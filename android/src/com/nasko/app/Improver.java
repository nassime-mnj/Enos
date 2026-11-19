package com.nasko.app;

import android.app.Activity;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Context;
import android.content.IntentSender;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * MOBILE IMPROVER (ETO Pro et +) : récupère de l'espace en recompressant les grosses photos JPEG, sans perte visible.
 *
 *  1. PRÉPARER (en arrière-plan, téléphone EN CHARGE, ou « Analyser maintenant ») : photos JPEG de plus de N Mo et de plus de N jours
 *     (jamais les photos récentes) ; décodage, redimensionnement au plus à 4080 px (12,5 Mpx), réencodage JPEG ; la version préparée n'est
 *     gardée QUE si elle pèse au moins 25 % de moins ET si la qualité mesurée reste haute (PSNR de la luminance ≥ 36 dB sur une réduction
 *     commune) ; les métadonnées EXIF (date, orientation, lieu, appareil) sont recopiées. Rien n'est modifié dans la galerie à ce stade.
 *  2. APPLIQUER (l'utilisateur touche « Appliquer ») : Android affiche SA demande d'autorisation (MediaStore.createWriteRequest) ; ensuite,
 *     pour chaque photo encore identique à l'analyse, l'original part dans la CORBEILLE de l'application (30 jours, restaurable) et la version
 *     préparée le remplace (même fichier, même place dans la galerie).
 *  3. CORBEILLE : restauration photo par photo (nouvelle autorisation Android), vidage immédiat, purge automatique après 30 jours.
 *  4. RAPPORT : gains par mois.
 * Aucun envoi réseau ; aucune modification sans l'autorisation système.
 */
final class Improver {
    static final int REQ_WRITE = 31;
    static final int REQ_RESTORE = 32;
    static final int JOB_ID = 4107;
    private static final Object LOCK = new Object();
    private static final long DAY = 86400000L;
    private static final long TRASH_DAYS = 30;
    private static final AtomicBoolean RUNNING = new AtomicBoolean(false);
    static final AtomicBoolean CANCEL = new AtomicBoolean(false);

    interface Progress {
        void on(int done, int total, long saved);
    }

    private final Activity act;
    private final NativeHttp.Sink sink;
    private long applyId = 0, restoreId = 0;
    private String restoreTrash = "";

    Improver(Activity act, NativeHttp.Sink sink) {
        this.act = act;
        this.sink = sink;
    }

    // ------------------------------------------------------------------ état (fichier JSON privé)
    static File dir(Context c) {
        File d = new File(c.getFilesDir(), "improver");
        new File(d, "staged").mkdirs();
        new File(d, "trash").mkdirs();
        return d;
    }

    static JSONObject load(Context c) {
        synchronized (LOCK) {
            try {
                File f = new File(dir(c), "state.json");
                if (f.exists()) {
                    byte[] b = readAll(new FileInputStream(f));
                    return new JSONObject(new String(b, "UTF-8"));
                }
            } catch (Exception e) { /* état illisible : on repart de zéro */ }
            return new JSONObject();
        }
    }

    static void save(Context c, JSONObject s) {
        synchronized (LOCK) {
            try {
                File f = new File(dir(c), "state.json"), tmp = new File(dir(c), "state.tmp");
                FileOutputStream o = new FileOutputStream(tmp);
                o.write(s.toString().getBytes("UTF-8"));
                o.close();
                tmp.renameTo(f);
            } catch (Exception e) { /* disque plein : l'état sera recalculé */ }
        }
    }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("improver", Context.MODE_PRIVATE);
    }

    static JSONArray arr(JSONObject o, String k) {
        JSONArray a = o.optJSONArray(k);
        if (a == null) {
            a = new JSONArray();
            try { o.put(k, a); } catch (Exception e) { /* jamais */ }
        }
        return a;
    }

    static JSONObject obj(JSONObject o, String k) {
        JSONObject a = o.optJSONObject(k);
        if (a == null) {
            a = new JSONObject();
            try { o.put(k, a); } catch (Exception e) { /* jamais */ }
        }
        return a;
    }

    /** Résumé pour l'interface. */
    static String summary(Context c) {
        try {
            JSONObject s = load(c), out = new JSONObject();
            JSONArray p = arr(s, "pending"), t = arr(s, "trash");
            long ps = 0, ts = 0;
            for (int i = 0; i < p.length(); i++) ps += p.getJSONObject(i).optLong("orig") - p.getJSONObject(i).optLong("size");
            for (int i = 0; i < t.length(); i++) ts += t.getJSONObject(i).optLong("orig");
            JSONArray trash = new JSONArray();
            for (int i = t.length() - 1; i >= 0 && trash.length() < 60; i--) {
                JSONObject e = t.getJSONObject(i);
                trash.put(new JSONObject().put("id", e.optString("tid")).put("name", e.optString("name")).put("orig", e.optLong("orig")).put("size", e.optLong("size")).put("t", e.optLong("t")));
            }
            SharedPreferences pr = prefs(c);
            out.put("pending", p.length()).put("pendingSaved", ps).put("trash", t.length()).put("trashBytes", ts).put("trashItems", trash)
                    .put("history", arr(s, "history")).put("last", obj(s, "last")).put("running", RUNNING.get())
                    .put("auto", pr.getBoolean("auto", false)).put("quality", pr.getInt("quality", 82)).put("maxEdge", pr.getInt("maxEdge", 4080))
                    .put("minAge", pr.getInt("minAge", 30)).put("minMb", pr.getFloat("minMb", 1.5f)).put("canApply", Build.VERSION.SDK_INT >= 30)
                    .put("doneCount", obj(s, "done").length());
            return out.toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    static void configure(Context c, String json) {
        try {
            JSONObject o = new JSONObject(json);
            SharedPreferences.Editor e = prefs(c).edit();
            if (o.has("quality")) e.putInt("quality", Math.max(60, Math.min(92, o.getInt("quality"))));
            if (o.has("maxEdge")) e.putInt("maxEdge", Math.max(1600, Math.min(8192, o.getInt("maxEdge"))));
            if (o.has("minAge")) e.putInt("minAge", Math.max(0, Math.min(3650, o.getInt("minAge"))));
            if (o.has("minMb")) e.putFloat("minMb", (float) Math.max(0.3, Math.min(50, o.getDouble("minMb"))));
            e.apply();
        } catch (Exception ex) { /* réglages ignorés */ }
    }

    /** Planifie (ou annule) la préparation automatique : une fois par jour au plus, seulement téléphone en charge et batterie correcte. */
    static boolean schedule(Context c, boolean on) {
        JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        prefs(c).edit().putBoolean("auto", on).apply();
        if (js == null) return false;
        if (!on) {
            js.cancel(JOB_ID);
            return true;
        }
        JobInfo ji = new JobInfo.Builder(JOB_ID, new ComponentName(c, ImproverJob.class))
                .setRequiresCharging(true)
                .setRequiresBatteryNotLow(true)
                .setPeriodic(DAY)
                .setPersisted(true)
                .build();
        return js.schedule(ji) == JobScheduler.RESULT_SUCCESS;
    }

    // ------------------------------------------------------------------ 1. préparer
    /** Prépare des versions allégées (rien n'est modifié dans la galerie). Retourne le nombre de photos préparées. */
    static int analyze(Context c, long budgetMs, int maxItems, Progress pg) {
        if (!RUNNING.compareAndSet(false, true)) return -1;
        CANCEL.set(false);
        long t0 = System.currentTimeMillis();
        int staged = 0, scanned = 0;
        long saved = 0;
        String reason = "fini";
        try {
            purgeTrash(c);
            SharedPreferences pr = prefs(c);
            int q = pr.getInt("quality", 82), maxEdge = pr.getInt("maxEdge", 4080), minAge = pr.getInt("minAge", 30);
            long minBytes = (long) (pr.getFloat("minMb", 1.5f) * 1024 * 1024);
            JSONObject s = load(c);
            JSONObject done = obj(s, "done");
            JSONArray pending = arr(s, "pending");
            List<String> already = new ArrayList<String>();
            for (int i = 0; i < pending.length(); i++) already.add(pending.getJSONObject(i).optString("id"));
            ContentResolver cr = c.getContentResolver();
            long cutoff = (System.currentTimeMillis() - minAge * DAY) / 1000;
            String sel = MediaStore.Images.Media.MIME_TYPE + "='image/jpeg' AND " + MediaStore.Images.Media.SIZE + ">=? AND " + MediaStore.Images.Media.DATE_ADDED + "<=?";
            String[] args = {String.valueOf(minBytes), String.valueOf(cutoff)};
            String[] cols = {MediaStore.Images.Media._ID, MediaStore.Images.Media.SIZE, MediaStore.Images.Media.DATE_MODIFIED, MediaStore.Images.Media.DISPLAY_NAME};
            List<long[]> todo = new ArrayList<long[]>();
            List<String> names = new ArrayList<String>();
            Cursor cu = cr.query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cols, sel, args, MediaStore.Images.Media.SIZE + " DESC");
            if (cu != null) {
                try {
                    while (cu.moveToNext()) {
                        long id = cu.getLong(0), size = cu.getLong(1), dm = cu.getLong(2);
                        String key = String.valueOf(id);
                        if (done.optLong(key, -1) == dm || already.contains(key)) continue;
                        todo.add(new long[]{id, size, dm});
                        names.add(cu.getString(3) == null ? "photo.jpg" : cu.getString(3));
                    }
                } finally {
                    cu.close();
                }
            }
            int total = Math.min(todo.size(), maxItems);
            if (pg != null) pg.on(0, total, 0);
            for (int i = 0; i < total; i++) {
                if (CANCEL.get()) { reason = "annulé"; break; }
                if (System.currentTimeMillis() - t0 > budgetMs) { reason = "temps écoulé"; break; }
                long[] it = todo.get(i);
                scanned++;
                Uri uri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, it[0]);
                JSONObject r = null;
                try {
                    r = prepare(c, cr, uri, it[0], it[1], q, maxEdge);
                } catch (OutOfMemoryError oom) {
                    System.gc();
                } catch (Exception e) { /* photo illisible : ignorée */ }
                if (r != null) {
                    r.put("id", String.valueOf(it[0])).put("uri", uri.toString()).put("name", names.get(i)).put("dm", it[2]).put("orig", it[1]);
                    pending.put(r);
                    staged++;
                    saved += it[1] - r.optLong("size");
                } else {
                    done.put(String.valueOf(it[0]), it[2]);          // déjà optimale (ou illisible) : on ne la retente pas tant qu'elle ne change pas
                }
                if ((i & 3) == 3) save(c, s);
                if (pg != null) pg.on(i + 1, total, saved);
            }
            JSONObject last = new JSONObject().put("t", System.currentTimeMillis() / 1000).put("scanned", scanned).put("staged", staged).put("saved", saved).put("reason", reason)
                    .put("left", Math.max(0, todo.size() - scanned));
            s.put("last", last);
            save(c, s);
        } catch (Exception e) {
            reason = "erreur : " + e.getMessage();
        } finally {
            RUNNING.set(false);
        }
        return staged;
    }

    private static final String[] EXIF_TAGS = {ExifInterface.TAG_ORIENTATION, ExifInterface.TAG_DATETIME, ExifInterface.TAG_DATETIME_ORIGINAL, ExifInterface.TAG_DATETIME_DIGITIZED,
            ExifInterface.TAG_OFFSET_TIME, ExifInterface.TAG_OFFSET_TIME_ORIGINAL, ExifInterface.TAG_SUBSEC_TIME_ORIGINAL, ExifInterface.TAG_MAKE, ExifInterface.TAG_MODEL,
            ExifInterface.TAG_GPS_LATITUDE, ExifInterface.TAG_GPS_LATITUDE_REF, ExifInterface.TAG_GPS_LONGITUDE, ExifInterface.TAG_GPS_LONGITUDE_REF,
            ExifInterface.TAG_GPS_ALTITUDE, ExifInterface.TAG_GPS_ALTITUDE_REF, ExifInterface.TAG_GPS_TIMESTAMP, ExifInterface.TAG_GPS_DATESTAMP,
            ExifInterface.TAG_F_NUMBER, ExifInterface.TAG_EXPOSURE_TIME, ExifInterface.TAG_ISO_SPEED_RATINGS, ExifInterface.TAG_FOCAL_LENGTH,
            ExifInterface.TAG_FOCAL_LENGTH_IN_35MM_FILM, ExifInterface.TAG_WHITE_BALANCE, ExifInterface.TAG_FLASH, ExifInterface.TAG_IMAGE_UNIQUE_ID};

    /** Une photo : version allégée dans staged/ si elle vaut le coup, sinon null. */
    private static JSONObject prepare(Context c, ContentResolver cr, Uri uri, long id, long origSize, int q, int maxEdge) throws Exception {
        BitmapFactory.Options b = new BitmapFactory.Options();
        b.inJustDecodeBounds = true;
        InputStream in = cr.openInputStream(uri);
        if (in == null) return null;
        try { BitmapFactory.decodeStream(in, null, b); } finally { in.close(); }
        int w = b.outWidth, h = b.outHeight, edge = Math.max(w, h);
        if (w <= 0 || h <= 0) return null;
        int sample = 1;
        while (edge / (sample * 2) >= maxEdge) sample *= 2;
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inSampleSize = sample;
        o.inPreferredConfig = Bitmap.Config.ARGB_8888;
        in = cr.openInputStream(uri);
        Bitmap bmp;
        try { bmp = BitmapFactory.decodeStream(in, null, o); } finally { in.close(); }
        if (bmp == null) return null;
        int bw = bmp.getWidth(), bh = bmp.getHeight();
        if (Math.max(bw, bh) > maxEdge) {
            float k = maxEdge / (float) Math.max(bw, bh);
            Bitmap s2 = Bitmap.createScaledBitmap(bmp, Math.round(bw * k), Math.round(bh * k), true);
            if (s2 != bmp) bmp.recycle();
            bmp = s2;
            bw = bmp.getWidth();
            bh = bmp.getHeight();
        }
        ByteArrayOutputStream bo = new ByteArrayOutputStream((int) Math.min(origSize, 16L * 1024 * 1024));
        bmp.compress(Bitmap.CompressFormat.JPEG, q, bo);
        byte[] out = bo.toByteArray();
        if (out.length > origSize * 0.75) { bmp.recycle(); return null; }      // gain trop faible : on ne touche pas à la photo
        double psnr = psnr(bmp, out);
        bmp.recycle();
        if (psnr < 36.0) return null;                                            // perte visible possible : on ne touche pas à la photo
        File f = new File(new File(dir(c), "staged"), id + ".jpg");
        FileOutputStream fo = new FileOutputStream(f);
        try { fo.write(out); } finally { fo.close(); }
        try {                                                                    // métadonnées recopiées (date, orientation, lieu, appareil)
            InputStream ei = cr.openInputStream(uri);
            ExifInterface src = new ExifInterface(ei);
            ei.close();
            ExifInterface dst = new ExifInterface(f.getAbsolutePath());
            for (String t : EXIF_TAGS) {
                String v = src.getAttribute(t);
                if (v != null) dst.setAttribute(t, v);
            }
            dst.saveAttributes();
        } catch (Exception e) { /* sans EXIF : l'orientation par défaut reste correcte pour la plupart des photos */ }
        return new JSONObject().put("size", f.length()).put("psnr", Math.round(psnr * 10) / 10.0).put("w", w).put("h", h).put("nw", bw).put("nh", bh).put("q", q);
    }

    /** PSNR (dB) de la luminance entre l'image source et sa version réencodée, comparées à la même petite taille. */
    private static double psnr(Bitmap src, byte[] jpg) {
        int W = 640, sw = src.getWidth(), sh = src.getHeight();
        float k = W / (float) Math.max(sw, sh);
        int tw = Math.max(16, Math.round(sw * k)), th = Math.max(16, Math.round(sh * k));
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inSampleSize = Math.max(1, Integer.highestOneBit(Math.max(1, Math.max(sw, sh) / (W * 2))));
        Bitmap dec = BitmapFactory.decodeByteArray(jpg, 0, jpg.length, o);
        if (dec == null) return 0;
        Bitmap a = Bitmap.createScaledBitmap(src, tw, th, true), bb = Bitmap.createScaledBitmap(dec, tw, th, true);
        int[] pa = new int[tw * th], pb = new int[tw * th];
        a.getPixels(pa, 0, tw, 0, 0, tw, th);
        bb.getPixels(pb, 0, tw, 0, 0, tw, th);
        if (a != src) a.recycle();
        if (bb != dec) bb.recycle();
        dec.recycle();
        double mse = 0;
        for (int i = 0; i < pa.length; i++) {
            double ya = 0.299 * ((pa[i] >> 16) & 255) + 0.587 * ((pa[i] >> 8) & 255) + 0.114 * (pa[i] & 255);
            double yb = 0.299 * ((pb[i] >> 16) & 255) + 0.587 * ((pb[i] >> 8) & 255) + 0.114 * (pb[i] & 255);
            mse += (ya - yb) * (ya - yb);
        }
        mse /= pa.length;
        return mse <= 1e-9 ? 99 : 10 * Math.log10(255.0 * 255.0 / mse);
    }

    /** Oublie les versions préparées (rien n'a été modifié dans la galerie). */
    static void discard(Context c) {
        JSONObject s = load(c);
        JSONArray p = arr(s, "pending");
        for (int i = 0; i < p.length(); i++) new File(new File(dir(c), "staged"), p.optJSONObject(i).optString("id") + ".jpg").delete();
        try { s.put("pending", new JSONArray()); } catch (Exception e) { /* jamais */ }
        save(c, s);
    }

    // ------------------------------------------------------------------ 2. appliquer (autorisation système obligatoire)
    /** Fil d'interface. Émet « applied » {ok, n, saved, skipped, error}. */
    void apply(long id) {
        if (Build.VERSION.SDK_INT < 30) {
            sink.emit(id, "applied", "{\"ok\":false,\"error\":\"Android 11 ou plus récent est nécessaire pour remplacer les photos.\"}");
            return;
        }
        try {
            JSONArray p = arr(load(act), "pending");
            List<Uri> uris = new ArrayList<Uri>();
            for (int i = 0; i < p.length() && uris.size() < 400; i++) uris.add(Uri.parse(p.getJSONObject(i).getString("uri")));
            if (uris.isEmpty()) {
                sink.emit(id, "applied", "{\"ok\":false,\"error\":\"Rien à appliquer.\"}");
                return;
            }
            applyId = id;
            IntentSender is = MediaStore.createWriteRequest(act.getContentResolver(), uris).getIntentSender();
            act.startIntentSenderForResult(is, REQ_WRITE, null, 0, 0, 0);
        } catch (Exception e) {
            sink.emit(id, "applied", "{\"ok\":false,\"error\":" + JSONObject.quote(String.valueOf(e.getMessage())) + "}");
        }
    }

    void onWriteResult(int req, int res) {
        if (req == REQ_RESTORE) {
            onRestoreResult(res);
            return;
        }
        final long id = applyId;
        applyId = 0;
        if (id == 0) return;
        if (res != Activity.RESULT_OK) {
            sink.emit(id, "applied", "{\"ok\":false,\"error\":\"cancelled\"}");
            return;
        }
        new Thread(new Runnable() {
            @Override
            public void run() {
                sink.emit(id, "applied", replaceAll(act));
            }
        }, "improver-apply").start();
    }

    private static String replaceAll(Context c) {
        int n = 0, skipped = 0;
        long saved = 0;
        try {
            JSONObject s = load(c);
            JSONArray p = arr(s, "pending"), trash = arr(s, "trash"), keep = new JSONArray();
            JSONObject done = obj(s, "done");
            ContentResolver cr = c.getContentResolver();
            for (int i = 0; i < p.length(); i++) {
                JSONObject e = p.getJSONObject(i);
                Uri uri = Uri.parse(e.getString("uri"));
                File staged = new File(new File(dir(c), "staged"), e.getString("id") + ".jpg");
                long[] now = sizeAndDate(cr, uri);
                if (!staged.exists() || now == null || now[0] != e.optLong("orig") || now[1] != e.optLong("dm")) {   // photo modifiée ou supprimée depuis l'analyse
                    staged.delete();
                    skipped++;
                    continue;
                }
                String tid = e.getString("id") + "_" + (System.currentTimeMillis() / 1000);
                File tf = new File(new File(dir(c), "trash"), tid + ".jpg");
                InputStream in = cr.openInputStream(uri);
                if (in == null) { skipped++; continue; }
                copy(in, new FileOutputStream(tf));
                if (tf.length() != e.optLong("orig")) { tf.delete(); skipped++; continue; }    // copie de sécurité incomplète : on ne remplace pas
                OutputStream out = cr.openOutputStream(uri, "wt");
                if (out == null) { tf.delete(); skipped++; continue; }
                copy(new FileInputStream(staged), out);
                staged.delete();
                long[] after = sizeAndDate(cr, uri);
                done.put(e.getString("id"), after == null ? 0 : after[1]);
                trash.put(new JSONObject().put("tid", tid).put("id", e.getString("id")).put("uri", uri.toString()).put("name", e.optString("name"))
                        .put("orig", e.optLong("orig")).put("size", e.optLong("size")).put("t", System.currentTimeMillis() / 1000));
                n++;
                saved += e.optLong("orig") - e.optLong("size");
            }
            s.put("pending", keep);
            JSONArray h = arr(s, "history");
            String month = new java.text.SimpleDateFormat("yyyy-MM", java.util.Locale.ROOT).format(new java.util.Date());
            JSONObject cur = h.length() > 0 && month.equals(h.getJSONObject(h.length() - 1).optString("m")) ? h.getJSONObject(h.length() - 1) : null;
            if (cur == null) { cur = new JSONObject().put("m", month).put("n", 0).put("saved", 0); h.put(cur); }
            cur.put("n", cur.optInt("n") + n).put("saved", cur.optLong("saved") + saved);
            save(c, s);
            return new JSONObject().put("ok", true).put("n", n).put("saved", saved).put("skipped", skipped).toString();
        } catch (Exception e) {
            return "{\"ok\":false,\"n\":" + n + ",\"error\":" + JSONObject.quote(String.valueOf(e.getMessage())) + "}";
        }
    }

    private static long[] sizeAndDate(ContentResolver cr, Uri uri) {
        Cursor cu = null;
        try {
            cu = cr.query(uri, new String[]{MediaStore.Images.Media.SIZE, MediaStore.Images.Media.DATE_MODIFIED}, null, null, null);
            if (cu != null && cu.moveToFirst()) return new long[]{cu.getLong(0), cu.getLong(1)};
        } catch (Exception e) { /* supprimée */ } finally {
            if (cu != null) cu.close();
        }
        return null;
    }

    // ------------------------------------------------------------------ 3. corbeille
    void restore(long id, String tid) {
        if (Build.VERSION.SDK_INT < 30) {
            sink.emit(id, "restored", "{\"ok\":false,\"error\":\"Android 11 requis.\"}");
            return;
        }
        try {
            JSONObject e = trashEntry(act, tid);
            if (e == null) {
                sink.emit(id, "restored", "{\"ok\":false,\"error\":\"Introuvable dans la corbeille.\"}");
                return;
            }
            List<Uri> u = new ArrayList<Uri>();
            u.add(Uri.parse(e.getString("uri")));
            restoreId = id;
            restoreTrash = tid;
            act.startIntentSenderForResult(MediaStore.createWriteRequest(act.getContentResolver(), u).getIntentSender(), REQ_RESTORE, null, 0, 0, 0);
        } catch (Exception ex) {
            sink.emit(id, "restored", "{\"ok\":false,\"error\":" + JSONObject.quote(String.valueOf(ex.getMessage())) + "}");
        }
    }

    private void onRestoreResult(int res) {
        final long id = restoreId;
        final String tid = restoreTrash;
        restoreId = 0;
        if (id == 0) return;
        if (res != Activity.RESULT_OK) {
            sink.emit(id, "restored", "{\"ok\":false,\"error\":\"cancelled\"}");
            return;
        }
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    JSONObject e = trashEntry(act, tid);
                    File tf = new File(new File(dir(act), "trash"), tid + ".jpg");
                    OutputStream out = act.getContentResolver().openOutputStream(Uri.parse(e.getString("uri")), "wt");
                    copy(new FileInputStream(tf), out);
                    dropTrash(act, tid);
                    sink.emit(id, "restored", "{\"ok\":true}");
                } catch (Exception ex) {
                    sink.emit(id, "restored", "{\"ok\":false,\"error\":" + JSONObject.quote(String.valueOf(ex.getMessage())) + "}");
                }
            }
        }, "improver-restore").start();
    }

    private static JSONObject trashEntry(Context c, String tid) throws Exception {
        JSONArray t = arr(load(c), "trash");
        for (int i = 0; i < t.length(); i++) if (tid.equals(t.getJSONObject(i).optString("tid"))) return t.getJSONObject(i);
        return null;
    }

    private static void dropTrash(Context c, String tid) throws Exception {
        JSONObject s = load(c);
        JSONArray t = arr(s, "trash"), k = new JSONArray();
        for (int i = 0; i < t.length(); i++) {
            JSONObject e = t.getJSONObject(i);
            if (tid == null || tid.equals(e.optString("tid"))) new File(new File(dir(c), "trash"), e.optString("tid") + ".jpg").delete();
            else k.put(e);
        }
        s.put("trash", k);
        save(c, s);
    }

    /** Vide la corbeille tout de suite (l'espace est libéré immédiatement ; les originaux ne sont plus restaurables). */
    static void emptyTrash(Context c) {
        try { dropTrash(c, null); } catch (Exception e) { /* rien */ }
    }

    /** Supprime les originaux gardés depuis plus de 30 jours. */
    static void purgeTrash(Context c) {
        try {
            JSONObject s = load(c);
            JSONArray t = arr(s, "trash"), k = new JSONArray();
            long lim = System.currentTimeMillis() / 1000 - TRASH_DAYS * 86400;
            for (int i = 0; i < t.length(); i++) {
                JSONObject e = t.getJSONObject(i);
                if (e.optLong("t") < lim) new File(new File(dir(c), "trash"), e.optString("tid") + ".jpg").delete();
                else k.put(e);
            }
            s.put("trash", k);
            save(c, s);
        } catch (Exception e) { /* rien */ }
    }

    // ------------------------------------------------------------------ outils
    private static void copy(InputStream in, OutputStream out) throws Exception {
        try {
            byte[] b = new byte[64 * 1024];
            int n;
            while ((n = in.read(b)) > 0) out.write(b, 0, n);
        } finally {
            in.close();
            out.close();
        }
    }

    private static byte[] readAll(InputStream in) throws Exception {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        copy(in, o);
        return o.toByteArray();
    }
}
