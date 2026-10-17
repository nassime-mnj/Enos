"""Studio média : conversion d'images, vidéo -> MP3/GIF, agrandissement net, nettoyage audio, floutage de confidentialité,
transcription, sous-titres incrustés, lecture / effacement des métadonnées EXIF. 100 % local (FFmpeg, Pillow, OpenCV) ;
seules la transcription et les sous-titres envoient l'AUDIO au service Whisper configuré (comme la dictée).

Modèle : l'interface envoie les fichiers (upload -> ref), puis lance un outil sur ce ref ; l'avancement se lit avec job().
Sorties dans Studio média/Livraison/ (lien de téléchargement temporaire côté serveur).
"""
import io
import os
import re
import secrets
import shutil
import struct
import subprocess
import threading
import time

from nasko_core import app_dir, load_config, resource_path

ROOT = os.path.join(app_dir(), "Studio média")
UP = os.path.join(ROOT, ".uploads")
OUT = os.path.join(ROOT, "Livraison")
IMG_EXTS = (".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".gif", ".heic", ".heif", ".avif")
VID_EXTS = (".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v", ".wmv", ".flv", ".mpg", ".mpeg", ".ts", ".3gp")
AUD_EXTS = (".mp3", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".flac", ".wma")
MAX_UPLOAD = 4 * 1024 ** 3
MAX_PIXELS = 120_000_000
CHUNK_SECONDS = 600                       # découpe pour l'API Whisper (limite de taille des fichiers)

lock = threading.RLock()
JOB = {"busy": False, "name": "", "stage": "", "progress": 0, "error": "", "result": None, "cancel": False, "id": 0}
_proc = {"p": None}


class StudioError(Exception):
    """Message lisible, affiché tel quel dans l'interface."""


def ensure_dirs():
    for d in (UP, OUT):
        os.makedirs(d, exist_ok=True)


def safe_name(name, default="fichier"):
    n = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", os.path.basename(str(name or ""))).strip(" .")
    return n[:120] or default


def stem(path):
    """Nom sans extension ni préfixe d'ordre « 000_ » ajouté au dépôt."""
    return re.sub(r"^\d{3}_", "", os.path.splitext(safe_name(path))[0]) or "fichier"


def _unique(folder, name):
    base, ext = os.path.splitext(name)
    out, n = os.path.join(folder, name), 1
    while os.path.exists(out):
        out = os.path.join(folder, f"{base}_{n}{ext}")
        n += 1
    return out


def kind_of(path):
    e = os.path.splitext(path)[1].lower()
    return "image" if e in IMG_EXTS else "video" if e in VID_EXTS else "audio" if e in AUD_EXTS else ""


# ----------------------------------------------------------------------------- dépôts (ref)
def new_ref():
    ensure_dirs()
    purge_uploads()
    ref = secrets.token_hex(6)
    os.makedirs(os.path.join(UP, ref), exist_ok=True)
    return ref


def ref_dir(ref):
    if not re.fullmatch(r"[0-9a-f]{12}", str(ref or "")):
        raise StudioError("Dépôt inconnu : renvoyez le fichier.")
    d = os.path.join(UP, ref)
    if not os.path.isdir(d):
        raise StudioError("Dépôt expiré : renvoyez le fichier.")
    return d


def ref_files(ref):
    d = ref_dir(ref)
    return sorted(os.path.join(d, n) for n in os.listdir(d) if os.path.isfile(os.path.join(d, n)) and not n.startswith("_"))


def purge_uploads(hours=6):
    cutoff = time.time() - hours * 3600
    if not os.path.isdir(UP):
        return
    for n in os.listdir(UP):
        p = os.path.join(UP, n)
        try:
            if os.path.isdir(p) and os.path.getmtime(p) < cutoff:
                shutil.rmtree(p, ignore_errors=True)
        except OSError:
            pass


def make_preview(path, dest, maxside=1600):
    """Aperçu JPEG affichable par le navigateur (HEIC, TIFF… inclus)."""
    try:
        im = _open_image(path)
        im.thumbnail((maxside, maxside))
        im = _flatten(im)
        im.save(dest, "JPEG", quality=85)
        return True
    except StudioError:
        raise
    except Exception:                                                  # noqa: BLE001
        return False


# ----------------------------------------------------------------------------- images : ouverture commune
_heif = {"done": False, "ok": False}


def _register_heif():
    if not _heif["done"]:
        _heif["done"] = True
        try:
            import pillow_heif
            pillow_heif.register_heif_opener()
            try:
                pillow_heif.register_avif_opener()
            except Exception:                                          # noqa: BLE001
                pass
            _heif["ok"] = True
        except Exception:                                              # noqa: BLE001
            _heif["ok"] = False
    return _heif["ok"]


def _open_image(path):
    from PIL import Image, ImageOps
    ext = os.path.splitext(path)[1].lower()
    if ext in (".heic", ".heif", ".avif") and not _register_heif():
        raise StudioError("Les images HEIC / AVIF demandent le module pillow-heif (« py -m pip install pillow-heif »).")
    _register_heif()
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    try:
        im = Image.open(path)
        im.load()
    except Exception as e:                                             # noqa: BLE001
        raise StudioError(f"Image illisible ({os.path.basename(path)}) : {e}")
    try:
        im.seek(0)                                                     # GIF / WEBP animés : première image
    except Exception:                                                  # noqa: BLE001
        pass
    return ImageOps.exif_transpose(im)


def _flatten(im, bg=(255, 255, 255)):
    from PIL import Image
    if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
        im = im.convert("RGBA")
        base = Image.new("RGB", im.size, bg)
        base.paste(im, mask=im.getchannel("A"))
        return base
    return im.convert("RGB") if im.mode != "RGB" else im


def convert_image(files, opts):
    """HEIC / WEBP / AVIF / TIFF / BMP… -> JPG, PNG ou WEBP. Métadonnées retirées par défaut (vie privée)."""
    fmt = (opts.get("fmt") or "jpg").lower()
    if fmt not in ("jpg", "png", "webp"):
        raise StudioError("Format de sortie inconnu.")
    q = max(30, min(int(opts.get("quality", 92)), 100))
    keep = bool(opts.get("keep_meta"))
    outs = []
    for i, p in enumerate(files):
        _progress(f"Conversion : {os.path.basename(p)}", int(100 * i / len(files)))
        im = _open_image(p)
        exif = None
        if keep:
            ex = im.getexif()
            if ex:
                ex[0x0112] = 1                                         # la rotation est déjà appliquée aux pixels
                exif = ex
        dest = _unique(OUT, stem(p) + "." + fmt)
        if fmt == "jpg":
            kw = {"quality": q, "optimize": True, "subsampling": 0 if q >= 90 else 2}
            if exif:
                kw["exif"] = exif
            _flatten(im).save(dest, "JPEG", **kw)
        elif fmt == "png":
            im.save(dest, "PNG", optimize=True)
        else:
            kw = {"quality": q, "method": 4}
            if exif:
                kw["exif"] = exif
            im.save(dest, "WEBP", **kw)
        outs.append(dest)
    return {"kind": "files", "paths": outs}


# ----------------------------------------------------------------------------- FFmpeg
def ffmpeg_exe():
    try:
        import nasko_compress
        return nasko_compress.ffmpeg_exe()
    except Exception:                                                  # noqa: BLE001
        return shutil.which("ffmpeg")


def _need_ffmpeg():
    exe = ffmpeg_exe()
    if not exe:
        raise StudioError("FFmpeg est introuvable (il est normalement fourni avec E.N.O.S.).")
    return exe


def probe_duration(path):
    exe = _need_ffmpeg()
    r = subprocess.run([exe, "-hide_banner", "-i", path], capture_output=True, text=True, errors="replace", creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", r.stderr)
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3)) if m else 0.0


def has_audio(path):
    exe = _need_ffmpeg()
    r = subprocess.run([exe, "-hide_banner", "-i", path], capture_output=True, text=True, errors="replace", creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    return bool(re.search(r"Stream #.*Audio", r.stderr))


def _ff(args, duration=0.0, base=0, span=100, cwd=None):
    """Lance FFmpeg ; avance la progression de `base` à `base+span` d'après le temps encodé ; annulable."""
    exe = _need_ffmpeg()
    cmd = [exe, "-y", "-hide_banner", "-loglevel", "error", "-nostdin", "-progress", "pipe:1", "-nostats"] + [str(a) for a in args]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace", cwd=cwd, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    _proc["p"] = p
    tail = []
    try:
        for line in p.stdout:
            line = line.strip()
            m = re.match(r"out_time_(?:us|ms)=(\d+)", line)
            if m and duration:
                t = int(m.group(1)) / 1_000_000
                _progress(None, base + span * min(1.0, t / duration))
            elif "=" not in line or line.startswith(("Error", "[")):
                tail.append(line)
                tail = tail[-12:]
            if JOB["cancel"]:
                p.kill()
                raise StudioError("Opération annulée.")
        p.wait()
    finally:
        _proc["p"] = None
        if p.poll() is None:
            p.kill()
    if p.returncode != 0:
        msg = " ".join(tail)[-300:]
        if "does not contain any stream" in msg or "matches no streams" in msg:
            raise StudioError("Ce fichier ne contient pas de piste audio.")
        raise StudioError("FFmpeg a échoué : " + (msg or f"code {p.returncode}"))


def _t(v, default=0.0):
    """« 12 », « 1:05 », « 00:01:05.5 » -> secondes."""
    s = str(v if v not in (None, "") else default).strip().replace(",", ".")
    parts = s.split(":")
    try:
        sec = 0.0
        for x in parts:
            sec = sec * 60 + float(x)
        return max(0.0, sec)
    except ValueError:
        raise StudioError(f"Durée invalide : « {v} » (exemples : 12, 1:05).")


def video_audio(files, opts):
    fmt = (opts.get("fmt") or "mp3").lower()
    codec = {"mp3": ["-c:a", "libmp3lame", "-b:a", f"{int(opts.get('bitrate', 192))}k"], "wav": ["-c:a", "pcm_s16le"], "m4a": ["-c:a", "aac", "-b:a", f"{int(opts.get('bitrate', 192))}k"]}.get(fmt)
    if not codec:
        raise StudioError("Format audio inconnu.")
    outs = []
    for i, p in enumerate(files):
        if not has_audio(p):
            raise StudioError(f"« {os.path.basename(p)} » ne contient pas de piste audio.")
        start, dur = _t(opts.get("start")), _t(opts.get("duration"), 0)
        total = probe_duration(p)
        span = (dur or max(0, total - start)) or total
        dest = _unique(OUT, stem(p) + "." + fmt)
        args = (["-ss", start] if start else []) + ["-i", p] + (["-t", dur] if dur else []) + ["-vn", "-map", "0:a:0"] + codec + [dest]
        _ff(args, span, int(100 * i / len(files)), int(100 / len(files)))
        outs.append(dest)
    return {"kind": "files", "paths": outs}


def video_gif(files, opts):
    p = files[0]
    if kind_of(p) != "video":
        raise StudioError("Choisissez un fichier vidéo.")
    start, dur = _t(opts.get("start")), _t(opts.get("duration"), 5)
    total = probe_duration(p)
    if dur <= 0:
        raise StudioError("Indiquez la durée de l'extrait.")
    if dur > 30:
        raise StudioError("Un GIF est limité à 30 secondes (sinon le fichier devient énorme).")
    if total and start >= total:
        raise StudioError(f"Le début ({start:g} s) dépasse la durée de la vidéo ({total:g} s).")
    width = max(120, min(int(opts.get("width", 480)), 1080))
    fps = max(5, min(int(opts.get("fps", 12)), 30))
    dest = _unique(OUT, stem(p) + ".gif")
    vf = f"fps={fps},scale={width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[pal];[s1][pal]paletteuse=dither=bayer:bayer_scale=5"
    _ff((["-ss", start] if start else []) + ["-t", dur, "-i", p, "-vf", vf, "-loop", "0", "-an", dest], min(dur, max(0.1, total - start)) if total else dur)
    return {"kind": "files", "paths": [dest], "info": {"size": os.path.getsize(dest)}}


def denoise_audio(files, opts):
    """Réduction de bruit : filtre passe-haut (vent, vibrations) + débruitage spectral FFmpeg (afftdn) calé sur le bruit de fond.
    Efficace sur un bruit continu (souffle, ventilation, circulation lointaine) ; l'écho n'est qu'atténué, pas supprimé."""
    level = {"light": 12, "medium": 20, "strong": 30}.get(opts.get("level") or "medium")
    if level is None:
        raise StudioError("Niveau inconnu.")
    chain = []
    if opts.get("wind", True):
        chain.append("highpass=f=110")
    chain.append(f"afftdn=nr={level}:nf=-38:tn=1")
    chain.append("alimiter=limit=0.95")
    outs = []
    for i, p in enumerate(files):
        k = kind_of(p)
        if k not in ("audio", "video") or not has_audio(p):
            raise StudioError(f"« {os.path.basename(p)} » ne contient pas d'audio.")
        total = probe_duration(p)
        if k == "video":
            dest = _unique(OUT, stem(p) + "_nettoye" + (os.path.splitext(p)[1].lower() if os.path.splitext(p)[1].lower() in (".mp4", ".mov", ".mkv", ".m4v") else ".mp4"))
            args = ["-i", p, "-map", "0:v:0?", "-map", "0:a:0", "-c:v", "copy", "-af", ",".join(chain), "-c:a", "aac", "-b:a", "192k", dest]
        else:
            ext = ".wav" if os.path.splitext(p)[1].lower() in (".wav", ".flac") else ".mp3"
            dest = _unique(OUT, stem(p) + "_nettoye" + ext)
            args = ["-i", p, "-vn", "-af", ",".join(chain)] + (["-c:a", "pcm_s16le"] if ext == ".wav" else ["-c:a", "libmp3lame", "-b:a", "192k"]) + [dest]
        _ff(args, total, int(100 * i / len(files)), int(100 / len(files)))
        outs.append(dest)
    return {"kind": "files", "paths": outs}


# ----------------------------------------------------------------------------- agrandissement net
def upscale(files, opts):
    """Agrandit 2× / 4× : interpolation Lanczos par paliers, suppression des artefacts de compression, puis netteté adaptative.
    Ce n'est PAS un modèle génératif : les détails perdus ne sont pas inventés (résultat net et propre, pas « magique »)."""
    import numpy as np
    from PIL import Image, ImageFilter
    factor = int(opts.get("factor", 2))
    if factor not in (2, 3, 4):
        raise StudioError("Facteur d'agrandissement : 2, 3 ou 4.")
    clean = bool(opts.get("clean", True))
    sharp = max(0, min(int(opts.get("sharp", 60)), 100))
    outs = []
    for i, p in enumerate(files):
        _progress(f"Agrandissement : {os.path.basename(p)}", int(100 * i / len(files)))
        im = _open_image(p)
        w, h = im.size
        if w * h * factor * factor > MAX_PIXELS:
            raise StudioError(f"Résultat trop grand ({w * factor}×{h * factor} px) : choisissez un facteur plus petit ou une image plus petite.")
        alpha = im.getchannel("A") if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info) else None
        rgb = im.convert("RGB")
        if clean and w * h <= 4_000_000:
            try:
                import cv2
                arr = cv2.fastNlMeansDenoisingColored(np.array(rgb), None, 4, 4, 5, 15)
                rgb = Image.fromarray(arr)
            except Exception:                                          # noqa: BLE001
                pass
        cur = rgb
        step_total = {2: 1, 3: 1, 4: 2}[factor]
        for s in range(step_total):
            f = 2 if factor in (2, 4) else 3
            cur = cur.resize((cur.width * f, cur.height * f), Image.LANCZOS)
            if sharp:
                cur = cur.filter(ImageFilter.UnsharpMask(radius=1.0 + 0.4 * s, percent=int(sharp * 1.6), threshold=2))
        if alpha is not None:
            cur = cur.convert("RGBA")
            cur.putalpha(alpha.resize(cur.size, Image.LANCZOS))
        ext = ".png" if (alpha is not None or os.path.splitext(p)[1].lower() == ".png") else ".jpg"
        dest = _unique(OUT, f"{stem(p)}_x{factor}{ext}")
        if ext == ".jpg":
            cur.convert("RGB").save(dest, "JPEG", quality=95, subsampling=0, optimize=True)
        else:
            cur.save(dest, "PNG", optimize=True)
        outs.append(dest)
    return {"kind": "files", "paths": outs, "info": {"from": f"{w}×{h}", "to": f"{w * factor}×{h * factor}"}}


# ----------------------------------------------------------------------------- floutage de confidentialité
def _cascade(name):
    import cv2
    for base in (resource_path("cascades"), getattr(getattr(cv2, "data", None), "haarcascades", "") or ""):
        p = os.path.join(base, name)
        if base and os.path.isfile(p):
            c = cv2.CascadeClassifier(p)
            if not c.empty():
                return c
    return None


def _nms(boxes, thr=0.35):
    """Fusionne les rectangles qui se recouvrent (x, y, w, h)."""
    boxes = sorted(boxes, key=lambda b: -b[2] * b[3])
    keep = []
    for b in boxes:
        ok = True
        for k in keep:
            ix = max(0, min(b[0] + b[2], k[0] + k[2]) - max(b[0], k[0]))
            iy = max(0, min(b[1] + b[3], k[1] + k[3]) - max(b[1], k[1]))
            if ix * iy / float(min(b[2] * b[3], k[2] * k[3])) > thr:
                ok = False
                break
        if ok:
            keep.append(b)
    return keep


def detect_sensitive(path, targets):
    """Visages, plaques d'immatriculation et zones de texte -> rectangles en fractions de l'image. Détection approximative : l'utilisateur vérifie et ajuste."""
    try:
        import cv2
        import numpy as np
    except ImportError:
        raise StudioError("Le floutage automatique demande OpenCV (« py -m pip install \"opencv-python-headless<5\" »).")
    if not hasattr(cv2, "CascadeClassifier"):
        raise StudioError("Cette version d'OpenCV n'a plus les détecteurs de visages : installez « opencv-python-headless<5 ».")
    im = _flatten(_open_image(path))
    arr = np.array(im)
    H0, W0 = arr.shape[:2]
    k = min(1.0, 1600 / max(W0, H0))
    small = cv2.resize(arr, (int(W0 * k), int(H0 * k))) if k < 1 else arr
    gray = cv2.cvtColor(small, cv2.COLOR_RGB2GRAY)
    H, W = gray.shape
    found = []
    if "faces" in targets:
        eq = cv2.equalizeHist(gray)
        boxes = []
        for name in ("haarcascade_frontalface_alt2.xml", "haarcascade_profileface.xml"):
            c = _cascade(name)
            if c is None:
                continue
            for flip in (False, True) if "profile" in name else (False,):
                g = cv2.flip(eq, 1) if flip else eq
                for (x, y, w, h) in c.detectMultiScale(g, 1.1, 5, minSize=(max(24, int(min(W, H) * 0.04)),) * 2):
                    boxes.append((W - x - w if flip else x, y, w, h))
        if not boxes and _cascade("haarcascade_frontalface_alt2.xml") is None:
            raise StudioError("Détecteurs de visages introuvables (dossier « cascades » absent).")
        for (x, y, w, h) in _nms(boxes):
            px, py = int(w * 0.18), int(h * 0.22)
            found.append(("faces", x - px, y - py, w + 2 * px, h + 2 * py))
    if "plates" in targets:
        boxes = []
        for name in ("haarcascade_russian_plate_number.xml", "haarcascade_license_plate_rus_16stages.xml"):
            c = _cascade(name)
            if c is not None:
                for (x, y, w, h) in c.detectMultiScale(gray, 1.1, 4, minSize=(max(40, int(W * 0.05)), 12)):
                    if 2.0 <= w / h <= 6.5:
                        boxes.append((x, y, w, h))
        for (x, y, w, h) in _nms(boxes):
            found.append(("plates", x - 4, y - 4, w + 8, h + 8))
    if "text" in targets:
        grad = cv2.morphologyEx(gray, cv2.MORPH_GRADIENT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
        _, bw = cv2.threshold(grad, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
        kw = max(9, int(W * 0.012))
        con = cv2.morphologyEx(bw, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (kw, 3)))
        cnts, _ = cv2.findContours(con, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for c in cnts:
            x, y, w, h = cv2.boundingRect(c)
            fill = cv2.countNonZero(bw[y:y + h, x:x + w]) / float(w * h)
            if w >= W * 0.04 and 0.008 * H <= h <= 0.12 * H and w / h >= 1.8 and fill > 0.22:
                found.append(("text", x - 3, y - 3, w + 6, h + 6))
    out = []
    for kind, x, y, w, h in found:
        x0, y0, x1, y1 = max(0, x) / W, max(0, y) / H, min(W, x + w) / W, min(H, y + h) / H
        out.append({"kind": kind, "rect": [round(x0, 4), round(y0, 4), round(x1, 4), round(y1, 4)]})
    return out


def blur_detect(files, opts):
    targets = [t for t in ("faces", "plates", "text") if opts.get(t, t != "text")]
    if not targets:
        raise StudioError("Cochez au moins un type de zone à rechercher.")
    boxes = detect_sensitive(files[0], targets)
    return {"kind": "boxes", "boxes": boxes}


def blur_apply(files, opts):
    """Applique flou / pixellisation / aplat noir sur les zones validées ; l'image exportée ne garde aucune métadonnée."""
    import numpy as np
    from PIL import Image, ImageFilter
    boxes = opts.get("boxes") or []
    if not boxes:
        raise StudioError("Aucune zone à flouter : lancez la détection ou tracez des zones.")
    mode = opts.get("mode") or "blur"
    if mode not in ("blur", "pixel", "black"):
        raise StudioError("Mode inconnu.")
    p = files[0]
    im = _open_image(p)
    alpha = im.getchannel("A") if im.mode in ("RGBA", "LA") else None
    im = im.convert("RGB")
    W, H = im.size
    for b in boxes:
        try:
            x0, y0, x1, y1 = [float(v) for v in b["rect"]]
        except (KeyError, TypeError, ValueError):
            raise StudioError("Zone invalide.")
        box = (max(0, int(min(x0, x1) * W)), max(0, int(min(y0, y1) * H)), min(W, int(max(x0, x1) * W)), min(H, int(max(y0, y1) * H)))
        if box[2] - box[0] < 2 or box[3] - box[1] < 2:
            continue
        crop = im.crop(box)
        cw, ch = crop.size
        if mode == "black":
            crop = Image.new("RGB", crop.size, (0, 0, 0))
        elif mode == "pixel":
            n = max(6, min(cw, ch) // 8)
            crop = crop.resize((max(1, cw // n), max(1, ch // n)), Image.BILINEAR).resize((cw, ch), Image.NEAREST)
        else:
            crop = crop.filter(ImageFilter.GaussianBlur(max(6, min(cw, ch) / 5)))
            crop = crop.filter(ImageFilter.GaussianBlur(max(3, min(cw, ch) / 10)))              # flou réellement illisible, pas seulement adouci
        im.paste(crop, box[:2])
    png = os.path.splitext(p)[1].lower() == ".png" or alpha is not None
    dest = _unique(OUT, stem(p) + "_flou" + (".png" if png else ".jpg"))
    if alpha is not None:
        im = im.convert("RGBA")
        im.putalpha(alpha)
    if png:
        im.save(dest, "PNG")
    else:
        im.save(dest, "JPEG", quality=94)
    return {"kind": "files", "paths": [dest], "info": {"zones": len(boxes)}}


# ----------------------------------------------------------------------------- EXIF
def _dms(v, ref):
    try:
        d = float(v[0]) + float(v[1]) / 60 + float(v[2]) / 3600
        return -d if str(ref).upper() in ("S", "W") else d
    except Exception:                                                  # noqa: BLE001
        return None


def exif_read(files, opts):
    from PIL import ExifTags, Image
    _register_heif()
    p = files[0]
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    try:
        im = Image.open(p)
    except Exception as e:                                             # noqa: BLE001
        raise StudioError(f"Image illisible : {e}")
    ex = im.getexif()
    rows, gps = [], None
    names = {v: k for k, v in ExifTags.TAGS.items()}
    ifds = {"EXIF": ex.get_ifd(names.get("ExifOffset", 0x8769)), "GPS": ex.get_ifd(names.get("GPSInfo", 0x8825))}
    wanted = [("Make", "Marque de l'appareil"), ("Model", "Modèle de l'appareil"), ("LensModel", "Objectif"), ("Software", "Logiciel"),
              ("DateTimeOriginal", "Date de prise de vue"), ("DateTime", "Date de modification"), ("ExposureTime", "Temps de pose"), ("FNumber", "Ouverture"),
              ("ISOSpeedRatings", "ISO"), ("FocalLength", "Focale"), ("Orientation", "Orientation"), ("Artist", "Auteur"), ("Copyright", "Copyright"), ("ImageDescription", "Description")]
    merged = {}
    for k, v in ex.items():
        merged[ExifTags.TAGS.get(k, str(k))] = v
    for k, v in ifds["EXIF"].items():
        merged[ExifTags.TAGS.get(k, str(k))] = v
    for key, label in wanted:
        v = merged.get(key)
        if v not in (None, "", b""):
            if isinstance(v, bytes):
                v = v.decode("utf-8", "replace")
            rows.append({"label": label, "value": str(v).strip("\x00 ")})
    g = {ExifTags.GPSTAGS.get(k, str(k)): v for k, v in ifds["GPS"].items()}
    if g.get("GPSLatitude") and g.get("GPSLongitude"):
        lat, lon = _dms(g["GPSLatitude"], g.get("GPSLatitudeRef", "N")), _dms(g["GPSLongitude"], g.get("GPSLongitudeRef", "E"))
        if lat is not None and lon is not None:
            gps = {"lat": round(lat, 6), "lon": round(lon, 6)}
            rows.insert(0, {"label": "⚠ POSITION GPS", "value": f"{gps['lat']}, {gps['lon']}"})
    extra = []
    for k in ("xmp", "XML:com.adobe.xmp", "icc_profile", "comment", "Comment", "software"):
        if im.info.get(k):
            extra.append("XMP" if "xmp" in k.lower() or "xml" in k.lower() else "profil ICC" if k == "icc_profile" else "commentaire")
    return {"kind": "exif", "rows": rows, "gps": gps, "extra": sorted(set(extra)), "empty": not rows and not extra,
            "size": f"{im.width}×{im.height}", "format": im.format or ""}


def _strip_jpeg(data):
    """Retire EXIF/XMP/IPTC/commentaires d'un JPEG SANS recompression (aucune perte de qualité) ; le profil ICC est conservé."""
    if data[:2] != b"\xff\xd8":
        raise StudioError("JPEG invalide.")
    out, i = [b"\xff\xd8"], 2
    while i < len(data):
        if data[i] != 0xFF:
            out.append(data[i:])
            break
        marker = data[i + 1]
        if marker == 0xDA:                                             # début des données image : le reste est copié tel quel
            out.append(data[i:])
            break
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            out.append(data[i:i + 2])
            i += 2
            continue
        (ln,) = struct.unpack(">H", data[i + 2:i + 4])
        seg = data[i:i + 2 + ln]
        keep = True
        if marker == 0xE1 or marker == 0xED or marker == 0xFE:        # APP1 (EXIF / XMP), APP13 (IPTC / Photoshop), commentaires
            keep = False
        elif marker == 0xE0 and not seg[4:9] == b"JFIF\x00":          # APP0 non JFIF
            keep = False
        if keep:
            out.append(seg)
        i += 2 + ln
    return b"".join(out)


def exif_strip(files, opts):
    from PIL import Image
    outs = []
    for i, p in enumerate(files):
        _progress(f"Nettoyage : {os.path.basename(p)}", int(100 * i / len(files)))
        ext = os.path.splitext(p)[1].lower()
        dest = _unique(OUT, stem(p) + "_sans-metadonnees" + (ext if ext in (".jpg", ".jpeg", ".png", ".webp") else ".jpg"))
        if ext in (".jpg", ".jpeg"):
            from PIL import Image as _I
            ori = 1
            try:
                ori = _I.open(p).getexif().get(0x0112, 1)
            except Exception:                                          # noqa: BLE001
                pass
            if ori in (1, None):
                with open(p, "rb") as f:
                    data = f.read()
                with open(dest, "wb") as f:
                    f.write(_strip_jpeg(data))
                outs.append(dest)
                continue
        im = _open_image(p)                                            # orientation intégrée aux pixels, puis ré-enregistrement sans aucune métadonnée
        if dest.lower().endswith(".png"):
            clean = Image.new(im.mode if im.mode in ("RGB", "RGBA", "L", "LA") else "RGBA", im.size)
            clean.paste(im.convert(clean.mode))
            clean.save(dest, "PNG", optimize=True)
        elif dest.lower().endswith(".webp"):
            im.save(dest, "WEBP", quality=95)
        else:
            _flatten(im).save(dest, "JPEG", quality=95, subsampling=0)
        outs.append(dest)
    return {"kind": "files", "paths": outs}


# ----------------------------------------------------------------------------- transcription
def _asr_chunk(path, cfg, lang):
    """Un fichier audio -> [{start, end, text}] (secondes relatives au fichier). Whisper via API compatible OpenAI, ou faster-whisper local."""
    import httpx
    import nasko_stt
    if (cfg.get("stt_provider") or "api") == "local":
        try:
            from faster_whisper import WhisperModel
        except ImportError:
            raise StudioError("Moteur local absent : py -m pip install faster-whisper (ou utilisez stt_provider « api »).")
        m = WhisperModel(cfg.get("stt_local_model", "small"), device="cpu", compute_type="int8")
        segs, _ = m.transcribe(path, language=lang or None, vad_filter=True)
        return [{"start": s.start, "end": s.end, "text": s.text.strip()} for s in segs if s.text.strip()]
    try:
        base, key, model = nasko_stt._api_settings(cfg)
    except nasko_stt.STTError as e:
        raise StudioError(str(e))
    from nasko_core import ssl_context
    data = {"model": model, "response_format": "verbose_json", "temperature": "0"}
    if lang:
        data["language"] = lang
    try:
        with open(path, "rb") as f, httpx.Client(timeout=180, verify=ssl_context()) as c:
            r = c.post(f"{base}/audio/transcriptions", headers={"Authorization": f"Bearer {key}"}, data=data, files={"file": (os.path.basename(path), f, "audio/mpeg")})
    except httpx.HTTPError as e:
        raise StudioError(f"Transcription injoignable ({e.__class__.__name__}). Vérifiez la connexion internet.")
    if r.status_code != 200:
        if r.status_code in (401, 403):
            raise StudioError("Transcription : clé API refusée (stt_api_key / llm_api_key).")
        if r.status_code == 429:
            raise StudioError("Transcription : limite de débit ou quota dépassé, réessayez plus tard.")
        raise StudioError(f"Transcription : erreur {r.status_code}.")
    j = r.json()
    segs = [{"start": float(s.get("start", 0)), "end": float(s.get("end", 0)), "text": str(s.get("text", "")).strip()} for s in (j.get("segments") or []) if str(s.get("text", "")).strip()]
    if not segs and j.get("text"):
        segs = [{"start": 0.0, "end": 0.0, "text": str(j["text"]).strip()}]
    return segs


def transcribe_segments(path, lang, base=0, span=70):
    """Fichier audio / vidéo -> segments horodatés (découpé en morceaux de 10 min pour respecter les limites de l'API)."""
    _need_ffmpeg()
    if not has_audio(path):
        raise StudioError("Ce fichier ne contient pas de piste audio.")
    cfg = load_config()
    work = os.path.join(UP, "_t" + secrets.token_hex(4))
    os.makedirs(work, exist_ok=True)
    try:
        total = probe_duration(path)
        _progress("Extraction de l'audio…", base)
        _ff(["-i", path, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "48k", "-f", "segment", "-segment_time", CHUNK_SECONDS, "-reset_timestamps", "1", os.path.join(work, "c%04d.mp3")], total, base, span * 0.25)
        chunks = sorted(f for f in os.listdir(work) if f.endswith(".mp3"))
        if not chunks:
            raise StudioError("Aucun son exploitable dans ce fichier.")
        segs = []
        for i, c in enumerate(chunks):
            _progress(f"Transcription : partie {i + 1} / {len(chunks)}…", base + span * (0.25 + 0.75 * i / len(chunks)))
            for s in _asr_chunk(os.path.join(work, c), cfg, lang):
                segs.append({"start": s["start"] + i * CHUNK_SECONDS, "end": s["end"] + i * CHUNK_SECONDS, "text": s["text"]})
        return segs
    finally:
        shutil.rmtree(work, ignore_errors=True)


def paragraphs(segs, gap=1.3, max_chars=650):
    """Segments -> paragraphes : nouvelle ligne après une pause, ou quand le paragraphe est long et que la phrase se termine."""
    out, cur, start, last_end = [], "", 0.0, None
    for s in segs:
        t = s["text"].strip()
        if not t:
            continue
        new = cur and (s["start"] - (last_end if last_end is not None else s["start"]) >= gap or (len(cur) >= max_chars and cur.rstrip()[-1:] in ".!?…"))
        if new:
            out.append((start, cur.strip()))
            cur = ""
        if not cur:
            start = s["start"]
        cur += (" " if cur else "") + t
        last_end = s["end"]
    if cur.strip():
        out.append((start, cur.strip()))
    return out


def _stamp(sec):
    sec = int(sec)
    return f"{sec // 3600:d}:{sec % 3600 // 60:02d}:{sec % 60:02d}" if sec >= 3600 else f"{sec // 60:d}:{sec % 60:02d}"


def transcribe(files, opts):
    lang = (opts.get("lang") or "fr").strip()
    segs = transcribe_segments(files[0], lang)
    if not segs:
        raise StudioError("Aucune parole détectée.")
    paras = paragraphs(segs)
    stamps = bool(opts.get("timestamps"))
    text = "\n\n".join((f"[{_stamp(s)}] " if stamps else "") + t for s, t in paras)
    ensure_dirs()
    base = stem(files[0])
    txt = _unique(OUT, base + "_transcription.txt")
    with open(txt, "w", encoding="utf-8") as f:
        f.write(text + "\n")
    srt = _unique(OUT, base + ".srt")
    with open(srt, "w", encoding="utf-8") as f:
        f.write(srt_text(make_cues(segs)))
    return {"kind": "text", "text": text, "paths": [txt, srt], "info": {"paragraphs": len(paras), "words": len(text.split())}}


# ----------------------------------------------------------------------------- sous-titres
def make_cues(segs, max_chars=42, max_lines=2):
    """Segments -> sous-titres courts (≤ 2 lignes de 42 caractères), le temps étant réparti selon la longueur du texte."""
    cues = []
    cap = max_chars * max_lines - 4                                   # marge : les deux lignes doivent tenir chacune dans max_chars
    for s in segs:
        words = s["text"].split()
        if not words:
            continue
        chunks, cur = [], ""
        for w in words:
            if cur and len(cur) + 1 + len(w) > cap:
                chunks.append(cur)
                cur = w
            else:
                cur = (cur + " " + w) if cur else w
        if cur:
            chunks.append(cur)
        total = sum(len(c) for c in chunks) or 1
        dur = max(0.4, s["end"] - s["start"]) if s["end"] > s["start"] else max(1.5, len(s["text"]) / 15)
        t = s["start"]
        for c in chunks:
            d = dur * len(c) / total
            cues.append({"start": t, "end": t + d, "text": _wrap(c, max_chars)})
            t += d
    for a, b in zip(cues, cues[1:]):                                   # jamais de chevauchement
        if a["end"] > b["start"]:
            a["end"] = b["start"]
    return cues


def _wrap(text, width):
    """Coupe en deux lignes équilibrées, chacune ≤ width si possible."""
    if len(text) <= width:
        return text
    best, mid = None, len(text) / 2
    for i, ch in enumerate(text):
        if ch == " ":
            ok = i <= width and len(text) - i - 1 <= width
            if best is None or (ok, -abs(i - mid)) > (best[0], -abs(best[1] - mid)):
                best = (ok, i)
    return text[:best[1]] + "\n" + text[best[1] + 1:] if best else text


def _srt_t(sec):
    ms = int(round(sec * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def srt_text(cues):
    return "\n".join(f"{i}\n{_srt_t(c['start'])} --> {_srt_t(c['end'])}\n{c['text']}\n" for i, c in enumerate(cues, 1))


COLORS = {"white": "&H00FFFFFF", "yellow": "&H0000FFFF", "cyan": "&H00FFFF00"}


def subtitles(files, opts):
    """Transcrit la vidéo puis incruste les sous-titres (texte contourné, lisible sur tout fond) ; exporte aussi le .srt."""
    p = files[0]
    if kind_of(p) != "video":
        raise StudioError("Choisissez un fichier vidéo.")
    lang = (opts.get("lang") or "fr").strip()
    total = probe_duration(p)
    segs = transcribe_segments(p, lang, 0, 55)
    if not segs:
        raise StudioError("Aucune parole détectée dans cette vidéo.")
    cues = make_cues(segs)
    base = stem(p)
    srt_out = _unique(OUT, base + ".srt")
    with open(srt_out, "w", encoding="utf-8") as f:
        f.write(srt_text(cues))
    dest = _unique(OUT, base + "_soustitres.mp4")
    if opts.get("burn", True):
        size = {"s": 16, "m": 22, "l": 30}.get(opts.get("size") or "m", 22)
        align = {"bottom": 2, "center": 10, "top": 6}.get(opts.get("pos") or "bottom", 2)
        color = COLORS.get(opts.get("color") or "white", COLORS["white"])
        style = f"FontName=Arial,FontSize={size},Bold=1,PrimaryColour={color},OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,Alignment={align},MarginV=24"
        work = os.path.join(UP, "_s" + secrets.token_hex(4))
        os.makedirs(work, exist_ok=True)
        try:
            shutil.copy(srt_out, os.path.join(work, "subs.srt"))            # chemin relatif : évite l'échappement des « C:\ » dans le filtre FFmpeg
            _progress("Incrustation des sous-titres…", 56)
            _ff(["-i", os.path.abspath(p), "-vf", f"subtitles=subs.srt:force_style='{style}'", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "copy" if os.path.splitext(p)[1].lower() == ".mp4" else "aac", "-movflags", "+faststart", os.path.abspath(dest)], total, 56, 44, cwd=work)
        finally:
            shutil.rmtree(work, ignore_errors=True)
        return {"kind": "files", "paths": [dest, srt_out], "info": {"cues": len(cues)}}
    return {"kind": "files", "paths": [srt_out], "info": {"cues": len(cues)}}


# ----------------------------------------------------------------------------- capacités / tâches
def capabilities():
    caps = {"ffmpeg": bool(ffmpeg_exe()), "heic": False, "opencv": False, "stt": False}
    try:
        import pillow_heif  # noqa: F401
        caps["heic"] = True
    except Exception:                                                  # noqa: BLE001
        pass
    try:
        import cv2  # noqa: F401
        caps["opencv"] = os.path.isfile(os.path.join(resource_path("cascades"), "haarcascade_frontalface_alt2.xml"))
    except Exception:                                                  # noqa: BLE001
        pass
    cfg = load_config()
    caps["stt"] = (cfg.get("stt_provider") or "api") == "local" or bool((cfg.get("stt_api_key") or "").strip() or ((cfg.get("llm_provider") == "openai") and (cfg.get("llm_api_key") or "").strip()))
    return caps


TOOLS = {"convert_image": convert_image, "video_audio": video_audio, "video_gif": video_gif, "upscale": upscale, "denoise": denoise_audio, "blur_detect": blur_detect,
         "blur_apply": blur_apply, "exif_read": exif_read, "exif_strip": exif_strip, "transcribe": transcribe, "subtitles": subtitles}
ACCEPT = {"convert_image": ("image",), "video_audio": ("video", "audio"), "video_gif": ("video",), "upscale": ("image",), "denoise": ("audio", "video"), "blur_detect": ("image",),
          "blur_apply": ("image",), "exif_read": ("image",), "exif_strip": ("image",), "transcribe": ("audio", "video"), "subtitles": ("video",)}


def _progress(label, pct):
    with lock:
        if label:
            JOB["stage"] = label
        JOB["progress"] = max(0, min(100, int(pct)))
    if JOB["cancel"]:
        raise StudioError("Opération annulée.")


def job():
    with lock:
        return {k: JOB[k] for k in ("busy", "name", "stage", "progress", "error", "result", "id")}


def cancel():
    JOB["cancel"] = True
    p = _proc.get("p")
    if p and p.poll() is None:
        try:
            p.kill()
        except OSError:
            pass


def start(tool, ref, opts):
    fn = TOOLS.get(tool)
    if not fn:
        raise StudioError("Outil inconnu.")
    files = ref_files(ref)
    if not files:
        raise StudioError("Aucun fichier : choisissez d'abord un fichier.")
    ok = ACCEPT[tool]
    bad = [os.path.basename(f) for f in files if kind_of(f) not in ok]
    if bad:
        raise StudioError(f"Type de fichier non adapté à cet outil : {bad[0]} (attendu : " + " / ".join({"image": "image", "video": "vidéo", "audio": "audio"}[k] for k in ok) + ").")
    ensure_dirs()
    with lock:
        if JOB["busy"]:
            raise StudioError("Une opération est déjà en cours : patientez ou annulez-la.")
        JOB.update(busy=True, name=tool, stage="Démarrage…", progress=0, error="", result=None, cancel=False, id=JOB["id"] + 1)

    def run():
        try:
            res = fn(files, opts or {})
            with lock:
                JOB["result"] = res
                JOB["progress"] = 100
        except StudioError as e:
            JOB["error"] = str(e)
        except Exception as e:                                         # noqa: BLE001  jamais d'erreur muette
            JOB["error"] = f"Échec inattendu : {e}"
        finally:
            with lock:
                JOB["busy"] = False
    threading.Thread(target=run, daemon=True, name="studio-job").start()
