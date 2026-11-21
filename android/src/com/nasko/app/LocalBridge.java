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

    // ------------------------------------------------------------------ journal de plantages (CrashLog.java) : lecture / ajout depuis js/crashlog.js / effacement
    @JavascriptInterface
    public String crashLog() {
        return ok() ? CrashLog.text() : "";
    }

    private long crashT0;
    private int crashN;

    @JavascriptInterface
    public void crashAdd(String kind, String msg) {
        if (!ok()) return;
        long now = System.currentTimeMillis();
        if (now - crashT0 > 60000) { crashT0 = now; crashN = 0; }
        if (++crashN > 40) return;                                            // au plus 40 lignes par minute (boucle d'erreurs)
        CrashLog.add(kind == null || kind.length() > 12 ? "JS" : kind, msg);
    }

    @JavascriptInterface
    public boolean crashClear() {
        return ok() && CrashLog.clear();
    }

    @JavascriptInterface
    public boolean saveBegin(String name, String mime, String collection) {
        return ok() && files.saveBegin(name, mime, collection);
    }

    @JavascriptInterface
    public boolean saveChunk(String b64) {
        return ok() && files.saveChunk(b64);
    }

    @JavascriptInterface
    public boolean saveEnd(boolean ok) {
        return ok() && files.saveEnd(ok);
    }

    // ------------------------------------------------------------------ sauvegarde de l'application (Download/ENOS/enos-sauvegarde-*.json)
    @JavascriptInterface
    public boolean backupWrite(String name, String text) {
        return ok() && files.backupWrite(name, text);
    }

    @JavascriptInterface
    public String backupList() {
        return ok() ? files.backupList() : "[]";
    }

    @JavascriptInterface
    public String backupRead(String id) {
        try {
            return ok() ? files.backupRead(Long.parseLong(id)) : "";
        } catch (NumberFormatException e) {
            return "";
        }
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

    // ------------------------------------------------------------------ Mobile Improver (Improver : préparation, remplacement avec autorisation système, corbeille 30 jours)
    @JavascriptInterface
    public String improverState() {
        return ok() ? Improver.summary(act) : "{}";
    }

    @JavascriptInterface
    public void improverConfig(String json) {
        if (ok()) Improver.configure(act, json == null ? "{}" : json);
    }

    @JavascriptInterface
    public boolean improverSchedule(boolean on) {
        return ok() && Improver.schedule(act, on);
    }

    /** Prépare maintenant (fil d'arrière-plan) : événements « progress » {done,total,saved} puis « done » {staged}. */
    @JavascriptInterface
    public void improverRun(final long id) {
        if (!ok()) return;
        if (!act.gallery().hasPermission()) {
            act.emit(id, "error", "Accès aux photos refusé.");
            return;
        }
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                int n = Improver.analyze(act, 20 * 60 * 1000L, 2000, new Improver.Progress() {
                    @Override
                    public void on(int done, int total, long saved) {
                        act.emit(id, "progress", "{\"done\":" + done + ",\"total\":" + total + ",\"saved\":" + saved + "}");
                    }
                });
                act.emit(id, n < 0 ? "error" : "done", n < 0 ? "Une préparation est déjà en cours." : "{\"staged\":" + n + "}");
            }
        }, "improver-run");
        t.setPriority(Thread.MIN_PRIORITY + 1);
        t.start();
    }

    @JavascriptInterface
    public void improverCancel() {
        if (ok()) Improver.CANCEL.set(true);
    }

    @JavascriptInterface
    public void improverApply(final long id) {
        if (ok()) act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                act.improver().apply(id);
            }
        });
    }

    @JavascriptInterface
    public void improverRestore(final long id, final String tid) {
        if (ok() && tid != null && tid.matches("[0-9]{1,18}_[0-9]{1,12}")) act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                act.improver().restore(id, tid);
            }
        });
    }

    @JavascriptInterface
    public void improverDiscard() {
        if (ok()) Improver.discard(act);
    }

    @JavascriptInterface
    public void improverEmptyTrash() {
        if (ok()) Improver.emptyTrash(act);
    }

    @JavascriptInterface
    public String pendingModule() {
        return ok() ? act.pendingModule() : "";
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

    /** Paiement ETO : ouvre la page Stripe (Checkout / portail client) dans le navigateur du téléphone. Seules les adresses https de Stripe sont acceptées. */
    @JavascriptInterface
    public boolean openCheckout(String url) {
        if (!ok()) return false;
        try {
            android.net.Uri u = android.net.Uri.parse(url == null ? "" : url);
            String h = u.getHost() == null ? "" : u.getHost();
            if (!"https".equals(u.getScheme()) || !(h.equals("checkout.stripe.com") || h.equals("billing.stripe.com"))) return false;
            act.startActivity(new android.content.Intent(android.content.Intent.ACTION_VIEW, u));
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** Support : ouvre l'application de messagerie vers l'adresse de DualPulse (adresse FIXE, seuls l'objet et le texte viennent de l'interface). */
    @JavascriptInterface
    public boolean openSupportMail(String subject, String body) {
        if (!ok()) return false;
        try {
            android.content.Intent i = new android.content.Intent(android.content.Intent.ACTION_SENDTO, android.net.Uri.parse("mailto:dualpulse.co@gmail.com"));
            i.putExtra(android.content.Intent.EXTRA_SUBJECT, subject == null ? "" : subject.substring(0, Math.min(200, subject.length())));
            i.putExtra(android.content.Intent.EXTRA_TEXT, body == null ? "" : body.substring(0, Math.min(20000, body.length())));
            act.startActivity(i);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** Application de TEST (« Eto TEST », identifiant com.nasko.app.test) : l'interface y propose de simuler chaque version / abonnement. */
    @JavascriptInterface
    public boolean isTestBuild() {
        return act.getPackageName().endsWith(".test");
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

    // ------------------------------------------------------------------ ENOS Cleaner (espace CEO) : versions d'E.N.O.S. / Eto installées sur le téléphone
    /** [{pkg, label, version, code, installed, updated, size, self}] pour les paquets com.nasko.* (application normale, version TEST, anciennes éditions) */
    @JavascriptInterface
    public String enosApps() {
        if (!ok()) return "[]";
        try {
            android.content.pm.PackageManager pm = act.getPackageManager();
            org.json.JSONArray out = new org.json.JSONArray();
            java.util.HashSet<String> seen = new java.util.HashSet<>();
            android.content.Intent main = new android.content.Intent(android.content.Intent.ACTION_MAIN).addCategory(android.content.Intent.CATEGORY_LAUNCHER);
            java.util.List<String> pkgs = new java.util.ArrayList<>();
            for (android.content.pm.ResolveInfo ri : pm.queryIntentActivities(main, 0)) pkgs.add(ri.activityInfo.packageName);
            for (String k : new String[]{"com.nasko.app", "com.nasko.app.test"}) pkgs.add(k);
            for (String pkg : pkgs) {
                if (pkg == null || !pkg.startsWith("com.nasko") || !seen.add(pkg)) continue;
                android.content.pm.PackageInfo pi;
                try { pi = pm.getPackageInfo(pkg, 0); } catch (Exception notInstalled) { continue; }
                org.json.JSONObject o = new org.json.JSONObject();
                o.put("pkg", pkg);
                o.put("label", String.valueOf(pi.applicationInfo.loadLabel(pm)));
                o.put("version", pi.versionName == null ? "" : pi.versionName);
                o.put("code", android.os.Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode);
                o.put("installed", pi.firstInstallTime);
                o.put("updated", pi.lastUpdateTime);
                o.put("size", new java.io.File(pi.applicationInfo.sourceDir).length());
                o.put("self", pkg.equals(act.getPackageName()));
                out.put(o);
            }
            return out.toString();
        } catch (Exception e) {
            return "[]";
        }
    }

    /** ouvre la fenêtre système de désinstallation (l'utilisateur confirme) ; refusé pour l'application en cours et hors com.nasko.* */
    @JavascriptInterface
    public boolean uninstallApp(String pkg) {
        if (!ok() || pkg == null || !pkg.matches("com\\.nasko[A-Za-z0-9_.]*") || pkg.equals(act.getPackageName())) return false;
        try {
            android.content.Intent i = new android.content.Intent(android.content.Intent.ACTION_DELETE, android.net.Uri.parse("package:" + pkg));
            i.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
            act.startActivity(i);
            return true;
        } catch (Exception e) {
            return false;
        }
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
