"""CHESS EDIT STUDIO, pont PC : reçoit le manifeste (edit_timeline_manifest.json) et la musique envoyés par l'application, les range dans
data/chess_edit/<horodatage>/, puis lance la scène Godot `godot_chess_edit` (à côté d'ENOS.exe) : aperçu en fenêtre, ou rendu vidéo 60 FPS
(Movie Maker de Godot -> .avi, converti en .mp4 par FFmpeg s'il est installé).

Le chemin de Godot est celui de RÉGLAGES → PROFIL (clé `godot_path`, comme nasko_jeux). Une seule scène à la fois : relancer ferme l'ancienne.
"""
import base64
import json
import logging
import os
import re
import shutil
import subprocess
import threading
import time

import nasko_core

log = logging.getLogger("nasko.chessedit")
CREATE_NO_WINDOW = 0x08000000
MAX_AUDIO = 60 * 1024 * 1024
_lock = threading.Lock()
_proc = {"p": None, "dir": "", "out": ""}


class ChessEditError(Exception):
    pass


def project_dir():
    d = os.path.join(nasko_core.app_dir(), "godot_chess_edit")
    return d if os.path.isfile(os.path.join(d, "project.godot")) else ""


def godot_exe():
    p = str(nasko_core.load_config().get("godot_path") or "").strip().strip('"')
    return p if p and os.path.isfile(p) and p.lower().endswith(".exe") else ""


def ffmpeg_exe():
    return shutil.which("ffmpeg") or ""


def work_root():
    d = os.path.join(nasko_core.data_dir(), "chess_edit")
    os.makedirs(d, exist_ok=True)
    return d


def status():
    p = _proc["p"]
    return {"available": bool(project_dir() and godot_exe()), "project": bool(project_dir()), "godot": bool(godot_exe()), "ffmpeg": bool(ffmpeg_exe()),
            "running": bool(p and p.poll() is None), "dossier": _proc["dir"], "video": _proc["out"]}


def _safe_name(name, default):
    n = re.sub(r"[^\w.\- ]", "_", os.path.basename(str(name or ""))).strip(" .")
    return n or default


def prepare(manifest, audio_b64="", audio_name=""):
    """Écrit le manifeste (+ la musique) dans un dossier de travail neuf ; retourne ce dossier. Le chemin audio du manifeste devient local."""
    if not isinstance(manifest, dict) or not isinstance(manifest.get("events"), list) or not manifest["events"]:
        raise ChessEditError("Manifeste invalide : aucun événement.")
    d = os.path.join(work_root(), time.strftime("%Y%m%d_%H%M%S"))
    os.makedirs(d, exist_ok=True)
    au = manifest.setdefault("audio", {})
    if audio_b64:
        try:
            raw = base64.b64decode(audio_b64, validate=False)
        except (ValueError, TypeError):
            raise ChessEditError("Audio illisible (base64).")
        if len(raw) > MAX_AUDIO:
            raise ChessEditError("Audio trop volumineux (60 Mo maximum).")
        name = _safe_name(audio_name or au.get("name"), "musique.mp3")
        if not name.lower().endswith((".mp3", ".wav", ".ogg")):
            raise ChessEditError("Format audio non géré par la scène Godot (.mp3, .wav ou .ogg).")
        with open(os.path.join(d, name), "wb") as f:
            f.write(raw)
        au["name"] = name
        au["path"] = name                                   # relatif au manifeste : ChessEditDirector.gd le cherche à côté du JSON
    with open(os.path.join(d, "edit_timeline_manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    return d


def launch(manifest, audio_b64="", audio_name="", render=False, seek=0.0):
    """Prépare puis lance la scène. render=True : enregistre un .avi 60 FPS (puis .mp4 si FFmpeg est là) dans le dossier de travail."""
    proj, exe = project_dir(), godot_exe()
    if not proj:
        raise ChessEditError("Dossier godot_chess_edit introuvable à côté d'ENOS.exe.")
    if not exe:
        raise ChessEditError("Godot introuvable : renseignez son chemin dans RÉGLAGES → PROFIL.")
    d = prepare(manifest, audio_b64, audio_name)
    args = [exe, "--path", proj]
    out = ""
    if render:
        out = os.path.join(d, "chess_edit.avi")
        args += ["--write-movie", out, "--fixed-fps", "60"]
    args += ["--", "--manifest=" + os.path.join(d, "edit_timeline_manifest.json")]
    if render:
        args.append("--movie")
    elif seek and float(seek) > 0:
        args.append("--seek=%.3f" % float(seek))
    with _lock:
        old = _proc["p"]
        if old and old.poll() is None:
            old.terminate()
        try:
            _proc["p"] = subprocess.Popen(args, cwd=os.path.dirname(exe), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                          stderr=subprocess.DEVNULL, creationflags=CREATE_NO_WINDOW)
        except OSError as e:
            raise ChessEditError(f"Lancement impossible : {e}")
        _proc["dir"], _proc["out"] = d, out
    if render:
        threading.Thread(target=_to_mp4, args=(_proc["p"], out), daemon=True).start()
    return status()


def _to_mp4(proc, avi):
    """Attend la fin du rendu Godot puis convertit l'.avi en .mp4 (H.264 + AAC) avec FFmpeg, s'il est disponible."""
    proc.wait()
    ff = ffmpeg_exe()
    if not ff or not os.path.isfile(avi):
        return
    mp4 = avi[:-4] + ".mp4"
    try:
        subprocess.run([ff, "-y", "-i", avi, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-c:a", "aac", "-b:a", "192k", mp4],
                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=CREATE_NO_WINDOW, timeout=1800)
        if os.path.isfile(mp4):
            _proc["out"] = mp4
    except (OSError, subprocess.SubprocessError) as e:
        log.warning("conversion mp4 impossible : %s", e)
