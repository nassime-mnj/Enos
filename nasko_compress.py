"""Compresseur média local : images (Pillow) et vidéos (FFmpeg, libx264). Sorties dans Compression/Livraison/ (suffixe _compressé).

Image  : mode % -> quality=X + optimize=True ; mode cible (Mo) -> recherche binaire de la qualité (BytesIO),
         puis réduction proportionnelle de la résolution si même la qualité plancher dépasse la cible.
Vidéo  : mode % -> libx264 -crf (100 % = CRF 18, 10 % = CRF 35) -preset slow ;
         mode cible (Mo) -> encodage DOUBLE PASSE, vidéo_kbps = Cible_Mo*8192/durée - audio_kbps.
"""
import io
import math
import os
import re
import shutil
import subprocess
import threading
import time

from nasko_core import app_dir, load_config

ROOT = os.path.join(app_dir(), "Compression")
TODO = os.path.join(ROOT, "A faire")
OUT = os.path.join(ROOT, "Livraison")
SCRATCH = os.path.join(ROOT, ".tmp")
IMG_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff")
VID_EXTS = (".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v", ".wmv", ".flv", ".mpg", ".mpeg", ".ts")
SUFFIX = "_compressé"
MIN_JPEG_Q = 65          # qualité plancher avant de réduire la résolution (JPEG / WEBP)
MIN_PNG_COLORS = 32      # palette plancher (PNG) avant de réduire la résolution
MIN_SIDE = 16            # on ne réduit jamais en dessous de 16 px
MIN_VIDEO_KBPS = 60      # en dessous, la cible est jugée impossible

lock = threading.Lock()
UPLOADS = os.path.join(ROOT, ".uploads")      # fichiers envoyés par un téléphone, supprimés dès la fin du traitement
STATE = {"busy": False, "kind": "", "name": "", "stage": "", "progress": 0, "error": "", "result": None, "cancel": False, "job": 0, "upload": False}
_proc = {"p": None}


class CompressError(Exception):
    pass


def ensure_dirs():
    for d in (TODO, OUT):
        os.makedirs(d, exist_ok=True)


def _unique(folder, name):
    base, ext = os.path.splitext(name)
    out, n = os.path.join(folder, name), 1
    while os.path.exists(out):
        out = os.path.join(folder, f"{base}_{n}{ext}")
        n += 1
    return out


def _progress(label, pct):
    with lock:
        STATE["stage"], STATE["progress"] = label, max(0, min(100, pct))
    if STATE["cancel"]:
        raise CompressError("Compression annulée.")


# ----------------------------------------------------------------------------- FFmpeg
def ffmpeg_exe():
    """nasko_config `ffmpeg_path`, sinon ffmpeg.exe a cote de E.N.O.S., sinon PATH, sinon le binaire embarque par imageio-ffmpeg."""
    cands = [(load_config().get("ffmpeg_path") or "").strip(), os.path.join(app_dir(), "ffmpeg.exe")]
    for c in cands:
        if c and os.path.isfile(c):
            return c
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def _run_quiet(args):
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    return subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace", creationflags=flags)


def probe_video(path):
    """Durée, résolution, fps, audio (présence + débit) lus dans la sortie de `ffmpeg -i` (pas de ffprobe disponible)."""
    exe = ffmpeg_exe()
    if not exe:
        raise CompressError("FFmpeg introuvable (installez-le ou renseignez `ffmpeg_path` dans nasko_config.json).")
    text = _run_quiet([exe, "-hide_banner", "-i", path]).stderr
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", text)
    if not m:
        raise CompressError("Vidéo illisible (durée introuvable).")
    dur = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    if dur <= 0:
        raise CompressError("Durée de la vidéo nulle.")
    v = re.search(r"Video:.*?(\d{2,5})x(\d{2,5})", text)
    fps = re.search(r"([\d.]+)\s*fps", text)
    a = re.search(r"Stream #[^\n]*Audio:[^\n]*", text)
    abr = re.search(r"(\d+)\s*kb/s", a.group(0)) if a else None
    return {"duration": dur, "width": int(v.group(1)) if v else 0, "height": int(v.group(2)) if v else 0,
            "fps": float(fps.group(1)) if fps else 0, "has_audio": bool(a), "audio_kbps": int(abr.group(1)) if abr else 0}


def crf_for_percent(pct):
    """100 % -> CRF 18 ; 10 % -> CRF 35 (linéaire, prolongée en dessous de 10 %), borné à 51."""
    return int(max(18, min(51, round(18 + (100 - pct) * 17 / 90))))


def video_bitrate_kbps(target_mo, duration_s, audio_kbps):
    """Formule : (Cible_Mo * 8192) / Durée_en_secondes - Audio_bitrate  (en kbit/s)."""
    return (target_mo * 8192) / duration_s - audio_kbps


def _ffmpeg_run(args, duration, base, span, label):
    """Lance FFmpeg avec -progress ; la progression [base, base+span] suit out_time / durée. Annulable."""
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    err_path = os.path.join(SCRATCH, "ffmpeg_err.txt")
    with open(err_path, "w", encoding="utf-8", errors="replace") as ef:
        p = subprocess.Popen(args + ["-progress", "pipe:1", "-nostats"], stdout=subprocess.PIPE, stderr=ef, text=True,
                             encoding="utf-8", errors="replace", creationflags=flags)
        _proc["p"] = p
        try:
            for line in p.stdout:
                if STATE["cancel"]:
                    p.kill()
                    break
                if line.startswith(("out_time_us=", "out_time_ms=")):
                    try:
                        t = int(line.split("=")[1]) / 1_000_000
                        _progress(label, base + span * min(1.0, t / duration))
                    except ValueError:
                        pass
                    except CompressError:                        # annulation demandée entre deux relevés : on stoppe FFmpeg
                        p.kill()
                        break
            p.wait()
        finally:
            _proc["p"] = None
    if STATE["cancel"]:
        raise CompressError("Compression annulée.")
    if p.returncode != 0:
        tail = open(err_path, encoding="utf-8", errors="replace").read()[-400:].strip().splitlines()
        raise CompressError("FFmpeg a échoué : " + (tail[-1] if tail else f"code {p.returncode}"))


def compress_video(src, mode, value, out_path):
    exe = ffmpeg_exe()
    info = probe_video(src)
    dur = info["duration"]
    os.makedirs(SCRATCH, exist_ok=True)
    note = ""
    if mode == "percent":
        crf = crf_for_percent(value)
        abr = 192 if value >= 90 else 128
        args = [exe, "-y", "-i", src, "-c:v", "libx264", "-preset", "slow", "-crf", str(crf), "-pix_fmt", "yuv420p"]
        args += ["-c:a", "aac", "-b:a", f"{abr}k"] if info["has_audio"] else ["-an"]
        args += ["-movflags", "+faststart", out_path]
        _ffmpeg_run(args, dur, 3, 95, f"Encodage x264 (CRF {crf}, preset slow)…")
        detail = f"libx264 · CRF {crf} · preset slow"
    else:
        target_bytes = value * 1024 * 1024
        if os.path.getsize(src) <= target_bytes:
            shutil.copyfile(src, out_path)
            return {"detail": "copie sans perte", "note": "La vidéo originale est déjà sous la cible : copiée telle quelle."}
        abr = min(128, info["audio_kbps"] or 128) if info["has_audio"] else 0
        vk = video_bitrate_kbps(value, dur, abr)
        if info["has_audio"] and vk < MIN_VIDEO_KBPS:                 # cible très serrée : on sacrifie d'abord l'audio
            abr = 48
            vk = video_bitrate_kbps(value, dur, abr)
        if vk < MIN_VIDEO_KBPS:
            raise CompressError(f"Cible trop basse pour {dur:.0f} s de vidéo : minimum ≈ {(MIN_VIDEO_KBPS + abr) * dur / 8192:.2f} Mo.")
        passlog = os.path.join(SCRATCH, "ffpass")
        for attempt in range(3):                                      # 2 passes ; jusqu'à 2 reprises si le fichier dépasse la cible
            k = max(MIN_VIDEO_KBPS, int(vk))
            common = ["-c:v", "libx264", "-preset", "slow", "-b:v", f"{k}k", "-pix_fmt", "yuv420p", "-passlogfile", passlog]
            _ffmpeg_run([exe, "-y", "-i", src, *common, "-pass", "1", "-an", "-f", "null", "NUL"], dur, 3, 45, f"Passe 1 / 2 — analyse ({k} kb/s)…")
            a = ["-c:a", "aac", "-b:a", f"{abr}k"] if info["has_audio"] else ["-an"]
            _ffmpeg_run([exe, "-y", "-i", src, *common, "-pass", "2", *a, "-movflags", "+faststart", out_path], dur, 50, 48, f"Passe 2 / 2 — encodage ({k} kb/s)…")
            size = os.path.getsize(out_path)
            if size <= target_bytes:
                break
            if attempt == 2:
                raise CompressError(f"Impossible de passer sous {value:g} Mo (obtenu {size / 1048576:.2f} Mo).")
            vk = k * (target_bytes / size) * 0.97                      # le fichier dépasse : on resserre le débit et on recommence
            note = "Débit resserré après une première passe trop lourde."
        detail = f"libx264 · double passe · {k} kb/s vidéo + {abr} kb/s audio"
    return {"detail": detail, "note": note}


# ----------------------------------------------------------------------------- Images
def _flatten(im, fmt):
    from PIL import Image
    if fmt == "JPEG" and im.mode not in ("RGB", "L"):
        bg = Image.new("RGB", im.size, (255, 255, 255))
        if im.mode in ("RGBA", "LA", "P"):
            im = im.convert("RGBA"); bg.paste(im, mask=im.getchannel("A"))
        else:
            bg.paste(im.convert("RGB"))
        return bg
    return im


def _encode(im, fmt, q):
    """Encode `im` en mémoire. q = qualité (JPEG/WEBP) ou nombre de couleurs (PNG ; 0 = sans perte)."""
    from PIL import Image
    buf = io.BytesIO()
    if fmt == "JPEG":
        _flatten(im, "JPEG").save(buf, "JPEG", quality=int(q), optimize=True)
    elif fmt == "WEBP":
        im.save(buf, "WEBP", quality=int(q), method=6)
    else:
        if q and q < 256:
            has_a = im.mode in ("RGBA", "LA") or "transparency" in im.info
            src = im.convert("RGBA" if has_a else "RGB")
            im = src.quantize(colors=int(q), method=Image.Quantize.FASTOCTREE if has_a else Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        im.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def _out_format(path, im):
    ext = os.path.splitext(path)[1].lower()
    if ext in (".jpg", ".jpeg"):
        return "JPEG", ".jpg"
    if ext == ".webp":
        return "WEBP", ".webp"
    if ext == ".png":
        return "PNG", ".png"
    alpha = im.mode in ("RGBA", "LA") or "transparency" in im.info
    return ("PNG", ".png") if alpha else ("JPEG", ".jpg")


def compress_image(src, mode, value, out_dir):
    from PIL import Image, ImageOps
    with Image.open(src) as im0:
        im = ImageOps.exif_transpose(im0)
        im.load()
    fmt, ext = _out_format(src, im)
    stem = os.path.splitext(os.path.basename(src))[0]
    out = _unique(out_dir, stem + SUFFIX + ext)
    orig = os.path.getsize(src)
    W, H = im.size
    note, detail = "", ""
    if mode == "percent":
        _progress("Compression de l'image…", 40)
        q = int(max(1, min(100, value)))
        if fmt == "PNG":
            colors = 0 if q >= 100 else max(4, round(256 * q / 100))       # PNG sans perte : « qualité » = taille de la palette
            data = _encode(im, "PNG", colors)
            detail = "PNG optimisé sans perte" if not colors else f"PNG · palette {colors} couleurs · optimize"
        else:
            data = _encode(im, fmt, q)
            detail = f"{fmt} · quality={q} · optimize=True"
        if len(data) >= orig:
            note = "Le fichier obtenu n'est pas plus léger que l'original (déjà bien optimisé)."
    else:
        target = int(value * 1024 * 1024)
        if orig <= target:
            shutil.copyfile(src, out)
            return {"out": out, "detail": "copie sans perte", "note": "L'image originale est déjà sous la cible : copiée telle quelle.", "size": os.path.getsize(out), "dims": f"{W}×{H}"}
        data, scale, steps = None, 1.0, 0
        while True:
            cur = im if scale >= 1.0 else im.resize((max(MIN_SIDE, round(W * scale)), max(MIN_SIDE, round(H * scale))), Image.LANCZOS)
            # recherche binaire du meilleur réglage (qualité la plus haute) qui passe sous la cible
            if fmt == "PNG":
                lossless = _encode(cur, "PNG", 0)
                if len(lossless) <= target:
                    data, q = lossless, 0; break
                lo, hi, best, floor_size = MIN_PNG_COLORS, 256, None, None
            else:
                lo, hi, best, floor_size = MIN_JPEG_Q, 100, None, None
            while lo <= hi:
                mid = (lo + hi) // 2
                d = _encode(cur, fmt, mid); steps += 1
                _progress(f"Recherche du meilleur réglage ({steps} essais)…", min(90, 8 + steps * 5))
                if len(d) <= target:
                    best, q, lo = d, mid, mid + 1                         # tient : on cherche plus haut
                else:
                    hi = mid - 1
            if best is not None:
                data = best; break
            # même la qualité plancher est trop lourde : réduction proportionnelle de la résolution
            floor_size = len(_encode(cur, fmt, MIN_PNG_COLORS if fmt == "PNG" else MIN_JPEG_Q))
            scale *= min(0.95, max(0.5, math.sqrt(target / floor_size) * 0.97))
            if min(W, H) * scale < MIN_SIDE:
                raise CompressError(f"Impossible d'atteindre {value:g} Mo même en réduisant fortement l'image.")
        detail = (f"{fmt} · " + ("sans perte" if fmt == "PNG" and not q else f"palette {q}" if fmt == "PNG" else f"quality={q}")
                  + f" · {steps} essais binaires")
        if scale < 1.0:
            detail += f" · redimensionnée à {round(scale * 100)} % ({round(W * scale)}×{round(H * scale)})"
            im = cur
    _progress("Écriture du fichier…", 96)
    with open(out, "wb") as f:
        f.write(data)
    return {"out": out, "detail": detail, "note": note, "size": len(data), "dims": f"{im.size[0]}×{im.size[1]}"}


# ----------------------------------------------------------------------------- orchestration (tâche d'arrière-plan)
def kind_of(path):
    ext = os.path.splitext(path)[1].lower()
    return "image" if ext in IMG_EXTS else "video" if ext in VID_EXTS else ""


def parse_target(text):
    t = str(text).strip().lower().replace(",", ".").replace("mo", "").replace("mb", "").strip()
    try:
        v = float(t)
    except ValueError:
        raise CompressError("Cible invalide : entrez un nombre de Mo (ex. 8 ou 8,5).")
    if not (0.05 <= v <= 20000):
        raise CompressError("Cible hors limites (0,05 à 20000 Mo).")
    return v


def info(path):
    path = os.path.abspath((path or "").strip().strip('"'))
    if not os.path.isfile(path):
        raise CompressError("Fichier introuvable.")
    kind = kind_of(path)
    if not kind:
        raise CompressError("Format non pris en charge.")
    res = {"path": path, "name": os.path.basename(path), "kind": kind, "size": os.path.getsize(path)}
    if kind == "image":
        from PIL import Image
        with Image.open(path) as im:
            res.update(width=im.size[0], height=im.size[1], format=im.format)
    else:
        res.update(probe_video(path))
    return res


def list_todo():
    ensure_dirs()
    out = []
    for n in sorted(os.listdir(TODO), key=str.lower):
        p = os.path.join(TODO, n)
        if os.path.isfile(p) and kind_of(p):
            out.append({"name": n, "path": p, "kind": kind_of(p), "size": os.path.getsize(p)})
    return out


def _notify(ok, name, detail=""):
    try:
        import nasko_notify
        nasko_notify.task_done("compress", name, ok, detail)
    except Exception:                                                # noqa: BLE001 — jamais bloquant
        pass


def _job(src, kind, mode, value, uploaded=False, shown_name=None):
    name = os.path.basename(src)
    with lock:
        STATE.update(busy=True, kind=kind, name=name, stage="Préparation…", progress=1, error="", result=None, cancel=False)
    t0 = time.time()
    try:
        ensure_dirs()
        if kind == "video":
            out = _unique(OUT, os.path.splitext(name)[0] + SUFFIX + ".mp4")
            r = compress_video(src, mode, value, out)
            r.update(out=out, size=os.path.getsize(out))
        else:
            r = compress_image(src, mode, value, OUT)
        r.update(name=os.path.basename(r["out"]), before=os.path.getsize(src), seconds=round(time.time() - t0, 1), kind=kind, mode=mode, value=value)
        if uploaded:                                                 # envoi depuis un téléphone : lien de téléchargement immédiat du résultat
            import nasko_sync
            sh = nasko_sync.make_share(r["out"], kind="compress", ttl_min=60)
            r["download"] = nasko_sync.share_path(sh)
        _progress("Terminé", 100)
        with lock:
            STATE["result"] = r
        _notify(True, r.get("name") or name)
        time.sleep(0.8)
    except Exception as e:
        with lock:
            STATE["error"] = str(e) or e.__class__.__name__
        if not STATE["cancel"]:
            _notify(False, name, STATE["error"])
        try:
            if "out" in locals() and os.path.exists(out) and STATE["error"]:
                os.remove(out)                                       # pas de fichier partiel dans Livraison
        except OSError:
            pass
    finally:
        shutil.rmtree(SCRATCH, ignore_errors=True)
        if uploaded:
            shutil.rmtree(os.path.dirname(src), ignore_errors=True)       # l'original reçu n'est pas conservé sur le PC
        with lock:
            STATE["busy"] = False


def start(path, mode, value, uploaded=False, shown_name=None):
    path = os.path.abspath((path or "").strip().strip('"'))
    if not os.path.isfile(path):
        raise CompressError("Fichier introuvable.")
    kind = kind_of(path)
    if not kind:
        raise CompressError("Format non pris en charge.")
    if mode == "percent":
        value = float(value)
        if not (1 <= value <= 100):
            raise CompressError("Le pourcentage doit être compris entre 1 et 100.")
    elif mode == "target":
        value = parse_target(value)
    else:
        raise CompressError("Mode inconnu.")
    if kind == "video" and not ffmpeg_exe():
        raise CompressError("FFmpeg introuvable (installez-le ou renseignez `ffmpeg_path` dans nasko_config.json).")
    with lock:
        if STATE["busy"]:
            raise RuntimeError("Une compression est déjà en cours.")
        STATE.update(busy=True, error="", result=None, cancel=False, stage="Préparation…", progress=1, name=shown_name or os.path.basename(path), kind=kind, upload=uploaded)
    threading.Thread(target=_job, args=(path, kind, mode, value, uploaded, shown_name), daemon=True, name="compress").start()


def cancel():
    with lock:
        STATE["cancel"] = True
    p = _proc["p"]
    if p:
        try:
            p.kill()
        except OSError:
            pass


def state():
    with lock:
        return dict(STATE)


def open_folder():
    ensure_dirs()
    os.startfile(OUT)
