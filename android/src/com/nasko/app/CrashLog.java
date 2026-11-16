package com.nasko.app;

import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.Context;
import android.os.Build;

import java.io.File;
import java.io.FileOutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Journal de plantages : un fichier texte privé (files/crash.log, 256 Ko max) qui garde
 *  - les exceptions Java non rattrapées (gestionnaire par défaut, avec pile complète),
 *  - la perte du processus du WebView (cause fréquente de « l'app se ferme » : mémoire saturée),
 *  - les erreurs JavaScript envoyées par js/crashlog.js,
 *  - la cause de fin de la session précédente (Android 11+ : plantage, mémoire basse, signal…) et un témoin « arrêt anormal ».
 * Lisible dans l'application : Paramètres › Journal de plantages (copier, enregistrer dans Téléchargements/ENOS, effacer). Rien n'est envoyé nulle part.
 */
final class CrashLog {
    private static final int MAX = 256 * 1024;
    private static File file, marker;
    private static final Object LOCK = new Object();
    private static final SimpleDateFormat FMT = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US);

    private CrashLog() {
    }

    static void init(Context c) {
        synchronized (LOCK) {
            if (file != null) return;
            file = new File(c.getFilesDir(), "crash.log");
            marker = new File(c.getFilesDir(), "session.run");
        }
        final Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((t, e) -> {
            try {
                add("JAVA", "Exception non rattrapée dans le thread « " + t.getName() + " » : " + trace(e));
            } catch (Throwable ignored) {
            }
            if (prev != null) prev.uncaughtException(t, e);
        });
        try {
            boolean dirty = marker.exists();
            String last = dirty ? read(marker) : "";
            if (Build.VERSION.SDK_INT >= 30) {
                ActivityManager am = (ActivityManager) c.getSystemService(Context.ACTIVITY_SERVICE);
                List<ApplicationExitInfo> l = am.getHistoricalProcessExitReasons(c.getPackageName(), 0, 3);
                long seen = prefLong(c);
                long newest = seen;
                for (ApplicationExitInfo x : l) {
                    if (x.getTimestamp() <= seen) continue;
                    newest = Math.max(newest, x.getTimestamp());
                    String d = x.getDescription();
                    add("FIN", "Session précédente terminée : " + reason(x.getReason()) + (d != null ? " (" + d + ")" : "") + " · importance " + x.getImportance() + " · mémoire PSS " + (x.getPss() / 1024) + " Mo");
                }
                prefLong(c, newest);
            } else if (dirty) {
                add("FIN", "Session précédente interrompue (arrêt anormal) · dernier état : " + last);
            }
            ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
            ((ActivityManager) c.getSystemService(Context.ACTIVITY_SERVICE)).getMemoryInfo(mi);
            add("INFO", "Démarrage · Android " + Build.VERSION.RELEASE + " · " + Build.MANUFACTURER + " " + Build.MODEL + " · RAM libre " + (mi.availMem >> 20) + " / " + (mi.totalMem >> 20) + " Mo · tas max " + (Runtime.getRuntime().maxMemory() >> 20) + " Mo");
        } catch (Throwable ignored) {
        }
        state("fg");
    }

    private static long prefLong(Context c) {
        return c.getSharedPreferences("nasko", Context.MODE_PRIVATE).getLong("crash.lastExit", 0);
    }

    private static void prefLong(Context c, long v) {
        c.getSharedPreferences("nasko", Context.MODE_PRIVATE).edit().putLong("crash.lastExit", v).apply();
    }

    private static String reason(int r) {
        switch (r) {
            case ApplicationExitInfo.REASON_CRASH: return "PLANTAGE Java";
            case ApplicationExitInfo.REASON_CRASH_NATIVE: return "PLANTAGE natif";
            case ApplicationExitInfo.REASON_LOW_MEMORY: return "MÉMOIRE BASSE (tuée par Android)";
            case ApplicationExitInfo.REASON_ANR: return "APPLICATION NE RÉPOND PLUS (ANR)";
            case ApplicationExitInfo.REASON_SIGNALED: return "signal système";
            case ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE: return "ressources excessives";
            case ApplicationExitInfo.REASON_USER_REQUESTED: return "fermée par l'utilisateur";
            case ApplicationExitInfo.REASON_USER_STOPPED: return "arrêt forcé";
            case ApplicationExitInfo.REASON_EXIT_SELF: return "fermeture normale";
            case ApplicationExitInfo.REASON_DEPENDENCY_DIED: return "dépendance morte";
            case ApplicationExitInfo.REASON_PERMISSION_CHANGE: return "changement de permission";
            default: return "autre (" + r + ")";
        }
    }

    /** témoin d'état : « fg » (premier plan), « bg » (arrière-plan), « clean » (fermeture normale) */
    static void state(String s) {
        try {
            if (marker == null) return;
            if ("clean".equals(s)) {
                marker.delete();
                return;
            }
            write(marker, s + " · " + FMT.format(new Date()), false);
        } catch (Throwable ignored) {
        }
    }

    static String trace(Throwable e) {
        StringWriter sw = new StringWriter();
        e.printStackTrace(new PrintWriter(sw));
        String s = sw.toString();
        return s.length() > 6000 ? s.substring(0, 6000) + "…" : s;
    }

    static void add(String kind, String msg) {
        synchronized (LOCK) {
            if (file == null) return;
            try {
                if (msg == null) msg = "";
                if (msg.length() > 8000) msg = msg.substring(0, 8000) + "…";
                String line = "[" + FMT.format(new Date()) + "] " + kind + " · " + msg.replace("\r", "") + "\n";
                if (file.length() > MAX) {                                   // on garde la moitié la plus récente
                    String all = read(file);
                    int cut = all.indexOf('\n', all.length() / 2);
                    write(file, cut > 0 ? all.substring(cut + 1) : "", false);
                }
                write(file, line, true);
            } catch (Throwable ignored) {
            }
        }
    }

    static String text() {
        synchronized (LOCK) {
            return file == null ? "" : read(file);
        }
    }

    static boolean clear() {
        synchronized (LOCK) {
            return file != null && write(file, "", false);
        }
    }

    private static String read(File f) {
        try (java.io.FileInputStream in = new java.io.FileInputStream(f)) {
            java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
            byte[] b = new byte[8192];
            int n;
            while ((n = in.read(b)) > 0) bo.write(b, 0, n);
            return new String(bo.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return "";
        }
    }

    private static boolean write(File f, String s, boolean append) {
        try (FileOutputStream out = new FileOutputStream(f, append)) {
            out.write(s.getBytes(StandardCharsets.UTF_8));
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
