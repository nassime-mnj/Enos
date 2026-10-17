"""Synthese vocale ElevenLabs avec la voix personnalisee 'A.I. E.N.O.S.' (cache local)."""
import hashlib
import logging
import os
import re
import subprocess
import sys
import time

import httpx

import nasko_core
import nasko_persona
from nasko_core import bump_stat, data_dir, ssl_context

log = logging.getLogger("nasko.eleven")
API = "https://api.elevenlabs.io/v1"


class ElevenError(Exception):
    """Erreur lisible, affichable telle quelle dans le chat."""


def configured(cfg, persona="enos"):
    return bool(_key(cfg, persona))


def _key(cfg, persona="enos"):
    """Clé ElevenLabs de la personnalité : ETO a la sienne, E.N.O.S. garde l'ancienne."""
    if persona == "eto":
        return (cfg.get("elevenlabs_eto_api_key") or "").strip()
    return (cfg.get("elevenlabs_api_key") or os.environ.get("ELEVENLABS_API_KEY", "")).strip()


def _model(cfg, persona="enos"):
    """E.N.O.S. : multilingual_v2 (une seule voix FR/EN). ETO : eleven_v3, qui interprète les Audio Tags [laugh] [sigh] [hmm]."""
    return (cfg.get("elevenlabs_eto_model") or "eleven_v3").strip() if persona == "eto" else MODEL


def _explain(resp):
    """Transforme une reponse d'erreur HTTP en message clair."""
    try:
        detail = resp.json().get("detail", {})
    except ValueError:
        detail = {}
    status = detail.get("status", "") if isinstance(detail, dict) else ""
    msg = detail.get("message", "") if isinstance(detail, dict) else str(detail)
    code = detail.get("code", "") if isinstance(detail, dict) else ""
    if "quota" in status or "quota" in code or resp.status_code == 402:           # ElevenLabs répond 401 « quota_exceeded » quand les crédits sont épuisés : ce n'est PAS une clé invalide
        return f"ElevenLabs : crédits épuisés (quota de caractères du compte). {msg}".strip()
    if resp.status_code == 401:
        return "ElevenLabs : clé API invalide ou révoquée (vérifiez elevenlabs_api_key / elevenlabs_eto_api_key)."
    if resp.status_code == 429:
        return "ElevenLabs : trop de requêtes simultanées, réessayez dans un instant."
    return f"ElevenLabs : erreur {resp.status_code}. {msg}".strip()


def resolve_voice_id(cfg, client, persona="enos"):
    if persona == "eto":
        vid = (cfg.get("elevenlabs_eto_voice_id") or "").strip()
        if not vid:
            raise ElevenError("ElevenLabs : voix d'ETO non configurée (elevenlabs_eto_voice_id dans nasko_config.json).")
        return vid
    vid = (cfg.get("elevenlabs_voice_id") or "").strip()
    if vid:
        return vid
    name = (cfg.get("elevenlabs_voice_name") or "").strip().lower()
    resp = client.get(f"{API}/voices", headers={"xi-api-key": _key(cfg)})
    if resp.status_code != 200:
        raise ElevenError(_explain(resp) + " Renseignez elevenlabs_voice_id pour éviter la recherche par nom.")
    for v in resp.json().get("voices", []):
        if v.get("name", "").strip().lower() == name:
            return v["voice_id"]
    raise ElevenError(f"ElevenLabs : voix « {cfg.get('elevenlabs_voice_name')} » introuvable. "
                      "Renseignez elevenlabs_voice_id dans nasko_config.json.")


MODEL = "eleven_multilingual_v2"
_DEAD = {}                       # clé -> instant où elle a été vue sans crédit : on essaie d'abord les autres comptes pendant DEAD_TTL
_BACKUP_VOICE = {}               # clé de secours -> voice_id retrouvé par nom (ENOS2)
DEAD_TTL = 600


def _out_of_credit(resp):
    """Quota épuisé (ElevenLabs répond 401 « quota_exceeded » ou 402) ou clé refusée : le compte de secours doit prendre le relais."""
    if resp.status_code in (401, 402):
        return True
    try:
        d = resp.json().get("detail", {})
    except ValueError:
        return False
    return isinstance(d, dict) and "quota" in (str(d.get("status", "")) + str(d.get("code", "")))


def _accounts(cfg, persona):
    """Comptes à essayer, dans l'ordre : [(clé, fonction(client) -> voice_id)]. E.N.O.S. a un compte de secours (voix ENOS2) ; ETO n'en a pas.
    Un compte vu sans crédit récemment passe en dernier (on garde la chance qu'il ait été rechargé)."""
    main = _key(cfg, persona)
    accs = [(main, lambda c: resolve_voice_id(cfg, c, persona))] if main else []
    bkey = (cfg.get("elevenlabs_backup_api_key") or "").strip() if persona != "eto" else ""
    if bkey and bkey != main:
        accs.append((bkey, lambda c: _backup_voice(cfg, c, bkey)))
    fresh = [a for a in accs if time.time() - _DEAD.get(a[0], 0) > DEAD_TTL]
    return fresh + [a for a in accs if a not in fresh]


def _backup_voice(cfg, client, key):
    vid = (cfg.get("elevenlabs_backup_voice_id") or "").strip() or _BACKUP_VOICE.get(key, "")
    if vid:
        return vid
    name = (cfg.get("elevenlabs_backup_voice_name") or "ENOS2").strip().lower()
    resp = client.get(f"{API}/voices", headers={"xi-api-key": key})
    if resp.status_code != 200:
        raise ElevenError(_explain(resp) + " (compte de secours)")
    for v in resp.json().get("voices", []):
        if v.get("name", "").strip().lower() == name:
            _BACKUP_VOICE[key] = v["voice_id"]
            return v["voice_id"]
    raise ElevenError(f"ElevenLabs (secours) : voix « {cfg.get('elevenlabs_backup_voice_name') or 'ENOS2'} » introuvable sur ce compte. Renseignez elevenlabs_backup_voice_id.")


def speakable(text, persona="enos"):
    """Retire la mise en forme markdown et borne la longueur (cout et limites de l'API).
    Les Audio Tags [laugh] [sigh]… sont conservés pour ETO (eleven_v3 les joue) et supprimés pour E.N.O.S. (multilingual_v2 les lirait à voix haute)."""
    text = nasko_persona.spoken_text(text, nasko_core.language())          # la voix ne doit jamais épeler la notation (« Fe3 » -> « fou en e 3 »)
    if persona != "eto":
        text = nasko_persona.clean(text)
    text = re.sub(r"[*_`#>~]+", "", text)
    return re.sub(r"\s+", " ", text).strip()[:2500]


def _voice_settings(cfg, persona):
    """ETO (streamer d'échecs rapide et passionné) : stabilité basse (0,35 : la voix varie du grave à l'aigu), similarité 0,80, style 0,15, débit accéléré. E.N.O.S. : réglages d'origine de la voix."""
    if persona != "eto":
        return None
    def f(k, d):
        try:
            return float(cfg.get(k, d))
        except (TypeError, ValueError):
            return d
    return {"stability": f("elevenlabs_eto_stability", 0.35), "similarity_boost": f("elevenlabs_eto_similarity", 0.80), "style": f("elevenlabs_eto_style", 0.15),
            "use_speaker_boost": True, "speed": max(0.7, min(1.2, f("elevenlabs_eto_speed", 1.12)))}


def _tempo(cfg, persona):
    """Accélération locale (FFmpeg atempo, hauteur inchangée) appliquée APRÈS ElevenLabs : l'API plafonne `speed` à 1.2, ce multiplicateur
    prend le relais pour atteindre le débit visé (1.2 x 1.15 ≈ 1.38). 1.0 = désactivé. Borné à 1.0 – 1.6 (au-delà, l'élocution devient pâteuse)."""
    if persona != "eto":
        return 1.0
    try:
        return max(1.0, min(1.6, float(cfg.get("elevenlabs_eto_tempo", 1.15))))
    except (TypeError, ValueError):
        return 1.0


def _speed_up(path, tempo):
    """Réécrit `path` (mp3) `tempo` fois plus vite. Sans FFmpeg ou en cas d'échec, le fichier d'origine est conservé (voix plus lente, jamais de silence)."""
    if tempo <= 1.001:
        return
    try:
        import nasko_compress
        exe = nasko_compress.ffmpeg_exe()
        if not exe:
            log.warning("TTS : FFmpeg introuvable, accélération locale ignorée.")
            return
        tmp = path + ".fast.mp3"
        flags = 0x08000000 if sys.platform == "win32" else 0                  # CREATE_NO_WINDOW
        r = subprocess.run([exe, "-y", "-loglevel", "error", "-i", path, "-filter:a", f"atempo={tempo:.3f}", "-codec:a", "libmp3lame", "-b:a", "128k", tmp],
                           capture_output=True, timeout=60, creationflags=flags)
        if r.returncode == 0 and os.path.isfile(tmp) and os.path.getsize(tmp) > 0:
            os.replace(tmp, path)
        else:
            log.warning("TTS : atempo a échoué (%s)", r.stderr.decode(errors="replace")[:200])
            if os.path.isfile(tmp):
                os.remove(tmp)
    except (OSError, subprocess.SubprocessError, ImportError) as e:
        log.warning("TTS : accélération locale impossible : %s", e)


def synthesize(text, cfg, persona="enos"):
    """Retourne le chemin d'un mp3 pour `text` (depuis le cache si deja genere). Les fichiers d'ETO sont préfixés « eto » (jamais assombris par deepen())."""
    if not configured(cfg, persona):
        raise ElevenError("ElevenLabs non configuré pour ETO : ajoutez elevenlabs_eto_api_key dans nasko_config.json." if persona == "eto"
                          else "ElevenLabs non configuré : ajoutez elevenlabs_api_key dans nasko_config.json.")
    text = speakable(text, persona)
    model = _model(cfg, persona)
    cache = os.path.join(data_dir(), "tts_cache")
    os.makedirs(cache, exist_ok=True)
    voice = cfg.get("elevenlabs_eto_voice_id", "") if persona == "eto" else cfg.get("elevenlabs_voice_id", "")
    vs = _voice_settings(cfg, persona)
    tempo = _tempo(cfg, persona)
    digest = ("eto" if persona == "eto" else "") + hashlib.sha1(f"{voice}|{model}|{vs}|{tempo}|{text}".encode()).hexdigest()[:20]      # le tempo fait partie de la clé : changer le réglage régénère l'audio
    path = os.path.join(cache, digest + ".mp3")
    if os.path.isfile(path):
        log.info("TTS cache hit %s", digest)
        return path
    accounts = _accounts(cfg, persona)
    resp = None
    try:
        with httpx.Client(timeout=60, verify=ssl_context()) as client:
            for i, (key, vid_of) in enumerate(accounts):
                vid = vid_of(client)
                log.info("TTS requete (%d caracteres, %s, voix %s, modele %s, compte %s)", len(text), persona, vid, model, "principal" if key == _key(cfg, persona) else "secours")
                hdr = {"xi-api-key": key}
                resp = client.post(f"{API}/text-to-speech/{vid}", params={"output_format": "mp3_44100_128"},
                                   headers=hdr, json={"text": text, "model_id": model, **({"voice_settings": vs} if vs else {})})
                if resp.status_code in (400, 422) and vs:            # réglages refusés par ce modèle : on réessaie avec ceux de la voix
                    resp = client.post(f"{API}/text-to-speech/{vid}", params={"output_format": "mp3_44100_128"},
                                       headers=hdr, json={"text": text, "model_id": model})
                if resp.status_code == 200:
                    _DEAD.pop(key, None)
                    break
                if _out_of_credit(resp):                             # crédits épuisés (ou clé refusée) : ce compte est mis de côté 10 min
                    _DEAD[key] = time.time()
                    if i + 1 < len(accounts):
                        log.warning("ElevenLabs : compte %s inutilisable (%s), bascule sur l'autre", "principal" if i == 0 else "secours", resp.status_code)
                        continue
                break
    except httpx.HTTPError as e:
        raise ElevenError(f"ElevenLabs injoignable : {e.__class__.__name__}. Vérifiez la connexion internet.") from e
    if resp is None or resp.status_code != 200:
        raise ElevenError(_explain(resp) if resp is not None else "ElevenLabs : aucun compte configuré.")
    with open(path, "wb") as f:
        f.write(resp.content)
    _speed_up(path, tempo)
    bump_stat("api_chars", len(text))        # caracteres réellement facturés par ElevenLabs
    return path
