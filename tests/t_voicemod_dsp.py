"""Voice Changer : DSP hors ligne (aucun périphérique) — hauteur exacte, 40+ voix sans NaN, charge CPU par bloc de 20 ms."""
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import nasko_voicemod as vm

BAD = []


def check(c, m):
    print(("OK   " if c else "FAIL ") + m)
    if not c:
        BAD.append(m)


RATE = 48000
N = int(RATE * 0.02)
t = np.arange(RATE * 2) / RATE
voice = sum(np.sin(2 * np.pi * 220 * k * t) / k for k in range(1, 8)).astype(np.float32) * 0.2
voice *= (0.6 + 0.4 * np.sin(2 * np.pi * 3 * t)).astype(np.float32)


def run(params, sig=voice):
    ch = vm.Chain(RATE)
    p = {**vm.NEUTRAL, **params}
    return np.concatenate([ch.process(sig[i:i + N], p) for i in range(0, len(sig) - N + 1, N)])


def peak_hz(y):
    s = np.abs(np.fft.rfft(y[RATE // 2:] * np.hanning(len(y) - RATE // 2)))
    return np.fft.rfftfreq(len(y) - RATE // 2, 1 / RATE)[int(np.argmax(s))]


pure = (0.3 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
for st, want in ((12, 880), (-12, 220), (7, 440 * 2 ** (7 / 12)), (0, 440)):
    got = peak_hz(run({"pitch": st}, pure))
    check(abs(got - want) < want * 0.03, "hauteur %+d demi-tons : %.1f Hz (attendu %.1f)" % (st, got, want))
check(np.allclose(run({}, pure)[:2000], pure[:2000], atol=1e-4), "chaîne neutre : signal inchangé")

check(len(vm.PRESETS) >= 40, "%d voix au catalogue" % len(vm.PRESETS))
check(len({p[0] for p in vm.PRESETS}) == len(vm.PRESETS), "identifiants uniques")
worst = 0.0
for pid, name, cat, emo, tag, params in vm.PRESETS:
    ch = vm.Chain(RATE)
    p = {**vm.NEUTRAL, **params}
    out, tm = [], 0.0
    for i in range(0, len(voice) - N + 1, N):
        t0 = time.perf_counter()
        out.append(ch.process(voice[i:i + N], p))
        tm = max(tm, time.perf_counter() - t0)
    y = np.concatenate(out)
    worst = max(worst, tm)
    check(np.isfinite(y).all() and np.max(np.abs(y)) <= 1.2 and np.std(y) > 1e-4 and len(y) == len(voice) // N * N, "%-18s sain (pic %.2f, pire bloc %.1f ms)" % (name, np.max(np.abs(y)), tm * 1000))
check(worst < 0.012, "pire bloc de toutes les voix : %.1f ms (budget 20 ms)" % (worst * 1000))
everything = {k: v for k, v in vm.NEUTRAL.items()}
everything.update(pitch=5, v2_lvl=60, v3_lvl=60, ring_hz=100, ring_mix=60, vib_rate=5, vib_depth=60, trem_rate=5, trem_depth=50, chorus=50, flanger=50, drive=50, crush_div=4, crush_bits=6,
                  whisper=40, echo_ms=300, echo_fb=50, echo_mix=50, reverb_mix=60, timbre=40, presence=40, lowcut=300, highcut=4000)
t0 = time.perf_counter()
y = run(everything)
per = (time.perf_counter() - t0) / (len(voice) // N)
check(np.isfinite(y).all() and per < 0.012, "TOUS les effets à la fois : %.1f ms / bloc" % (per * 1000))
for k, *_ in vm.PARAMS:
    check(k in vm.NEUTRAL, "paramètre %s connu" % k) if k not in vm.NEUTRAL else None
print("ECHECS :", BAD if BAD else "aucun")
sys.exit(1 if BAD else 0)
