package com.nasko.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.regex.Pattern;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Coffre des secrets (clés d'API, liens .ics, jeton du PC) : AES-256-GCM, clé non exportable dans l'Android Keystore (matériel sécurisé si présent).
 * Les valeurs chiffrées sont rangées dans des SharedPreferences privées ; allowBackup=false : elles ne sont jamais sauvegardées dans le cloud.
 * Le JavaScript peut écrire, tester l'existence et effacer, mais JAMAIS lire : seul le code Java (NativeHttp, PcLink) déchiffre.
 */
final class KeyVault {
    private static final String ALIAS = "enos_vault_v1";
    private static final Pattern NAME = Pattern.compile("[a-z0-9_]{1,40}");
    private final SharedPreferences sp;

    KeyVault(Context c) {
        sp = c.getSharedPreferences("enos_vault", Context.MODE_PRIVATE);
    }

    private SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (!ks.containsAlias(ALIAS)) {
            KeyGenerator g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            g.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build());
            g.generateKey();
        }
        return (SecretKey) ks.getKey(ALIAS, null);
    }

    static boolean validName(String n) {
        return n != null && NAME.matcher(n).matches();
    }

    synchronized boolean set(String name, String value) {
        if (!validName(name) || value == null || value.length() > 4000) return false;
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, key());
            byte[] ct = c.doFinal(value.getBytes(StandardCharsets.UTF_8));
            sp.edit().putString(name, Base64.encodeToString(c.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP)).apply();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** Réservé au code Java. Chaîne vide si absent ou illisible. */
    synchronized String get(String name) {
        if (!validName(name)) return "";
        String v = sp.getString(name, "");
        if (v.isEmpty()) return "";
        try {
            String[] p = v.split(":");
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(p[0], Base64.NO_WRAP)));
            return new String(c.doFinal(Base64.decode(p[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return "";
        }
    }

    boolean has(String name) {
        return validName(name) && sp.contains(name);
    }

    void del(String name) {
        if (validName(name)) sp.edit().remove(name).apply();
    }
}
