package com.nasko.app;

import android.app.Activity;
import android.app.RecoverableSecurityException;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Intent;
import android.content.IntentSender;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Size;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Nettoyeur de stockage : analyse la galerie (MediaStore) sur un fil d'arrière-plan et renvoie au JavaScript, par morceaux, une fiche par image
 * (netteté = variance du laplacien, empreinte perceptuelle dHash 64 bits, capture d'écran ?) et une fiche par grosse vidéo.
 * Sécurité : le JavaScript ne reçoit que des URI content://media/ ; pour supprimer il ne peut citer QUE des URI du dernier scan (liste blanche en mémoire).
 * Aucune suppression silencieuse : la boîte de dialogue système (createDeleteRequest) demande toujours la confirmation de l'utilisateur.
 */
final class GalleryScan {
    static final int REQ_PERM = 21;
    static final int REQ_DELETE = 22;
    static final int REQ_DELETE_ONE = 23;

    private static final Pattern MEDIA_URI = Pattern.compile("content://media/external(?:_primary)?/(images|video)/media/[0-9]{1,18}");
    private static final int MAX_DELETE = 500;
    private static final int BATCH = 24;
    private static final long MIN_VIDEO = 20L * 1024 * 1024;     // seules les vidéos >= 20 Mo sont listées

    private final Activity act;
    private final NativeHttp.Sink sink;
    private volatile boolean cancelled = false;
    private Thread worker;
    private final Set<String> known = new HashSet<String>();      // URI du dernier scan (accès synchronisé)
    private long permId = 0;
    // suppression en cours
    private long delId = 0;
    private List<Uri> delQueue = new ArrayList<Uri>();            // API 29 : une à une
    private final List<String> delDone = new ArrayList<String>();
    private Uri delCurrent = null;

    GalleryScan(Activity act, NativeHttp.Sink sink) {
        this.act = act;
        this.sink = sink;
    }

    // ------------------------------------------------------------------ permission
    static String[] permissions() {
        if (Build.VERSION.SDK_INT >= 33) return new String[]{"android.permission.READ_MEDIA_IMAGES", "android.permission.READ_MEDIA_VIDEO"};
        return new String[]{"android.permission.READ_EXTERNAL_STORAGE"};
    }

    boolean hasPermission() {
        String[] p = permissions();
        // Android 14 : l'accès « photos sélectionnées » n'accorde que READ_MEDIA_VISUAL_USER_SELECTED ; l'analyse complète exige READ_MEDIA_IMAGES
        return act.checkSelfPermission(p[0]) == PackageManager.PERMISSION_GRANTED;
    }

    /** Appelé depuis le fil d'interface. Émet « perm » {granted:bool} (tout de suite, ou après la réponse de l'utilisateur). */
    void requestPermission(long id) {
        if (hasPermission()) {
            sink.emit(id, "perm", "{\"granted\":true}");
            return;
        }
        permId = id;
        act.requestPermissions(permissions(), REQ_PERM);
    }

    void onPermissionResult(int[] res) {
        boolean g = res != null && res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED;
        long id = permId;
        permId = 0;
        if (id != 0) sink.emit(id, "perm", "{\"granted\":" + g + "}");
    }

    // ------------------------------------------------------------------ scan
    synchronized void start(final long id) {
        if (worker != null && worker.isAlive()) {
            sink.emit(id, "error", "Analyse déjà en cours.");
            return;
        }
        if (!hasPermission()) {
            sink.emit(id, "error", "Accès aux photos refusé.");
            return;
        }
        cancelled = false;
        synchronized (known) {
            known.clear();
        }
        worker = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    scan(id);
                } catch (Throwable t) {
                    sink.emit(id, "error", "Analyse interrompue : " + (t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage()));
                }
            }
        }, "gallery-scan");
        worker.setPriority(Thread.MIN_PRIORITY + 1);
        worker.start();
    }

    void cancel() {
        cancelled = true;
    }

    private void scan(long id) throws Exception {
        ContentResolver cr = act.getContentResolver();
        int screenW = act.getResources().getDisplayMetrics().widthPixels;
        int total = count(cr, MediaStore.Images.Media.EXTERNAL_CONTENT_URI, null) + count(cr, MediaStore.Video.Media.EXTERNAL_CONTENT_URI, MediaStore.Video.Media.SIZE + " >= " + MIN_VIDEO);
        sink.emit(id, "head", "{\"total\":" + total + "}");
        int done = 0;
        JSONArray batch = new JSONArray();

        String[] pi = {MediaStore.Images.Media._ID, MediaStore.Images.Media.DISPLAY_NAME, MediaStore.Images.Media.SIZE, MediaStore.Images.Media.DATE_ADDED,
                MediaStore.Images.Media.DATE_TAKEN, MediaStore.Images.Media.RELATIVE_PATH, MediaStore.Images.Media.BUCKET_DISPLAY_NAME,
                MediaStore.Images.Media.WIDTH, MediaStore.Images.Media.HEIGHT, MediaStore.Images.Media.MIME_TYPE};
        Cursor c = cr.query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, pi, null, null, MediaStore.Images.Media.DATE_ADDED + " DESC");
        if (c != null) {
            try {
                while (c.moveToNext()) {
                    if (cancelled) {
                        sink.emit(id, "cancelled", "{}");
                        return;
                    }
                    long mid = c.getLong(0);
                    String name = nz(c.getString(1));
                    long size = c.getLong(2);
                    long added = c.getLong(3);
                    long taken = c.getLong(4);
                    String rel = nz(c.getString(5));
                    String bucket = nz(c.getString(6));
                    int w = c.getInt(7), h = c.getInt(8);
                    String mime = nz(c.getString(9));
                    if (!mime.startsWith("image/")) continue;
                    Uri uri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, mid);
                    JSONObject o = new JSONObject();
                    o.put("kind", "image");
                    o.put("id", mid);
                    o.put("uri", uri.toString());
                    o.put("name", name);
                    o.put("size", size);
                    o.put("date", taken > 0 ? taken / 1000 : added);
                    o.put("folder", bucket.isEmpty() ? rel : bucket);
                    o.put("w", w);
                    o.put("h", h);
                    o.put("isScreenshot", isScreenshot(name, rel, w, h, screenW));
                    Analysis an = analyse(cr, uri);
                    if (an != null) {
                        o.put("blur", Math.round(an.blur * 10.0) / 10.0);
                        o.put("dhash", hex64(an.hash));
                    }
                    synchronized (known) {
                        known.add(uri.toString());
                    }
                    batch.put(o);
                    done++;
                    if (batch.length() >= BATCH) {
                        sink.emit(id, "items", batch.toString());
                        batch = new JSONArray();
                        sink.emit(id, "progress", "{\"done\":" + done + ",\"total\":" + total + "}");
                    }
                }
            } finally {
                c.close();
            }
        }
        if (batch.length() > 0) {
            sink.emit(id, "items", batch.toString());
            batch = new JSONArray();
        }

        // vidéos volumineuses (taille seulement, pas d'analyse)
        String[] pv = {MediaStore.Video.Media._ID, MediaStore.Video.Media.DISPLAY_NAME, MediaStore.Video.Media.SIZE, MediaStore.Video.Media.DATE_ADDED,
                MediaStore.Video.Media.RELATIVE_PATH, MediaStore.Video.Media.BUCKET_DISPLAY_NAME, MediaStore.Video.Media.WIDTH, MediaStore.Video.Media.HEIGHT,
                MediaStore.Video.Media.DURATION};
        Cursor v = cr.query(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, pv, MediaStore.Video.Media.SIZE + " >= " + MIN_VIDEO, null, MediaStore.Video.Media.SIZE + " DESC");
        if (v != null) {
            try {
                while (v.moveToNext()) {
                    if (cancelled) {
                        sink.emit(id, "cancelled", "{}");
                        return;
                    }
                    long mid = v.getLong(0);
                    Uri uri = ContentUris.withAppendedId(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, mid);
                    JSONObject o = new JSONObject();
                    o.put("kind", "video");
                    o.put("id", mid);
                    o.put("uri", uri.toString());
                    o.put("name", nz(v.getString(1)));
                    o.put("size", v.getLong(2));
                    o.put("date", v.getLong(3));
                    String bucket = nz(v.getString(5));
                    o.put("folder", bucket.isEmpty() ? nz(v.getString(4)) : bucket);
                    o.put("w", v.getInt(6));
                    o.put("h", v.getInt(7));
                    o.put("duration", v.getLong(8) / 1000);
                    o.put("isScreenshot", false);
                    synchronized (known) {
                        known.add(uri.toString());
                    }
                    batch.put(o);
                    done++;
                    if (batch.length() >= BATCH) {
                        sink.emit(id, "items", batch.toString());
                        batch = new JSONArray();
                    }
                }
            } finally {
                v.close();
            }
        }
        if (batch.length() > 0) sink.emit(id, "items", batch.toString());
        sink.emit(id, "end", "{\"count\":" + done + "}");
    }

    private static int count(ContentResolver cr, Uri u, String sel) {
        Cursor c = cr.query(u, new String[]{MediaStore.MediaColumns._ID}, sel, null, null);
        if (c == null) return 0;
        try {
            return c.getCount();
        } finally {
            c.close();
        }
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }

    private static String hex64(long v) {
        String s = Long.toHexString(v);
        StringBuilder b = new StringBuilder();
        for (int i = s.length(); i < 16; i++) b.append('0');
        return b.append(s).toString();
    }

    /** Dossier Screenshots, nom « Screenshot / Capture / Screen_Shot », ou image à la largeur exacte de l'écran, très haute, hors dossier appareil photo. */
    static boolean isScreenshot(String name, String rel, int w, int h, int screenW) {
        String n = name.toLowerCase(Locale.ROOT), r = rel.toLowerCase(Locale.ROOT);
        if (r.contains("screenshot") || r.contains("capture d") || r.contains("screen_capture")) return true;
        if (n.contains("screenshot") || n.contains("screen_shot") || n.contains("capture") || n.startsWith("scr_")) return true;
        boolean camera = r.contains("camera") || r.contains("dcim/100") || n.startsWith("img_") || n.startsWith("pxl_");
        return !camera && w > 0 && w == screenW && h >= (int) (w * 1.7) && n.endsWith(".png");
    }

    private static final class Analysis {
        final double blur;
        final long hash;

        Analysis(double blur, long hash) {
            this.blur = blur;
            this.hash = hash;
        }
    }

    /** Netteté + dhash de la miniature, ou null si elle est illisible. */
    private Analysis analyse(ContentResolver cr, Uri uri) {
        Bitmap b = null;
        try {
            b = cr.loadThumbnail(uri, new Size(256, 256), null);
            if (b == null) return null;
            if (b.getConfig() == Bitmap.Config.HARDWARE) {
                Bitmap sw = b.copy(Bitmap.Config.ARGB_8888, false);
                b.recycle();
                b = sw;
                if (b == null) return null;
            }
            int w = b.getWidth(), h = b.getHeight();
            if (w < 8 || h < 8) return null;
            int[] px = new int[w * h];
            b.getPixels(px, 0, w, 0, 0, w, h);
            float[] g = new float[w * h];
            for (int i = 0; i < px.length; i++) {
                int p = px[i];
                g[i] = 0.299f * ((p >> 16) & 255) + 0.587f * ((p >> 8) & 255) + 0.114f * (p & 255);
            }
            return new Analysis(laplacianVariance(g, w, h), dhash(g, w, h));
        } catch (Throwable t) {
            return null;
        } finally {
            if (b != null) b.recycle();
        }
    }

    /** Variance du laplacien 3x3 (4-voisins) sur niveaux de gris : faible = flou. */
    static double laplacianVariance(float[] g, int w, int h) {
        double sum = 0, sum2 = 0;
        long n = 0;
        for (int y = 1; y < h - 1; y++) {
            for (int x = 1; x < w - 1; x++) {
                int i = y * w + x;
                double l = g[i - 1] + g[i + 1] + g[i - w] + g[i + w] - 4.0 * g[i];
                sum += l;
                sum2 += l * l;
                n++;
            }
        }
        if (n == 0) return 0;
        double mean = sum / n;
        return sum2 / n - mean * mean;
    }

    /** dHash 64 bits : image réduite à 9x8 (moyenne par zones), 1 bit si le pixel est plus clair que son voisin de droite. */
    static long dhash(float[] g, int w, int h) {
        double[][] cell = new double[8][9];
        for (int cy = 0; cy < 8; cy++) {
            int y0 = cy * h / 8, y1 = Math.max(y0 + 1, (cy + 1) * h / 8);
            for (int cx = 0; cx < 9; cx++) {
                int x0 = cx * w / 9, x1 = Math.max(x0 + 1, (cx + 1) * w / 9);
                double s = 0;
                int n = 0;
                for (int y = y0; y < y1; y++) {
                    for (int x = x0; x < x1; x++) {
                        s += g[y * w + x];
                        n++;
                    }
                }
                cell[cy][cx] = n == 0 ? 0 : s / n;
            }
        }
        long bits = 0;
        for (int y = 0; y < 8; y++) {
            for (int x = 0; x < 8; x++) {
                bits = (bits << 1) | (cell[y][x] > cell[y][x + 1] ? 1L : 0L);
            }
        }
        return bits;
    }

    // ------------------------------------------------------------------ vignette (JPEG 96 px en data: URL, uniquement pour une URI du scan)
    String thumb(String uriStr) {
        if (!isKnown(uriStr)) return "";
        Bitmap b = null;
        try {
            b = act.getContentResolver().loadThumbnail(Uri.parse(uriStr), new Size(160, 160), null);
            if (b == null) return "";
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            b.compress(Bitmap.CompressFormat.JPEG, 70, bo);
            return "data:image/jpeg;base64," + Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP);
        } catch (Throwable t) {
            return "";
        } finally {
            if (b != null) b.recycle();
        }
    }

    private boolean isKnown(String u) {
        if (u == null || !MEDIA_URI.matcher(u).matches()) return false;
        synchronized (known) {
            return known.contains(u);
        }
    }

    // ------------------------------------------------------------------ suppression (confirmation système obligatoire)
    /** Valide la liste (schéma, forme, appartenance au scan, nombre borné) puis ouvre la boîte système. Fil d'interface. */
    void delete(long id, String json) {
        List<Uri> uris = new ArrayList<Uri>();
        try {
            JSONArray a = new JSONArray(json == null ? "[]" : json);
            if (a.length() == 0 || a.length() > MAX_DELETE) {
                sink.emit(id, "deleted", "{\"ok\":false,\"error\":\"Sélection vide ou trop grande (max " + MAX_DELETE + ").\"}");
                return;
            }
            Set<String> seen = new HashSet<String>();
            for (int i = 0; i < a.length(); i++) {
                String u = a.optString(i, "");
                if (!isKnown(u)) {
                    sink.emit(id, "deleted", "{\"ok\":false,\"error\":\"Fichier hors de la dernière analyse : refusé.\"}");
                    return;
                }
                if (seen.add(u)) uris.add(Uri.parse(u));
            }
        } catch (Exception e) {
            sink.emit(id, "deleted", "{\"ok\":false,\"error\":\"Demande invalide.\"}");
            return;
        }
        if (delId != 0) {
            sink.emit(id, "deleted", "{\"ok\":false,\"error\":\"Une suppression est déjà en cours.\"}");
            return;
        }
        delId = id;
        delDone.clear();
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                IntentSender is = MediaStore.createDeleteRequest(act.getContentResolver(), uris).getIntentSender();
                act.startIntentSenderForResult(is, REQ_DELETE, null, 0, 0, 0);
                pendingBatch = uris;
            } else {
                delQueue = uris;
                nextLegacy();
            }
        } catch (Exception e) {
            finishDelete(false, "Suppression impossible : " + (e.getMessage() == null ? "erreur" : e.getMessage()));
        }
    }

    private List<Uri> pendingBatch = new ArrayList<Uri>();

    /** API 29 : suppression une à une ; si le système exige l'accord de l'utilisateur (RecoverableSecurityException), on le lui demande. */
    private void nextLegacy() {
        while (!delQueue.isEmpty()) {
            Uri u = delQueue.get(0);
            try {
                int n = act.getContentResolver().delete(u, null, null);
                delQueue.remove(0);
                if (n > 0) {
                    delDone.add(u.toString());
                    synchronized (known) {
                        known.remove(u.toString());
                    }
                }
            } catch (SecurityException se) {
                if (Build.VERSION.SDK_INT >= 29 && se instanceof RecoverableSecurityException) {
                    try {
                        delCurrent = u;
                        act.startIntentSenderForResult(((RecoverableSecurityException) se).getUserAction().getActionIntent().getIntentSender(), REQ_DELETE_ONE, null, 0, 0, 0);
                        return;
                    } catch (Exception e) {
                        finishDelete(false, "Suppression refusée par le système.");
                        return;
                    }
                }
                finishDelete(false, "Suppression refusée par le système (Android 10).");
                return;
            } catch (Exception e) {
                delQueue.remove(0);
            }
        }
        finishDelete(true, "");
    }

    void onDeleteResult(int req, int res) {
        if (delId == 0) return;
        if (req == REQ_DELETE) {
            if (res == Activity.RESULT_OK) {
                for (Uri u : pendingBatch) delDone.add(u.toString());
                forget(pendingBatch);
                finishDelete(true, "");
            } else {
                finishDelete(false, "cancelled");
            }
            pendingBatch = new ArrayList<Uri>();
        } else if (req == REQ_DELETE_ONE) {
            if (res == Activity.RESULT_OK && delCurrent != null) {
                // l'utilisateur a accordé l'accès : on réessaie ce fichier (il reste en tête de file)
                nextLegacy();
            } else {
                finishDelete(false, "cancelled");
            }
        }
    }

    private void forget(List<Uri> l) {
        synchronized (known) {
            for (Uri u : l) known.remove(u.toString());
        }
    }

    private void finishDelete(boolean ok, String err) {
        long id = delId;
        delId = 0;
        delCurrent = null;
        delQueue = new ArrayList<Uri>();
        JSONArray ids = new JSONArray();
        for (String l : delDone) ids.put(l);
        delDone.clear();
        try {
            JSONObject o = new JSONObject();
            o.put("ok", ok);
            o.put("cancelled", "cancelled".equals(err));
            if (!ok && !"cancelled".equals(err)) o.put("error", err);
            o.put("deleted", ids);
            if (id != 0) sink.emit(id, "deleted", o.toString());
        } catch (Exception e) {
            if (id != 0) sink.emit(id, "deleted", "{\"ok\":false}");
        }
    }
}
