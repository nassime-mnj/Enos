package com.nasko.app;

import android.util.Base64;

import org.json.JSONObject;

import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

/**
 * Proxy HTTP du pont JavaScript. Le JS demande « appelle le service X, ce chemin » ; ICI on choisit l'hôte (liste blanche), on injecte la clé du coffre
 * et on diffuse la réponse par morceaux (flux SSE du chat, audio en base64). Aucun hôte ni en-tête d'authentification ne vient du JavaScript.
 *
 *   groq → api.groq.com/openai/v1/…      eleven_enos / eleven_eto → api.elevenlabs.io/v1/… (clés distinctes)
 *   zeus / moodle → lien .ics du coffre (GET https uniquement)      pc → API du PC (PcLink : TLS épinglé + Bearer)
 *   cloud → serveur Dual Pulse (/launcher/v1/…, adresse https + jeton d'accès pris dans le coffre)      cloud_refresh → renouvelle la session cloud SANS rien renvoyer au JavaScript
 */
final class NativeHttp {
    interface Sink {
        void emit(long id, String evt, String payload);
    }

    private static final Pattern SAFE_PATH = Pattern.compile("/[A-Za-z0-9/_.\\-?=&%,:+]{0,400}");
    private static final long MAX_BIN = 25L * 1024 * 1024;
    private final KeyVault vault;
    private final PcLink pc;
    private final Sink sink;
    private final ExecutorService ex = Executors.newCachedThreadPool();
    private final ConcurrentHashMap<Long, HttpURLConnection> live = new ConcurrentHashMap<>();

    NativeHttp(KeyVault vault, PcLink pc, Sink sink) {
        this.vault = vault;
        this.pc = pc;
        this.sink = sink;
    }

    void request(final long id, final String json) {
        ex.execute(new Runnable() {
            @Override
            public void run() {
                go(id, json);
            }
        });
    }

    void cancel(long id) {
        HttpURLConnection c = live.remove(id);
        if (c != null) c.disconnect();
    }

    private static boolean okPath(String p, String prefix) {
        return p != null && p.startsWith(prefix) && SAFE_PATH.matcher(p).matches() && !p.contains("..");
    }

    private HttpURLConnection connect(String provider, String path, String method) throws Exception {
        HttpURLConnection c;
        switch (provider) {
            case "groq": {
                if (!okPath(path, "/openai/v1/")) throw new IllegalArgumentException("chemin refusé");
                String k = vault.get("groq");
                if (k.isEmpty()) throw new IllegalStateException("clé Groq absente");
                c = (HttpURLConnection) new URL("https://api.groq.com" + path).openConnection();
                c.setRequestProperty("Authorization", "Bearer " + k);
                break;
            }
            case "eleven_enos":
            case "eleven_eto": {
                if (!okPath(path, "/v1/")) throw new IllegalArgumentException("chemin refusé");
                String k = vault.get(provider);
                if (k.isEmpty()) throw new IllegalStateException("clé ElevenLabs absente");
                c = (HttpURLConnection) new URL("https://api.elevenlabs.io" + path).openConnection();
                c.setRequestProperty("xi-api-key", k);
                break;
            }
            case "zeus":
            case "moodle": {
                String u = vault.get("ics_" + provider);
                if (!u.startsWith("https://")) throw new IllegalStateException("lien .ics absent");
                c = (HttpURLConnection) new URL(u).openConnection();
                break;
            }
            case "pc":
                c = pc.open(path, method, null);
                break;
            case "cloud": {
                if (!okPath(path, "/launcher/v1/")) throw new IllegalArgumentException("chemin refusé");
                String base = vault.get("cloud_url");
                if (!base.startsWith("https://")) throw new IllegalStateException("serveur cloud non configuré");
                c = (HttpURLConnection) new URL(base + path).openConnection();
                String t = vault.get("cloud_access");
                if (!t.isEmpty()) c.setRequestProperty("Authorization", "Bearer " + t);
                break;
            }
            default:
                throw new IllegalArgumentException("service inconnu");
        }
        c.setConnectTimeout(10000);
        c.setReadTimeout(120000);
        c.setInstanceFollowRedirects(false);
        c.setRequestMethod(method);
        return c;
    }

    private void go(long id, String json) {
        HttpURLConnection c = null;
        try {
            JSONObject o = new JSONObject(json);
            String provider = o.optString("provider");
            String method = o.optString("method", "GET").toUpperCase();
            if (!(method.equals("GET") || method.equals("POST") || method.equals("PATCH") || method.equals("DELETE"))) throw new IllegalArgumentException("méthode refusée");
            if (provider.equals("cloud_refresh")) {
                String out = cloudRefresh();
                sink.emit(id, "head", "{\"status\":200,\"ctype\":\"application/json\"}");
                sink.emit(id, "chunk", out);
                sink.emit(id, "end", "");
                return;
            }
            if (provider.equals("cloud_logout")) {
                cloudLogout();
                sink.emit(id, "head", "{\"status\":200,\"ctype\":\"application/json\"}");
                sink.emit(id, "chunk", "{\"ok\":true}");
                sink.emit(id, "end", "");
                return;
            }
            boolean bin = o.optBoolean("bin", false);
            boolean ics = provider.equals("zeus") || provider.equals("moodle");
            String body = o.optString("body", "");
            c = connect(provider, o.optString("path", "/"), ics ? "GET" : method);
            // seuls Content-Type et Accept viennent du JavaScript : jamais d'Authorization ni d'hôte
            JSONObject h = o.optJSONObject("headers");
            if (h != null) {
                Iterator<String> it = h.keys();
                while (it.hasNext()) {
                    String k = it.next();
                    if (k.equalsIgnoreCase("Content-Type") || k.equalsIgnoreCase("Accept")) c.setRequestProperty(k, h.optString(k).replaceAll("[\\r\\n]", ""));
                }
            }
            live.put(id, c);
            if (!ics && !body.isEmpty() && !method.equals("GET")) {
                byte[] b = body.getBytes(StandardCharsets.UTF_8);
                if (b.length > 2 * 1024 * 1024) throw new IllegalArgumentException("requête trop grande");
                c.setDoOutput(true);
                try (OutputStream out = c.getOutputStream()) {
                    out.write(b);
                }
            }
            int code = c.getResponseCode();
            for (int hop = 0; ics && code >= 300 && code < 400 && hop < 3; hop++) {       // redirections des .ics : https seulement
                String loc = c.getHeaderField("Location");
                c.disconnect();
                if (loc == null || !loc.startsWith("https://")) throw new IllegalStateException("redirection refusée");
                c = (HttpURLConnection) new URL(loc).openConnection();
                c.setConnectTimeout(10000);
                c.setReadTimeout(60000);
                c.setInstanceFollowRedirects(false);
                live.put(id, c);
                code = c.getResponseCode();
            }
            String ct = c.getContentType();
            sink.emit(id, "head", new JSONObject().put("status", code).put("ctype", ct == null ? "" : ct).toString());
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            if (in != null) {
                if (bin) {
                    byte[] buf = new byte[24 * 1024];
                    long total = 0;
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        total += n;
                        if (total > MAX_BIN) throw new IllegalStateException("réponse trop grande");
                        sink.emit(id, "chunk", Base64.encodeToString(buf, 0, n, Base64.NO_WRAP));
                    }
                } else {
                    InputStreamReader r = new InputStreamReader(in, StandardCharsets.UTF_8);       // décodage UTF-8 correct même quand un caractère est coupé entre deux lectures
                    char[] buf = new char[4096];
                    int n;
                    while ((n = r.read(buf)) > 0) sink.emit(id, "chunk", new String(buf, 0, n));
                }
                in.close();
            }
            sink.emit(id, "end", "");
        } catch (Exception e) {
            if (live.containsKey(id)) sink.emit(id, "error", message(e));      // annulé par le JS : silence
        } finally {
            live.remove(id);
            if (c != null) c.disconnect();
        }
    }

    /** Renouvelle la session cloud avec le jeton de rafraîchissement du coffre. Les nouveaux jetons restent dans le coffre ; seul l'utilisateur / le rôle est renvoyé. */
    private synchronized String cloudRefresh() throws Exception {
        String base = vault.get("cloud_url"), rt = vault.get("cloud_refresh");
        if (!base.startsWith("https://") || rt.isEmpty()) throw new IllegalStateException("session cloud absente");
        HttpURLConnection c = (HttpURLConnection) new URL(base + "/launcher/v1/auth/refresh").openConnection();
        try {
            c.setConnectTimeout(15000);
            c.setReadTimeout(90000);                                  // l'hébergeur gratuit peut mettre une minute à se réveiller
            c.setInstanceFollowRedirects(false);
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            try (OutputStream out = c.getOutputStream()) {
                out.write(new JSONObject().put("refresh_token", rt).toString().getBytes(StandardCharsets.UTF_8));
            }
            int code = c.getResponseCode();
            if (code != 200) {
                if (code == 401) {
                    vault.del("cloud_refresh");
                    vault.del("cloud_access");
                }
                throw new IllegalStateException("session cloud refusée (" + code + ")");
            }
            StringBuilder sb = new StringBuilder();
            try (InputStreamReader r = new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8)) {
                char[] buf = new char[4096];
                int n;
                while ((n = r.read(buf)) > 0) sb.append(buf, 0, n);
            }
            JSONObject j = new JSONObject(sb.toString());
            if (!vault.set("cloud_access", j.getString("access_token")) || !vault.set("cloud_refresh", j.getString("refresh_token"))) throw new IllegalStateException("coffre indisponible");
            return new JSONObject().put("user", j.optJSONObject("user")).put("role", j.optString("role")).toString();
        } finally {
            c.disconnect();
        }
    }

    /** Déconnexion cloud : révoque la session côté serveur (si joignable) puis efface TOUT du coffre (jetons et adresse de mise à jour). */
    private synchronized void cloudLogout() {
        String base = vault.get("cloud_url"), rt = vault.get("cloud_refresh");
        if (base.startsWith("https://") && !rt.isEmpty()) {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(base + "/launcher/v1/auth/logout").openConnection();
                c.setConnectTimeout(8000);
                c.setReadTimeout(15000);
                c.setInstanceFollowRedirects(false);
                c.setRequestMethod("POST");
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json");
                try (OutputStream out = c.getOutputStream()) {
                    out.write(new JSONObject().put("refresh_token", rt).toString().getBytes(StandardCharsets.UTF_8));
                }
                c.getResponseCode();
            } catch (Exception ignored) {
                // hors ligne : la session locale est tout de même supprimée
            } finally {
                if (c != null) c.disconnect();
            }
        }
        vault.del("cloud_access");
        vault.del("cloud_refresh");
        vault.del("cloud_update_base");
    }

    /** Message sans adresse ni jeton (les liens .ics contiennent des secrets). */
    private static String message(Exception e) {
        if (e instanceof java.net.UnknownHostException || e instanceof java.net.ConnectException || e instanceof java.net.SocketTimeoutException) return "réseau indisponible";
        if (e instanceof javax.net.ssl.SSLException) return "certificat refusé";
        String m = e.getMessage();
        return m == null || m.contains("://") ? "échec de la requête" : m;
    }
}
