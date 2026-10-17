package com.nasko.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.widget.Toast;

/** Résultat de l'installation d'une mise à jour (PackageInstaller) : demande la confirmation système si Android l'exige. */
public class UpdateReceiver extends BroadcastReceiver {
    @Override
    @SuppressWarnings("deprecation")
    public void onReceive(Context c, Intent i) {
        int st = i.getIntExtra(PackageInstaller.EXTRA_STATUS, -1);
        if (st == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent a = i.getParcelableExtra(Intent.EXTRA_INTENT);
            if (a != null) {
                a.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                c.startActivity(a);                       // « Voulez-vous mettre à jour cette application ? » (une seule fois)
            }
        } else if (st != PackageInstaller.STATUS_SUCCESS) {
            Toast.makeText(c, "Mise à jour impossible : " + i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE), Toast.LENGTH_LONG).show();
        }
    }
}
