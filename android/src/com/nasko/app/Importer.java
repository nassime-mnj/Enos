package com.nasko.app;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Base64;
import java.util.Iterator;
import java.util.Locale;

import javax.crypto.AEADBadTagException;
import javax.crypto.Cipher;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Import de la configuration du PC (script envoyer_cles.py) : clés d'API, liens .ics, jeton et certificat du PC.
 *
 * Format du fichier : base64url( "EK1" | sel(16) | IV(12) | AES-256-GCM(JSON) ), clé = PBKDF2-HMAC-SHA256(code, sel, 300 000 tours).
 * Le code (10 caractères) n'est affiché que sur l'écran du PC : un lien « enos://import » piégé ne peut rien écrire sans lui.
 * Le cœur cryptographique (decrypt) n'a aucune dépendance Android : testable avec un simple JDK.
 */
final class Importer {
    static final int ITER = 300000;
    private static final String[] VAULT = {"groq", "eleven_enos", "eleven_eto", "ics_zeus", "ics_moodle", "pc_token"};      // seuls noms acceptés
    private static final String[] SETTINGS = {"name", "model", "voice_enos", "voice_name_enos", "voice_eto", "voice_name_eto"};

    private Importer() {}

    static String norm(String code) {
        return code == null ? "" : code.toUpperCase(Locale.ROOT).replaceAll("[^A-Z0-9]", "");
    }

    /** Déchiffre le fichier. Lève IllegalArgumentException (« fichier invalide ») ou SecurityException (« code incorrect »). */
    static String decrypt(String blob, String code) throws Exception {
        byte[] raw;
        try {
            raw = Base64.getUrlDecoder().decode(blob.trim());
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("fichier invalide");
        }
        if (raw.length < 3 + 16 + 12 + 17 || raw[0] != 'E' || raw[1] != 'K' || raw[2] != '1') throw new IllegalArgumentException("fichier invalide");
        byte[] salt = Arrays.copyOfRange(raw, 3, 19), iv = Arrays.copyOfRange(raw, 19, 31), ct = Arrays.copyOfRange(raw, 31, raw.length);
        byte[] key = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(new PBEKeySpec(norm(code).toCharArray(), salt, ITER, 256)).getEncoded();
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
        try {
            return new String(c.doFinal(ct), StandardCharsets.UTF_8);
        } catch (AEADBadTagException e) {
            throw new SecurityException("code incorrect");
        }
    }

    /** Applique la configuration : coffre (liste blanche), adresses + empreinte du PC. Retourne {ok, imported:[noms], settings:{…}} sans AUCUNE valeur secrète. */
    static String apply(String blob, String code, KeyVault vault, PcLink pc) {
        try {
            JSONObject o = new JSONObject(decrypt(blob, code));
            JSONArray done = new JSONArray();
            JSONObject v = o.optJSONObject("vault");
            if (v != null) for (String name : VAULT) {
                String val = v.optString(name, "");
                if (!val.isEmpty() && !("pc_token".equals(name) && !SecureStream.validToken(val)) && vault.set(name, val)) done.put(name);
            }
            JSONObject p = o.optJSONObject("pc");
            if (p != null) {
                String addrs = p.optString("addrs", "");
                if (!addrs.isEmpty() && pc.setAddrs(addrs)) done.put("pc_addrs");
                if (pc.pin("", p.optString("pin", ""))) done.put("pc_cert");
            }
            if (pc.setDeviceId(o.optString("device_id", ""))) done.put("pc_device");
            JSONObject outSettings = new JSONObject();
            JSONObject s = o.optJSONObject("settings");
            if (s != null) for (String k : SETTINGS) {
                String val = s.optString(k, "");
                if (!val.isEmpty() && val.length() <= 100) outSettings.put(k, val);
            }
            if (o.optString("name", "").length() > 0 && o.optString("name").length() <= 30) outSettings.put("name", o.optString("name"));
            // Export CEO (exporter_donnees_ceo.py) : préférences simples et tâches de l'agenda. Rien de secret ici, mais tout est borné et filtré.
            JSONObject outPrefs = new JSONObject();
            JSONObject pf = o.optJSONObject("prefs");
            if (pf != null) {
                Iterator<String> it = pf.keys();
                while (it.hasNext() && outPrefs.length() < 40) {
                    String k = it.next();
                    Object pv = pf.opt(k);
                    if (!k.matches("[a-zA-Z0-9_.]{1,40}")) continue;
                    if ((pv instanceof String && ((String) pv).length() <= 100) || pv instanceof Boolean || pv instanceof Integer || pv instanceof Long || pv instanceof Double) outPrefs.put(k, pv);
                }
            }
            JSONArray outTasks = new JSONArray();
            JSONArray ts = o.optJSONArray("tasks");
            if (ts != null) for (int i = 0; i < ts.length() && outTasks.length() < 500; i++) {
                JSONObject t = ts.optJSONObject(i);
                if (t == null) continue;
                String id = t.optString("id", ""), title = t.optString("title", "");
                if (!id.matches("[a-zA-Z0-9]{1,24}") || title.isEmpty()) continue;
                outTasks.put(new JSONObject().put("id", id).put("title", cut(title, 200)).put("due", cut(t.optString("due", ""), 25))
                        .put("notes", cut(t.optString("notes", ""), 1000)).put("done", t.optBoolean("done", false)).put("created", cut(t.optString("created", ""), 25)));
            }
            return new JSONObject().put("ok", true).put("imported", done).put("settings", outSettings).put("prefs", outPrefs).put("tasks", outTasks).toString();
        } catch (SecurityException e) {
            return fail("Code incorrect.");
        } catch (IllegalArgumentException e) {
            return fail("Fichier d'import invalide ou incomplet.");
        } catch (Exception e) {
            return fail("Import impossible.");
        }
    }

    private static String cut(String v, int max) {
        return v.length() <= max ? v : v.substring(0, max);
    }

    private static String fail(String m) {
        try {
            return new JSONObject().put("ok", false).put("error", m).toString();
        } catch (Exception e) {
            return "{\"ok\":false}";
        }
    }
}
