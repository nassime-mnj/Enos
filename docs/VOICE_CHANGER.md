# VOICE CHANGER

Modifie la voix **sortante du micro** en temps réel (module « 26. VOICE CHANGER » du menu de la version PC).

## Principe
micro réel → chaîne d'effets (`nasko_voicemod.py`, numpy pur, blocs de 20 ms, ≈ 55 ms de latence, ~2 % de CPU) → **câble audio virtuel** (VB-CABLE, VoiceMeeter, Hi-Fi Cable…).
Dans Discord / OBS / Teams / un jeu : micro = « CABLE Output ». Windows ne permet pas de remplacer le micro sans pilote : E.N.O.S. n'installe pas le câble à ta place (bouton « TÉLÉCHARGER VB-CABLE » dans l'interface). Sans câble : « Je m'entends » (casque) et « Aperçu 4 s » fonctionnent quand même.

## Contenu
* **54 voix** en 7 catégories (Naturel, Fun, Robot & SF, Radio & lieux, Horreur, Musique & FX, Persos) + **Mes voix** (voix enregistrées, 40 max) + **favoris** ★.
* **29 curseurs** : hauteur ±12 demi-tons, timbre, présence, 2 harmonies, robot (modulation en anneau), vibrato, trémolo, chœur, flanger, distorsion, bit-crusher, murmure, écho, réverbération, coupe-bas/haut, porte de bruit, gain, mix sec/traité. Tout se règle **en direct**.
* Bypass (voix normale) en un clic, niveaux micro / sortie, visualiseur spectre + onde.
* Fichiers : `nasko_voicemod.py` (DSP + moteur), routes `/api/voicemod/*` (nasko_server.py, `local_only`), `static/voicemod.js|css`, section `#vm` de `static/index.html`. Réglages mémorisés dans `data/voicemod.json`.
* Tests : `tests/t_voicemod_dsp.py` (hauteur exacte, 54 voix saines, charge CPU), `tests/t_voicemod_ui.py` (interface + API).

## Limites
* Windows (WASAPI) ; le micro et la sortie doivent être des périphériques WASAPI.
* Décalage de hauteur granulaire : très bon jusqu'à ±7 demi-tons, un peu « robotique » aux extrêmes (c'est voulu pour certaines voix). Le « timbre » est une courbe de filtre, pas un vrai déplacement de formants.
* Jamais testé avec un câble virtuel installé (aucun sur le PC de dev) : seule la partie micro → sortie normale a été vérifiée en réel.
