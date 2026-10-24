"""Projets de montage CinePulse : la timeline (EDL / JSON) enregistrée côté serveur dans une base SQLite, donc disponible depuis n'importe quel appareil.

Chaque projet a un nom, une révision (`rev`, +1 à chaque enregistrement) et sa date. La révision sert au verrouillage optimiste : deux appareils qui
modifient le même projet ne s'écrasent pas en silence (`Conflict`, HTTP 409). Le contenu est validé et nettoyé : seules les propriétés connues d'un clip
sont conservées, les nombres doivent être finis, les tailles sont plafonnées.
"""
import json
import math
import os
import re
import sqlite3
import threading
import time
import uuid

MAX_CLIPS = 1500
MAX_TRACKS = 64
MAX_BYTES = 8 << 20
MAX_NAME = 80
DEFAULT_NAME = "Projet sans titre"
CLIP_KEYS = ("id", "asset", "kind", "name", "track", "start", "dur", "in", "opacity", "volume", "scale", "x", "y", "fadeIn", "fadeOut")
PROPS = ("opacity", "volume", "scale", "x", "y")
SCHEMA = """CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, data TEXT NOT NULL, rev INTEGER NOT NULL DEFAULT 1, clips INTEGER NOT NULL DEFAULT 0,
  duration REAL NOT NULL DEFAULT 0, created REAL NOT NULL, updated REAL NOT NULL);
CREATE INDEX IF NOT EXISTS projects_updated ON projects(updated DESC);"""


class ProjectError(ValueError):
    """Projet ou nom invalide (message destiné à l'utilisateur)."""


class Conflict(Exception):
    """Le projet a été enregistré depuis un autre appareil depuis le chargement."""

    def __init__(self, current):
        super().__init__("Le projet a été modifié depuis un autre appareil")
        self.current = current


def _num(v, what, lo=-1e9, hi=1e9):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise ProjectError(f"{what} invalide : un nombre est attendu")
    return min(hi, max(lo, float(v)))


def _text(v, what, limit=200):
    if not isinstance(v, str) or not v or len(v) > limit or re.search(r"[\x00-\x1f]", v):
        raise ProjectError(f"{what} invalide")
    return v


def clean_name(name):
    if name is None:
        return DEFAULT_NAME
    if not isinstance(name, str):
        raise ProjectError("Nom invalide")
    name = re.sub(r"[\x00-\x1f]", " ", name).strip()
    if not name:
        return DEFAULT_NAME
    return name[:MAX_NAME]


def clean_project(p):
    """Valide / nettoie l'EDL du projet. Retourne (projet nettoyé, nombre de clips, durée)."""
    if not isinstance(p, dict) or p.get("version") != 1:
        raise ProjectError("Projet invalide (version 1 attendue)")
    tracks, clips = p.get("tracks"), p.get("clips")
    if not isinstance(tracks, list) or not tracks or len(tracks) > MAX_TRACKS or not isinstance(clips, list) or len(clips) > MAX_CLIPS:
        raise ProjectError("Projet invalide (pistes ou clips)")
    out_tracks, ids = [], set()
    for t in tracks:
        if not isinstance(t, dict) or t.get("type") not in ("video", "audio"):
            raise ProjectError("Piste invalide")
        tid = _text(t.get("id"), "Identifiant de piste", 20)
        if tid in ids:
            raise ProjectError("Pistes en double")
        ids.add(tid)
        out_tracks.append({"id": tid, "type": t["type"]})
    out_clips, end = [], 0.0
    for c in clips:
        if not isinstance(c, dict):
            raise ProjectError("Clip invalide")
        o = {}
        for k in CLIP_KEYS:
            if k not in c:
                continue
            if k == "name":
                o[k] = str(c[k])[:200] if isinstance(c[k], str) else "clip"
                continue
            o[k] = _text(c[k], k) if k in ("id", "asset", "kind", "track") else _num(c[k], k, 0 if k in ("start", "dur", "in", "fadeIn", "fadeOut") else -1e6)
        for need in ("id", "asset", "kind", "track", "start", "dur"):
            if need not in o:
                raise ProjectError(f"Clip sans « {need} »")
        if o["track"] not in ids or o["kind"] not in ("video", "audio", "image"):
            raise ProjectError("Clip sur une piste inconnue ou de type inconnu")
        kf = c.get("kf")
        if isinstance(kf, dict):
            o["kf"] = {}
            for prop, pts in kf.items():
                if prop not in PROPS or not isinstance(pts, list) or len(pts) > 200:
                    raise ProjectError("Images-clés invalides")
                o["kf"][prop] = [{"t": _num(q.get("t") if isinstance(q, dict) else None, "temps d'image-clé", 0), "v": _num(q.get("v"), "valeur d'image-clé")} for q in pts]
        tr = c.get("trIn")
        if isinstance(tr, dict) and tr.get("type") == "crossfade":
            o["trIn"] = {"type": "crossfade", "dur": _num(tr.get("dur"), "durée de transition", 0, 30)}
        end = max(end, o["start"] + o["dur"])
        out_clips.append(o)
    clean = {"version": 1, "fps": _num(p.get("fps", 30), "fps", 10, 60), "tracks": out_tracks, "clips": out_clips}
    if len(json.dumps(clean)) > MAX_BYTES:
        raise ProjectError("Projet trop volumineux")
    return clean, len(out_clips), end


class ProjectStore:
    def __init__(self, root):
        os.makedirs(root, exist_ok=True)
        self.db = sqlite3.connect(os.path.join(root, "projects.db"), check_same_thread=False, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        with self.lock:
            self.db.execute("PRAGMA journal_mode=WAL")
            self.db.executescript(SCHEMA)

    @staticmethod
    def _meta(r):
        return {"id": r["id"], "name": r["name"], "rev": r["rev"], "clips": r["clips"], "duration": r["duration"], "created": r["created"], "updated": r["updated"]}

    def _row(self, pid):
        if not isinstance(pid, str) or not re.fullmatch(r"[0-9a-f]{12}", pid):
            return None
        with self.lock:
            return self.db.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()

    def list(self):
        with self.lock:
            rows = self.db.execute("SELECT id,name,rev,clips,duration,created,updated FROM projects ORDER BY updated DESC").fetchall()
        return [self._meta(r) for r in rows]

    def get(self, pid):
        r = self._row(pid)
        return {**self._meta(r), "project": json.loads(r["data"])} if r else None

    def create(self, name, project, pid=None):
        """`pid` (facultatif, choisi par le client) rend la création rejouable : un renvoi après une coupure réseau retourne le projet déjà créé au lieu d'un doublon."""
        clean, n, dur = clean_project(project)
        if pid is not None and (not isinstance(pid, str) or not re.fullmatch(r"[0-9a-f]{12}", pid)):
            raise ProjectError("Identifiant de projet invalide")
        with self.lock:                                                 # test + insertion indivisibles : deux envois simultanés du même identifiant ne se disputent pas
            if pid is not None and self._row(pid):
                return self._meta(self._row(pid))
            pid, now = pid or uuid.uuid4().hex[:12], time.time()
            self.db.execute("INSERT INTO projects(id,name,data,rev,clips,duration,created,updated) VALUES(?,?,?,?,?,?,?,?)", (pid, clean_name(name), json.dumps(clean), 1, n, dur, now, now))
            return self._meta(self._row(pid))

    def save(self, pid, name=None, project=None, rev=None):
        """Enregistre un projet existant. `rev` = révision connue du client : si elle n'est plus la courante -> Conflict. None = écrase (choix explicite)."""
        with self.lock:
            r = self._row(pid)
            if not r:
                return None
            if rev is not None and rev != r["rev"]:
                raise Conflict(self._meta(r))
            data, n, dur = r["data"], r["clips"], r["duration"]
            if project is not None:
                clean, n, dur = clean_project(project)
                data = json.dumps(clean)
            self.db.execute("UPDATE projects SET name=?, data=?, rev=rev+1, clips=?, duration=?, updated=? WHERE id=?",
                            (clean_name(name) if name is not None else r["name"], data, n, dur, time.time(), pid))
            return self._meta(self._row(pid))

    def delete(self, pid):
        with self.lock:
            if not self._row(pid):
                return False
            self.db.execute("DELETE FROM projects WHERE id=?", (pid,))
            return True

    def close(self):
        with self.lock:
            self.db.close()
