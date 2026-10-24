"""Moteur de rendu de CinePulse : EDL (JSON de la timeline) -> commande FFmpeg `filter_complex`, exécutée en arrière-plan avec progression.

Modèle de l'EDL (voir frontend/js/nle/core.js, toEDL) :
  {version, fps, duration, settings?: {width, height, fps, crf}, tracks: [{id, type}] (du haut vers le bas),
   clips: [{asset, track, start, dur, in, opacity, volume, scale, x, y, fadeIn, fadeOut, kf?, trIn?}]}
  kf  : images-clés {opacity|volume|scale|x|y: [{t, v}]} (t en secondes DEPUIS le début du clip, interpolation linéaire)
  trIn: {type: "crossfade", dur} sur le clip qui SUIT un autre clip de la même piste (collés bord à bord).
Sémantique : scale 1 = le média tient dans l'image ; x / y = décalage en fraction de la largeur / hauteur de l'image (+x droite, +y bas).

Sécurité : le JSON ne désigne jamais un chemin. Les médias sont résolus par identifiant dans la bibliothèque (`resolve`), et tout ce qui est écrit dans la
commande FFmpeg est un nombre validé. Aucune chaîne venue de l'EDL n'atteint la ligne de commande.
"""
import collections
import math
import os
import subprocess
import threading
import time
import uuid

_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
SR = 48000                                    # fréquence audio du rendu
MAX_CLIPS = 1500
MAX_DURATION = 3 * 3600
MIN_DUR = 0.1
PRESETS = {"480p": (854, 480), "540p": (960, 540), "720p": (1280, 720), "1080p": (1920, 1080)}
RANGES = {"opacity": (0.0, 1.0, 1.0), "volume": (0.0, 2.0, 1.0), "scale": (0.05, 4.0, 1.0), "x": (-2.0, 2.0, 0.0), "y": (-2.0, 2.0, 0.0)}
ADJ = 0.05                                    # tolérance (s) pour dire que deux clips sont collés


class EdlError(ValueError):
    """EDL invalide : le message est destiné à l'utilisateur."""


class RenderBusy(RuntimeError):
    pass


# ------------------------------------------------------------------------------------------------ utilitaires
def num(x, lo, hi, default, what="valeur"):
    """Nombre fini borné ; défaut si absent ; erreur claire si ce n'est pas un nombre."""
    if x is None:
        return default
    if isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x):
        raise EdlError(f"{what} invalide : un nombre est attendu")
    return min(hi, max(lo, float(x)))


def f(x):
    """Nombre -> texte pour FFmpeg, sans notation scientifique ; les négatifs sont entre parenthèses (sûrs dans une expression)."""
    s = f"{x:.6f}".rstrip("0").rstrip(".")
    s = "0" if s in ("", "-0") else s
    return f"({s})" if s.startswith("-") else s


def kf_expr(points, T):
    """Interpolation linéaire par morceaux d'images-clés [(t, v)] en expression FFmpeg de la variable `T` (texte). Constant avant / après."""
    if not points:
        raise ValueError("images-clés vides")
    if len(points) == 1:
        return f(points[0][1])
    expr = f(points[-1][1])
    for (t0, v0), (t1, v1) in reversed(list(zip(points, points[1:]))):
        expr = f"if(lt({T},{f(t1)}),{f(v0)}+({f(v1 - v0)})*({T}-{f(t0)})/{f(t1 - t0)},{expr})"
    return f"if(lt({T},{f(points[0][0])}),{f(points[0][1])},{expr})"


def value_at(clip, prop, rel):
    """Valeur d'une propriété à l'instant `rel` (secondes depuis le début du clip) : mêmes règles que core.js valueAt."""
    pts = clip["kf"].get(prop)
    if not pts:
        return clip[prop]
    if rel <= pts[0][0]:
        return pts[0][1]
    for (t0, v0), (t1, v1) in zip(pts, pts[1:]):
        if rel < t1:
            return v0 + (v1 - v0) * (rel - t0) / (t1 - t0)
    return pts[-1][1]


# ------------------------------------------------------------------------------------------------ validation de l'EDL
def sanitize(edl, resolve, warnings=None):
    """Valide / normalise l'EDL. `resolve(asset_id)` -> {path, kind, duration, has_audio} ou None. Retourne {settings, clips, duration}."""
    warnings = warnings if warnings is not None else []
    if not isinstance(edl, dict):
        raise EdlError("EDL invalide : un objet JSON est attendu")
    raw_clips = edl.get("clips")
    if not isinstance(raw_clips, list) or not raw_clips:
        raise EdlError("La timeline est vide : ajoutez au moins un clip avant d'exporter")
    if len(raw_clips) > MAX_CLIPS:
        raise EdlError(f"Trop de clips ({len(raw_clips)} > {MAX_CLIPS})")
    tracks = edl.get("tracks")
    if not isinstance(tracks, list) or not tracks:
        raise EdlError("EDL invalide : pistes manquantes")
    order = {}                                                       # id de piste -> rang (0 = le plus BAS, dessiné en premier)
    for i, t in enumerate(reversed(tracks)):
        if not isinstance(t, dict) or not isinstance(t.get("id"), str):
            raise EdlError("EDL invalide : piste sans identifiant")
        order[t["id"]] = (i, t.get("type") == "audio")

    st = edl.get("settings") if isinstance(edl.get("settings"), dict) else {}
    preset = st.get("preset")
    if preset is not None and preset not in PRESETS:
        raise EdlError("Préréglage inconnu (480p, 540p, 720p, 1080p)")
    w, h = PRESETS[preset] if preset else (int(num(st.get("width"), 64, 3840, 1280, "largeur")), int(num(st.get("height"), 64, 2160, 720, "hauteur")))
    w, h = w // 2 * 2, h // 2 * 2
    fps = num(st.get("fps", edl.get("fps")), 10, 60, 30, "fps")
    settings = {"width": w, "height": h, "fps": round(fps, 3), "crf": int(num(st.get("crf"), 14, 32, 21, "qualité"))}

    clips = []
    for k, c in enumerate(raw_clips):
        if not isinstance(c, dict):
            raise EdlError(f"Clip {k + 1} invalide")
        aid, tid = c.get("asset"), c.get("track")
        if not isinstance(aid, str) or not isinstance(tid, str):
            raise EdlError(f"Clip {k + 1} : média ou piste manquant")
        if tid not in order:
            raise EdlError(f"Clip {k + 1} : piste inconnue « {tid[:20]} »")
        a = resolve(aid)
        if not a or not a.get("path") or not os.path.isfile(a["path"]):
            raise EdlError(f"Clip {k + 1} : média introuvable dans la bibliothèque (supprimé ?)")
        if a["kind"] == "audio" and not order[tid][1] or a["kind"] != "audio" and order[tid][1]:
            raise EdlError(f"Clip {k + 1} : ce type de média ne peut pas être sur la piste {tid[:20]}")
        name = f"clip {k + 1}"
        start = num(c.get("start"), 0, MAX_DURATION, 0, name)
        dur = num(c.get("dur"), MIN_DUR, MAX_DURATION, MIN_DUR, name)
        src_in = 0.0 if a["kind"] == "image" else num(c.get("in"), 0, MAX_DURATION, 0, name)
        if a["kind"] != "image" and a.get("duration"):
            room = a["duration"] - src_in
            if room < 0.04:
                raise EdlError(f"Clip {k + 1} : le point d'entrée dépasse la durée du média")
            if dur > room + 0.05:
                warnings.append(f"Clip {k + 1} raccourci à {room:.2f} s (fin du média)")
                dur = room
        clip = {"asset": aid, "track": tid, "rank": order[tid][0], "kind": a["kind"], "path": a["path"], "media_dur": a.get("duration"), "has_audio": bool(a.get("has_audio")),
                "start": start, "dur": dur, "in": src_in, "xf_out": 0.0, "xf_in": 0.0, "tr": None}
        for p, (lo, hi, d) in RANGES.items():
            clip[p] = num(c.get(p), lo, hi, d, p)
        clip["fadeIn"] = num(c.get("fadeIn"), 0, dur, 0, "fondu d'entrée")
        clip["fadeOut"] = num(c.get("fadeOut"), 0, dur, 0, "fondu de sortie")
        if clip["fadeIn"] + clip["fadeOut"] > dur:
            r = dur / (clip["fadeIn"] + clip["fadeOut"])
            clip["fadeIn"], clip["fadeOut"] = clip["fadeIn"] * r, clip["fadeOut"] * r
        clip["kf"] = {}
        kfs = c.get("kf") if isinstance(c.get("kf"), dict) else {}
        for p, (lo, hi, d) in RANGES.items():
            pts = kfs.get(p)
            if not pts:
                continue
            if not isinstance(pts, list) or len(pts) > 200:
                raise EdlError(f"Clip {k + 1} : images-clés « {p} » invalides")
            seen = {}
            for q in pts:
                if not isinstance(q, dict):
                    raise EdlError(f"Clip {k + 1} : image-clé invalide")
                t = num(q.get("t"), 0, dur, 0, "temps d'image-clé")
                seen[round(t, 3)] = num(q.get("v"), lo, hi, d, "valeur d'image-clé")
            clip["kf"][p] = sorted(seen.items())
        tr = c.get("trIn")
        if isinstance(tr, dict) and tr.get("type") == "crossfade":
            clip["tr"] = num(tr.get("dur"), 0, 30, 0, "durée de transition")
        clips.append(clip)

    # transitions : un fondu enchaîné relie B à son prédécesseur A collé sur la même piste ; A est prolongé de d (média réel, sinon image figée)
    by_track = collections.defaultdict(list)
    for c in clips:
        by_track[c["track"]].append(c)
    for lane in by_track.values():
        lane.sort(key=lambda c: c["start"])
        for a, b in zip(lane, lane[1:]):
            if not b["tr"] or abs(a["start"] + a["dur"] - b["start"]) > ADJ:
                continue
            d = min(b["tr"], a["dur"], b["dur"])
            if d >= 0.04:
                a["xf_out"], b["xf_in"] = d, d
    for c in clips:
        c["key"] = (c["rank"], c["start"] + c["dur"] + 1e-6 if c["xf_out"] else c["start"])      # A est dessiné au-dessus de B pendant le fondu
    total = max(c["start"] + c["dur"] for c in clips)
    if total > MAX_DURATION:
        raise EdlError("Projet trop long (3 h maximum)")
    return {"settings": settings, "clips": clips, "duration": total}


# ------------------------------------------------------------------------------------------------ construction de la commande
def _tail(c):
    """Prolongement (s) de A pendant un fondu enchaîné : -> (durée réelle de média, durée d'image figée)."""
    d = c["xf_out"]
    if not d:
        return 0.0, 0.0
    if c["kind"] == "image":
        return d, 0.0
    room = max(0.0, (c["media_dur"] or 0) - (c["in"] + c["dur"])) if c["media_dur"] else 0.0
    real = min(d, room)
    return real, d - real


def build_command(edl, resolve, out_path, ffmpeg="ffmpeg", warnings=None):
    """EDL -> (argv, filtergraph, durée). Lève EdlError si l'EDL est invalide."""
    plan = sanitize(edl, resolve, warnings)
    S, clips, D = plan["settings"], sorted(plan["clips"], key=lambda c: c["key"]), plan["duration"]
    W, H, FPS = S["width"], S["height"], S["fps"]
    inputs, chains, v_labels, a_labels = [], [], [], []
    for c in clips:
        real, frozen = _tail(c)
        total = c["dur"] + real
        argv_in = (["-loop", "1", "-framerate", f(FPS), "-t", f(total), "-i", c["path"]] if c["kind"] == "image"
                   else ["-ss", f(c["in"]), "-t", f(total), "-i", c["path"]])
        inputs.append(argv_in)
        i = len(inputs) - 1
        if c["kind"] != "audio":
            fl = ["setpts=PTS-STARTPTS", f"fps={f(FPS)}"]
            if frozen > 0.001:
                fl.append(f"tpad=stop_mode=clone:stop_duration={f(frozen)}")
            fl.append(f"scale={W}:{H}:force_original_aspect_ratio=decrease")
            fl.append("setsar=1")
            if "scale" in c["kf"]:
                e = kf_expr(c["kf"]["scale"], "t")
                fl.append(f"scale=w='max(2,trunc(iw*({e})/2)*2)':h='max(2,trunc(ih*({e})/2)*2)':eval=frame")
            elif abs(c["scale"] - 1) > 1e-4:
                fl.append(f"scale=w='max(2,trunc(iw*{f(c['scale'])}/2)*2)':h='max(2,trunc(ih*{f(c['scale'])}/2)*2)'")
            fl.append("format=yuva420p")
            if c["fadeIn"] > 0.01 and not c["xf_in"]:
                fl.append(f"fade=t=in:st=0:d={f(c['fadeIn'])}:alpha=1")
            if c["xf_out"]:
                fl.append(f"fade=t=out:st={f(c['dur'])}:d={f(c['xf_out'])}:alpha=1")
            elif c["fadeOut"] > 0.01:
                fl.append(f"fade=t=out:st={f(c['dur'] - c['fadeOut'])}:d={f(c['fadeOut'])}:alpha=1")
            if "opacity" in c["kf"]:
                e = kf_expr(c["kf"]["opacity"], "T")
                fl.append(f"geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='alpha(X,Y)*clip({e},0,1)'")
            elif c["opacity"] < 0.999:
                fl.append(f"colorchannelmixer=aa={f(c['opacity'])}")
            fl.append(f"setpts=PTS+{f(c['start'])}/TB")
            chains.append(f"[{i}:v]{','.join(fl)}[v{i}]")
            ox = kf_expr([(t + c["start"], v) for t, v in c["kf"]["x"]], "t") if "x" in c["kf"] else f(c["x"])
            oy = kf_expr([(t + c["start"], v) for t, v in c["kf"]["y"]], "t") if "y" in c["kf"] else f(c["y"])
            v_labels.append((f"v{i}", ox, oy))
        if c["kind"] == "audio" or c["has_audio"]:
            fl = ["asetpts=PTS-STARTPTS", f"aformat=sample_rates={SR}:channel_layouts=stereo"]
            if "volume" in c["kf"]:
                fl.append(f"volume=volume='{kf_expr(c['kf']['volume'], 't')}':eval=frame")
            elif abs(c["volume"] - 1) > 1e-4:
                fl.append(f"volume={f(c['volume'])}")
            fin = c["xf_in"] or (c["fadeIn"] if c["fadeIn"] > 0.01 else 0)
            if fin:
                fl.append(f"afade=t=in:st=0:d={f(fin)}")
            if c["xf_out"]:
                fl.append(f"afade=t=out:st={f(c['dur'])}:d={f(c['xf_out'])}")
            elif c["fadeOut"] > 0.01:
                fl.append(f"afade=t=out:st={f(c['dur'] - c['fadeOut'])}:d={f(c['fadeOut'])}")
            fl.append(f"adelay=delays={int(round(c['start'] * 1000))}:all=1")
            chains.append(f"[{i}:a]{','.join(fl)}[a{i}]")
            a_labels.append(f"a{i}")
    # image : fond noir puis superposition des calques du plus bas au plus haut
    chains.insert(0, f"color=c=black:s={W}x{H}:r={f(FPS)}:d={f(D)},format=yuv420p[bg0]")
    cur = "bg0"
    for n, (lab, ox, oy) in enumerate(v_labels):
        nxt = f"bg{n + 1}"
        chains.append(f"[{cur}][{lab}]overlay=x='(main_w-overlay_w)/2+main_w*({ox})':y='(main_h-overlay_h)/2+main_h*({oy})':eof_action=pass:repeatlast=0:format=auto[{nxt}]")
        cur = nxt
    chains.append(f"[{cur}]format=yuv420p[vout]")
    # son : silence de base (durée exacte du projet) + tous les calques, sans normalisation automatique, avec limiteur
    chains.append(f"anullsrc=r={SR}:cl=stereo,atrim=end={f(D)}[sil]")
    chains.append("".join(f"[{x}]" for x in ["sil"] + a_labels) + f"amix=inputs={len(a_labels) + 1}:normalize=0:duration=longest,alimiter=limit=0.97,atrim=end={f(D)}[aout]")
    graph = ";".join(chains)
    cmd = [ffmpeg, "-hide_banner", "-nostdin", "-y", "-v", "error", "-nostats", "-progress", "pipe:1"]
    for a in inputs:
        cmd += a
    cmd += ["-filter_complex", graph, "-map", "[vout]", "-map", "[aout]", "-c:v", "libx264", "-preset", "veryfast", "-crf", str(S["crf"]), "-pix_fmt", "yuv420p",
            "-r", f(FPS), "-c:a", "aac", "-b:a", "192k", "-ar", str(SR), "-t", f(D), "-movflags", "+faststart", out_path]
    return cmd, graph, D


# ------------------------------------------------------------------------------------------------ rendu asynchrone
class RenderManager:
    """Un rendu à la fois (FFmpeg occupe déjà tous les coeurs). Chaque rendu a un identifiant, une progression 0..1 et un fichier MP4 final."""

    def __init__(self, ffmpeg, resolve, out_dir, keep=6, script_threshold=24000):
        self.ffmpeg, self.resolve, self.dir, self.keep, self.script_threshold = ffmpeg, resolve, out_dir, keep, script_threshold
        self.jobs, self.lock = collections.OrderedDict(), threading.Lock()
        os.makedirs(out_dir, exist_ok=True)

    def start(self, edl):
        if not self.ffmpeg:
            raise EdlError("FFmpeg est introuvable : rendu impossible")
        with self.lock:
            if any(j["status"] in ("queued", "running") for j in self.jobs.values()):
                raise RenderBusy("Un export est déjà en cours")
            jid, warnings = uuid.uuid4().hex[:12], []
            part = os.path.join(self.dir, jid + ".part.mp4")
            cmd, graph, dur = build_command(edl, self.resolve, part, self.ffmpeg, warnings)
            script = None
            if sum(len(x) for x in cmd) > self.script_threshold:                      # ligne de commande trop longue (limite Windows ~32 k) : graphe dans un fichier
                script = os.path.join(self.dir, jid + ".graph.txt")
                with open(script, "w", encoding="utf-8") as fh:
                    fh.write(graph)
                cmd[cmd.index("-filter_complex")] = "-filter_complex_script"
                cmd[cmd.index(graph)] = script
            plan_s = sanitize(edl, self.resolve, [])["settings"]
            job = {"id": jid, "status": "queued", "progress": 0.0, "duration": dur, "elapsed": 0.0, "eta": None, "speed": None, "error": None, "warnings": warnings,
                   "width": plan_s["width"], "height": plan_s["height"], "fps": plan_s["fps"], "size": None, "created": time.time(),
                   "_cmd": cmd, "_part": part, "_out": os.path.join(self.dir, jid + ".mp4"), "_proc": None, "_cancel": False, "_script": script, "_log": collections.deque(maxlen=40)}
            self.jobs[jid] = job
            self._prune()
        threading.Thread(target=self._run, args=(job,), daemon=True, name="cinepulse-render").start()
        return self.public(job)

    def _run(self, job):
        t0 = time.time()
        job["status"] = "running"
        try:
            proc = subprocess.Popen(job["_cmd"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL, creationflags=_NO_WINDOW)
        except OSError as e:
            return self._finish(job, "error", f"FFmpeg n'a pas pu démarrer : {e}")
        job["_proc"] = proc
        errs = threading.Thread(target=lambda: [job["_log"].append(l.decode("utf-8", "replace").rstrip()) for l in proc.stderr], daemon=True)
        errs.start()
        for raw in proc.stdout:
            line = raw.decode("utf-8", "replace").strip()
            key, _, val = line.partition("=")
            if key in ("out_time_us", "out_time_ms"):                                  # (out_time_ms est en réalité en microsecondes)
                try:
                    done = max(0.0, int(val) / 1e6)
                except ValueError:
                    continue
                if not job["_cancel"] and job["status"] == "running":
                    job["progress"] = max(job["progress"], min(0.99, done / job["duration"]))
                    job["elapsed"] = time.time() - t0
                    if job["progress"] > 0.02:
                        job["eta"] = max(0.0, job["elapsed"] * (1 - job["progress"]) / job["progress"])
            elif key == "speed":
                try:
                    job["speed"] = float(val.rstrip("x"))
                except ValueError:
                    pass
        rc = proc.wait()
        errs.join(5)
        proc.stdout.close()
        proc.stderr.close()
        job["elapsed"] = time.time() - t0
        if job["_cancel"]:
            return self._finish(job, "cancelled", None)
        if rc != 0 or not os.path.isfile(job["_part"]) or os.path.getsize(job["_part"]) == 0:
            tail = [l for l in job["_log"] if l.strip()][-3:]
            return self._finish(job, "error", " | ".join(tail) or f"FFmpeg a échoué (code {rc})")
        try:
            os.replace(job["_part"], job["_out"])
        except OSError as e:
            return self._finish(job, "error", str(e))
        job["size"] = os.path.getsize(job["_out"])
        job["progress"], job["eta"] = 1.0, 0.0
        self._finish(job, "done", None)

    def _finish(self, job, status, error):
        for p in ([job["_script"]] if status == "done" else [job["_script"], job["_part"]]):          # le fichier partiel ne survit qu'à un rendu réussi (renommé)
            if p and os.path.exists(p):
                try:
                    os.remove(p)
                except OSError:
                    pass
        job["error"], job["status"] = error, status

    def _prune(self):
        done = [j for j in self.jobs.values() if j["status"] not in ("queued", "running")]
        for j in done[:-self.keep] if len(done) > self.keep else []:
            for p in (j["_out"], j["_part"]):
                try:
                    os.remove(p)
                except OSError:
                    pass
            self.jobs.pop(j["id"], None)

    @staticmethod
    def public(j):
        return {k: v for k, v in j.items() if not k.startswith("_")} | {"file_url": f"/api/render/{j['id']}/file" if j["status"] == "done" else None}

    def get(self, jid):
        j = self.jobs.get(jid)
        return self.public(j) if j else None

    def cancel(self, jid):
        j = self.jobs.get(jid)
        if not j:
            return None
        if j["status"] in ("queued", "running"):
            j["_cancel"] = True
            p = j["_proc"]
            if p and p.poll() is None:
                try:
                    p.terminate()
                except OSError:
                    pass
        return self.public(j)

    def file(self, jid):
        j = self.jobs.get(jid)
        return j["_out"] if j and j["status"] == "done" and os.path.isfile(j["_out"]) else None

    def wait(self, jid, timeout=120):
        end = time.time() + timeout
        while time.time() < end:
            j = self.jobs.get(jid)
            if j and j["status"] not in ("queued", "running"):
                return self.public(j)
            time.sleep(0.05)
        return self.get(jid)
