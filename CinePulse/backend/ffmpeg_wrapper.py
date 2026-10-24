"""Wrapper FFmpeg/FFprobe de CinePulse.

Localisation du binaire (ordre) : variable CINEPULSE_FFMPEG (dossier ou exe),
dossier CinePulse/bin, puis PATH. Sans FFmpeg, `probe` retombe sur l'extension
du fichier (durée inconnue) : l'interface mesure alors la durée côté navigateur.
"""
import json
import os
import re
import shutil
import subprocess
import sys
from array import array
from fractions import Fraction

AUDIO_EXT = {".wav", ".mp3", ".flac", ".ogg", ".oga", ".opus", ".m4a", ".aac", ".aif", ".aiff", ".wma"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff"}
VIDEO_EXT = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".mpg", ".mpeg", ".wmv", ".mxf"}

_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
_EXE = ".exe" if sys.platform == "win32" else ""


class FFmpegError(RuntimeError):
    pass


def kind_from_extension(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in AUDIO_EXT:
        return "audio"
    if ext in VIDEO_EXT:
        return "video"
    if ext in IMAGE_EXT:
        return "image"
    return None


def _find(name, hint_dir=None):
    candidates = []
    env = os.environ.get("CINEPULSE_FFMPEG")
    if env:
        candidates.append(env if os.path.isdir(env) else os.path.dirname(env))
    here = os.path.dirname(os.path.abspath(__file__))
    candidates.append(os.path.join(here, "..", "bin"))
    if hint_dir:
        candidates.append(hint_dir)
    for d in candidates:
        p = os.path.join(d, name + _EXE)
        if os.path.isfile(p):
            return os.path.abspath(p)
    found = shutil.which(name)
    if found or name != "ffmpeg":
        return found
    try:                                                    # E.N.O.S. embarque ffmpeg via imageio-ffmpeg (sans ffprobe)
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:                                       # noqa: BLE001
        return None


class FFmpeg:
    def __init__(self):
        self.ffmpeg = _find("ffmpeg")
        self.ffprobe = _find("ffprobe", os.path.dirname(self.ffmpeg) if self.ffmpeg else None)

    @property
    def available(self):
        return bool(self.ffmpeg)                            # ffprobe facultatif : probe() sait lire la sortie de « ffmpeg -i »

    def _run(self, cmd, timeout=600, binary=False):
        try:
            res = subprocess.run(cmd, capture_output=True, timeout=timeout, creationflags=_NO_WINDOW)
        except (OSError, subprocess.TimeoutExpired) as e:
            raise FFmpegError(str(e))
        if res.returncode != 0:
            msg = res.stderr.decode("utf-8", "replace").strip().splitlines()
            raise FFmpegError(msg[-1] if msg else "ffmpeg a échoué")
        return res.stdout if binary else res.stdout.decode("utf-8", "replace")

    def version(self):
        if not self.ffmpeg:
            return None
        try:
            first = self._run([self.ffmpeg, "-version"], timeout=10).splitlines()[0]
            return first.split()[2] if first.startswith("ffmpeg version") else first
        except FFmpegError:
            return None

    # ------------------------------------------------------------ métadonnées
    def probe(self, path):
        """Retourne {kind, duration, fps, width, height, has_audio, sample_rate, channels, codec}.

        kind vaut None si le fichier n'est ni audio ni vidéo.
        """
        info = {"kind": kind_from_extension(path), "duration": None, "fps": None, "width": None,
                "height": None, "has_audio": info_audio_guess(path), "sample_rate": None,
                "channels": None, "codec": None}
        if not self.ffprobe:
            return self._probe_stderr(path, info) if self.ffmpeg else info
        out = self._run([self.ffprobe, "-v", "error", "-print_format", "json",
                         "-show_format", "-show_streams", path], timeout=60)
        data = json.loads(out)
        streams = data.get("streams", [])
        video = next((s for s in streams if s.get("codec_type") == "video"
                      and not s.get("disposition", {}).get("attached_pic")), None)
        audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
        info["kind"] = "video" if video else "audio" if audio else None
        info["has_audio"] = audio is not None
        try:
            info["duration"] = float(data.get("format", {}).get("duration"))
        except (TypeError, ValueError):
            pass
        if video:
            info["width"], info["height"] = video.get("width"), video.get("height")
            info["fps"] = _parse_fps(video.get("avg_frame_rate")) or _parse_fps(video.get("r_frame_rate"))
            info["codec"] = video.get("codec_name")
        if audio:
            info["sample_rate"] = int(audio.get("sample_rate") or 0) or None
            info["channels"] = audio.get("channels")
            info["codec"] = info["codec"] or audio.get("codec_name")
        return info

    def _probe_stderr(self, path, info):
        """Sans ffprobe : analyse la sortie texte de « ffmpeg -i » (durée, flux vidéo / audio)."""
        try:
            res = subprocess.run([self.ffmpeg, "-hide_banner", "-i", path], capture_output=True, timeout=60, creationflags=_NO_WINDOW)
        except (OSError, subprocess.TimeoutExpired) as e:
            raise FFmpegError(str(e))
        text = res.stderr.decode("utf-8", "replace")
        m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", text)
        if m:
            info["duration"] = int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3])
        video = audio = False
        for line in text.splitlines():
            if "Stream #" not in line:
                continue
            if " Video:" in line and "attached pic" not in line and not video:
                video = True
                wh = re.search(r"[\s,\[](\d{2,5})x(\d{2,5})[\s,\[]", line + " ")
                if wh:
                    info["width"], info["height"] = int(wh[1]), int(wh[2])
                fps = re.search(r"([\d.]+) fps", line)
                info["fps"] = _parse_fps(fps[1]) if fps else None
                info["codec"] = line.split("Video:")[1].split()[0].strip(",")
            elif " Audio:" in line and not audio:
                audio = True
                hz = re.search(r"(\d+) Hz", line)
                info["sample_rate"] = int(hz[1]) if hz else None
                info["channels"] = 1 if "mono" in line else 6 if "5.1" in line else 2
                info["codec"] = info["codec"] or line.split("Audio:")[1].split()[0].strip(",")
        if not video and not audio:
            raise FFmpegError("fichier illisible (aucun flux audio ou vidéo)")
        if info["kind"] != "image":
            info["kind"] = "video" if video else "audio"
        info["has_audio"] = audio
        return info

    # ------------------------------------------------------------ flux audio
    def waveform_peaks(self, path, buckets):
        """Pics normalisés (0..1) répartis en `buckets` segments, mono 8 kHz."""
        if not self.ffmpeg:
            raise FFmpegError("ffmpeg introuvable")
        raw = self._run([self.ffmpeg, "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", "8000",
                         "-f", "s16le", "-"], binary=True)
        samples = array("h")
        samples.frombytes(raw[: len(raw) // 2 * 2])
        if sys.byteorder == "big":
            samples.byteswap()
        n = len(samples)
        if n == 0:
            return []
        step = max(1, n // max(1, buckets))
        return [max(max(c), -min(c)) / 32768 for c in (samples[i:i + step] for i in range(0, n, step))]

    def extract_audio(self, src, dst, sample_rate=48000):
        """Extrait la piste audio d'une vidéo en WAV PCM 16 bits."""
        self._need()
        self._run([self.ffmpeg, "-y", "-v", "error", "-i", src, "-vn", "-ac", "2", "-ar", str(sample_rate),
                   "-c:a", "pcm_s16le", dst])
        return dst

    def make_proxy(self, src, dst, height=540):
        """Proxy H.264 léger pour un montage fluide des rushes lourds."""
        self._need()
        self._run([self.ffmpeg, "-y", "-v", "error", "-i", src, "-vf", f"scale=-2:{height}",
                   "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-c:a", "aac", "-b:a", "128k", dst],
                  timeout=3600)
        return dst

    def make_video_proxy(self, src, dst, has_audio=True, height=540):
        """Proxy de montage mobile : H.264 ≤ 540 p, image-clé toutes les 12 images (scrub instantané), faststart, jamais agrandi."""
        self._need()
        cmd = [self.ffmpeg, "-y", "-v", "error", "-i", src, "-vf", f"scale=-2:'min({height},ih)',format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28",
               "-g", "12", "-movflags", "+faststart"]
        cmd += ["-c:a", "aac", "-b:a", "96k"] if has_audio else ["-an"]
        self._run(cmd + [dst], timeout=3600)
        return dst

    def _need(self):
        if not self.ffmpeg:
            raise FFmpegError("ffmpeg introuvable")


def info_audio_guess(path):
    return kind_from_extension(path) == "audio"


def _parse_fps(text):
    try:
        f = Fraction(text)
        return round(float(f), 3) if f > 0 else None
    except (TypeError, ValueError, ZeroDivisionError):
        return None
