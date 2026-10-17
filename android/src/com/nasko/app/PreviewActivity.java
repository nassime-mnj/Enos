package com.nasko.app;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.JsResult;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

/**
 * Aperçu HTML/CSS/JS de CodeLab dans une activité SÉPARÉE : une WebView ordinaire, SANS aucun pont JavaScript (ni « Enos » ni « NaskoApp »), réseau coupé,
 * accès fichiers coupé, navigation bloquée. Le code de l'utilisateur (parfois collé depuis Internet) ne peut donc jamais appeler le coffre-fort, les clés ou les fichiers
 * du téléphone — ce qui serait possible dans une iframe de la page principale, car addJavascriptInterface s'applique à TOUS les cadres.
 * Les messages console et les erreurs sont renvoyés au terminal de CodeLab via {@link #listener}.
 */
public final class PreviewActivity extends Activity {
    interface Listener { void log(String json); }

    static volatile String pendingHtml = "";
    static volatile String pendingTitle = "";
    static volatile Listener listener;

    private WebView web;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        final String html = pendingHtml;
        pendingHtml = "";
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.BLACK);

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(Color.rgb(15, 15, 19));
        int p = (int) (10 * getResources().getDisplayMetrics().density);
        bar.setPadding(p, p, p, p);
        TextView close = new TextView(this);
        close.setText("‹  RETOUR");
        close.setTextColor(Color.WHITE);
        close.setTextSize(15);
        close.setPadding(p, p / 2, p * 2, p / 2);
        close.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { finish(); }
        });
        TextView title = new TextView(this);
        title.setText(pendingTitle == null || pendingTitle.isEmpty() ? "Aperçu" : pendingTitle);
        title.setTextColor(Color.rgb(160, 160, 175));
        title.setSingleLine(true);
        bar.addView(close);
        bar.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);                 // le code de l'utilisateur doit pouvoir s'exécuter
        s.setDomStorageEnabled(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setBlockNetworkLoads(true);                 // aperçu hors-ligne : aucune requête sortante
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setSupportMultipleWindows(false);
        s.setGeolocationEnabled(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { return true; }   // aucune navigation
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(ConsoleMessage m) {
                Listener l = listener;
                if (l != null) {
                    try {
                        JSONObject o = new JSONObject();
                        o.put("level", m.messageLevel().toString());
                        o.put("msg", m.message());
                        o.put("line", m.lineNumber());
                        l.log(o.toString());
                    } catch (Exception ignored) { /* journal facultatif */ }
                }
                return true;
            }
            @Override public boolean onJsAlert(WebView v, String url, String message, JsResult r) { r.confirm(); return true; }
            @Override public boolean onJsConfirm(WebView v, String url, String message, JsResult r) { r.cancel(); return true; }
            @Override public boolean onJsPrompt(WebView v, String url, String message, String d, android.webkit.JsPromptResult r) { r.cancel(); return true; }
        });
        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);
        web.setBackgroundColor(Color.WHITE);
        web.loadDataWithBaseURL(null, html == null ? "" : html, "text/html", "utf-8", null);
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.stopLoading();
            web.loadUrl("about:blank");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
