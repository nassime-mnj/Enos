"""Génère des sons de test (WAV) dans CinePulse/samples pour essayer la Soundboard sans FFmpeg."""
import math
import os
import random
import struct
import wave

RATE = 44100
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "samples")


def write(name, samples):
    os.makedirs(OUT, exist_ok=True)
    with wave.open(os.path.join(OUT, name), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, s)) * 32767)) for s in samples))


def tone(freq, dur, decay=4.0):
    n = int(RATE * dur)
    return [math.sin(2 * math.pi * freq * i / RATE) * math.exp(-decay * i / n) * 0.8 for i in range(n)]


def kick(dur=0.6):
    n = int(RATE * dur)
    ph, out = 0.0, []
    for i in range(n):
        f = 45 + 120 * math.exp(-i / (RATE * 0.04))
        ph += 2 * math.pi * f / RATE
        out.append(math.sin(ph) * math.exp(-6 * i / n) * 0.9)
    return out


def noise(dur, decay):
    n = int(RATE * dur)
    return [(random.random() * 2 - 1) * math.exp(-decay * i / n) * 0.6 for i in range(n)]


write("kick.wav", kick())
write("bip_440.wav", tone(440, 0.5))
write("bip_880.wav", tone(880, 1.0, 2.5))
write("explosion.wav", noise(2.5, 5))
write("whoosh.wav", [s * (i / 44100 / 1.2) for i, s in enumerate(noise(1.2, 0.5))])
write("nappe_220.wav", [math.sin(2 * math.pi * 220 * i / RATE) * 0.5 for i in range(RATE * 6)])
print("Sons de test générés dans", OUT)
