"""Mémoire locale d'ETO : plus on joue, moins ça coûte en API.

Chaque commentaire généré par le LLM (Groq) est mémorisé dans data/eto_commentary_cache.json, avec pour clé la position exacte (FEN), le coup joué et l'Elo
du bot. Son audio ElevenLabs est copié dans data/audio_cache/ sous le même identifiant. Quand la même situation revient (ouvertures, erreurs typiques à bas Elo),
ETO relit le texte et rejoue l'audio : AUCUN appel au LLM ni à ElevenLabs.
"""
import json
import logging
import os
import shutil
import threading
import time

from nasko_core import data_dir

log = logging.getLogger("nasko.cache")
MAX_ENTRIES = 5000
_lock = threading.RLock()
_db = {"loaded": False, "entries": {}, "hits": 0, "misses": 0}


def _path():
    return os.path.join(data_dir(), "eto_commentary_cache.json")


def audio_dir():
    d = os.path.join(data_dir(), "audio_cache")
    os.makedirs(d, exist_ok=True)
    return d


def _load():
    if _db["loaded"]:
        return
    _db["loaded"] = True
    try:
        with open(_path(), encoding="utf-8") as f:
            d = json.load(f)
        _db["entries"] = d.get("entries", {}) if isinstance(d, dict) else {}
    except (OSError, ValueError):
        _db["entries"] = {}


def _save():
    tmp = _path() + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"version": 1, "entries": _db["entries"]}, f, ensure_ascii=False)
        os.replace(tmp, _path())
    except OSError as e:
        log.warning("cache non enregistré : %s", e)


def get(key):
    """Entrée {spoken, shown, tags, audio?} ou None. Compte les succès / échecs."""
    if not key:
        return None
    with _lock:
        _load()
        e = _db["entries"].get(key)
        if e:
            _db["hits"] += 1
            e["n"] = e.get("n", 0) + 1
            e["last"] = int(time.time())
            log.info("cache ETO : succès (%s) — aucun appel LLM", key)
            return dict(e)
        _db["misses"] += 1
        return None


def put(key, spoken, shown, tags):
    if not key or not spoken:
        return
    with _lock:
        _load()
        ents = _db["entries"]
        ents[key] = {"spoken": spoken, "shown": shown, "tags": tags, "n": 0, "created": int(time.time()), "last": int(time.time())}
        if len(ents) > MAX_ENTRIES:                                  # on oublie d'abord les entrées les moins servies, les plus anciennes
            for k in sorted(ents, key=lambda k: (ents[k].get("n", 0), ents[k].get("last", 0)))[:len(ents) - MAX_ENTRIES + 100]:
                ents.pop(k, None)
        _save()


def audio_for(key):
    """Identifiant de l'audio (pour /api/tts/<id>) si le fichier existe dans audio_cache, sinon None."""
    if not key:
        return None
    with _lock:
        _load()
        e = _db["entries"].get(key)
        name = e.get("audio") if e else None
    if name and os.path.isfile(os.path.join(audio_dir(), name + ".mp3")):
        return name
    return None


def store_audio(key, src_path):
    """Copie l'audio synthétisé dans audio_cache et le rattache à l'entrée. Retourne son identifiant."""
    if not key or not src_path or not os.path.isfile(src_path):
        return None
    name = "etocc" + key                                              # préfixe « eto » : jamais assombri par deepen()
    try:
        shutil.copyfile(src_path, os.path.join(audio_dir(), name + ".mp3"))
    except OSError as e:
        log.warning("audio non mis en cache : %s", e)
        return None
    with _lock:
        _load()
        if key in _db["entries"]:
            _db["entries"][key]["audio"] = name
            _save()
    return name


def audio_path(name):
    p = os.path.join(audio_dir(), name + ".mp3")
    return p if os.path.isfile(p) else None


def stats():
    with _lock:
        _load()
        n = len(_db["entries"])
        audio = sum(1 for e in _db["entries"].values() if e.get("audio"))
        tot = _db["hits"] + _db["misses"]
        return {"entries": n, "with_audio": audio, "hits": _db["hits"], "misses": _db["misses"], "hit_rate": round(_db["hits"] / tot, 3) if tot else 0.0}
