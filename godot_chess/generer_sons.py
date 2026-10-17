"""Sons de substitution (synthétisés) pour le plateau : à remplacer par vos fichiers .wav / .ogg / .mp3 du même nom dans audio/.
Noms lus par Godot : move, capture, check, checkmate, castle, promote, select, illegal, start, victory, defeat.  py generer_sons.py"""
import os
import wave

import numpy as np

SR = 44100
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "audio")
rng = np.random.default_rng(7)


def t(d):
    return np.linspace(0, d, int(SR * d), endpoint=False)


def env(x, a=0.003, r=0.1):
    n = len(x)
    e = np.ones(n)
    na, nr = int(SR * a), int(SR * r)
    e[:na] = np.linspace(0, 1, na)
    e[-nr:] *= np.linspace(1, 0, nr)
    return x * e


def lowpass(x, k):
    return np.convolve(x, np.ones(k) / k, mode="same")


def save(name, x, gain=0.8):
    x = x / (np.max(np.abs(x)) + 1e-9) * gain
    with wave.open(os.path.join(OUT, name + ".wav"), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype("<i2").tobytes())


def sweep(f0, f1, d):
    tt = t(d)
    f = np.linspace(f0, f1, len(tt))
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


os.makedirs(OUT, exist_ok=True)
tt = t(0.16)
save("move", env(np.sin(2 * np.pi * 150 * tt) * np.exp(-tt * 30) + 0.4 * lowpass(rng.normal(size=len(tt)), 6) * np.exp(-tt * 60), r=0.05))
tt = t(0.6)
boom = np.sin(2 * np.pi * 55 * tt) * np.exp(-tt * 7)
crack = lowpass(rng.normal(size=len(tt)), 3) * np.exp(-tt * 14)
save("capture", env(boom * 1.2 + crack * 0.9, r=0.2), 0.95)
tt = t(0.32)
save("check", env(np.sin(2 * np.pi * 880 * tt) * (tt < 0.12) + np.sin(2 * np.pi * 660 * tt) * (tt >= 0.14) * np.exp(-(tt - 0.14) * 6), r=0.08))
tt = t(1.6)
save("checkmate", env(sweep(260, 38, 1.6) * np.exp(-tt * 1.4) + 0.5 * lowpass(rng.normal(size=len(tt)), 12) * np.exp(-tt * 3), r=0.4), 0.95)
tt = t(0.28)
save("castle", env(np.sin(2 * np.pi * 170 * tt) * np.exp(-tt * 28) * (1 + (tt > 0.13)), r=0.05))
save("promote", env(np.concatenate([np.sin(2 * np.pi * f * t(0.09)) for f in (440, 554, 659, 880)]), r=0.08))
tt = t(0.05)
save("select", env(np.sin(2 * np.pi * 1400 * tt) * np.exp(-tt * 70), r=0.02), 0.45)
tt = t(0.2)
save("illegal", env(np.sign(np.sin(2 * np.pi * 110 * tt)) * 0.5, r=0.06), 0.5)
save("start", env(sweep(80, 700, 0.7) * np.linspace(0.2, 1, int(SR * 0.7)), r=0.2))
tt = t(1.2)
save("victory", env(np.sin(2 * np.pi * 70 * tt) + 0.5 * np.sin(2 * np.pi * 140.5 * tt), a=0.05, r=0.5))
save("defeat", env(sweep(400, 90, 1.0), a=0.02, r=0.4))
# --- sons de jugement (coup du joueur)
def chime(freqs, step=0.07, d=0.35):
    out = np.zeros(int(SR * (step * len(freqs) + d)))
    for i, f in enumerate(freqs):
        tt = t(d); w = (np.sin(2 * np.pi * f * tt) + 0.4 * np.sin(2 * np.pi * 2 * f * tt)) * np.exp(-tt * 7)
        a = int(SR * step * i); out[a:a + len(w)] += w[:len(out) - a]
    return out
save("brilliant", env(chime([880, 1109, 1319, 1760, 2217], 0.06, 0.55), a=0.002, r=0.3), 0.9)       # arpège cristallin ascendant : le « gratifiant »
save("excellent", env(chime([784, 1175], 0.09, 0.4), r=0.2), 0.8)                                    # deux notes claires
tt = t(0.5)
save("mistake", env(sweep(300, 170, 0.5) * np.exp(-tt * 3) * 0.8, r=0.15), 0.7)                      # glissando descendant mat
tt = t(0.7)
save("blunder", env(np.sign(np.sin(2 * np.pi * sweep(140, 55, 0.7).cumsum() / 40)) * 0.35 + sweep(180, 50, 0.7) * np.exp(-tt * 4), r=0.25), 0.85)   # buzz grave qui chute
print("sons générés dans", OUT)
