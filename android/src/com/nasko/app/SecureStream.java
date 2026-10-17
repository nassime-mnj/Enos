package com.nasko.app;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Base64;
import java.util.Locale;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Déchiffrement des fichiers Eto (format NKE1, AES-256-GCM par blocs de 1 Mio) et lecture du jeton d'appairage.
 * Classe sans dépendance Android : testable avec un simple JDK.
 *
 * Jeton d'appairage : "NK1.<clé d'API>.<clé de chiffrement>" (base64url, 32 octets chacune). La clé d'API part en en-tête Bearer ;
 * la clé de chiffrement ne quitte jamais l'appareil. Clé de fichier = HMAC-SHA256(clé de chiffrement, "nasko-file-v1").
 */
final class SecureStream {
    private static final int CH = 1 << 20;
    private static final int BLOCK = CH + 16;

    private SecureStream() {}

    /** Octets de la clé de chiffrement contenue dans le jeton, ou null si le jeton n'en contient pas / est invalide. */
    static byte[] encKey(String token) {
        try {
            String[] p = token.trim().split("\\.");
            if (p.length < 3 || !"NK1".equals(p[0])) return null;
            byte[] k = Base64.getUrlDecoder().decode(p[2]);
            return k.length == 32 ? k : null;
        } catch (Exception e) {
            return null;
        }
    }

    /** Jeton acceptable : "NK1.<api>.<enc>" (ou "NK1.<api>" : authentification seule, sans chiffrement). */
    static boolean validToken(String token) {
        try {
            String[] p = token.trim().split("\\.");
            if ((p.length != 2 && p.length != 3) || !"NK1".equals(p[0])) return false;
            if (Base64.getUrlDecoder().decode(p[1]).length != 32) return false;
            return p.length == 2 || Base64.getUrlDecoder().decode(p[2]).length == 32;
        } catch (Exception e) {
            return false;
        }
    }

    /** Empreinte courte de la clé d'API (identique à celle du panneau SÉCURITÉ du PC) pour vérifier visuellement l'appairage. */
    static String fingerprint(String token) {
        try {
            byte[] api = Base64.getUrlDecoder().decode(token.trim().split("\\.")[1]);
            byte[] d = MessageDigest.getInstance("SHA-256").digest(api);
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 6; i++) sb.append(String.format(Locale.ROOT, "%02X", d[i] & 0xff));
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    private static byte[] hmac(byte[] key, String label) throws Exception {
        Mac m = Mac.getInstance("HmacSHA256");
        m.init(new SecretKeySpec(key, "HmacSHA256"));
        return m.doFinal(label.getBytes(StandardCharsets.UTF_8));
    }

    private static byte[] readUpTo(InputStream in, int n) throws Exception {
        ByteArrayOutputStream bo = new ByteArrayOutputStream(Math.min(n, 1 << 16));
        byte[] buf = new byte[65536];
        int left = n;
        while (left > 0) {
            int r = in.read(buf, 0, Math.min(buf.length, left));
            if (r < 0) break;
            bo.write(buf, 0, r);
            left -= r;
        }
        return bo.toByteArray();
    }

    /** Déchiffre un flux NKE1 vers `out`. Lève une exception si le flux est altéré, réordonné ou tronqué. Retourne les octets en clair. */
    static long decrypt(InputStream in, OutputStream out, byte[] encKey) throws Exception {
        SecretKeySpec ks = new SecretKeySpec(hmac(encKey, "nasko-file-v1"), "AES");
        byte[] head = readUpTo(in, 12);
        if (head.length != 12 || head[0] != 'N' || head[1] != 'K' || head[2] != 'E' || head[3] != '1') throw new Exception("flux chiffré invalide");
        byte[] prefix = Arrays.copyOfRange(head, 4, 12);
        byte[] cur = readUpTo(in, BLOCK);
        long total = 0;
        for (int i = 0; ; i++) {
            if (cur.length == 0) throw new Exception("flux tronqué");
            byte[] nxt = cur.length == BLOCK ? readUpTo(in, BLOCK) : new byte[0];
            int fin = nxt.length == 0 ? 1 : 0;
            byte[] iv = new byte[12];
            System.arraycopy(prefix, 0, iv, 0, 8);
            iv[8] = (byte) (i >>> 24); iv[9] = (byte) (i >>> 16); iv[10] = (byte) (i >>> 8); iv[11] = (byte) i;
            byte[] aad = new byte[]{70, (byte) fin, (byte) (i >>> 24), (byte) (i >>> 16), (byte) (i >>> 8), (byte) i};
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, ks, new GCMParameterSpec(128, iv));
            c.updateAAD(aad);
            byte[] plain;
            try {
                plain = c.doFinal(cur);
            } catch (Exception e) {
                throw new Exception("fichier altéré, tronqué ou clé incorrecte");
            }
            out.write(plain);
            total += plain.length;
            if (fin == 1) return total;
            cur = nxt;
        }
    }
}
