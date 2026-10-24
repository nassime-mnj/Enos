"""Serveur local de CinePulse : API d'import/analyse + service du frontend.

Bibliothèque standard uniquement. Lancer :  py backend/server.py [--port 8790] [--open]
"""
import argparse
import json
import mimetypes
import os
import re
import tempfile
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

from asset_store import AssetStore
from cinepulse_engine import EdlError, RenderBusy, RenderManager
from project_store import Conflict, ProjectError, ProjectStore
from ffmpeg_wrapper import FFmpeg

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND = os.path.join(ROOT, "frontend")
CHUNK = 1 << 20
PEAKS_MAX = 20000
MAX_EDL_BYTES = 8 << 20

MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml",
        ".wav": "audio/wav", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".flac": "audio/flac",
        ".m4a": "audio/mp4", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
        ".mkv": "video/x-matroska"}


def mime_of(path):
    ext = os.path.splitext(path)[1].lower()
    return MIME.get(ext) or mimetypes.guess_type(path)[0] or "application/octet-stream"


FF = FFmpeg()
STORE = AssetStore(os.environ.get("CINEPULSE_ASSETS") or os.path.join(ROOT, "cinepulse_assets"), FF)      # bibliothèque persistante (voir asset_store.py)


def _resolve_asset(asset_id):
    """Média de la bibliothèque pour le moteur de rendu (l'EDL ne désigne jamais un chemin, seulement un identifiant)."""
    a = STORE.get(asset_id) if isinstance(asset_id, str) else None
    p = STORE.path(asset_id, "original") if a else None
    return {"path": p, "kind": a["kind"], "duration": a["duration"], "has_audio": a["has_audio"]} if a and p else None


PROJECTS = ProjectStore(os.environ.get("CINEPULSE_PROJECTS") or os.path.join(ROOT, "cinepulse_projects"))      # projets de montage enregistrés côté serveur (voir project_store.py)
RENDER = RenderManager(FF.ffmpeg, _resolve_asset, os.environ.get("CINEPULSE_EXPORTS") or os.path.join(ROOT, "cinepulse_exports"))      # exports MP4 (voir cinepulse_engine.py)


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

    def _file(self, path, cache=False, download=None):
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
        if download:
            self.send_header("Content-Disposition", f'attachment; filename="{download}"')
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
                               "library": STORE.stats()})
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
        m = re.fullmatch(r"/api/render/(\w+)", path)
        if m:
            j = RENDER.get(m.group(1))
            return self._json(j) if j else self._error(404, "Export inconnu")
        m = re.fullmatch(r"/api/render/(\w+)/file", path)
        if m:
            p = RENDER.file(m.group(1))
            return self._file(p, download="cinepulse-export.mp4") if p else self._error(404, "Export introuvable ou non terminé")
        m = re.fullmatch(r"/api/projects/(\w+)", path)
        if path == "/api/projects":
            return self._json({"projects": PROJECTS.list()})
        if m:
            pr = PROJECTS.get(m.group(1))
            return self._json(pr) if pr else self._error(404, "Projet inconnu")
        self._static(path)

    def _static(self, path):
        rel = "nle.html" if path in ("", "/") else path.lstrip("/")
        full = os.path.realpath(os.path.join(FRONTEND, rel))
        if not full.startswith(os.path.realpath(FRONTEND) + os.sep) or not os.path.isfile(full):
            return self._error(404, "Introuvable")
        self._file(full)

    def do_POST(self):
        url = urlparse(self.path)
        if url.path == "/api/projects":
            return self._project_write(None)
        if url.path == "/api/library/import":
            return self._library_import(parse_qs(url.query))
        if url.path == "/api/library/import_path":
            return self._library_import_path()
        if url.path == "/api/render":
            return self._render_start()
        m = re.fullmatch(r"/api/render/(\w+)/cancel", url.path)
        if m:
            self.rfile.read(int(self.headers.get("Content-Length") or 0))
            j = RENDER.cancel(m.group(1))
            return self._json(j) if j else self._error(404, "Export inconnu")
        m = re.fullmatch(r"/api/library/(\w+)/use", url.path)
        if m:
            return self._json({"ok": True}) if STORE.use(m.group(1)) else self._error(404, "Média inconnu")
        self._error(404, "Route inconnue")

    def _render_start(self):
        """Corps JSON {edl: {...}} : lance l'export en arrière-plan (202) ; la progression se lit sur GET /api/render/<id>."""
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_EDL_BYTES:
            return self._error(413, "EDL trop volumineuse")
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
            edl = body["edl"]
        except (ValueError, KeyError, TypeError):
            return self._error(400, "Corps JSON attendu : {\"edl\": ...}")
        try:
            self._json(RENDER.start(edl), 202)
        except EdlError as e:
            self._error(400, str(e))
        except RenderBusy as e:
            self._error(409, str(e))

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

    def _project_write(self, pid):
        """POST /api/projects (création) ou PUT /api/projects/<id> (enregistrement). Corps JSON {name?, project, rev?}."""
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_EDL_BYTES:
            return self._error(413, "Projet trop volumineux")
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(body, dict) or (body.get("rev") is not None and (isinstance(body["rev"], bool) or not isinstance(body["rev"], int))):
                raise ValueError
        except ValueError:
            return self._error(400, "Corps JSON attendu : {\"name\": texte, \"project\": ..., \"rev\": entier}")
        try:
            if pid is None:
                if "project" not in body:
                    return self._error(400, "Champ « project » manquant")
                return self._json(PROJECTS.create(body.get("name"), body["project"], body.get("id")), 201)
            meta = PROJECTS.save(pid, body.get("name"), body.get("project"), body.get("rev"))
            return self._json(meta) if meta else self._error(404, "Projet inconnu")
        except ProjectError as e:
            self._error(400, str(e))
        except Conflict as e:
            self._json({"error": str(e), "current": e.current}, 409)

    def do_PUT(self):
        m = re.fullmatch(r"/api/projects/(\w+)", urlparse(self.path).path)
        if not m:
            return self._error(404, "Route inconnue")
        self._project_write(m.group(1))

    def do_DELETE(self):
        m = re.fullmatch(r"/api/library/(\w+)", urlparse(self.path).path)
        if m:
            return self._json({"ok": True}) if STORE.delete(m.group(1)) else self._error(404, "Média inconnu")
        m = re.fullmatch(r"/api/projects/(\w+)", urlparse(self.path).path)
        if m:
            return self._json({"ok": True}) if PROJECTS.delete(m.group(1)) else self._error(404, "Projet inconnu")
        self._error(404, "Média inconnu")


def main():
    ap = argparse.ArgumentParser(description="CinePulse")
    ap.add_argument("--port", type=int, default=8790)
    ap.add_argument("--open", action="store_true", help="ouvre le navigateur")
    args = ap.parse_args()
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    url = f"http://127.0.0.1:{args.port}/"
    print(f"CinePulse : {url}  (FFmpeg : {'ok' if FF.available else 'absent, mode dégradé'})")
    if args.open:
        webbrowser.open(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        STORE.close()
        PROJECTS.close()


if __name__ == "__main__":
    main()
