package com.nasko.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Super Enos : entraînement aux échecs qui continue quand l'application passe en arrière-plan.
 * Service de premier plan (notification permanente, visible et fermable depuis l'appli) + verrou de réveil partiel : sans eux, Android gèle le processus
 * dès que l'écran s'éteint. Le calcul reste dans la page (Stockfish.js dans un Worker) ; ce service ne fait que garder le processus en vie.
 * Arrêt : bouton ARRÊTER de la page (MainActivity.setKeepAlive(false)), ou action « Arrêter » de la notification.
 */
public class TrainService extends Service {
    static final String CHANNEL = "enos_train";
    static final String ACTION_STOP = "com.nasko.app.TRAIN_STOP";
    static final String EXTRA_TEXT = "text";
    private static final int NOTIF_ID = 4107;
    private static final long MAX_HOLD_MS = 8L * 60 * 60 * 1000;      // le verrou se libère tout seul au bout de 8 h (jamais de fuite de batterie)
    private PowerManager.WakeLock lock;

    static void start(Context c, String text) {
        Intent i = new Intent(c, TrainService.class).putExtra(EXTRA_TEXT, text == null ? "" : text);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
        else c.startService(i);
    }

    static void stop(Context c) {
        c.stopService(new Intent(c, TrainService.class));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            sendBroadcast(new Intent(ACTION_STOP).setPackage(getPackageName()));       // la page est prévenue (MainActivity écoute)
            stopSelf();
            return START_NOT_STICKY;
        }
        String text = intent == null ? "" : intent.getStringExtra(EXTRA_TEXT);
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Entraînement de Super Enos", NotificationManager.IMPORTANCE_LOW));
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent po = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent ps = PendingIntent.getService(this, 1, new Intent(this, TrainService.class).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .setContentTitle("Super Enos s'entraîne")
                .setContentText(text == null || text.isEmpty() ? "Parties d'échecs en arrière-plan" : text)
                .setContentIntent(po)
                .addAction(new Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, "Arrêter", ps).build())
                .setOngoing(true)
                .build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(NOTIF_ID, n);
        if (lock == null) {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            lock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "enos:train");
            lock.setReferenceCounted(false);
        }
        if (!lock.isHeld()) lock.acquire(MAX_HOLD_MS);
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        if (lock != null && lock.isHeld()) lock.release();
        lock = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
