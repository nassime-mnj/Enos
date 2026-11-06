"""CHESS EDIT STUDIO, pont PC : reçoit le manifeste (edit_timeline_manifest.json) et la musique envoyés par l'application, les range dans
data/chess_edit/<horodatage>/, puis lance la scène Godot `godot_chess_edit` (à côté d'ENOS.exe) : aperçu en fenêtre, ou rendu vidéo 60 FPS
(Movie Maker de Godot -> .avi, converti en .mp4 par FFmpeg s'il est installé).

Le chemin de Godot est celui de RÉGLAGES → PROFIL (clé `godot_path`, comme nasko_jeux). Une seule scène à la fois : relancer ferme l'ancienne.
"""
import base64
import json
import logging
import math
import os
import random
import re
import shutil
import struct
import subprocess
import threading
import time
import wave

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


# ---------------------------------------------------------------------------------------------------------------- SON : mixage FFmpeg (rendu vidéo)
# Même traitement que l'aperçu du téléphone (chess_edit_sfx.js) : voix de Levy ralenties (×0,93, plus graves) + passe-haut 170 Hz, puis REVERB à convolution
# (filtre `afir` avec une réponse impulsionnelle synthétique de 2,6 s : FFmpeg n'a pas de filtre « reverb ») + ÉCHO (`aecho`, retours à 310 / 620 / 930 ms).
VOICE_RATE = 0.93
SR = 44100
VOICE_IDS = ("the_queen", "the_rook", "the_bishop", "the_knight", "this_is_the_way")


def _write_wav(path, frames, stereo=False):
    with wave.open(path, "wb") as w:
        w.setnchannels(2 if stereo else 1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1.0, min(1.0, x)) * 32000)) for x in frames))


def synth_capture(path):
    """Claquement de prise : triangle grave qui descend (190 -> 70 Hz) + souffle (comme chess_sound.js)."""
    n, ph, out = int(SR * 0.2), 0.0, []
    rnd = random.Random(1)
    for i in range(n):
        t = i / SR
        f = 190 * (70 / 190) ** min(1.0, t / 0.12)
        ph += 2 * math.pi * f / SR
        tri = (2 / math.pi) * math.asin(math.sin(ph))
        noise = (rnd.random() * 2 - 1) * (1 - t / 0.06) * 0.5 if t < 0.06 else 0.0
        out.append(tri * math.exp(-t * 26) * 0.9 + noise)
    _write_wav(path, out)


def synth_chime(path):
    """Petite cloche brillante (coup brillant) : deux sinus 880 / 1320 Hz qui s'éteignent."""
    n = int(SR * 0.7)
    _write_wav(path, [(math.sin(2 * math.pi * 880 * i / SR) * 0.5 + math.sin(2 * math.pi * 1320 * i / SR) * 0.35) * math.exp(-i / SR * 5.5) * 0.8 for i in range(n)])


def synth_boom(path):
    """Impact grave de la fiche de stats : sinus 88 -> 28 Hz + souffle bref (comme chess_edit_sfx.js)."""
    n, ph, out = int(SR * 0.7), 0.0, []
    rnd = random.Random(2)
    for i in range(n):
        t = i / SR
        ph += 2 * math.pi * (28 + 60 * math.exp(-t * 14)) / SR
        out.append((math.sin(ph) * math.exp(-t * 5.5) * 1.1 + ((rnd.random() * 2 - 1) * (1 - t / 0.08) * 0.6 if t < 0.08 else 0.0)) * 0.9)
    _write_wav(path, out)


def synth_whoosh(path):
    """« Whoosh » de sortie de la fiche : bruit filtré qui monte puis retombe."""
    n, lp, out = int(SR * 0.45), 0.0, []
    rnd = random.Random(4)
    for i in range(n):
        t = i / n
        lp += ((rnd.random() * 2 - 1) - lp) * (0.04 + t * 0.5)
        out.append(lp * math.sin(math.pi * t) * 1.6)
    _write_wav(path, out)


def synth_impulse(path, seconds=3.4, decay=2.6):
    """Réponse impulsionnelle stéréo (bruit qui s'éteint et s'assombrit) pour le filtre afir."""
    n, rnd, chans = int(SR * seconds), random.Random(7), []
    for _c in range(2):
        lp, ch = 0.0, []
        for i in range(n):
            k = i / n
            x = (rnd.random() * 2 - 1) * (1 - k) ** decay
            lp += (x - lp) * max(0.12, 0.85 - 0.7 * k)
            ch.append(lp * 1.9)
        chans.append(ch)
    _write_wav(path, [v for pair in zip(*chans) for v in pair], stereo=True)


def _base_js():
    for c in (os.path.join(nasko_core.app_dir(), "static", "learn", "chess_sounds_data.js"),
              os.path.join(nasko_core.app_dir(), "android", "assets", "mobile", "js", "chess_sounds_data.js")):
        if os.path.isfile(c):
            return c
    return ""


def sfx_sources(workdir, ids):
    """Fichier audio de chaque son demandé : voix de Levy (godot_chess_edit/sfx/levy), bruits Chess.com (extraits de chess_sounds_data.js), prise et cloche synthétisées."""
    out = {}
    proj = project_dir() or os.path.join(nasko_core.app_dir(), "godot_chess_edit")
    js = _base_js()
    snd = {}
    if js:
        try:
            with open(js, encoding="utf-8") as fh:
                txt = fh.read()
            snd = json.loads(txt[txt.index("{"):txt.rindex("}") + 1])
        except (OSError, ValueError):
            snd = {}
    for i in ids:
        if i in VOICE_IDS:
            for d in (os.path.join(proj, "sfx", "levy"), os.path.join(nasko_core.app_dir(), "android", "assets", "mobile", "audio", "levy")):
                f = os.path.join(d, i + ".mp3")
                if os.path.isfile(f):
                    out[i] = f
                    break
        elif i == "capture" and "capture" not in snd:
            out[i] = os.path.join(workdir, "sfx_capture.wav")
            synth_capture(out[i])
        elif i == "brilliant":
            out[i] = os.path.join(workdir, "sfx_brilliant.wav")
            synth_chime(out[i])
        elif i == "boom":
            out[i] = os.path.join(workdir, "sfx_boom.wav")
            synth_boom(out[i])
        elif i == "whoosh":
            out[i] = os.path.join(workdir, "sfx_whoosh.wav")
            synth_whoosh(out[i])
        elif i in snd:
            out[i] = os.path.join(workdir, "sfx_" + i + ".mp3")
            with open(out[i], "wb") as f:
                f.write(base64.b64decode(snd[i]))
    return out


def onset(path, thr=0.1):
    """Délai (s) avant le premier vrai son d'un échantillon (les .mp3 de coups commencent par 0,1 à 0,4 s de silence) : on avance son départ pour que l'IMPACT tombe sur la frame voulue."""
    ff = ffmpeg_exe()
    if not ff:
        return 0.0
    try:
        raw = subprocess.run([ff, "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"], stdin=subprocess.DEVNULL, capture_output=True, timeout=60).stdout
    except (OSError, subprocess.SubprocessError):
        return 0.0
    n = len(raw) // 2
    if not n:
        return 0.0
    vals = struct.unpack("<%dh" % n, raw[:n * 2])
    peak = max(abs(v) for v in vals) or 1
    for i, v in enumerate(vals):
        if abs(v) >= peak * thr:
            return i / SR
    return 0.0


def duration_of(path):
    """Durée (s) d'un fichier audio, lue avec ffmpeg ; 3 s si inconnue."""
    ff = ffmpeg_exe()
    if not ff:
        return 3.0
    try:
        err = subprocess.run([ff, "-i", path], stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=30).stderr
        m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", err)
        if m:
            return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    except (OSError, subprocess.SubprocessError):
        pass
    return 3.0


def mix_graph(manifest, srcs, has_music):
    """Construit le graphe FFmpeg (texte) et la liste d'entrées. Retourne (inputs, graph, nb_pistes)."""
    items = [x for x in (manifest.get("sfx") or []) if x.get("id") in srcs]
    ids = sorted({x["id"] for x in items})
    inputs, idx = [], {}
    base = 1 if has_music else 0
    for i in ids:
        idx[i] = base + len(inputs)
        inputs.append(srcs[i])
    uses = {i: [x for x in items if x["id"] == i] for i in ids}
    ons = {i: onset(srcs[i]) / (VOICE_RATE if i in VOICE_IDS else 1.0) for i in ids}
    g, tracks, voices, boosts = [], [], [], []
    off = float((manifest.get("audio") or {}).get("start_offset") or 0)
    if has_music:
        # la musique BAISSE (à 20 %) pendant chaque voix de Levy (et sa queue de reverb) : la voix passe devant
        duck = "".join(f",volume=0.2:enable='between(t,{max(0.0, float(u['t']) - 0.1):.2f},{float(u['t']) + duration_of(srcs[i]) / VOICE_RATE + 1.2:.2f})'" for i in ids if i in VOICE_IDS for u in uses[i])
        if off >= 0:
            g.append(f"[0:a]aresample={SR},atrim=start={off:.3f},asetpts=PTS-STARTPTS,volume=0.85{duck}[mus]")
        else:
            ms = int(-off * 1000)
            g.append(f"[0:a]aresample={SR},adelay={ms}|{ms},volume=0.85{duck}[mus]")
        tracks.append("[mus]")
    n = 0
    for i in ids:
        us = uses[i]
        if len(us) == 1:
            labels = [f"[{idx[i]}:a]"]
        else:
            labels = [f"[sp{idx[i]}_{k}]" for k in range(len(us))]
            g.append(f"[{idx[i]}:a]aresample={SR},asplit={len(us)}" + "".join(labels))
        for lab, u in zip(labels, us):
            start = float(u["t"]) - ons[i]                                            # l'impact (premier son) tombe sur t
            ms, cut = max(0, int(round(start * 1000))), max(0.0, -start)
            trim = f"atrim=start={cut:.3f},asetpts=PTS-STARTPTS," if cut > 0 else ""
            gain = float(u.get("gain", 1))
            n += 1
            if u.get("bus") == "voice":
                wet = float(u.get("wet", 1))
                if wet > 1:                                                                  # reverb supplémentaire (The Rook) : une copie part seulement dans la reverb
                    g.append(f"{lab}aresample={SR},asetrate={int(SR * VOICE_RATE)},aresample={SR},{trim}highpass=f=170,adelay={ms}|{ms},volume={gain:.3f},asplit=2[v{n}][vb{n}]")
                    boosts.append(f"[vb{n}]volume={wet - 1:.2f}")
                    g.append(boosts[-1] + f"[vbx{n}]")
                    boosts[-1] = f"[vbx{n}]"
                else:
                    g.append(f"{lab}aresample={SR},asetrate={int(SR * VOICE_RATE)},aresample={SR},{trim}highpass=f=170,adelay={ms}|{ms},volume={gain:.3f}[v{n}]")
                voices.append(f"[v{n}]")
            elif u.get("bus") == "echo":                                                      # coups lourds : écho spatial (delay 140 / 280 ms, feedback 0,38)
                g.append(f"{lab}aresample={SR},{trim}adelay={ms}|{ms},volume={gain:.3f},aecho=0.8:0.7:140|280:0.38|0.3[x{n}]")
                tracks.append(f"[x{n}]")
            elif u.get("bus") == "epic":                                                       # écho ÉPIQUE (enregistrement de l'Alien Gambit) : deux répétitions longues + grande salle
                g.append(f"{lab}aresample={SR},{trim}adelay={ms}|{ms},volume={gain:.3f},aecho=0.8:0.8:360|720|1100:0.5|0.35|0.2,lowpass=f=5200[x{n}]")
                tracks.append(f"[x{n}]")
            else:
                g.append(f"{lab}aresample={SR},{trim}adelay={ms}|{ms},volume={gain * 0.9:.3f}[x{n}]")
                tracks.append(f"[x{n}]")
    if voices:
        g.append("".join(voices) + (f"amix=inputs={len(voices)}:normalize=0," if len(voices) > 1 else "") + "asplit=3[vd][vw][ve]")
        ir = base + len(inputs)
        g.append("[vd]volume=0.85[vdry]")
        g.append("[vw]" + "".join(boosts) + (f"amix=inputs={1 + len(boosts)}:normalize=0," if boosts else "") + "anull[vwin]")
        g.append(f"[vwin][{ir}:a]afir=dry=0:wet=1,volume=1.0[vwet]")                      # REVERB à convolution, plus forte que la voix sèche
        g.append("[ve]aecho=0.8:0.85:420:0.16,lowpass=f=3600,volume=0.3[vecho]")           # écho discret : une seule répétition
        tracks += ["[vdry]", "[vwet]", "[vecho]"]
    return inputs, ";".join(g), tracks


def build_mix(manifest, workdir, music=""):
    """Mixe musique + bruitages + voix (reverb/écho) en un .wav stéréo calé sur la timeline du manifeste (écrit mix.wav). Retourne son chemin, ou '' sans FFmpeg / sans sons."""
    ff = ffmpeg_exe()
    items = manifest.get("sfx") or []
    if not ff or not items:
        return ""
    srcs = sfx_sources(workdir, {x.get("id") for x in items if x.get("id")})
    if not srcs:
        return ""
    has_music = bool(music and os.path.isfile(music))
    inputs, graph, tracks = mix_graph(manifest, srcs, has_music)
    if not tracks:
        return ""
    dur = float((manifest.get("pacing") or {}).get("duration") or (manifest.get("audio") or {}).get("duration") or 60) + 0.5
    cmd = [ff, "-y"]
    if has_music:
        cmd += ["-i", music]
    for f in inputs:
        cmd += ["-i", f]
    if any(x.get("bus") == "voice" for x in items):
        ir = os.path.join(workdir, "ir_reverb.wav")
        synth_impulse(ir)
        cmd += ["-i", ir]
    final = "".join(tracks) + f"amix=inputs={len(tracks)}:normalize=0:duration=longest,alimiter=limit=0.95:level=0,apad=whole_dur={dur:.2f},atrim=end={dur:.2f}[out]"
    script = os.path.join(workdir, "mix_filter.txt")
    with open(script, "w", encoding="utf-8") as f:
        f.write(graph + ";" + final if graph else final)
    out = os.path.join(workdir, "mix.wav")
    cmd += ["-filter_complex_script", script, "-map", "[out]", "-ar", str(SR), "-ac", "2", out]
    try:
        r = subprocess.run(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=900, creationflags=CREATE_NO_WINDOW if os.name == "nt" else 0)
        if r.returncode != 0:
            log.warning("mixage FFmpeg refusé : %s", (r.stderr or b"")[-400:].decode("utf-8", "replace"))
            return ""
    except (OSError, subprocess.SubprocessError) as e:
        log.warning("mixage FFmpeg impossible : %s", e)
        return ""
    return out if os.path.isfile(out) else ""


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


def mix_for(d, manifest):
    """Mixage son d'un dossier préparé (manifeste v2 avec `sfx`) ; '' si rien à mixer."""
    music = os.path.join(d, au_name) if (au_name := (manifest.get("audio") or {}).get("name")) else ""
    return build_mix(manifest, d, music)


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
        threading.Thread(target=_to_mp4, args=(_proc["p"], out, d, manifest), daemon=True).start()
    return status()


def _to_mp4(proc, avi, workdir="", manifest=None):
    """Attend la fin du rendu Godot puis convertit l'.avi en .mp4 (H.264 + AAC) avec FFmpeg, s'il est disponible. Manifeste v2 : l'audio est remplacé par le MIXAGE
    (musique calée + bruitages + voix de Levy avec reverb/écho) construit par build_mix, calé à la milliseconde sur la timeline."""
    proc.wait()
    ff = ffmpeg_exe()
    if not ff or not os.path.isfile(avi):
        return
    mp4 = avi[:-4] + ".mp4"
    mix = ""
    try:
        if manifest and manifest.get("sfx"):
            mix = mix_for(workdir, manifest)
    except Exception as e:
        log.warning("mixage son : %s", e)
    try:
        cmd = [ff, "-y", "-i", avi] + (["-i", mix, "-map", "0:v:0", "-map", "1:a:0", "-shortest"] if mix else [])
        subprocess.run(cmd + ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-c:a", "aac", "-b:a", "192k", mp4],
                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=CREATE_NO_WINDOW, timeout=1800)
        if os.path.isfile(mp4):
            _proc["out"] = mp4
    except (OSError, subprocess.SubprocessError) as e:
        log.warning("conversion mp4 impossible : %s", e)
