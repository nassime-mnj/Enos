"""Crée la voix « ETO streamer » via ElevenLabs Voice Design, la sauvegarde sur le compte et écrit son voice_id dans nasko_config.json.

    py creer_voix_eto.py            -> génère 3 aperçus, enregistre le premier, met à jour elevenlabs_eto_voice_id

Prérequis ElevenLabs : un plan PAYANT (le Voice Design par API est refusé sur le plan gratuit : « feature_not_available ») et au moins un slot de voix libre
(supprimez une voix inutile sinon). Les réglages de rendu (stabilité 0,35, similarité 0,80, style 0,15) ne font pas partie de la voix : ils sont appliqués
à chaque synthèse (clés elevenlabs_eto_stability / _similarity / _style / _speed de nasko_config.json).
"""
import base64
import os
import sys

import httpx

import nasko_core

DESC = ("A young energetic French male voice, speaking very fast with high enthusiasm and dynamic pitch variations. The tone is pedagogical, confident, and highly "
        "engaging, exactly like a professional chess streamer or e-sports commentator explaining tactics. Clear articulation despite the fast pacing. No robotic "
        "undertones, very natural, expressive, and slightly geeky.")
# Voice Design par API : le genre (male), l'âge (young adult) et l'accent (French) sont décrits DANS le prompt ci-dessus (l'API ne prend plus de champs séparés).
SAMPLE = ("[excited] Ok, du coup on avance le pion en e4 et boum, on prend le contrôle du centre ! [laugh] Et là attention : le cavalier arrive en f3, "
          "on développe les pièces, on se prépare à roquer. Allez, c'est parti, c'est exactement les trois principes de l'ouverture !")
SETTINGS = {"elevenlabs_eto_stability": 0.35, "elevenlabs_eto_similarity": 0.80, "elevenlabs_eto_style": 0.15}


def main():
    cfg = nasko_core.load_config()
    key = (cfg.get("elevenlabs_eto_api_key") or "").strip()
    if not key:
        sys.exit("elevenlabs_eto_api_key absente de nasko_config.json")
    H = {"xi-api-key": key}
    with httpx.Client(timeout=180, verify=nasko_core.ssl_context()) as c:
        r = c.post("https://api.elevenlabs.io/v1/text-to-voice/design", headers=H,
                   json={"voice_description": DESC, "model_id": "eleven_ttv_v3", "text": SAMPLE, "guidance_scale": 5})
        if r.status_code != 200:
            sys.exit(f"Voice Design refusé ({r.status_code}) : {r.text[:400]}")
        previews = r.json().get("previews", [])
        if not previews:
            sys.exit("Aucun aperçu généré.")
        out = os.path.join(nasko_core.data_dir(), "voice_design")
        os.makedirs(out, exist_ok=True)
        for i, p in enumerate(previews):
            with open(os.path.join(out, f"eto_apercu_{i}.mp3"), "wb") as f:
                f.write(base64.b64decode(p["audio_base_64"]))
        print(f"{len(previews)} aperçus dans {out}")
        r = c.post("https://api.elevenlabs.io/v1/text-to-voice", headers=H,
                   json={"voice_name": "ETO Streamer", "voice_description": DESC, "generated_voice_id": previews[0]["generated_voice_id"]})
        if r.status_code != 200:
            sys.exit(f"Sauvegarde de la voix refusée ({r.status_code}) : {r.text[:400]}")
        vid = r.json()["voice_id"]
    nasko_core.update_config({"elevenlabs_eto_voice_id": vid, **SETTINGS})
    print("Nouvelle voix ETO enregistrée :", vid, "(elevenlabs_eto_voice_id mis à jour)")


if __name__ == "__main__":
    main()
