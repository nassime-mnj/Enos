"""Laboratoire audio : extraction vidéo -> WAV (FFmpeg), détection des SFX par silences (pydub), export au sample près.

Dossiers (a cote de E.N.O.S.) :  Audio/A faire (dépôt) · Audio/Travail (WAV convertis = playlist) · Audio/Livraison/<source>/sfx_NN.wav
"""
import os
import re
import shutil
import subprocess
import threading
import time
import wave
import zipfile
from concurrent.futures import ThreadPoolExecutor

import nasko_compress
from nasko_core import app_dir

ROOT = os.path.join(app_dir(), "Audio")
TODO = os.path.join(ROOT, "A faire")
WORK = os.path.join(ROOT, "Travail")
OUT = os.path.join(ROOT, "Livraison")
AUDIO_EXTS = (".wav", ".mp3", ".flac", ".ogg", ".oga", ".opus", ".m4a", ".aac", ".wma", ".aiff", ".aif")
VIDEO_EXTS = (".mp4", ".mkv", ".mov", ".avi", ".webm", ".m4v", ".wmv", ".flv", ".mpg", ".mpeg", ".ts")
DEFAULTS = {"offset_db": 16, "min_silence_ms": 200, "keep_ms": 40, "min_sfx_ms": 40}
MIN_REGION_S = 0.005
FORMATS = ("wav", "mp3")
BITRATES = (128, 192, 256, 320)
OUT_EXTS = (".wav", ".mp3")

lock = threading.Lock()
STATE = {"busy": False, "stage": "", "progress": 0, "error": "", "result": None, "cancel": False, "name": ""}
_proc = {"p": None}


class AudioError(Exception):
    pass


def ensure_dirs():
    for d in (TODO, WORK, OUT):
        os.makedirs(d, exist_ok=True)


def kind_of(path):
    ext = os.path.splitext(path)[1].lower()
    return "audio" if ext in AUDIO_EXTS else "video" if ext in VIDEO_EXTS else ""


def _unique(folder, name):
    base, ext = os.path.splitext(name)
    out, n = os.path.join(folder, name), 2
    while os.path.exists(out):
        out = os.path.join(folder, f"{base}_{n}{ext}")
        n += 1
    return out


def _progress(label, pct):
    with lock:
        STATE["stage"], STATE["progress"] = label, max(0, min(100, pct))


def wav_info(path):
    with wave.open(path, "rb") as w:
        n, rate = w.getnframes(), w.getframerate()
        return {"duration": n / rate if rate else 0, "rate": rate, "channels": w.getnchannels(), "bits": w.getsampwidth() * 8}


# ----------------------------------------------------------------------------- 1. extraction / conversion -> WAV
def _duration_and_audio(exe, path):
    text = nasko_compress._run_quiet([exe, "-hide_banner", "-i", path]).stderr
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", text)
    dur = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3)) if m else 0
    return dur, bool(re.search(r"Stream #[^\n]*Audio:", text))


def to_wav(src, progress=None):
    """Convertit/extrait la première piste audio de `src` en WAV PCM 16 bits (fréquence et canaux d'origine). Retourne le chemin."""
    exe = nasko_compress.ffmpeg_exe()
    if not exe:
        raise AudioError("FFmpeg introuvable (renseignez `ffmpeg_path` dans nasko_config.json).")
    dur, has_audio = _duration_and_audio(exe, src)
    if not has_audio:
        raise AudioError("Ce fichier ne contient aucune piste audio.")
    ensure_dirs()
    dst = _unique(WORK, os.path.splitext(os.path.basename(src))[0] + ".wav")
    args = [exe, "-y", "-i", src, "-vn", "-map", "0:a:0", "-c:a", "pcm_s16le", "-f", "wav", dst, "-progress", "pipe:1", "-nostats"]
    err_path = dst + ".err"
    with open(err_path, "w", encoding="utf-8", errors="replace") as ef:
        p = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=ef, text=True, encoding="utf-8", errors="replace",
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        _proc["p"] = p
        try:
            for line in p.stdout:
                if STATE["cancel"]:
                    p.kill(); break
                if line.startswith(("out_time_us=", "out_time_ms=")) and dur:
                    try:
                        if progress:
                            progress(min(1.0, int(line.split("=")[1]) / 1_000_000 / dur))
                    except ValueError:
                        pass
            p.wait()
        finally:
            _proc["p"] = None
    tail = open(err_path, encoding="utf-8", errors="replace").read()[-300:].strip().splitlines()
    os.remove(err_path)
    if STATE["cancel"]:
        _rm(dst)
        raise AudioError("Opération annulée.")
    if p.returncode != 0 or not os.path.isfile(dst):
        _rm(dst)
        raise AudioError("FFmpeg a échoué : " + (tail[-1] if tail else f"code {p.returncode}"))
    return dst


def _rm(p):
    try:
        os.remove(p)
    except OSError:
        pass


# ----------------------------------------------------------------------------- 2. détection des SFX (pydub)
def analyze(wav_path, offset_db=None, min_silence_ms=None, keep_ms=None, min_sfx_ms=None):
    """Timestamps (secondes) de chaque SFX. Même logique que pydub.silence.split_on_silence : detect_nonsilent avec
    silence_thresh = niveau moyen - offset_db, puis marge `keep_ms` de chaque côté (limitée à la moitié du silence voisin)."""
    import warnings
    with warnings.catch_warnings():                           # pydub se plaint de ne pas trouver ffmpeg dans le PATH à l'import
        warnings.simplefilter("ignore", RuntimeWarning)
        from pydub import AudioSegment
        from pydub.silence import detect_nonsilent
    exe = nasko_compress.ffmpeg_exe()
    if exe:
        AudioSegment.converter = exe                          # pydub n'a pas besoin de ffprobe pour lire un WAV PCM
    p = {"offset_db": offset_db, "min_silence_ms": min_silence_ms, "keep_ms": keep_ms, "min_sfx_ms": min_sfx_ms}
    p = {k: (DEFAULTS[k] if v is None else float(v)) for k, v in p.items()}
    p["offset_db"] = max(1, min(60, p["offset_db"]))
    p["min_silence_ms"] = int(max(10, min(5000, p["min_silence_ms"])))
    p["keep_ms"] = int(max(0, min(1000, p["keep_ms"])))
    p["min_sfx_ms"] = int(max(1, min(5000, p["min_sfx_ms"])))
    seg = AudioSegment.from_wav(wav_path)
    total_ms = len(seg)
    if seg.dBFS == float("-inf") or total_ms == 0:
        return {"regions": [], "thresh_db": None, "params": p, "duration": total_ms / 1000}
    thresh = seg.dBFS - p["offset_db"]
    step = 1 if total_ms < 20_000 else 5 if total_ms < 120_000 else 10
    ranges = detect_nonsilent(seg, min_silence_len=p["min_silence_ms"], silence_thresh=thresh, seek_step=step)
    out = []
    for i, (s, e) in enumerate(ranges):
        prev_end = ranges[i - 1][1] if i else 0
        next_start = ranges[i + 1][0] if i + 1 < len(ranges) else total_ms
        s2 = max(s - p["keep_ms"], (prev_end + s) // 2 if i else 0)
        e2 = min(e + p["keep_ms"], (e + next_start) // 2 if i + 1 < len(ranges) else total_ms)
        if e2 - s2 >= p["min_sfx_ms"]:
            out.append({"start": round(s2 / 1000, 3), "end": round(e2 / 1000, 3)})
    return {"regions": out, "thresh_db": round(thresh, 1), "params": p, "duration": total_ms / 1000}


# ----------------------------------------------------------------------------- 4. export précis
def _safe_stem(name):
    stem = os.path.splitext(os.path.basename(name))[0]
    stem = "".join(c for c in stem if c not in '<>:"/\\|?*' and ord(c) >= 32).strip().rstrip(". ")
    return stem or "audio"


def work_path(name):
    if name != os.path.basename(name) or not name.lower().endswith(".wav"):
        raise AudioError("nom de fichier invalide")
    p = os.path.join(WORK, name)
    if not os.path.isfile(p):
        raise AudioError("fichier introuvable dans Audio/Travail")
    return p


def _mp3_args(bitrate):
    return ["-c:a", "libmp3lame", "-b:a", f"{int(bitrate)}k", "-id3v2_version", "3", "-write_xing", "0"]


def _encode_mp3(pcm, params, dst, bitrate):
    """PCM 16 bits -> MP3 via FFmpeg (le PCM passe par stdin : aucun fichier temporaire)."""
    exe = nasko_compress.ffmpeg_exe()
    if not exe:
        raise AudioError("FFmpeg introuvable : export MP3 indisponible.")
    args = [exe, "-y", "-hide_banner", "-loglevel", "error", "-f", "s16le", "-ar", str(params.framerate), "-ac", str(params.nchannels),
            "-i", "pipe:0", *_mp3_args(bitrate), dst]
    p = subprocess.run(args, input=pcm, capture_output=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if p.returncode != 0 or not os.path.isfile(dst):
        _rm(dst)
        raise AudioError("Encodage MP3 échoué : " + (p.stderr.decode("utf-8", "replace").strip().splitlines() or [f"code {p.returncode}"])[-1])


def export(name, regions, fmt="wav", bitrate=192):
    """Découpe `name` (WAV de Audio/Travail) au sample près ; un fichier sfx_NN.<fmt> par région, dans Livraison/<source>/."""
    fmt = (fmt or "wav").lower()
    if fmt not in FORMATS:
        raise AudioError("format inconnu")
    bitrate = int(bitrate) if int(bitrate) in BITRATES else 192
    src = work_path(name)
    with wave.open(src, "rb") as w:
        params, rate, total = w.getparams(), w.getframerate(), w.getnframes()
        if fmt == "mp3" and params.sampwidth != 2:
            raise AudioError("Export MP3 : WAV 16 bits attendu.")
        regs = []
        for r in regions:
            try:
                a, b = float(r["start"]), float(r["end"])
            except (KeyError, TypeError, ValueError):
                raise AudioError("région invalide")
            fa, fb = max(0, round(a * rate)), min(total, round(b * rate))
            if fb - fa >= max(1, int(MIN_REGION_S * rate)):
                regs.append((fa, fb))
        if not regs:
            raise AudioError("Aucune région valide à exporter.")
        regs.sort()
        ensure_dirs()
        folder = _unique(OUT, _safe_stem(name))
        os.makedirs(folder)
        width = max(2, len(str(len(regs))))
        chunks = []
        for fa, fb in regs:                                      # une seule lecture séquentielle du WAV ; l'encodage se fait ensuite en parallèle
            w.setpos(fa)
            chunks.append(w.readframes(fb - fa))
    names = [f"sfx_{i:0{width}d}.{fmt}" for i in range(1, len(regs) + 1)]

    def write(i):
        dst = os.path.join(folder, names[i])
        if fmt == "wav":
            with wave.open(dst, "wb") as o:
                o.setparams(params)
                o.writeframes(chunks[i])
        else:
            _encode_mp3(chunks[i], params, dst, bitrate)
        chunks[i] = None                                         # libère la mémoire au fur et à mesure
    try:
        if fmt == "wav":
            for i in range(len(regs)):
                write(i)
        else:
            with ThreadPoolExecutor(max_workers=min(6, os.cpu_count() or 2)) as ex:
                list(ex.map(write, range(len(regs))))
    except Exception:
        shutil.rmtree(folder, ignore_errors=True)
        raise
    files = [{"name": n, "duration": round((fb - fa) / rate, 3), "size": os.path.getsize(os.path.join(folder, n))} for n, (fa, fb) in zip(names, regs)]
    return {"folder": os.path.basename(folder), "path": folder, "files": files, "fmt": fmt}


def convert_full(name, bitrate=192):
    """Tout le WAV de travail -> un seul MP3 (Livraison/<source>/<source>.mp3), sans découpe."""
    bitrate = int(bitrate) if int(bitrate) in BITRATES else 192
    src = work_path(name)
    exe = nasko_compress.ffmpeg_exe()
    if not exe:
        raise AudioError("FFmpeg introuvable : conversion MP3 indisponible.")
    ensure_dirs()
    folder = _unique(OUT, _safe_stem(name))
    os.makedirs(folder)
    dst = os.path.join(folder, _safe_stem(name) + ".mp3")
    p = nasko_compress._run_quiet([exe, "-y", "-hide_banner", "-loglevel", "error", "-i", src, "-vn", *_mp3_args(bitrate), dst])
    if p.returncode != 0 or not os.path.isfile(dst):
        shutil.rmtree(folder, ignore_errors=True)
        raise AudioError("Conversion MP3 échouée : " + ((p.stderr or "").strip().splitlines() or [f"code {p.returncode}"])[-1])
    return {"folder": os.path.basename(folder), "path": folder, "fmt": "mp3",
            "files": [{"name": os.path.basename(dst), "duration": round(wav_info(src)["duration"], 3), "size": os.path.getsize(dst)}]}


# ----------------------------------------------------------------------------- colis (zip dans « Traitement d'image / Colis en attente »)
def out_folder(folder):
    if not folder or folder != os.path.basename(folder):
        raise AudioError("dossier invalide")
    p = os.path.join(OUT, folder)
    if not os.path.isdir(p):
        raise AudioError("dossier de livraison introuvable")
    return p


def make_colis(folder, files=None):
    """Zippe les SFX d'un dossier de Livraison dans « Colis N.zip » (colis en attente, prêt à livrer)."""
    import nasko_imagefactory as imf
    d = out_folder(folder)
    names = [n for n in sorted(os.listdir(d), key=str.lower) if n.lower().endswith(OUT_EXTS) and os.path.isfile(os.path.join(d, n))]
    if files:
        keep = set(files)
        names = [n for n in names if n in keep]
    if not names:
        raise AudioError("Aucun fichier à mettre dans le colis.")
    os.makedirs(imf.PENDING, exist_ok=True)
    zname = imf._colis_name()
    with zipfile.ZipFile(os.path.join(imf.PENDING, zname), "w", zipfile.ZIP_STORED) as z:       # WAV/MP3 : pas de recompression, zip instantané
        for n in names:
            z.write(os.path.join(d, n), n)
    return {"name": zname, "count": len(names)}


# ----------------------------------------------------------------------------- playlist / fichiers
def playlist():
    ensure_dirs()
    work = []
    for n in sorted(os.listdir(WORK), key=str.lower):
        p = os.path.join(WORK, n)
        if n.lower().endswith(".wav") and os.path.isfile(p):
            try:
                work.append({"name": n, "size": os.path.getsize(p), "t": os.path.getmtime(p), **wav_info(p)})
            except (wave.Error, OSError, EOFError):
                continue
    out = []
    for d in sorted(os.listdir(OUT), key=str.lower):
        dp = os.path.join(OUT, d)
        if os.path.isdir(dp):
            fs = []
            for n in sorted(os.listdir(dp), key=str.lower):
                p = os.path.join(dp, n)
                if n.lower().endswith(OUT_EXTS) and os.path.isfile(p):
                    try:
                        fs.append({"name": n, "size": os.path.getsize(p), "duration": wav_info(p)["duration"] if n.lower().endswith(".wav") else 0})
                    except (wave.Error, OSError, EOFError):
                        continue
            out.append({"folder": d, "files": fs})
    return {"work": work, "out": out}


def file_path(scope, rel):
    """Fichier audio d'Audio/Travail (scope=work) ou Audio/Livraison (scope=out) — jamais en dehors de ces dossiers."""
    base = WORK if scope == "work" else OUT if scope == "out" else None
    if base is None:
        raise AudioError("zone inconnue")
    p = os.path.realpath(os.path.join(base, rel))
    rb = os.path.realpath(base)
    if not (os.path.normcase(p).startswith(os.path.normcase(rb) + os.sep)) or not p.lower().endswith(OUT_EXTS if scope == "out" else (".wav",)) or not os.path.isfile(p):
        raise AudioError("fichier introuvable")
    return p


def list_todo():
    ensure_dirs()
    return [{"name": n, "path": os.path.join(TODO, n), "kind": kind_of(n), "size": os.path.getsize(os.path.join(TODO, n))}
            for n in sorted(os.listdir(TODO), key=str.lower) if kind_of(n) and os.path.isfile(os.path.join(TODO, n))]


def open_wav(name, **params):
    """Charge un WAV déjà présent dans Audio/Travail (playlist) : infos + détection."""
    p = work_path(name)
    return {"name": name, **wav_info(p), "analysis": analyze(p, **params)}


# ----------------------------------------------------------------------------- tâche d'arrière-plan : conversion + détection
def _notify(ok, name, detail=""):
    try:
        import nasko_notify
        nasko_notify.task_done("audio", name, ok, detail)
    except Exception:                                                # noqa: BLE001 — jamais bloquant
        pass


def _job(src):
    try:
        _progress("Conversion en WAV (FFmpeg)…", 2)
        wav = to_wav(src, lambda f: _progress("Extraction de la piste audio en WAV…", 3 + f * 70))
        _progress("Analyse des silences (pydub)…", 78)
        name = os.path.basename(wav)
        res = {"name": name, **wav_info(wav), "analysis": analyze(wav)}
        _progress("Terminé", 100)
        with lock:
            STATE["result"] = res
        _notify(True, name)
        time.sleep(0.6)
    except Exception as e:
        with lock:
            STATE["error"] = str(e) or e.__class__.__name__
        if not STATE["cancel"]:
            _notify(False, os.path.basename(src), STATE["error"])
    finally:
        with lock:
            STATE["busy"] = False


def start(path):
    path = os.path.abspath((path or "").strip().strip('"'))
    if not os.path.isfile(path):
        raise AudioError("Fichier introuvable.")
    if not kind_of(path):
        raise AudioError("Format non pris en charge (audio : wav, mp3, flac, ogg, m4a… · vidéo : mp4, mkv, mov…).")
    with lock:
        if STATE["busy"]:
            raise RuntimeError("Une opération est déjà en cours.")
        STATE.update(busy=True, error="", result=None, cancel=False, stage="Préparation…", progress=1, name=os.path.basename(path))
    threading.Thread(target=_job, args=(path,), daemon=True, name="audiolab").start()


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
