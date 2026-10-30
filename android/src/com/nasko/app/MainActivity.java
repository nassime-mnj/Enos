package com.nasko.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.net.http.SslCertificate;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.ValueCallback;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.net.InetSocketAddress;
import java.net.Socket;
import java.security.MessageDigest;
import java.security.cert.X509Certificate;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.Locale;

import org.json.JSONObject;

/**
 * Eto : coque Android autour de l'interface web de E.N.O.S. (PC).
 * - adresse du PC (et du relais de réveil) saisie une fois ;
 * - le certificat du PC est épinglé (empreinte SHA-256 validée par l'utilisateur) : aucune installation de certificat ;
 * - si le PC est injoignable : page « hors ligne » avec reconnexion automatique et bouton ALLUMER LE PC (relais).
 */
public class MainActivity extends Activity {
    private static final String ASSET = "file:///android_asset/app.html";
    private static final String LOCAL_APP = "file:///android_asset/mobile/index.html";

    private WebView web;
    private FrameLayout root;
    private View customView;
    private WebChromeClient.CustomViewCallback customCb;
    private SharedPreferences prefs;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private volatile boolean onAsset = false;
    private volatile String curHost = "";
    private boolean offline = false;
    private boolean sslPending = false;
    private String lastFp = "";
    private PermissionRequest pendingPerm;
    private Updater updater;
    private WebUpdater webUpd;
    private boolean webChecked = false;
    private Downloader downloader;
    private ValueCallback<Uri[]> fileCb;          // sélecteur de fichiers (galerie) demandé par la page
    private static final int REQ_FILE = 11;
    private boolean updateChecked = false;
    private volatile boolean onLocalApp = false;      // la page courante est l'application locale (seule autorisee a utiliser le pont "Enos")
    private KeyVault vault;
    private PcLink pcLink;
    private FilesBridge files;
    private GalleryScan gallery;
    private ConnectivityManager.NetworkCallback netCb;
    private volatile String pendingShare = "";        // capture d'ecran partagee vers l'application (menu Partager) : base64 en memoire seulement, lue UNE fois par le JavaScript
    private volatile String pendingImport = "";       // fichier chiffre recu par enos://import (en memoire seulement) ; applique uniquement apres saisie du code
    private int importFails = 0;
    private volatile boolean keepAlive = false;      // Super Enos s'entraîne : la page reste active en arrière-plan (service de premier plan + verrou de réveil)
    private boolean paused = false;
    private android.content.BroadcastReceiver trainStop;

    // ------------------------------------------------------------------ cycle de vie
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        prefs = getSharedPreferences("nasko", MODE_PRIVATE);
        vault = new KeyVault(this);
        pcLink = new PcLink(prefs, vault);
        migrateToken();
        updater = new Updater(this, prefs);
        webUpd = new WebUpdater(this, prefs, updater.installedCode());
        webUpd.promoteIfStaged();                    // lot web téléchargé au lancement précédent : activé avant d'afficher la page
        downloader = new Downloader(this, updater);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);   // la visu F6 ne doit pas s'éteindre
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setUserAgentString(s.getUserAgentString() + " NaskoAndroid/" + updater.installedName());
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, false);
        web.addJavascriptInterface(new Bridge(), "NaskoApp");
        NativeHttp.Sink sink = new NativeHttp.Sink() {
            @Override
            public void emit(long id, String evt, String payload) {
                MainActivity.this.emit(id, evt, payload);
            }
        };
        files = new FilesBridge(this, sink);
        gallery = new GalleryScan(this, sink);
        web.addJavascriptInterface(new LocalBridge(this, vault, pcLink, new NativeHttp(vault, pcLink, sink), files), "Enos");
        watchNetwork();
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener(new DownloadListener() {         // liens de téléchargement du PC (SYNC, résultat de compression)
            @Override
            public void onDownloadStart(String url, String ua, String cd, String mime, long len) {
                if (!hostOf(url).equals(hostOf(server()))) return;
                // APK appairée (jeton complet) : le lien /dl/ est remplacé par /dle/ -> contenu AES-256-GCM, déchiffré dans l'application
                byte[] ek = SecureStream.encKey(pcLink.token());
                String u = (ek != null && url.contains("/dl/")) ? url.replaceFirst("/dl/", "/dle/") : url;
                downloader.start(u, cd, mime, ek);
            }
        });
        handleIntent(getIntent());
        showLocalApp();                                    // l'application a son propre cerveau : elle demarre sans le PC
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        setIntent(i);
        handleIntent(i);
        if (onLocalApp && web != null) {
            web.evaluateJavascript("window.ENOS&&ENOS.importer&&ENOS.importer.check()", null);
            if (!pendingShare.isEmpty()) web.evaluateJavascript("window.ENOS&&ENOS.native&&ENOS.native._shared&&ENOS.native._shared()", null);
        }
    }

    /** Menu Partager d'Android : une image (ex. capture d'ecran d'un echiquier) est lue en memoire (12 Mo max) ; le JavaScript la recupere par pendingShare(). */
    private void readShared(Intent i) {
        try {
            String type = i.getType();
            if (type == null || !type.startsWith("image/")) return;
            Uri u = i.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u == null) return;
            InputStream in = getContentResolver().openInputStream(u);
            if (in == null) return;
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int n;
            long total = 0;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > 12L * 1024 * 1024) { in.close(); return; }
                out.write(buf, 0, n);
            }
            in.close();
            pendingShare = android.util.Base64.encodeToString(out.toByteArray(), android.util.Base64.NO_WRAP);
        } catch (Exception ignored) {
            pendingShare = "";
        }
    }

    String pendingShare() {
        String b = pendingShare;
        pendingShare = "";
        return b;
    }

    private void handleIntent(Intent i) {
        if (i != null && Intent.ACTION_SEND.equals(i.getAction())) readShared(i);
        Uri d = i == null ? null : i.getData();
        if (d != null && "enos".equals(d.getScheme()) && "import".equals(d.getHost())) {
            String b = d.getQueryParameter("d");
            if (b != null && b.length() > 50 && b.length() < 30000) {
                pendingImport = b;
                importFails = 0;
            }
        }
    }

    String pendingImport() { return pendingImport; }

    /** Applique l'import apres verification du code. 5 mauvais codes : le fichier est oublie (il faut relancer le script sur le PC). */
    String applyImport(String blob, String code, KeyVault v, PcLink pc) {
        String b = blob == null || blob.trim().isEmpty() ? pendingImport : blob.trim();
        if (b.isEmpty()) return "{\"ok\":false,\"error\":\"Aucun fichier d'import.\"}";
        String r = Importer.apply(b, code, v, pc);
        if (r.contains("\"ok\":true")) {
            pendingImport = "";
            importFails = 0;
        } else if (r.contains("Code incorrect") && ++importFails >= 5) {
            pendingImport = "";
            return "{\"ok\":false,\"error\":\"Trop d'essais : relance envoyer_cles sur le PC.\"}";
        }
        return r;
    }

    @Override
    protected void onResume() {
        super.onResume();
        paused = false;
        web.onResume();
        if (offline) ui.post(probe);
    }

    @Override
    protected void onPause() {
        CookieManager.getInstance().flush();
        ui.removeCallbacks(probe);
        paused = true;
        if (!keepAlive) web.onPause();                 // entraînement en cours : on ne gèle pas la page (sinon Stockfish s'arrête avec l'écran)
        super.onPause();
    }

    /** Super Enos : garde l'application active en arrière-plan (service de premier plan + verrou de réveil) ou relâche. Appelé par le pont, sur le thread principal. */
    void setKeepAlive(final boolean on, final String text) {
        ui.post(new Runnable() {
            @Override
            public void run() {
                if (on == keepAlive) return;
                keepAlive = on;
                if (on) {
                    if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
                        requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 12);     // sans elle, le service tourne mais la notification reste cachée
                    if (trainStop == null) {
                        trainStop = new android.content.BroadcastReceiver() {
                            @Override
                            public void onReceive(android.content.Context c, Intent i) {
                                keepAlive = false;
                                if (paused && web != null) web.onPause();
                                if (onLocalApp && web != null) web.evaluateJavascript("window.ENOS&&ENOS.trainUi&&ENOS.trainUi.stopFromNative()", null);
                            }
                        };
                        android.content.IntentFilter f = new android.content.IntentFilter(TrainService.ACTION_STOP);
                        if (Build.VERSION.SDK_INT >= 33) registerReceiver(trainStop, f, android.content.Context.RECEIVER_NOT_EXPORTED);
                        else registerReceiver(trainStop, f);
                    }
                    TrainService.start(MainActivity.this, text);
                } else {
                    TrainService.stop(MainActivity.this);
                    if (paused && web != null) web.onPause();
                }
            }
        });
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacksAndMessages(null);
        keepAlive = false;
        TrainService.stop(this);
        try {
            if (trainStop != null) unregisterReceiver(trainStop);
        } catch (Exception ignored) {
        }
        try {
            if (netCb != null) ((ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE)).unregisterNetworkCallback(netCb);
        } catch (Exception ignored) {
        }
        if (web != null) {
            root.removeView(web);
            web.destroy();
        }
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (customView != null) {
            hideCustom();
        } else if (onLocalApp) {
            // l'application decide (feuille ouverte, sous-ecran, onglet) ; sinon on la met en arriere-plan
            web.evaluateJavascript("(window.ENOS&&ENOS.ui&&ENOS.ui.back())?1:0", new ValueCallback<String>() {
                @Override
                public void onReceiveValue(String v) {
                    if (!"1".equals(v)) moveTaskToBack(true);
                }
            });
        } else if (!onAsset && web.canGoBack()) {
            web.goBack();                    // l'interface du PC empile des etats (panneau F6) : retour = fermer le panneau
        } else if (!onAsset) {
            showLocalApp();                  // depuis l'interface complete du PC : retour a l'application
        } else {
            moveTaskToBack(true);
        }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == FilesBridge.REQ_TREE) {
            files.onTreeResult(res, data);
            return;
        }
        if (req == GalleryScan.REQ_DELETE || req == GalleryScan.REQ_DELETE_ONE) {
            gallery.onDeleteResult(req, res);
            return;
        }
        if (req == REQ_FILE) {
            if (fileCb != null) {
                fileCb.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
                fileCb = null;
            }
            return;
        }
        super.onActivityResult(req, res, data);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        if (code == GalleryScan.REQ_PERM) {
            gallery.onPermissionResult(res);
            return;
        }
        PermissionRequest r = pendingPerm;
        pendingPerm = null;
        if (r == null) return;
        String want = code == 8 ? PermissionRequest.RESOURCE_VIDEO_CAPTURE : PermissionRequest.RESOURCE_AUDIO_CAPTURE;
        if (res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED) r.grant(new String[]{want});
        else r.deny();
    }

    // ------------------------------------------------------------------ navigation
    private String server() {
        String s = prefs.getString("server", "");
        if (!s.isEmpty()) return s;
        java.util.List<String> a = pcLink.addrs();
        return a.isEmpty() ? "" : PcLink.url(a.get(0));
    }

    boolean onLocalApp() { return onLocalApp; }

    GalleryScan gallery() { return gallery; }

    /** Mise à jour depuis le cloud : l'adresse (avec le jeton d'appareil) est dans le coffre ; même Updater que pour le PC (SHA-256 vérifié, Android exige la même signature que l'application installée). */
    /** CodeLab : aperçu web dans PreviewActivity (aucun pont JS) ; la console de l'aperçu revient dans le terminal de CodeLab. */
    void openPreview(final String html, final String title) {
        PreviewActivity.pendingHtml = html;
        PreviewActivity.pendingTitle = title == null ? "" : title;
        PreviewActivity.listener = new PreviewActivity.Listener() {
            @Override public void log(final String json) {
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        if (onLocalApp && web != null) web.evaluateJavascript("window.ENOS&&ENOS.codelab&&ENOS.codelab.previewLog(" + JSONObject.quote(json) + ")", null);
                    }
                });
            }
        };
        startActivity(new Intent(this, PreviewActivity.class));
    }

    void checkCloudUpdate(boolean manual) {
        String b = vault.get("cloud_update_base");
        if (b.startsWith("https://")) updater.check(b.endsWith("/") ? b : b + "/", manual);
    }

    String versionName() { return updater.installedName(); }

    /** Mise à jour instantanée de la partie web depuis GitHub (voir WebUpdater). apply : activer et recharger tout de suite. Résultat JSON via emit(id). */
    void webUpdate(final long id, final boolean apply) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                String r = webUpd.run(apply);
                emit(id, "webupd", r);
                if (id == 0 && r.contains("\"ready\"")) ui.post(new Runnable() { @Override public void run() { if (onLocalApp && web != null) web.evaluateJavascript("ENOS.ui&&ENOS.ui.toast('Mise à jour prête : Réglages › METTRE À JOUR','ok')", null); } });
                if (r.contains("\"applied\"")) ui.post(new Runnable() { @Override public void run() { if (web != null) web.loadUrl(LOCAL_APP); } });
            }
        }).start();
    }

    String webUpdateInfo() {
        return "{\"label\":\"" + esc(webUpd.label()) + "\",\"branch\":\"" + esc(webUpd.branch()) + "\",\"auto\":" + webUpd.auto() + "}";
    }

    void setWebUpdate(String branch, boolean auto) {
        SharedPreferences.Editor e = prefs.edit().putBoolean("web_auto", auto);
        if (branch != null && branch.matches("[A-Za-z0-9._/-]{1,80}")) e.putString("web_branch", branch);
        e.apply();
    }

    private String esc(String s) { return s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\""); }

    /** Application locale (HTML/JS embarques) : ecran de demarrage par defaut. */
    private void showLocalApp() {
        onAsset = true;
        onLocalApp = true;
        offline = false;
        ui.removeCallbacks(probe);
        web.loadUrl(LOCAL_APP);
    }

    /** "Ouvrir l'interface complete du PC" (ancienne coque) : charge l'interface web servie par le PC, ou l'ecran de reglages herite si aucun PC n'est configure. */
    void openPcUi() { ui.post(this::go); }

    /** Ouvre l'interface complète du PC directement sur le module `id` (ex. "b-ch" = mode chill). La clé part dans l'en-tête de la première requête : aucune page de code. */
    void openPcModule(final String id) {
        if (id == null || !id.matches("[A-Za-z0-9_-]{1,30}") || server().isEmpty() || pcLink.token().isEmpty()) {
            openPcUi();
            return;
        }
        ui.post(new Runnable() {
            @Override
            public void run() {
                String key;
                try {
                    key = pcLink.token().trim().split("\\.")[1];
                } catch (Exception e) {
                    go();
                    return;
                }
                java.util.Map<String, String> h = new java.util.HashMap<>();
                h.put("Authorization", "Bearer " + key);
                h.put("X-Eto-Device", pcLink.deviceId());
                onAsset = false;
                onLocalApp = false;
                offline = false;
                web.loadUrl(server() + "#open=" + id, h);
            }
        });
    }

    void wakeRelay() {
        ui.post(new Runnable() {
            @Override
            public void run() {
                offline = false;
                if (relay().isEmpty()) showAsset("setup");
                else web.loadUrl(relay());
            }
        });
    }

    /** Pont -> page : evenement d'un appel asynchrone (callbacks ENOS.native._cb). Ignore si la page n'est plus l'application locale. */
    void emit(final long id, final String evt, final String payload) {
        final String js = "ENOS.native._cb(" + id + "," + JSONObject.quote(evt) + "," + JSONObject.quote(payload) + ")";
        ui.post(new Runnable() {
            @Override
            public void run() {
                if (onLocalApp && web != null) web.evaluateJavascript(js, null);
            }
        });
    }

    /** Wi-Fi rejoint, VPN (Tailscale) active, reseau perdu : la page relance aussitot la recherche du PC. */
    private void watchNetwork() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            netCb = new ConnectivityManager.NetworkCallback() {
                private void push(final boolean online, NetworkCapabilities caps) {
                    final String t = caps == null ? "" : caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) ? "vpn" : caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ? "wifi" : "cell";
                    ui.post(new Runnable() {
                        @Override
                        public void run() {
                            if (onLocalApp && web != null) web.evaluateJavascript("ENOS.native._net(" + online + "," + JSONObject.quote(t) + ")", null);
                        }
                    });
                }

                @Override
                public void onAvailable(Network n) {
                    push(true, ((ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE)).getNetworkCapabilities(n));
                }

                @Override
                public void onCapabilitiesChanged(Network n, NetworkCapabilities c) {
                    push(true, c);
                }

                @Override
                public void onLost(Network n) {
                    push(false, null);
                }
            };
            cm.registerDefaultNetworkCallback(netCb);
        } catch (Exception ignored) {
        }
    }

    /** Ancienne coque : jeton en clair dans les preferences. Il est deplace dans le coffre Keystore (puis efface) au premier lancement de la nouvelle version. */
    private void migrateToken() {
        String legacy = prefs.getString("apikey", "");
        if (!legacy.isEmpty() && SecureStream.validToken(legacy) && !vault.has("pc_token") && vault.set("pc_token", legacy)) prefs.edit().remove("apikey").apply();
    }

    private String relay() { return prefs.getString("relay", ""); }

    private void go() {
        offline = false;
        String s = server();
        if (s.isEmpty()) showAsset("setup");
        else web.loadUrl(s);
    }

    private void showAsset(String mode) {
        onAsset = true;
        offline = "offline".equals(mode);
        web.loadUrl(ASSET + "#" + mode);
        if (offline) {
            ui.removeCallbacks(probe);
            ui.postDelayed(probe, 3000);
        }
    }

    /** Tant que la page « hors ligne » est affichée : teste le PC toutes les 4 s et recharge dès qu'il répond. */
    private final Runnable probe = this::doProbe;

    private void doProbe() {
        if (!offline) return;
        final String s = server();
        new Thread(() -> {
            final boolean ok = reachable(s);
            ui.post(() -> {
                if (!offline) return;
                if (ok) go();
                else ui.postDelayed(probe, 4000);
            });
        }).start();
    }

    private static boolean reachable(String url) {
        try {
            Uri u = Uri.parse(url);
            int port = u.getPort() > 0 ? u.getPort() : ("https".equals(u.getScheme()) ? 443 : 80);
            try (Socket sock = new Socket()) {
                sock.connect(new InetSocketAddress(u.getHost(), port), 1200);
                return true;
            }
        } catch (Exception e) {
            return false;
        }
    }

    private static String hostOf(String url) {
        try {
            String h = Uri.parse(url).getHost();
            return h == null ? "" : h.toLowerCase(Locale.ROOT);
        } catch (Exception e) {
            return "";
        }
    }

    /** "192.168.1.28" -> "https://192.168.1.28:8443/" ; refuse ce qui n'est pas http(s). */
    private static String normalize(String in, String scheme, int defPort) {
        String t = in == null ? "" : in.trim();
        if (t.isEmpty()) return "";
        if (!t.contains("://")) t = scheme + "://" + t;
        Uri u = Uri.parse(t);
        String sch = u.getScheme(), host = u.getHost();
        if (host == null || host.isEmpty() || sch == null || !(sch.equals("http") || sch.equals("https"))) return "";
        int port = u.getPort() > 0 ? u.getPort() : defPort;
        return sch + "://" + host + (port > 0 ? ":" + port : "") + "/";
    }

    private static String fingerprint(SslCertificate c) {
        try {
            X509Certificate x = c.getX509Certificate();
            if (x == null) return "";
            byte[] d = MessageDigest.getInstance("SHA-256").digest(x.getEncoded());
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < d.length; i++) {
                if (i > 0) sb.append(':');
                sb.append(String.format("%02X", d[i] & 0xff));
            }
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    // ------------------------------------------------------------------ plein écran (bouton ⛶ de la visu)
    private void showCustom(View v, WebChromeClient.CustomViewCallback cb) {
        if (customView != null) {
            cb.onCustomViewHidden();
            return;
        }
        customView = v;
        customCb = cb;
        root.addView(v, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web.setVisibility(View.GONE);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    private void hideCustom() {
        if (customView == null) return;
        root.removeView(customView);
        customView = null;
        web.setVisibility(View.VISIBLE);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        if (customCb != null) customCb.onCustomViewHidden();
        customCb = null;
    }

    // ------------------------------------------------------------------ client web
    class Client extends WebViewClient {
        @Override
        public void onPageStarted(WebView v, String url, Bitmap icon) {
            onAsset = url != null && url.startsWith("file:///android_asset/");
            onLocalApp = url != null && url.startsWith("file:///android_asset/mobile/");
            curHost = onAsset ? "" : hostOf(url);
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
            return "GET".equals(r.getMethod()) ? webUpd.intercept(r.getUrl().toString()) : null;
        }

        @Override
        public void onPageFinished(WebView v, String url) {
            // une fois par lancement : télécharge en silence la mise à jour web (activée au prochain lancement ou via le bouton)
            if (!webChecked && onLocalApp && webUpd.auto()) {
                webChecked = true;
                webUpdate(0, false);
            }
            // une fois par lancement, quand le PC répond : cherche une mise à jour de l'application
            if (!updateChecked && !onAsset && url != null && !server().isEmpty() && hostOf(url).equals(hostOf(server()))) {
                updateChecked = true;
                updater.check(server(), false);
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
            Uri u = r.getUrl();
            String url = u.toString();
            if (url.startsWith("file:///android_asset/") || url.startsWith("about:")) return false;
            String h = hostOf(url);
            if (h.equals(hostOf(server())) || h.equals(hostOf(relay()))) return false;
            if (curHost.equals(hostOf(relay())) && !curHost.isEmpty()) return false;   // « OUVRIR E.N.O.S. » depuis le relais
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, u));                      // le reste s'ouvre dans le navigateur du téléphone
            } catch (Exception ignored) {
            }
            return true;
        }

        @Override
        public void onReceivedSslError(WebView v, SslErrorHandler h, SslError e) {
            String fp = fingerprint(e.getCertificate());
            String pin = prefs.getString("pin", "");
            if (!fp.isEmpty() && fp.equalsIgnoreCase(pin)) {
                h.proceed();                  // certificat du PC déjà validé par l'utilisateur
                return;
            }
            h.cancel();
            String host = hostOf(e.getUrl());
            if (host.equals(hostOf(server()))) {
                sslPending = true;
                lastFp = fp;
                showAsset("trust");
            }
        }

        @Override
        public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError err) {
            if (!r.isForMainFrame() || onAsset) return;
            if (sslPending) {
                sslPending = false;
                return;
            }
            showAsset("offline");
        }

        @Override
        public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail d) {
            ui.post(MainActivity.this::recreate);
            return true;
        }
    }

    class Chrome extends WebChromeClient {
        @Override
        public void onPermissionRequest(final PermissionRequest r) {
            runOnUiThread(() -> {
                boolean video = false;
                for (String x : r.getResources()) if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(x)) video = true;
                if (video) {                                    // scan du QR d'appairage : caméra réservée à l'application locale
                    if (!onLocalApp) r.deny();
                    else if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) r.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                    else { pendingPerm = r; requestPermissions(new String[]{Manifest.permission.CAMERA}, 8); }
                    return;
                }
                boolean mine = hostOf(r.getOrigin().toString()).equals(hostOf(server()));
                boolean audio = false;
                for (String x : r.getResources()) if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(x)) audio = true;
                if (!mine || !audio) {
                    r.deny();
                } else if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    r.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                } else {
                    pendingPerm = r;
                    requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, 7);
                }
            });
        }

        /** Envoi de fichiers vers le PC (SYNC, compression) : ouvre le sélecteur Android, uniquement pour les pages du PC configuré. */
        @Override
        public boolean onShowFileChooser(WebView w, ValueCallback<Uri[]> cb, FileChooserParams p) {
            if (!onLocalApp && !hostOf(String.valueOf(w.getUrl())).equals(hostOf(server()))) {      // l'application locale (photos a compresser) ou le PC configure seulement
                cb.onReceiveValue(null);
                return true;
            }
            if (fileCb != null) fileCb.onReceiveValue(null);
            fileCb = cb;
            try {
                startActivityForResult(p.createIntent(), REQ_FILE);
            } catch (Exception e) {
                fileCb = null;
                cb.onReceiveValue(null);
            }
            return true;
        }

        @Override
        public void onShowCustomView(View v, CustomViewCallback cb) {
            showCustom(v, cb);
        }

        @Override
        public void onHideCustomView() {
            hideCustom();
        }
    }

    // ------------------------------------------------------------------ pont JavaScript (pages de l'application uniquement)
    class Bridge {
        private boolean fromApp() { return onAsset; }

        @JavascriptInterface
        public String info() {
            if (!fromApp()) return "{}";
            String pin = prefs.getString("pin", "");
            return "{\"server\":\"" + esc(server()) + "\",\"relay\":\"" + esc(relay()) + "\",\"fp\":\"" + esc(lastFp)
                    + "\",\"changed\":" + (!pin.isEmpty() && !pin.equalsIgnoreCase(lastFp)) + ",\"version\":\"" + esc(updater.installedName()) + "\""
                    + ",\"hasKey\":" + (!pcLink.token().isEmpty()) + ",\"keyFp\":\"" + esc(SecureStream.fingerprint(pcLink.token())) + "\"}";
        }

        @JavascriptInterface
        public String save(String serverIn, String relayIn) {
            if (!fromApp()) return "refusé";
            String s = normalize(serverIn, "https", 8443), r = normalize(relayIn, "http", 8088);
            if (s.isEmpty()) return "Adresse du PC invalide (ex. 192.168.1.28 ou 100.64.0.5)";
            if (!(relayIn == null || relayIn.trim().isEmpty()) && r.isEmpty()) return "Adresse du relais invalide";
            if (!s.equals(server())) prefs.edit().remove("pin").apply();           // autre PC : nouvelle validation du certificat
            prefs.edit().putString("server", s).putString("relay", r).apply();
            ui.post(MainActivity.this::go);
            return "";
        }

        /** Jeton d'appairage (panneau SÉCURITÉ du PC), collé UNE fois dans les réglages. Vide = efface la clé. */
        @JavascriptInterface
        public String saveKey(String token) {
            if (!fromApp()) return "refusé";
            String t = token == null ? "" : token.trim();
            if (t.isEmpty()) {
                prefs.edit().remove("apikey").apply();
                vault.del("pc_token");
                return "";
            }
            if (!SecureStream.validToken(t)) return "Jeton invalide : collez le jeton complet du panneau SÉCURITÉ (il commence par NK1.)";
            if (!vault.set("pc_token", t)) return "Coffre indisponible sur ce téléphone";
            prefs.edit().remove("apikey").apply();
            return "";
        }

        /** Lu par l'interface du PC (sec.js) pour ajouter Authorization: Bearer à chaque requête. Jamais fourni à un autre site. */
        @JavascriptInterface
        public String apiKey() {
            if (onAsset || curHost.isEmpty() || !curHost.equals(hostOf(server()))) return "";
            return pcLink.token();
        }

        /** Identifiant unique de CE téléphone (UUID aléatoire créé à la première demande). Le PC l'ajoute à la liste « Appareils de confiance »
         *  pour passer l'application de « Eto » (limitée) à « Eto Dev » (E.N.O.S. complet). Fourni uniquement au PC appairé. */
        @JavascriptInterface
        public String deviceId() {
            if (onAsset || curHost.isEmpty() || !curHost.equals(hostOf(server()))) return "";
            String id = prefs.getString("device_id", "");
            if (id.isEmpty()) {
                id = java.util.UUID.randomUUID().toString();
                prefs.edit().putString("device_id", id).apply();
            }
            return id;
        }

        @JavascriptInterface
        public void trust() {
            if (!fromApp() || lastFp.isEmpty()) return;
            prefs.edit().putString("pin", lastFp).apply();
            ui.post(MainActivity.this::go);
        }

        @JavascriptInterface
        public void retry() {
            if (fromApp()) ui.post(MainActivity.this::go);
        }

        @JavascriptInterface
        public void wake() {
            if (!fromApp()) return;
            final String r = relay();
            ui.post(() -> {
                offline = false;
                if (r.isEmpty()) showAsset("setup");
                else web.loadUrl(r);
            });
        }

        /** Réglages : aussi appelable depuis l'interface E.N.O.S. du PC configuré (bouton « RÉGLAGES DE L'APPLICATION »). */
        @JavascriptInterface
        public void settings() {
            if (!(fromApp() || (!curHost.isEmpty() && curHost.equals(hostOf(server()))))) return;
            ui.post(() -> showAsset("setup"));
        }

        @JavascriptInterface
        public String version() { return updater.installedName(); }

        @JavascriptInterface
        public void checkUpdate() {
            if (fromApp() || (!curHost.isEmpty() && curHost.equals(hostOf(server())))) updater.check(server(), true);
        }

        private String esc(String s) {
            return s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\"");
        }
    }
}
