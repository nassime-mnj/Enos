package com.nasko.app;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.widget.Toast;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;

/**
 * Téléchargements de l'interface (fichiers envoyés depuis le PC, résultat d'une compression…).
 * La WebView ne sait pas télécharger seule, et le DownloadManager d'Android refuserait le certificat auto-signé du PC :
 * on réutilise donc la connexion à certificat ÉPINGLÉ de {@link Updater}, avec le cookie d'appareil de confiance de la WebView.
 * Le fichier est enregistré dans Téléchargements/Eto (MediaStore, aucune permission de stockage requise).
 */
final class Downloader {
    private final Activity act;
    private final Updater net;

    Downloader(Activity act, Updater net) {
        this.act = act;
        this.net = net;
    }

    private void toast(final String msg) {
        act.runOnUiThread(() -> Toast.makeText(act, msg, Toast.LENGTH_LONG).show());
    }

    /** `encKey` non nul : le lien est un /dle/ (flux AES-256-GCM) déchiffré ici ; sinon téléchargement direct (TLS épinglé). */
    void start(final String url, final String contentDisposition, final String mime, final byte[] encKey) {
        final String cookie = CookieManager.getInstance().getCookie(url);
        new Thread(() -> run(url, contentDisposition, mime, cookie, encKey), "nasko-download").start();
    }

    private void run(String url, String contentDisposition, String mime, String cookie, byte[] encKey) {
        Uri out = null;
        ContentResolver cr = act.getContentResolver();
        try {
            HttpURLConnection c = net.open(url);
            c.setReadTimeout(60000);                                  // un gros fichier peut mettre du temps à démarrer
            if (cookie != null && !cookie.isEmpty()) c.setRequestProperty("Cookie", cookie);
            int code = c.getResponseCode();
            if (code == 404 && url.contains("/dle/")) {                // PC plus ancien : pas de lien chiffré -> lien classique (TLS)
                encKey = null;
                c = net.open(url.replace("/dle/", "/dl/"));
                c.setReadTimeout(60000);
                code = c.getResponseCode();
            }
            if (code != 200) throw new Exception(code == 404 ? "lien expiré ou introuvable" : "HTTP " + code);
            final boolean encrypted = encKey != null && "stream".equals(c.getHeaderField("X-Nasko-Enc"));
            String disp = c.getHeaderField("Content-Disposition");
            String type = c.getContentType();
            String name = URLUtil.guessFileName(url, disp != null ? disp : contentDisposition, type != null ? type : mime);
            long total = c.getContentLengthLong();
            toast("Téléchargement de " + name + (total > 0 ? " (" + human(total) + ")…" : "…"));

            ContentValues v = new ContentValues();
            v.put(MediaStore.Downloads.DISPLAY_NAME, name);
            v.put(MediaStore.Downloads.MIME_TYPE, type != null && !type.contains("octet-stream") ? type.split(";")[0] : guessMime(name));
            v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Eto");
            v.put(MediaStore.Downloads.IS_PENDING, 1);
            out = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (out == null) throw new Exception("stockage indisponible");
            long done = 0;
            try (InputStream in = c.getInputStream(); OutputStream os = cr.openOutputStream(out)) {
                if (encrypted) {
                    done = SecureStream.decrypt(in, os, encKey);              // lève une exception si le fichier est altéré ou tronqué
                } else {
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        os.write(buf, 0, n);
                        done += n;
                    }
                }
            }
            ContentValues ok = new ContentValues();
            ok.put(MediaStore.Downloads.IS_PENDING, 0);
            cr.update(out, ok, null, null);
            toast("Téléchargé" + (encrypted ? " (déchiffré)" : "") + " : " + name + " (" + human(done) + ") → Téléchargements/Eto");
        } catch (Exception e) {
            if (out != null) {
                try {
                    cr.delete(out, null, null);                       // pas de fichier tronqué laissé dans Téléchargements
                } catch (Exception ignored) {
                }
            }
            toast("Téléchargement impossible : " + (e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage()));
        }
    }

    private static String guessMime(String name) {
        String n = name.toLowerCase();
        if (n.endsWith(".mp4")) return "video/mp4";
        if (n.endsWith(".mkv")) return "video/x-matroska";
        if (n.endsWith(".webm")) return "video/webm";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
        if (n.endsWith(".webp")) return "image/webp";
        if (n.endsWith(".zip")) return "application/zip";
        if (n.endsWith(".wav")) return "audio/wav";
        if (n.endsWith(".mp3")) return "audio/mpeg";
        if (n.endsWith(".pdf")) return "application/pdf";
        return "application/octet-stream";
    }

    private static String human(long b) {
        if (b < 1024) return b + " o";
        if (b < 1048576) return String.format(java.util.Locale.FRANCE, "%.1f Ko", b / 1024.0);
        if (b < 1073741824L) return String.format(java.util.Locale.FRANCE, "%.1f Mo", b / 1048576.0);
        return String.format(java.util.Locale.FRANCE, "%.2f Go", b / 1073741824.0);
    }
}
