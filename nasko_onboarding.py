"""Assistant de premier démarrage : validation RÉELLE des clés et liens saisis avant de les écrire dans nasko_config.json.

Chaque étape est facultative (« Passer ») : tout peut être renseigné plus tard depuis les réglages. Rien n'est écrit tant que le test n'a pas réussi.
Les valeurs secrètes ne sont jamais renvoyées à l'interface : elle ne reçoit que « renseigné / non renseigné ».
"""
import logging
import os
import re

import httpx

import nasko_core
import nasko_epita

log = logging.getLogger("nasko.onboarding")
ELEVEN = "https://api.elevenlabs.io/v1"
GROQ = "https://api.groq.com/openai/v1"
STEPS = ("eleven_enos", "eleven_eto", "groq", "agenda", "godot", "phone", "youtube")
_KEY = re.compile(r"^[A-Za-z0-9_\-]{16,200}$")


class StepError(Exception):
    pass


def _client():
    return httpx.AsyncClient(timeout=20, verify=nasko_core.ssl_context())


def _clean_key(v):
    v = (v or "").strip()
    if not _KEY.match(v):
        raise StepError("Cette clé a un format invalide (aucun espace ni guillemet).")
    return v


def state(cfg=None):
    """{done, steps: {id: bool}} — vrai si la valeur existe déjà (le wizard saute ou coche l'étape)."""
    cfg = cfg or nasko_core.load_config()
    import nasko_youtube
    steps = {
        "eleven_enos": bool(cfg.get("elevenlabs_api_key")),
        "eleven_eto": bool(cfg.get("elevenlabs_eto_api_key") and cfg.get("elevenlabs_eto_voice_id")),
        "groq": bool(cfg.get("llm_api_key")),
        "agenda": bool(cfg.get("zeus_ics_url") or cfg.get("moodle_ics_url")),
        "godot": bool(cfg.get("project_dir") and os.path.isdir(cfg.get("project_dir", ""))),
        "phone": bool(cfg.get("allow_network_access")),
        "youtube": bool(nasko_youtube.authorized()),
    }
    done = cfg.get("onboarding_done")
    if done is None:                                                         # installation d'avant l'assistant : déjà configurée -> on ne la dérange pas
        done = bool(cfg.get("llm_api_key") or cfg.get("elevenlabs_api_key"))
    return {"done": bool(done), "steps": steps, "user": cfg.get("user_label", "")}


async def eleven_voices(key):
    """Teste la clé et retourne ses voix [{id, name}] (l'utilisateur choisit celle d'E.N.O.S. / d'ETO)."""
    key = _clean_key(key)
    async with _client() as c:
        r = await c.get(f"{ELEVEN}/voices", headers={"xi-api-key": key})
    if r.status_code in (400, 401, 403):
        raise StepError("ElevenLabs refuse cette clé (invalide, révoquée ou crédits épuisés).")
    if r.status_code != 200:
        raise StepError(f"ElevenLabs : erreur {r.status_code}.")
    voices = [{"id": v["voice_id"], "name": v.get("name", "?"), "cat": v.get("category", "")} for v in r.json().get("voices", [])]
    if not voices:
        raise StepError("Clé valide, mais ce compte n'a aucune voix : ajoutes-en une dans ElevenLabs (Voices) puis réessaie.")
    return voices


async def save_eleven(persona, key, voice_id):
    key = _clean_key(key)
    voices = await eleven_voices(key)
    v = next((x for x in voices if x["id"] == voice_id), None)
    if not v:
        raise StepError("Choisis une voix dans la liste.")
    if persona == "eto":
        nasko_core.update_config({"elevenlabs_eto_api_key": key, "elevenlabs_eto_voice_id": voice_id})
    else:
        nasko_core.update_config({"elevenlabs_api_key": key, "elevenlabs_voice_id": voice_id, "elevenlabs_voice_name": v["name"]})
    return {"voice": v["name"]}


async def save_groq(key):
    key = _clean_key(key)
    async with _client() as c:
        r = await c.get(f"{GROQ}/models", headers={"Authorization": f"Bearer {key}"})
    if r.status_code == 401:
        raise StepError("Groq refuse cette clé (elle doit commencer par gsk_).")
    if r.status_code != 200:
        raise StepError(f"Groq : erreur {r.status_code}.")
    ids = {m.get("id") for m in r.json().get("data", [])}
    model = "openai/gpt-oss-120b" if "openai/gpt-oss-120b" in ids else next((i for i in sorted(ids) if i and "llama" in i and "guard" not in i), "llama-3.3-70b-versatile")
    nasko_core.update_config({"llm_provider": "openai", "llm_base_url": GROQ, "llm_model": model, "llm_api_key": key})
    return {"model": model}


async def save_agenda(zeus, moodle):
    """Télécharge et analyse réellement chaque lien .ics avant de l'enregistrer. Un champ vide est ignoré."""
    out, vals = {}, {}
    for name, url, cfgkey in (("zeus", (zeus or "").strip(), "zeus_ics_url"), ("moodle", (moodle or "").strip(), "moodle_ics_url")):
        if not url:
            continue
        try:
            items = nasko_epita.parse_ics(await nasko_epita._download(url))
        except Exception as e:                                              # noqa: BLE001
            raise StepError(f"{name.capitalize()} : " + re.sub(r"https?://\S+", "<lien>", str(e))[:160])
        vals[cfgkey] = url
        out[name] = len(items)
    if not vals:
        raise StepError("Colle au moins un lien d'export (.ics).")
    nasko_core.update_config(vals)
    nasko_epita._mem.clear()
    return out


def finish(done=True):
    nasko_core.update_config({"onboarding_done": bool(done)})


def save_name(name):
    """Prénom de l'utilisateur : étiquette du profil actif + son nom d'utilisateur Windows (retrouvé automatiquement aux lancements suivants)."""
    name = re.sub(r"[^\w \-'.]", "", (name or "").strip(), flags=re.U)[:30].strip()
    if not name:
        raise StepError("Indique ton prénom.")
    data = nasko_core.load_profiles()
    pid, prof = nasko_core.current_profile(data)
    prof["label"] = name
    prof["windows_users"] = sorted({*prof.get("windows_users", []), *nasko_core._whoami()})
    data["active"] = pid
    nasko_core.save_profiles(data)
    return {"name": name}
