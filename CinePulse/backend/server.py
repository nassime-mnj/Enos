"""Serveur local de CinePulse : API d'import/analyse + service du frontend.

Bibliothèque standard uniquement. Lancer :  py backend/server.py [--port 8790] [--open]
"""
import argparse
import json
import mimetypes
import os
import re
import shutil
import tempfile
import threading
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

from asset_store import AssetStore
from ffmpeg_wrapper import FFmpeg, FFmpegError, kind_from_extension

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND = os.path.join(ROOT, "frontend")
CHUNK = 1 << 20
PEAKS_MAX = 20000

MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml",
        ".wav": "audio/wav", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".flac": "audio/flac",
        ".m4a": "audio/mp4", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
        ".mkv": "video/x-matroska"}


def mime_of(path):
    ext = os.path.splitext(path)[1].lower()
    return MIME.get(ext) or mimetypes.guess_type(path)[0] or "application/octet-stream"


class Project:
    """Projet temporaire : un dossier de médias importés + leur métadonnées en mémoire."""

    def __init__(self):
        self.dir = tempfile.mkdtemp(prefix="cinepulse_")
        self.assets = {}
        self.peaks = {}
        self.lock = threading.Lock()

    def add(self, src, name, ffmpeg, move=False):
        asset_id = uuid.uuid4().hex[:10]
        ext = os.path.splitext(name)[1].lower()
        dst = os.path.join(self.dir, asset_id + ext)
        (shutil.move if move else shutil.copyfile)(src, dst)
        try:
            info = ffmpeg.probe(dst)
        except (FFmpegError, ValueError) as e:
            os.remove(dst)
            raise ValueError(f"Fichier illisible : {e}")
        if info["kind"] not in ("audio", "video"):
            os.remove(dst)
            raise ValueError("Format non pris en charge (audio ou vidéo attendu)")
        asset = {"id": asset_id, "name": name, "kind": info["kind"], "url": f"/media/{asset_id}",
                 "size": os.path.getsize(dst), **{k: info[k] for k in
                 ("duration", "fps", "width", "height", "has_audio", "sample_rate", "channels", "codec")}}
        with self.lock:
            self.assets[asset_id] = {"meta": asset, "path": dst}
        return asset

    def remove(self, asset_id):
        with self.lock:
            entry = self.assets.pop(asset_id, None)
            self.peaks = {k: v for k, v in self.peaks.items() if k[0] != asset_id}
        if entry:
            try:
                os.remove(entry["path"])
            except OSError:
                pass
        return entry is not None

    def cleanup(self):
        shutil.rmtree(self.dir, ignore_errors=True)


PROJECT = Project()
FF = FFmpeg()
STORE = AssetStore(os.environ.get("CINEPULSE_ASSETS") or os.path.join(ROOT, "cinepulse_assets"), FF)      # bibliothèque persistante (voir asset_store.py)


def safe_name(name):
    name = os.path.basename(name.replace("\\", "/")) or "media"
    return re.sub(r'[<>:"|?*\x00-\x1f]', "_", name)[:180]


class Handler(BaseHTTPRequestHandler):
    server_version = "CinePulse/0.1"

    def log_message(self, fmt, *args):
        pass

    # ------------------------------------------------------------ helpers
    def _json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status, msg):
        self._json({"error": msg}, status)

    def _file(self, path, cache=False):
        size = os.path.getsize(path)
        start, end, status = 0, size - 1, 200
        rng = self.headers.get("Range")
        m = re.match(r"bytes=(\d*)-(\d*)$", rng or "")
        if m:
            a, b = m.groups()
            if a == "" and b:
                start = max(0, size - int(b))
            else:
                start = int(a or 0)
                end = min(int(b), size - 1) if b else end
            if start > end or start >= size:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return
            status = 206
        self.send_response(status)
        self.send_header("Content-Type", mime_of(path))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Cache-Control", "max-age=3600" if cache else "no-cache")
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        try:
            with open(path, "rb") as f:
                f.seek(start)
                left = end - start + 1
                while left > 0:
                    chunk = f.read(min(CHUNK, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
        except (ConnectionError, OSError):
            pass

    # ------------------------------------------------------------ routes
    def do_GET(self):
        url = urlparse(self.path)
        path, qs = unquote(url.path), parse_qs(url.query)
        if path == "/api/status":
            return self._json({"ffmpeg": FF.available, "ffmpeg_version": FF.version(),
                               "project_dir": PROJECT.dir, "library": STORE.stats()})
        if path == "/api/library":
            q = lambda k, d="": qs.get(k, [d])[0]                                                # noqa: E731
            return self._json({"assets": STORE.list(q("kind") or None, q("q"), q("sort", "recent")), "stats": STORE.stats()})
        m = re.fullmatch(r"/api/library/(\w+)/waveform", path)
        if m:
            peaks = STORE.peaks(m.group(1), max(50, min(int(qs.get("buckets", ["1000"])[0]), PEAKS_MAX)))
            return self._json({"peaks": peaks}) if peaks is not None else self._error(404, "Onde indisponible (média inconnu, sans audio ou en cours de traitement)")
        m = re.fullmatch(r"/media/lib/(\w+)", path)
        if m:
            p = STORE.path(m.group(1), "original" if qs.get("v", ["proxy"])[0] == "original" else "proxy")
            return self._file(p, cache=True) if p else self._error(404, "Média inconnu")
        m = re.fullmatch(r"/thumb/(\w+)", path)
        if m:
            p = STORE.path(m.group(1), "thumb")
            return self._file(p, cache=True) if p else self._error(404, "Pas de vignette")
        if path == "/api/assets":
            return self._json([e["meta"] for e in PROJECT.assets.values()])
        m = re.fullmatch(r"/api/waveform/(\w+)", path)
        if m:
            return self._waveform(m.group(1), int(qs.get("buckets", ["2000"])[0]))
        m = re.fullmatch(r"/media/(\w+)", path)
        if m:
            entry = PROJECT.assets.get(m.group(1))
            return self._file(entry["path"], cache=True) if entry else self._error(404, "Média inconnu")
        self._static(path)

    def _static(self, path):
        rel = "index.html" if path in ("", "/") else path.lstrip("/")
        full = os.path.realpath(os.path.join(FRONTEND, rel))
        if not full.startswith(os.path.realpath(FRONTEND) + os.sep) or not os.path.isfile(full):
            return self._error(404, "Introuvable")
        self._file(full)

    def _waveform(self, asset_id, buckets):
        entry = PROJECT.assets.get(asset_id)
        if not entry:
            return self._error(404, "Média inconnu")
        if not FF.ffmpeg:
            return self._error(501, "ffmpeg_missing")
        buckets = max(100, min(buckets, 60000))
        key = (asset_id, buckets)
        if key not in PROJECT.peaks:
            try:
                PROJECT.peaks[key] = FF.waveform_peaks(entry["path"], buckets)
            except FFmpegError:
                PROJECT.peaks[key] = []
        self._json({"peaks": PROJECT.peaks[key]})

    def do_POST(self):
        url = urlparse(self.path)
        if url.path == "/api/import":
            return self._import_upload(parse_qs(url.query))
        if url.path == "/api/import_path":
            return self._import_path()
        if url.path == "/api/library/import":
            return self._library_import(parse_qs(url.query))
        if url.path == "/api/library/import_path":
            return self._library_import_path()
        m = re.fullmatch(r"/api/library/(\w+)/use", url.path)
        if m:
            return self._json({"ok": True}) if STORE.use(m.group(1)) else self._error(404, "Média inconnu")
        self._error(404, "Route inconnue")

    def _library_import(self, qs):
        """Corps brut = contenu du fichier ; nom d'origine dans ?name=. Répond tout de suite : vignette / proxy / onde sont calculés en arrière-plan (champ `state`)."""
        name = safe_name(qs.get("name", ["media"])[0])
        length = int(self.headers.get("Content-Length") or 0)
        fd, tmp = tempfile.mkstemp(dir=STORE.root, suffix=".part")
        try:
            with os.fdopen(fd, "wb") as f:
                left = length
                while left > 0:
                    chunk = self.rfile.read(min(CHUNK, left))
                    if not chunk:
                        break
                    f.write(chunk)
                    left -= len(chunk)
            asset, dup = STORE.import_file(tmp, name, move=True)
            self._json({**asset, "duplicate": dup}, 200 if dup else 201)
        except ValueError as e:
            self._error(415, str(e))
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)

    def _library_import_path(self):
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            src = os.path.abspath(body["path"])
        except (ValueError, KeyError):
            return self._error(400, "Corps JSON attendu : {\"path\": ...}")
        if not os.path.isfile(src):
            return self._error(404, "Fichier introuvable")
        try:
            asset, dup = STORE.import_file(src, os.path.basename(src))
            self._json({**asset, "duplicate": dup}, 200 if dup else 201)
        except ValueError as e:
            self._error(415, str(e))

    def do_PATCH(self):
        m = re.fullmatch(r"/api/library/(\w+)", urlparse(self.path).path)
        if not m:
            return self._error(404, "Route inconnue")
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            name, tags = body.get("name"), body.get("tags")
            if (name is not None and not isinstance(name, str)) or (tags is not None and not isinstance(tags, list)):
                raise ValueError
        except (ValueError, AttributeError):
            return self._error(400, "Corps JSON attendu : {\"name\": texte, \"tags\": liste}")
        if not STORE.rename(m.group(1), name, tags):
            return self._error(404, "Média inconnu")
        self._json(STORE.get(m.group(1)))

    def _import_upload(self, qs):
        """Corps brut = contenu du fichier ; nom d'origine dans ?name=."""
        name = safe_name(qs.get("name", ["media"])[0])
        if not kind_from_extension(name) and not FF.available:
            return self._error(415, "Format non pris en charge")
        length = int(self.headers.get("Content-Length") or 0)
        fd, tmp = tempfile.mkstemp(dir=PROJECT.dir, suffix=".part")
        try:
            with os.fdopen(fd, "wb") as f:
                left = length
                while left > 0:
                    chunk = self.rfile.read(min(CHUNK, left))
                    if not chunk:
                        break
                    f.write(chunk)
                    left -= len(chunk)
            self._json(PROJECT.add(tmp, name, FF, move=True), 201)
        except ValueError as e:
            self._error(415, str(e))
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)

    def _import_path(self):
        """Import d'un fichier local par son chemin (le serveur n'écoute que sur 127.0.0.1)."""
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            src = os.path.abspath(body["path"])
        except (ValueError, KeyError):
            return self._error(400, "Corps JSON attendu : {\"path\": ...}")
        if not os.path.isfile(src):
            return self._error(404, "Fichier introuvable")
        try:
            self._json(PROJECT.add(src, os.path.basename(src), FF), 201)
        except ValueError as e:
            self._error(415, str(e))

    def do_DELETE(self):
        m = re.fullmatch(r"/api/library/(\w+)", urlparse(self.path).path)
        if m:
            return self._json({"ok": True}) if STORE.delete(m.group(1)) else self._error(404, "Média inconnu")
        m = re.fullmatch(r"/api/assets/(\w+)", urlparse(self.path).path)
        if m and PROJECT.remove(m.group(1)):
            return self._json({"ok": True})
        self._error(404, "Média inconnu")


def main():
    ap = argparse.ArgumentParser(description="CinePulse")
    ap.add_argument("--port", type=int, default=8790)
    ap.add_argument("--open", action="store_true", help="ouvre le navigateur")
    args = ap.parse_args()
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    url = f"http://127.0.0.1:{args.port}/"
    print(f"CinePulse : {url}  (FFmpeg : {'ok' if FF.available else 'absent, mode dégradé'})")
    print(f"Dossier projet temporaire : {PROJECT.dir}")
    if args.open:
        webbrowser.open(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        PROJECT.cleanup()


if __name__ == "__main__":
    main()
