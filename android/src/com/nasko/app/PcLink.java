package com.nasko.app;

import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.URL;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;

import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLHandshakeException;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

/**
 * Liaison avec E.N.O.S. sur le PC : adresses candidates (Wi-Fi, Tailscale), certificat ÉPINGLÉ (empreinte SHA-256 validée une fois par l'utilisateur),
 * jeton Bearer et identifiant d'appareil. Tout est fait ici : le JavaScript ne voit jamais le jeton.
 */
final class PcLink {
    private static final Pattern ADDR = Pattern.compile("[A-Za-z0-9.\\-]{1,100}(:\\d{2,5})?");
    private static final Pattern PATH = Pattern.compile("/api/[A-Za-z0-9/_.\\-?=&%,:+]{0,300}");
    private final SharedPreferences prefs;       // « nasko » : mêmes clés « server », « pin », « device_id » que l'ancienne coque (l'interface complète du PC continue de fonctionner)
    private final KeyVault vault;
    private volatile String active = "";

    PcLink(SharedPreferences prefs, KeyVault vault) {
        this.prefs = prefs;
        this.vault = vault;
    }

    // ------------------------------------------------------------------ configuration
    List<String> addrs() {
        List<String> out = new ArrayList<>();
        for (String a : prefs.getString("pc_addrs", "").split(",")) {
            a = a.trim();
            if (!a.isEmpty() && ADDR.matcher(a).matches()) out.add(a);
        }
        return out;
    }

    /** Enregistre la liste (« 192.168.1.28, 100.64.0.5 ») ; la première alimente aussi l'ancienne clé « server » (interface complète du PC). */
    boolean setAddrs(String raw) {
        List<String> ok = new ArrayList<>();
        for (String a : raw.split("[,; ]+")) {
            a = a.trim().replaceFirst("^https?://", "").replaceAll("/.*$", "");
            if (!a.isEmpty() && ADDR.matcher(a).matches() && !ok.contains(a)) ok.add(a);
        }
        StringBuilder sb = new StringBuilder();
        for (String a : ok) sb.append(sb.length() > 0 ? "," : "").append(a);
        SharedPreferences.Editor e = prefs.edit().putString("pc_addrs", sb.toString());
        if (!ok.isEmpty()) e.putString("server", url(ok.get(0)));
        e.apply();
        active = "";
        return true;
    }

    static String url(String addr) {
        return "https://" + (addr.contains(":") ? addr : addr + ":8443") + "/";
    }

    String token() {
        String t = vault.get("pc_token");
        return t.isEmpty() ? prefs.getString("apikey", "") : t;
    }

    private String bearer() {
        try {
            return token().trim().split("\\.")[1];
        } catch (Exception e) {
            return "";
        }
    }

    String deviceId() {
        String id = prefs.getString("device_id", "");
        if (id.isEmpty()) {
            id = UUID.randomUUID().toString();
            prefs.edit().putString("device_id", id).apply();
        }
        return id;
    }

    /** Identifiant d'appareil préparé par le PC (déjà approuvé là-bas) : le téléphone l'adopte. */
    boolean setDeviceId(String id) {
        if (id == null || !id.matches("[0-9a-fA-F-]{16,64}")) return false;
        prefs.edit().putString("device_id", id).apply();
        return true;
    }

    String pin() {
        return prefs.getString("pin", "");
    }

    String configJson() {
        boolean tok = SecureStream.validToken(token());
        boolean pinned = !pin().isEmpty();
        JSONObject o = new JSONObject();
        try {
            o.put("addrs", prefs.getString("pc_addrs", "").replace(",", ", "));
            o.put("hasToken", tok);
            o.put("pinned", pinned);
            o.put("paired", tok && pinned && !addrs().isEmpty());
            o.put("active", active);
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    void clear() {
        vault.del("pc_token");
        prefs.edit().remove("apikey").remove("pin").apply();
    }

    static String via(String addr) {
        String h = addr.replaceFirst(":\\d+$", "").toLowerCase(Locale.ROOT);
        if (h.endsWith(".ts.net")) return "Tailscale";
        String[] p = h.split("\\.");
        try {
            if (p.length == 4 && Integer.parseInt(p[0]) == 100 && Integer.parseInt(p[1]) >= 64 && Integer.parseInt(p[1]) <= 127) return "Tailscale";    // 100.64.0.0/10
        } catch (NumberFormatException ignored) {
        }
        return "Wi-Fi";
    }

    // ------------------------------------------------------------------ TLS épinglé
    static String fp(X509Certificate c) throws Exception {
        byte[] d = MessageDigest.getInstance("SHA-256").digest(c.getEncoded());
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < d.length; i++) {
            if (i > 0) sb.append(':');
            sb.append(String.format(Locale.ROOT, "%02X", d[i] & 0xff));
        }
        return sb.toString();
    }

    private static final HostnameVerifier ANY_HOST = (h, s) -> true;       // le certificat du PC est auto-signé pour une IP : l'identité est garantie par l'épinglage

    private SSLContext pinned(final String pin) throws Exception {
        SSLContext ctx = SSLContext.getInstance("TLS");
        ctx.init(null, new TrustManager[]{new X509TrustManager() {
            @Override
            public void checkClientTrusted(X509Certificate[] chain, String t) throws CertificateException {
                throw new CertificateException("client");
            }

            @Override
            public void checkServerTrusted(X509Certificate[] chain, String t) throws CertificateException {
                try {
                    if (pin.isEmpty() || chain == null || chain.length == 0 || !fp(chain[0]).equalsIgnoreCase(pin)) throw new CertificateException("pin");
                } catch (CertificateException e) {
                    throw e;
                } catch (Exception e) {
                    throw new CertificateException("pin");
                }
            }

            @Override
            public X509Certificate[] getAcceptedIssuers() {
                return new X509Certificate[0];
            }
        }}, new SecureRandom());
        return ctx;
    }

    /** Connexion HTTPS vers l'API du PC (chemin /api/… uniquement), certificat épinglé, Bearer + identifiant d'appareil. */
    HttpURLConnection open(String path, String method, String addr) throws Exception {
        if (!PATH.matcher(path).matches() || path.contains("..")) throw new IllegalArgumentException("chemin refusé");
        String a = addr != null ? addr : (!active.isEmpty() ? active : (addrs().isEmpty() ? "" : addrs().get(0)));
        if (a.isEmpty()) throw new IllegalStateException("aucune adresse de PC");
        HttpsURLConnection c = (HttpsURLConnection) new URL(url(a) + path.substring(1)).openConnection();
        c.setSSLSocketFactory(pinned(pin()).getSocketFactory());
        c.setHostnameVerifier(ANY_HOST);
        c.setConnectTimeout(4000);
        c.setReadTimeout(30000);
        c.setInstanceFollowRedirects(false);
        c.setRequestMethod(method);
        c.setRequestProperty("Authorization", "Bearer " + bearer());
        c.setRequestProperty("X-Eto-Device", deviceId());
        return c;
    }

    // ------------------------------------------------------------------ détection : le PC répond-il ? (adresse active d'abord, puis les autres)
    /** JSON {ok, via, addr} | {ok:false, reason:"cert"|"unreachable"|"unpaired"}. Appel bloquant (≤ ~1,5 s par adresse). */
    String probe(int timeoutMs) {
        JSONObject out = new JSONObject();
        try {
            List<String> order = new ArrayList<>(addrs());
            if (!active.isEmpty() && order.remove(active)) order.add(0, active);
            if (order.isEmpty() || pin().isEmpty() || bearer().isEmpty()) return out.put("ok", false).put("reason", "unpaired").toString();
            String reason = "unreachable";
            for (String a : order) {
                try {
                    HttpsURLConnection c = (HttpsURLConnection) open("/api/ping", "GET", a);
                    c.setConnectTimeout(timeoutMs);
                    c.setReadTimeout(timeoutMs);
                    int code = c.getResponseCode();
                    String body = "";
                    InputStream in = code == 200 ? c.getInputStream() : null;
                    if (in != null) {
                        byte[] b = new byte[200];
                        int n = in.read(b);
                        body = n > 0 ? new String(b, 0, n, "UTF-8") : "";
                        in.close();
                    }
                    c.disconnect();
                    if (code == 200 && body.contains("\"nasko\"")) {
                        active = a;
                        return out.put("ok", true).put("via", via(a)).put("addr", a).toString();
                    }
                } catch (SSLHandshakeException e) {
                    reason = "cert";
                } catch (Exception ignored) {
                }
            }
            return out.put("ok", false).put("reason", reason).toString();
        } catch (Exception e) {
            return "{\"ok\":false,\"reason\":\"unreachable\"}";
        }
    }

    /** Empreinte du certificat présenté par le PC, SANS lui faire confiance : l'utilisateur la compare à celle du PC avant de l'épingler. */
    String fingerprint(String addr) {
        try {
            if (!ADDR.matcher(addr).matches()) return "{\"error\":\"adresse invalide\"}";
            String hostPort = addr.contains(":") ? addr : addr + ":8443";
            SSLContext ctx = SSLContext.getInstance("TLS");
            ctx.init(null, new TrustManager[]{new X509TrustManager() {
                public void checkClientTrusted(X509Certificate[] c, String t) {
                }

                public void checkServerTrusted(X509Certificate[] c, String t) {
                }

                public X509Certificate[] getAcceptedIssuers() {
                    return new X509Certificate[0];
                }
            }}, new SecureRandom());
            String host = hostPort.substring(0, hostPort.lastIndexOf(':'));
            int port = Integer.parseInt(hostPort.substring(hostPort.lastIndexOf(':') + 1));
            try (SSLSocket s = (SSLSocket) ctx.getSocketFactory().createSocket()) {
                s.connect(new InetSocketAddress(host, port), 3000);
                s.setSoTimeout(3000);
                s.startHandshake();
                X509Certificate x = (X509Certificate) s.getSession().getPeerCertificates()[0];
                return new JSONObject().put("fp", fp(x)).toString();
            }
        } catch (Exception e) {
            return "{\"error\":\"PC injoignable (allumé ? même réseau / Tailscale actif ?)\"}";
        }
    }

    boolean pin(String addr, String fp) {
        if (fp == null || !fp.matches("([0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}")) return false;
        prefs.edit().putString("pin", fp.toUpperCase(Locale.ROOT)).apply();
        return true;
    }
}
