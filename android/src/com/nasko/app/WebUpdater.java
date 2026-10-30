package com.nasko.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.AssetManager;
import android.webkit.MimeTypeMap;
import android.webkit.WebResourceResponse;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;

/**
 * Mise à jour instantanée de la partie WEB de l'application (HTML / JS / CSS / images de android/assets/mobile), sans réinstaller l'APK :
 * lit le dépôt GitHub public, télécharge uniquement les fichiers modifiés (empreinte Git SHA-1 vérifiée), puis les sert à la place de ceux
 * embarqués dans l'APK (shouldInterceptRequest). Le code Java natif, lui, ne change qu'avec une nouvelle APK.
 * Sûreté : tout est téléchargé dans un dossier d'attente puis permuté d'un bloc ; au moindre échec on garde l'ancien état, et l'APK
 * embarque toujours une version complète qui sert de repli. Une nouvelle APK installée repart de zéro (superposition effacée).
 */
final class WebUpdater {
    static final String REPO = "nassime-mnj/Enos";
    static final String DIR = "android/assets/mobile";
    private static final String APP_PREFIX = "file:///android_asset/mobile/";

    private final Context ctx;
    private final SharedPreferences prefs;
    private final long apkCode;
    private final File root, live, stage;
    private volatile Map<String, String> overlay = new HashMap<>();   // chemin relatif -> empreinte Git du fichier superposé
    private Map<String, String> bundled;                              // idem pour les fichiers embarqués dans l'APK (calculé une fois)

    WebUpdater(Context ctx, SharedPreferences prefs, long apkCode) {
        this.ctx = ctx;
        this.prefs = prefs;
        this.apkCode = apkCode;
        root = new File(ctx.getFilesDir(), "web");
        live = new File(root, "live");
        stage = new File(root, "stage");
        load();
    }

    String branch() {
        String b = prefs.getString("web_branch", "main");
        return b.matches("[A-Za-z0-9._/-]{1,80}") ? b : "main";
    }

    boolean auto() { return prefs.getBoolean("web_auto", true); }

    // ------------------------------------------------------------------ état local
    private synchronized void load() {
        overlay = new HashMap<>();
        try {
            File st = new File(root, "state.json");
            if (st.isFile()) {
                JSONObject j = new JSONObject(new String(read(st), "UTF-8"));
                if (j.optLong("apk", -1) == apkCode) {
                    JSONObject m = j.getJSONObject("shas");
                    for (Iterator<String> it = m.keys(); it.hasNext(); ) { String k = it.next(); overlay.put(k, m.getString(k)); }
                } else {
                    deleteTree(root);
                    prefs.edit().remove("web_commit").remove("web_label").apply();   // nouvelle APK installée : son contenu embarqué est au moins aussi récent
                }
            }
        } catch (Exception e) {
            overlay = new HashMap<>();
            deleteTree(root);
        }
    }

    private void saveState(File dir, Map<String, String> shas) throws Exception {
        JSONObject j = new JSONObject();
        j.put("apk", apkCode);
        j.put("shas", new JSONObject(shas));
        write(new File(dir, "state.json"), j.toString().getBytes("UTF-8"));
    }

    /** Version affichée : date/commit de la dernière superposition, ou vide si on utilise l'APK telle quelle. */
    String label() { return prefs.getString("web_label", ""); }

    // ------------------------------------------------------------------ service des fichiers (appelé par le WebViewClient)
    WebResourceResponse intercept(String url) {
        if (url == null || !url.startsWith(APP_PREFIX) || overlay.isEmpty()) return null;
        String rel = url.substring(APP_PREFIX.length());
        int q = rel.indexOf('?'), h = rel.indexOf('#');
        if (q >= 0) rel = rel.substring(0, q);
        if (h >= 0) rel = rel.substring(0, Math.min(rel.length(), h));
        if (rel.isEmpty()) rel = "index.html";
        if (!overlay.containsKey(rel) || rel.contains("..")) return null;
        File f = new File(live, rel);
        if (!f.isFile()) return null;
        try {
            return new WebResourceResponse(mime(rel), isText(rel) ? "UTF-8" : null, new FileInputStream(f));
        } catch (Exception e) {
            return null;
        }
    }

    private static byte[] crlfToLf(byte[] b) {
        ByteArrayOutputStream o = new ByteArrayOutputStream(b.length);
        for (int i = 0; i < b.length; i++) if (!(b[i] == 13 && i + 1 < b.length && b[i + 1] == 10)) o.write(b[i]);   // saute le CR d'un CRLF
        return o.toByteArray();
    }

    private static boolean isText(String n) {
        return n.endsWith(".js") || n.endsWith(".css") || n.endsWith(".html") || n.endsWith(".json") || n.endsWith(".svg") || n.endsWith(".txt");
    }

    private static String mime(String n) {
        String l = n.toLowerCase(Locale.ROOT);
        if (l.endsWith(".js")) return "application/javascript";
        if (l.endsWith(".css")) return "text/css";
        if (l.endsWith(".html")) return "text/html";
        if (l.endsWith(".json")) return "application/json";
        if (l.endsWith(".svg")) return "image/svg+xml";
        if (l.endsWith(".wasm")) return "application/wasm";
        String ext = MimeTypeMap.getFileExtensionFromUrl(l);
        String m = ext == null ? null : MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
        return m != null ? m : "application/octet-stream";
    }

    // ------------------------------------------------------------------ mise à jour
    /**
     * Télécharge les fichiers modifiés. apply = true : les active tout de suite (l'appelant recharge la page) ; false : mis de côté,
     * activés au prochain lancement. Retourne {"state": "uptodate" | "ready" | "applied" | "needs_apk" | "error", "n": nb de fichiers, "msg": …}.
     */
    synchronized String run(boolean apply) {
        try {
            // un lot déjà téléchargé et en attente (auto au lancement précédent) : on l'active simplement
            if (stage.isDirectory() && new File(stage, "state.json").isFile()) {
                if (apply) { promote(); return res("applied", 0, "Mise à jour appliquée."); }
            }
            String br = branch();
            String commit = httpText("https://api.github.com/repos/" + REPO + "/commits/" + br, "application/vnd.github.sha").trim();
            if (!commit.matches("[0-9a-f]{40}")) return res("error", 0, "Réponse GitHub inattendue.");
            if (commit.equals(prefs.getString("web_commit", "")) && overlay != null && !overlay.isEmpty() && !stage.isDirectory()) return res("uptodate", 0, "Déjà à jour.");

            // une version web qui exige une APK plus récente (nouveau code Java) ne doit pas être appliquée à une vieille APK
            long need = 0;
            try { need = Long.parseLong(httpText(raw(commit, "android/web_min_apk.txt"), null).trim()); } catch (Exception ignored) { }
            if (need > apkCode) return res("needs_apk", 0, "Cette version demande une nouvelle APK (v" + need + "). Installe-la une fois, puis les suivantes passeront ici.");

            JSONObject tree = new JSONObject(httpText("https://api.github.com/repos/" + REPO + "/git/trees/" + commit + ":" + DIR + "?recursive=1", null));
            if (tree.optBoolean("truncated")) return res("error", 0, "Liste de fichiers trop grande.");
            JSONArray arr = tree.getJSONArray("tree");

            Map<String, String> have = effective();
            Map<String, String> todo = new HashMap<>();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject e = arr.getJSONObject(i);
                if (!"blob".equals(e.optString("type"))) continue;
                String p = e.getString("path"), sha = e.getString("sha");
                if (p.contains("..") || p.startsWith("/")) continue;
                if (!sha.equals(have.get(p))) todo.put(p, sha);
            }
            if (todo.isEmpty()) {
                prefs.edit().putString("web_commit", commit).apply();
                return res("uptodate", 0, "Déjà à jour.");
            }

            // nouveau dossier d'attente = superposition actuelle + fichiers modifiés
            deleteTree(stage);
            stage.mkdirs();
            copyTree(live, stage);
            for (Map.Entry<String, String> e : todo.entrySet()) {
                byte[] b = httpBytes(raw(commit, DIR + "/" + e.getKey()));
                if (!gitSha(b).equals(e.getValue())) { deleteTree(stage); return res("error", 0, "Empreinte incorrecte : " + e.getKey()); }
                File out = new File(stage, e.getKey());
                out.getParentFile().mkdirs();
                write(out, b);
            }
            // la superposition ne garde que ce qui diffère de l'APK
            Map<String, String> ov = new HashMap<>(overlay);
            ov.putAll(todo);
            File pend = new File(stage, ".pending");
            write(pend, (commit + "\n" + todo.size()).getBytes("UTF-8"));
            saveState(stage, ov);
            if (apply) { promote(); return res("applied", todo.size(), todo.size() + " fichier(s) mis à jour."); }
            return res("ready", todo.size(), todo.size() + " fichier(s) prêts, activés au prochain lancement.");
        } catch (Exception e) {
            return res("error", 0, e.getMessage() == null ? e.toString() : e.getMessage());
        }
    }

    /** À appeler avant de charger la page : active un lot téléchargé au lancement précédent. */
    synchronized void promoteIfStaged() {
        try { if (stage.isDirectory() && new File(stage, "state.json").isFile()) promote(); } catch (Exception ignored) { }
    }

    private void promote() throws Exception {
        File pend = new File(stage, ".pending");
        String commit = pend.isFile() ? new String(read(pend), "UTF-8").split("\n")[0] : "";
        File old = new File(root, "live.old");
        deleteTree(old);
        File stState = new File(stage, "state.json");
        byte[] st = read(stState);
        pend.delete();
        File stFinal = new File(root, "state.json");
        if (live.exists() && !live.renameTo(old)) throw new Exception("Impossible de remplacer les fichiers.");
        if (!stage.renameTo(live)) { old.renameTo(live); throw new Exception("Impossible d'activer les fichiers."); }
        new File(live, "state.json").delete();
        write(stFinal, st);
        deleteTree(old);
        load();
        prefs.edit().putString("web_commit", commit).putString("web_label", commit.length() >= 7 ? commit.substring(0, 7) : "").apply();
    }

    private Map<String, String> effective() throws Exception {
        if (bundled == null) bundled = bundledShas();
        Map<String, String> m = new HashMap<>(bundled);
        m.putAll(overlay);
        return m;
    }

    /** Empreintes Git des fichiers embarqués dans l'APK (calculées une fois par version d'APK, puis gardées). */
    private Map<String, String> bundledShas() throws Exception {
        File cache = new File(root, "bundled-" + apkCode + ".json");
        Map<String, String> m = new HashMap<>();
        if (cache.isFile()) {
            try {
                JSONObject j = new JSONObject(new String(read(cache), "UTF-8"));
                for (Iterator<String> it = j.keys(); it.hasNext(); ) { String k = it.next(); m.put(k, j.getString(k)); }
                return m;
            } catch (Exception ignored) { m.clear(); }
        }
        walkAssets(ctx.getAssets(), "mobile", "", m);
        root.mkdirs();
        write(cache, new JSONObject(m).toString().getBytes("UTF-8"));
        return m;
    }

    private static void walkAssets(AssetManager am, String dir, String rel, Map<String, String> out) throws Exception {
        String[] names = am.list(dir);
        if (names == null || names.length == 0) return;
        for (String n : names) {
            String full = dir + "/" + n, r = rel.isEmpty() ? n : rel + "/" + n;
            String[] sub = am.list(full);
            if (sub != null && sub.length > 0) { walkAssets(am, full, r, out); continue; }
            try (InputStream in = am.open(full)) {
                byte[] b = readAll(in);
                out.put(r, gitSha(isText(r) ? crlfToLf(b) : b));     // APK construite sous Windows : fins de ligne CRLF, alors que Git (GitHub) stocke du LF
            }
        }
    }

    // ------------------------------------------------------------------ utilitaires
    private static String raw(String commit, String path) { return "https://raw.githubusercontent.com/" + REPO + "/" + commit + "/" + path; }

    private static String res(String state, int n, String msg) {
        try { return new JSONObject().put("state", state).put("n", n).put("msg", msg).toString(); } catch (Exception e) { return "{\"state\":\"error\"}"; }
    }

    private static String httpText(String url, String accept) throws Exception {
        return new String(http(url, accept), "UTF-8");
    }

    private static byte[] httpBytes(String url) throws Exception { return http(url, null); }

    private static byte[] http(String url, String accept) throws Exception {
        if (!url.startsWith("https://api.github.com/") && !url.startsWith("https://raw.githubusercontent.com/")) throw new Exception("adresse refusée");
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(8000);
        c.setReadTimeout(30000);
        c.setRequestProperty("User-Agent", "ENOS-mobile");
        if (accept != null) c.setRequestProperty("Accept", accept);
        int code = c.getResponseCode();
        if (code == 403 || code == 429) throw new Exception("GitHub limite les requêtes : réessaie dans quelques minutes.");
        if (code != 200) throw new Exception("GitHub : erreur " + code);
        try (InputStream in = c.getInputStream()) { return readAll(in); }
    }

    private static byte[] readAll(InputStream in) throws Exception {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        byte[] buf = new byte[65536];
        int n;
        while ((n = in.read(buf)) > 0) o.write(buf, 0, n);
        return o.toByteArray();
    }

    private static byte[] read(File f) throws Exception {
        try (InputStream in = new FileInputStream(f)) { return readAll(in); }
    }

    private static void write(File f, byte[] b) throws Exception {
        try (FileOutputStream o = new FileOutputStream(f)) { o.write(b); o.getFD().sync(); }
    }

    /** Empreinte d'un fichier telle que Git la calcule : SHA-1("blob <taille>\0" + contenu). */
    static String gitSha(byte[] b) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-1");
        md.update(("blob " + b.length + "\0").getBytes("UTF-8"));
        md.update(b);
        StringBuilder s = new StringBuilder();
        for (byte x : md.digest()) s.append(String.format("%02x", x));
        return s.toString();
    }

    private static void copyTree(File from, File to) throws Exception {
        File[] fs = from.listFiles();
        if (fs == null) return;
        for (File f : fs) {
            File t = new File(to, f.getName());
            if (f.isDirectory()) { t.mkdirs(); copyTree(f, t); } else write(t, read(f));
        }
    }

    private static void deleteTree(File f) {
        if (f == null || !f.exists()) return;
        File[] fs = f.listFiles();
        if (fs != null) for (File c : fs) deleteTree(c);
        f.delete();
    }
}
