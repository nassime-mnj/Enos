"""Bibliothèque d'assets persistante de CinePulse (dossier cinepulse_assets/, index SQLite library.db).

    cinepulse_assets/
        library.db            index (une ligne par média, WAL)
        originals/<id><ext>   copie du média importé, jamais modifiée
        proxies/<id>.mp4|.png|.jpg   vidéo 540p à images-clés rapprochées / image ≤ 960 px : lecture fluide sur mobile
        thumbs/<id>.jpg       vignette 320 px (vidéo : image à 10 % ; image : réduite ; audio : aucune)
        peaks/<id>.json       enveloppe audio normalisée (pour dessiner l'onde sur la timeline)

Import : copie + empreinte SHA-256 (un média déjà présent n'est pas dupliqué), lecture des métadonnées, puis traitement
(vignette, proxy, onde) par UN thread d'arrière-plan : l'import répond tout de suite, `state` passe de « processing » à « ready ».
Au redémarrage, les médias restés « processing » sont retraités. Sans FFmpeg l'import fonctionne en mode dégradé (état « ready », sans proxy).
"""
import hashlib
import json
import os
import queue
import re
import shutil
import sqlite3
import threading
import time
import uuid

from ffmpeg_wrapper import FFmpegError, kind_from_extension

KINDS = ("video", "image", "audio")
PEAKS = 2000
SCHEMA = """
CREATE TABLE IF NOT EXISTS assets(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, ext TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL UNIQUE,
  duration REAL, fps REAL, width INTEGER, height INTEGER, has_audio INTEGER NOT NULL DEFAULT 0, sample_rate INTEGER, channels INTEGER, codec TEXT,
  state TEXT NOT NULL DEFAULT 'processing', error TEXT NOT NULL DEFAULT '', proxy TEXT NOT NULL DEFAULT '', thumb INTEGER NOT NULL DEFAULT 0,
  tags TEXT NOT NULL DEFAULT '', added REAL NOT NULL, uses INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS assets_kind ON assets(kind);
"""


def safe_name(name):
    name = os.path.basename((name or "").replace("\\", "/")) or "media"
    return re.sub(r'[<>:"|?*\x00-\x1f]', "_", name)[:180]


def _sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


class AssetStore:
    def __init__(self, root, ffmpeg, start_worker=True):
        self.root, self.ff = os.path.abspath(root), ffmpeg
        self.dirs = {k: os.path.join(self.root, k) for k in ("originals", "proxies", "thumbs", "peaks")}
        for d in self.dirs.values():
            os.makedirs(d, exist_ok=True)
        self.db = sqlite3.connect(os.path.join(self.root, "library.db"), check_same_thread=False, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript(SCHEMA)
        self.lock = threading.RLock()
        self.jobs = queue.Queue()
        self._busy = 0
        self._idle = threading.Condition()
        for r in self.db.execute("SELECT id FROM assets WHERE state='processing'").fetchall():      # reprise après un arrêt brutal
            self._enqueue(r["id"])
        if start_worker:
            threading.Thread(target=self._worker, daemon=True, name="cinepulse-assets").start()

    # ------------------------------------------------------------------ chemins
    def path(self, asset_id, variant="original"):
        """Chemin du fichier demandé (original | proxy | thumb | peaks) ou None. Les identifiants viennent de la base : pas de traversée possible."""
        row = self._row(asset_id)
        if not row:
            return None
        if variant == "original":
            p = os.path.join(self.dirs["originals"], row["id"] + row["ext"])
        elif variant == "proxy":
            p = os.path.join(self.dirs["proxies"], row["proxy"]) if row["proxy"] else os.path.join(self.dirs["originals"], row["id"] + row["ext"])
        elif variant == "thumb":
            p = os.path.join(self.dirs["thumbs"], row["id"] + ".jpg") if row["thumb"] else ""
        elif variant == "peaks":
            p = os.path.join(self.dirs["peaks"], row["id"] + ".json")
        else:
            return None
        return p if p and os.path.isfile(p) else None

    # ------------------------------------------------------------------ lecture
    def _row(self, asset_id):
        if not re.fullmatch(r"[0-9a-f]{10}", asset_id or ""):
            return None
        return self.db.execute("SELECT * FROM assets WHERE id=?", (asset_id,)).fetchone()

    def _dict(self, r):
        d = {"id": r["id"], "name": r["name"], "kind": r["kind"], "size": r["size"], "duration": r["duration"], "fps": r["fps"], "width": r["width"], "height": r["height"],
             "has_audio": bool(r["has_audio"]), "sample_rate": r["sample_rate"], "channels": r["channels"], "codec": r["codec"], "state": r["state"], "error": r["error"],
             "tags": [t for t in r["tags"].split(",") if t], "added": r["added"], "uses": r["uses"],
             "url": f"/media/lib/{r['id']}?v=proxy", "original_url": f"/media/lib/{r['id']}?v=original", "thumb_url": f"/thumb/{r['id']}" if r["thumb"] else "",
             "proxy": bool(r["proxy"])}
        return d

    def get(self, asset_id):
        r = self._row(asset_id)
        return self._dict(r) if r else None

    def list(self, kind=None, q=None, sort="recent"):
        sql, args = "SELECT * FROM assets WHERE 1=1", []
        if kind in KINDS:
            sql += " AND kind=?"
            args.append(kind)
        for word in (q or "").lower().split()[:6]:
            sql += " AND (lower(name) LIKE ? ESCAPE '\\' OR lower(tags) LIKE ? ESCAPE '\\')"
            like = "%" + word.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            args += [like, like]
        sql += " ORDER BY " + ("uses DESC, added DESC" if sort == "used" else "name COLLATE NOCASE" if sort == "name" else "added DESC")
        return [self._dict(r) for r in self.db.execute(sql, args).fetchall()]

    def stats(self):
        r = self.db.execute("SELECT COUNT(*) n, COALESCE(SUM(size),0) b, SUM(state='processing') p FROM assets").fetchone()
        return {"count": r["n"], "bytes": r["b"], "processing": r["p"] or 0}

    # ------------------------------------------------------------------ import
    def import_file(self, src, name, move=False):
        """Copie `src` dans la bibliothèque. Retourne (asset, duplicate). Lève ValueError si le fichier n'est pas un média exploitable."""
        name = safe_name(name)
        ext = os.path.splitext(name)[1].lower()
        if not re.fullmatch(r"\.[a-z0-9]{1,8}", ext):
            raise ValueError("Format non pris en charge")
        digest = _sha256(src)
        with self.lock:
            dup = self.db.execute("SELECT * FROM assets WHERE sha256=?", (digest,)).fetchone()
            if dup:
                if move:
                    os.remove(src)
                return self._dict(dup), True
            asset_id = uuid.uuid4().hex[:10]
            dst = os.path.join(self.dirs["originals"], asset_id + ext)
            (shutil.move if move else shutil.copyfile)(src, dst)
            try:
                info = self.ff.probe(dst)
            except (FFmpegError, ValueError) as e:
                os.remove(dst)
                raise ValueError(f"Fichier illisible : {e}")
            kind = info.get("kind") or kind_from_extension(dst)
            if kind not in KINDS:
                os.remove(dst)
                raise ValueError("Format non pris en charge (vidéo, image ou audio attendu)")
            state = "processing" if self.ff.available else "ready"
            self.db.execute("INSERT INTO assets(id,name,kind,ext,size,sha256,duration,fps,width,height,has_audio,sample_rate,channels,codec,state,added) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                            (asset_id, name, kind, ext, os.path.getsize(dst), digest, info.get("duration") if kind != "image" else None, info.get("fps"), info.get("width"), info.get("height"),
                             int(bool(info.get("has_audio"))), info.get("sample_rate"), info.get("channels"), info.get("codec"), state, time.time()))
        if state == "processing":
            self._enqueue(asset_id)
        return self.get(asset_id), False

    # ------------------------------------------------------------------ édition de l'index
    def rename(self, asset_id, name=None, tags=None):
        if not self._row(asset_id):
            return False
        with self.lock:
            if name is not None:
                self.db.execute("UPDATE assets SET name=? WHERE id=?", (safe_name(name), asset_id))
            if tags is not None:
                clean = sorted({re.sub(r"[^\w\- ]", "", str(t), flags=re.U).strip().lower()[:24] for t in tags} - {""})[:12]
                self.db.execute("UPDATE assets SET tags=? WHERE id=?", (",".join(clean), asset_id))
        return True

    def use(self, asset_id):
        with self.lock:
            return self.db.execute("UPDATE assets SET uses=uses+1 WHERE id=?", (asset_id,)).rowcount > 0 if self._row(asset_id) else False

    def delete(self, asset_id):
        row = self._row(asset_id)
        if not row:
            return False
        with self.lock:
            self.db.execute("DELETE FROM assets WHERE id=?", (asset_id,))
        for folder, pattern in (("originals", row["id"] + row["ext"]), ("proxies", row["proxy"]), ("thumbs", row["id"] + ".jpg"), ("peaks", row["id"] + ".json")):
            if pattern:
                try:
                    os.remove(os.path.join(self.dirs[folder], pattern))
                except OSError:
                    pass
        return True

    def peaks(self, asset_id, buckets=PEAKS):
        """Enveloppe normalisée rééchantillonnée sur `buckets` valeurs (None si pas encore calculée)."""
        p = self.path(asset_id, "peaks")
        if not p:
            return None
        with open(p, encoding="utf-8") as f:
            raw = json.load(f)
        if not raw or buckets >= len(raw):
            return raw
        step = len(raw) / buckets
        return [round(max(raw[int(i * step):max(int(i * step) + 1, int((i + 1) * step))]), 4) for i in range(buckets)]

    # ------------------------------------------------------------------ traitement d'arrière-plan
    def _enqueue(self, asset_id):
        with self._idle:
            self._busy += 1
        self.jobs.put(asset_id)

    def wait_idle(self, timeout=60):
        """Attend la fin des traitements en cours (tests, arrêt propre)."""
        end = time.time() + timeout
        with self._idle:
            while self._busy and time.time() < end:
                self._idle.wait(0.2)
        return not self._busy

    def close(self, timeout=60):
        """Arrêt propre : laisse finir les traitements puis ferme la base."""
        self.wait_idle(timeout)
        self.db.close()

    def _worker(self):
        while True:
            asset_id = self.jobs.get()
            try:
                self._process(asset_id)
            except Exception as e:                                                                       # noqa: BLE001 — un média défectueux ne doit jamais tuer le thread
                try:
                    self.db.execute("UPDATE assets SET state='failed', error=? WHERE id=?", (str(e)[:200], asset_id))
                except sqlite3.Error:                                                                    # base fermée pendant l'arrêt : le média sera retraité au prochain démarrage
                    pass
            finally:
                with self._idle:
                    self._busy -= 1
                    self._idle.notify_all()

    def _process(self, asset_id):
        row = self._row(asset_id)
        if not row:
            return
        src = os.path.join(self.dirs["originals"], row["id"] + row["ext"])
        thumb, proxy, errors = 0, "", []
        thumb_path = os.path.join(self.dirs["thumbs"], row["id"] + ".jpg")
        ff = self.ff
        try:
            if row["kind"] == "video":
                at = max(0.0, (row["duration"] or 0) * 0.1)
                ff._run([ff.ffmpeg, "-y", "-v", "error", "-ss", f"{at:.2f}", "-i", src, "-frames:v", "1", "-vf", "scale='min(320,iw)':-2", "-q:v", "4", thumb_path], timeout=120)
                thumb = 1
                out = os.path.join(self.dirs["proxies"], row["id"] + ".mp4")
                ff.make_video_proxy(src, out, row["has_audio"])
                proxy = row["id"] + ".mp4"
            elif row["kind"] == "image":
                ff._run([ff.ffmpeg, "-y", "-v", "error", "-i", src, "-frames:v", "1", "-vf", "scale='min(320,iw)':-2", "-q:v", "4", thumb_path], timeout=120)
                thumb = 1
                keep_alpha = row["ext"] in (".png", ".webp", ".gif")                                      # logos : la transparence doit survivre au proxy
                out = os.path.join(self.dirs["proxies"], row["id"] + (".png" if keep_alpha else ".jpg"))
                ff._run([ff.ffmpeg, "-y", "-v", "error", "-i", src, "-frames:v", "1", "-vf", "scale='min(960,iw)':-2"] + ([] if keep_alpha else ["-q:v", "3"]) + [out], timeout=120)
                proxy = os.path.basename(out)
        except FFmpegError as e:
            errors.append(str(e))
        if row["kind"] == "audio" or (row["kind"] == "video" and row["has_audio"]):
            try:
                peaks = ff.waveform_peaks(src, PEAKS)
                with open(os.path.join(self.dirs["peaks"], row["id"] + ".json"), "w", encoding="utf-8") as f:
                    json.dump([round(p, 4) for p in peaks], f)
            except FFmpegError as e:
                errors.append(str(e))
        failed = bool(errors) and not (thumb or proxy) and row["kind"] != "audio"
        with self.lock:
            self.db.execute("UPDATE assets SET state=?, error=?, proxy=?, thumb=? WHERE id=?", ("failed" if failed else "ready", errors[0][:200] if errors else "", proxy, thumb, asset_id))
