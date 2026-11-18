package com.nasko.app;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * MOTEURS D'ÉCHECS NATIFS (UCI) : Stockfish 19 complet, Obsidian, PlentyChess, Caissa, Viridithas — exécutables ARM64 livrés dans l'APK
 * sous lib/arm64-v8a/libeng_<id>.so (android:extractNativeLibs="true" -> nativeLibraryDir, seul dossier exécutable d'une application).
 * Le JavaScript (window.EnosEngine) démarre un moteur, lui écrit des lignes UCI et reçoit ses réponses par lots
 * via ENOS.nativeEngine._recv(id, [lignes]). Un seul processus par moteur ; tous arrêtés quand l'activité est détruite.
 */
final class EngineBridge {
    private static final Pattern ID = Pattern.compile("[a-z0-9]{1,16}");
    private static final Pattern LINE = Pattern.compile("[\\x20-\\x7E]{1,4000}");
    private final Activity act;
    private final WebView web;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Map<String, Proc> procs = new HashMap<>();

    private final class Proc {
        final String id; final Process p; final OutputStream in; final List<String> buf = new ArrayList<>(); boolean posted = false;
        Proc(String id, Process p) { this.id = id; this.p = p; this.in = p.getOutputStream(); }
    }

    EngineBridge(Activity act, WebView web) { this.act = act; this.web = web; }

    private File exe(String id) { return new File(act.getApplicationInfo().nativeLibraryDir, "libeng_" + id + ".so"); }

    /** moteurs présents dans l'APK : ["sf19", "obsidian", ...] + nombre de cœurs */
    @JavascriptInterface
    public String list() {
        try {
            JSONArray a = new JSONArray();
            File[] fs = new File(act.getApplicationInfo().nativeLibraryDir).listFiles();
            if (fs != null) for (File f : fs) { String n = f.getName(); if (n.startsWith("libeng_") && n.endsWith(".so") && f.canExecute()) a.put(n.substring(7, n.length() - 3)); }
            return new JSONObject().put("engines", a).put("cores", Runtime.getRuntime().availableProcessors()).toString();
        } catch (Exception e) { return "{\"engines\":[],\"cores\":1}"; }
    }

    @JavascriptInterface
    public synchronized boolean start(String id) {
        if (id == null || !ID.matcher(id).matches()) return false;
        Proc old = procs.get(id); if (old != null) { try { old.p.exitValue(); } catch (IllegalThreadStateException alive) { return true; } procs.remove(id); }
        File f = exe(id); if (!f.isFile()) return false;
        try {
            ProcessBuilder pb = new ProcessBuilder(f.getAbsolutePath()).redirectErrorStream(true).directory(act.getCacheDir());
            final Proc pr = new Proc(id, pb.start()); procs.put(id, pr);
            Thread t = new Thread(new Runnable() { @Override public void run() { pump(pr); } }, "engine-" + id); t.setDaemon(true); t.start();
            return true;
        } catch (Exception e) { CrashLog.add("moteur", id + " : " + e); return false; }
    }

    private void pump(final Proc pr) {
        try (BufferedReader r = new BufferedReader(new InputStreamReader(pr.p.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = r.readLine()) != null) {
                synchronized (pr) {
                    pr.buf.add(line);
                    if (!pr.posted) { pr.posted = true; ui.postDelayed(new Runnable() { @Override public void run() { flush(pr); } }, 12); }     // lots de 12 ms : peu d'appels JS même quand le moteur parle beaucoup
                }
            }
        } catch (Exception e) { /* moteur arrêté */ }
        synchronized (pr) { pr.buf.add("info string ENOS engine-exit"); if (!pr.posted) { pr.posted = true; ui.post(new Runnable() { @Override public void run() { flush(pr); } }); } }
    }

    private void flush(Proc pr) {
        JSONArray a;
        synchronized (pr) { a = new JSONArray(pr.buf); pr.buf.clear(); pr.posted = false; }
        if (a.length() == 0) return;
        web.evaluateJavascript("window.ENOS&&ENOS.nativeEngine&&ENOS.nativeEngine._recv(" + JSONObject.quote(pr.id) + "," + a.toString() + ")", null);
    }

    @JavascriptInterface
    public boolean send(String id, String text) {
        Proc pr; synchronized (this) { pr = procs.get(id); }
        if (pr == null || text == null) return false;
        try {
            StringBuilder sb = new StringBuilder();
            for (String l : text.split("\n")) { if (!LINE.matcher(l).matches()) return false; sb.append(l).append('\n'); }      // UCI = ASCII imprimable, une commande par ligne
            synchronized (pr) { pr.in.write(sb.toString().getBytes(StandardCharsets.US_ASCII)); pr.in.flush(); }
            return true;
        } catch (Exception e) { return false; }
    }

    @JavascriptInterface
    public synchronized void stop(String id) {
        Proc pr = procs.remove(id); if (pr == null) return;
        try { pr.in.write("quit\n".getBytes(StandardCharsets.US_ASCII)); pr.in.flush(); } catch (Exception e) { /* déjà fermé */ }
        pr.p.destroy();
    }

    synchronized void stopAll() { for (String id : new ArrayList<>(procs.keySet())) stop(id); }
}
