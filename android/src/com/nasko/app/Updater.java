package com.nasko.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.util.Locale;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

/**
 * Mise à jour de l'application depuis le PC (méthode officielle Android : PackageInstaller).
 * Le PC publie /api/app/version ; l'APK est vérifiée (SHA-256) puis Android exige la MÊME signature que l'application
 * installée : une APK d'une autre origine est refusée par le système.
 */
final class Updater {
    private final Activity act;
    private final SharedPreferences prefs;

    Updater(Activity act, SharedPreferences prefs) {
        this.act = act;
        this.prefs = prefs;
    }

    long installedCode() {
        try {
            PackageInfo pi = act.getPackageManager().getPackageInfo(act.getPackageName(), 0);
            return pi.getLongVersionCode();
        } catch (Exception e) {
            return 0;
        }
    }

    String installedName() {
        try {
            return act.getPackageManager().getPackageInfo(act.getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "?";
        }
    }

    private void toast(final String msg) {
        act.runOnUiThread(() -> Toast.makeText(act, msg, Toast.LENGTH_LONG).show());
    }

    /** Vérifie la version publiée par le PC ; propose la mise à jour si elle est plus récente. */
    void check(final String server, final boolean manual) {
        if (server == null || server.isEmpty()) return;
        new Thread(() -> {
            try {
                JSONObject j = new JSONObject(readText(server + "api/app/version"));
                final long remote = j.getLong("versionCode");
                final String name = j.optString("versionName", "?"), sha = j.optString("sha256", "");
                if (remote > installedCode()) {
                    act.runOnUiThread(() -> ask(server, name, sha));
                } else if (manual) {
                    toast("Eto est à jour (v" + installedName() + ").");
                }
            } catch (Exception e) {
                if (manual) toast("Vérification impossible : " + e.getMessage());
            }
        }).start();
    }

    private void ask(final String server, final String name, final String sha) {
        new AlertDialog.Builder(act, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle("Mise à jour Eto")
                .setMessage("La version " + name + " est disponible (installée : " + installedName() + "). L'application va redémarrer.")
                .setPositiveButton("METTRE À JOUR", (d, w) -> start(server, sha))
                .setNegativeButton("PLUS TARD", null)
                .show();
    }

    private void start(final String server, final String sha) {
        if (!act.getPackageManager().canRequestPackageInstalls()) {
            toast("Autorisez Eto à installer des mises à jour (une seule fois), puis relancez la mise à jour.");
            act.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + act.getPackageName())));
            return;
        }
        toast("Téléchargement de la mise à jour…");
        new Thread(() -> {
            try {
                File f = new File(act.getCacheDir(), "update.apk");
                String got = download(server + "nasko.apk", f);
                if (!sha.isEmpty() && !sha.equalsIgnoreCase(got)) {
                    f.delete();
                    toast("Mise à jour refusée : empreinte de l'APK incorrecte.");
                    return;
                }
                install(f);
            } catch (Exception e) {
                toast("Téléchargement impossible : " + e.getMessage());
            }
        }).start();
    }

    private void install(File f) throws Exception {
        PackageInstaller pi = act.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams p = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        if (Build.VERSION.SDK_INT >= 31) p.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
        int id = pi.createSession(p);
        PackageInstaller.Session s = pi.openSession(id);
        try (OutputStream out = s.openWrite("nasko", 0, f.length()); InputStream in = new FileInputStream(f)) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            s.fsync(out);
        }
        Intent i = new Intent(act, UpdateReceiver.class).setAction("com.nasko.app.INSTALL_RESULT");
        PendingIntent pend = PendingIntent.getBroadcast(act, id, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
        s.commit(pend.getIntentSender());
        s.close();
    }

    // ------------------------------------------------------------------ réseau (certificat du PC épinglé)
    HttpURLConnection open(String url) throws Exception {          // visible du paquet : réutilisé par Downloader (certificat épinglé)
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        if (c instanceof HttpsURLConnection) ((HttpsURLConnection) c).setSSLSocketFactory(pinnedFactory());
        c.setConnectTimeout(4000);
        c.setReadTimeout(20000);
        return c;
    }

    private String readText(String url) throws Exception {
        HttpURLConnection c = open(url);
        if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
        try (InputStream in = c.getInputStream()) {
            java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
            byte[] b = new byte[4096];
            int n;
            while ((n = in.read(b)) > 0) bo.write(b, 0, n);
            return bo.toString("UTF-8");
        }
    }

    private String download(String url, File dst) throws Exception {
        HttpURLConnection c = open(url);
        if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(dst)) {
            byte[] b = new byte[65536];
            int n;
            while ((n = in.read(b)) > 0) {
                out.write(b, 0, n);
                md.update(b, 0, n);
            }
        }
        StringBuilder sb = new StringBuilder();
        for (byte x : md.digest()) sb.append(String.format("%02x", x & 0xff));
        return sb.toString();
    }

    private SSLSocketFactory pinnedFactory() throws Exception {
        TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        tmf.init((KeyStore) null);
        SSLContext ctx = SSLContext.getInstance("TLS");
        ctx.init(null, new TrustManager[]{new PinTrust((X509TrustManager) tmf.getTrustManagers()[0], prefs.getString("pin", ""))}, null);
        return ctx.getSocketFactory();
    }

    /** Accepte la chaîne si Android lui fait confiance, ou si le certificat du PC est celui que l'utilisateur a validé (empreinte). */
    static final class PinTrust implements X509TrustManager {
        private final X509TrustManager def;
        private final String pin;

        PinTrust(X509TrustManager def, String pin) {
            this.def = def;
            this.pin = pin;
        }

        @Override
        public void checkClientTrusted(X509Certificate[] chain, String type) throws CertificateException {
            def.checkClientTrusted(chain, type);
        }

        @Override
        public void checkServerTrusted(X509Certificate[] chain, String type) throws CertificateException {
            try {
                def.checkServerTrusted(chain, type);
            } catch (CertificateException e) {
                if (pin.isEmpty() || chain == null || chain.length == 0 || !pin.equalsIgnoreCase(fp(chain[0]))) throw e;
            }
        }

        @Override
        public X509Certificate[] getAcceptedIssuers() {
            return def.getAcceptedIssuers();
        }

        private static String fp(X509Certificate c) throws CertificateException {
            try {
                byte[] d = MessageDigest.getInstance("SHA-256").digest(c.getEncoded());
                StringBuilder sb = new StringBuilder();
                for (int i = 0; i < d.length; i++) {
                    if (i > 0) sb.append(':');
                    sb.append(String.format(Locale.ROOT, "%02X", d[i] & 0xff));
                }
                return sb.toString();
            } catch (Exception e) {
                throw new CertificateException(e);
            }
        }
    }
}
