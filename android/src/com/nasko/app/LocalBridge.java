package com.nasko.app;

import android.os.Environment;
import android.os.StatFs;
import android.webkit.JavascriptInterface;

/**
 * Pont « Enos » : exposé UNIQUEMENT à l'application locale (file:///android_asset/mobile/). Chaque méthode vérifie que la page courante est bien celle-ci.
 * Règle de conception : aucune méthode ne renvoie un secret (clé d'API, jeton) ; Java agit, le JavaScript demande.
 */
final class LocalBridge {
    private final MainActivity act;
    private final KeyVault vault;
    private final PcLink pc;
    private final NativeHttp http;
    private final FilesBridge files;

    LocalBridge(MainActivity act, KeyVault vault, PcLink pc, NativeHttp http, FilesBridge files) {
        this.act = act;
        this.vault = vault;
        this.pc = pc;
        this.http = http;
        this.files = files;
    }

    private boolean ok() {
        return act.onLocalApp();
    }

    // ------------------------------------------------------------------ coffre
    @JavascriptInterface
    public boolean vaultHas(String name) {
        return ok() && vault.has(name);
    }

    @JavascriptInterface
    public boolean vaultSet(String name, String value) {
        if (!ok()) return false;
        if ("pc_token".equals(name) && !SecureStream.validToken(value)) return false;
        return vault.set(name, value == null ? "" : value.trim());
    }

    @JavascriptInterface
    public boolean vaultDel(String name) {
        if (!ok()) return false;
        vault.del(name);
        return true;
    }

    // ------------------------------------------------------------------ HTTP (clés injectées côté Java)
    @JavascriptInterface
    public void http(long id, String json) {
        if (ok()) http.request(id, json);
    }

    @JavascriptInterface
    public void cancel(long id) {
        if (ok()) http.cancel(id);
    }

    // ------------------------------------------------------------------ PC
    @JavascriptInterface
    public String pcConfig() {
        return ok() ? pc.configJson() : "{}";
    }

    @JavascriptInterface
    public boolean pcSetAddrs(String s) {
        return ok() && pc.setAddrs(s == null ? "" : s);
    }

    @JavascriptInterface
    public void pcProbe(final long id, final int timeoutMs) {
        if (!ok()) return;
        new Thread(new Runnable() {
            @Override
            public void run() {
                act.emit(id, "probe", pc.probe(Math.max(500, Math.min(timeoutMs, 5000))));
            }
        }).start();
    }

    @JavascriptInterface
    public void pcFingerprint(final long id, final String addr) {
        if (!ok()) return;
        new Thread(new Runnable() {
            @Override
            public void run() {
                act.emit(id, "fp", pc.fingerprint(addr == null ? "" : addr.trim()));
            }
        }).start();
    }

    @JavascriptInterface
    public boolean pcPin(String addr, String fp) {
        return ok() && pc.pin(addr, fp);
    }

    @JavascriptInterface
    public void pcClear() {
        if (ok()) pc.clear();
    }

    @JavascriptInterface
    public String deviceId() {
        return ok() ? pc.deviceId() : "";
    }

    // ------------------------------------------------------------------ fichiers
    @JavascriptInterface
    public void treePick(long id) {
        if (ok()) act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                files.pickTree(id);
            }
        });
    }

    @JavascriptInterface
    public String treeList(String tree, String docId) {
        return ok() ? files.list(tree, docId) : "[]";
    }

    @JavascriptInterface
    public String treeOp(String op, String args) {
        return ok() ? files.op(op, args) : "{\"ok\":false}";
    }

    @JavascriptInterface
    public boolean saveMedia(String name, String mime, String b64, String collection) {
        return ok() && files.saveMedia(name, mime, b64, collection);
    }

    // ------------------------------------------------------------------ import de la configuration du PC (chiffree, code saisi par l'utilisateur)
    /** Image partagee vers l'application (base64, "" s'il n'y en a pas) : lue une seule fois. */
    @JavascriptInterface
    public String pendingShare() {
        return ok() ? act.pendingShare() : "";
    }

    @JavascriptInterface
    public String pendingImport() {
        return ok() ? act.pendingImport() : "";
    }

    @JavascriptInterface
    public void importApply(final long id, final String blob, final String code) {
        if (!ok()) return;
        new Thread(new Runnable() {
            @Override
            public void run() {
                act.emit(id, "import", act.applyImport(blob, code, vault, pc));
            }
        }).start();
    }

    // ------------------------------------------------------------------ nettoyeur de galerie (GalleryScan : résultats par événements, suppression confirmée par le système)
    @JavascriptInterface
    public void galleryPermission(final long id) {
        if (ok()) act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                act.gallery().requestPermission(id);
            }
        });
    }

    @JavascriptInterface
    public void galleryScan(long id) {
        if (ok()) act.gallery().start(id);
    }

    @JavascriptInterface
    public void galleryCancel() {
        if (ok()) act.gallery().cancel();
    }

    @JavascriptInterface
    public void galleryDelete(final long id, final String jsonUris) {
        if (ok()) act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                act.gallery().delete(id, jsonUris);
            }
        });
    }

    /** Vignette (data:image/jpeg) d'une image du dernier scan ; "" pour toute autre URI. */
    @JavascriptInterface
    public String galleryThumb(String uri) {
        return ok() ? act.gallery().thumb(uri) : "";
    }

    // ------------------------------------------------------------------ divers
    /** Stockage interne : {total, free} en octets (pour le Nettoyeur). */
    @JavascriptInterface
    public String storage() {
        if (!ok()) return "{}";
        try {
            StatFs s = new StatFs(Environment.getDataDirectory().getPath());
            return "{\"total\":" + s.getTotalBytes() + ",\"free\":" + s.getAvailableBytes() + "}";
        } catch (Exception e) {
            return "{}";
        }
    }

    @JavascriptInterface
    public String version() {
        return act.versionName();
    }

    @JavascriptInterface
    public void openPcUi() {
        if (ok()) act.openPcUi();
    }

    @JavascriptInterface
    public void openPcModule(String id) {
        if (ok()) act.openPcModule(id);
    }

    /** CodeLab : ouvre l'aperçu d'un projet web dans une activité séparée, sans pont JavaScript (voir PreviewActivity). */
    @JavascriptInterface
    public void openPreview(String html, String title) {
        if (ok() && html != null && html.length() <= 1500000) act.openPreview(html, title);
    }

    /** Mise à jour instantanée du web de l'application depuis GitHub (sans réinstaller l'APK). */
    @JavascriptInterface
    public void webUpdate(long id, boolean apply) {
        if (ok()) act.webUpdate(id, apply);
    }

    @JavascriptInterface
    public String webUpdateInfo() {
        return ok() ? act.webUpdateInfo() : "{}";
    }

    @JavascriptInterface
    public void setWebUpdate(String branch, boolean auto) {
        if (ok()) act.setWebUpdate(branch, auto);
    }

    @JavascriptInterface
    public void checkCloudUpdate(boolean manual) {
        if (ok()) act.checkCloudUpdate(manual);
    }

    /** Adresses IPv4 privées du téléphone (Wi-Fi) : le PC les lit via le cloud pour se connecter en ADB sans fil. */
    @JavascriptInterface
    public String lanIps() {
        if (!ok()) return "[]";
        try {
            org.json.JSONArray a = new org.json.JSONArray();
            for (java.util.Enumeration<java.net.NetworkInterface> e = java.net.NetworkInterface.getNetworkInterfaces(); e != null && e.hasMoreElements(); ) {
                java.net.NetworkInterface ni = e.nextElement();
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (java.util.Enumeration<java.net.InetAddress> ad = ni.getInetAddresses(); ad.hasMoreElements(); ) {
                    java.net.InetAddress x = ad.nextElement();
                    if (x instanceof java.net.Inet4Address && x.isSiteLocalAddress()) a.put(x.getHostAddress());
                }
            }
            return a.toString();
        } catch (Exception e) {
            return "[]";
        }
    }

    /** Super Enos : true = l'entraînement continue en arrière-plan (notification permanente + verrou de réveil), false = relâche. */
    @JavascriptInterface
    public void keepAlive(boolean on, String text) {
        if (ok()) act.setKeepAlive(on, text == null ? "" : text.length() > 120 ? text.substring(0, 120) : text);
    }

    @JavascriptInterface
    public void wake() {
        if (ok()) act.wakeRelay();
    }
}
