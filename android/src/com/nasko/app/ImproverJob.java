package com.nasko.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobParameters;
import android.app.job.JobService;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

/**
 * Préparation automatique du Mobile Improver (planifiée par Improver.schedule : au plus une fois par jour, téléphone EN CHARGE, batterie correcte).
 * Prépare au plus 300 photos en 8 minutes, purge la corbeille de plus de 30 jours, puis prévient par une notification si des photos sont prêtes.
 * Rien n'est remplacé ici : le remplacement exige l'autorisation d'Android, donnée dans l'application (« Appliquer »).
 */
public final class ImproverJob extends JobService {
    private Thread worker;

    @Override
    public boolean onStartJob(final JobParameters params) {
        if (!Improver.prefs(this).getBoolean("auto", false) || !GalleryReadable(this)) return false;
        worker = new Thread(new Runnable() {
            @Override
            public void run() {
                int n = 0;
                try {
                    n = Improver.analyze(ImproverJob.this, 8 * 60 * 1000L, 300, null);
                } catch (Throwable t) { /* jamais d'arrêt de l'application à cause d'une photo */ }
                if (n > 0) notifyReady(ImproverJob.this);
                jobFinished(params, false);
            }
        }, "improver-job");
        worker.setPriority(Thread.MIN_PRIORITY);
        worker.start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        Improver.CANCEL.set(true);                                  // débranché : on s'arrête proprement, on reprendra plus tard
        return true;
    }

    private static boolean GalleryReadable(Context c) {
        String p = Build.VERSION.SDK_INT >= 33 ? "android.permission.READ_MEDIA_IMAGES" : "android.permission.READ_EXTERNAL_STORAGE";
        return c.checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED;
    }

    private static void notifyReady(Context c) {
        try {
            if (Build.VERSION.SDK_INT >= 33 && c.checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) return;
            org.json.JSONObject s = new org.json.JSONObject(Improver.summary(c));
            int n = s.optInt("pending");
            long mb = s.optLong("pendingSaved") / (1024 * 1024);
            if (n <= 0) return;
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            nm.createNotificationChannel(new NotificationChannel("improver", "Mobile Improver", NotificationManager.IMPORTANCE_LOW));
            Intent open = new Intent(c, MainActivity.class).putExtra("module", "improver").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pi = PendingIntent.getActivity(c, 4107, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            Notification no = new Notification.Builder(c, "improver")
                    .setSmallIcon(android.R.drawable.stat_sys_download_done)
                    .setContentTitle("ETO a préparé " + n + " photo" + (n > 1 ? "s" : ""))
                    .setContentText(mb + " Mo à récupérer, sans perte visible. Touche pour vérifier et appliquer.")
                    .setContentIntent(pi)
                    .setAutoCancel(true)
                    .build();
            nm.notify(4107, no);
        } catch (Exception e) { /* pas de notification : l'application montrera le résultat */ }
    }
}
