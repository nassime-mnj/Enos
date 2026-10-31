"""VOICE CHANGER : modifie la voix SORTANTE du micro en temps réel (numpy + sounddevice, aucune autre dépendance).

Principe : micro réel  ->  chaîne d'effets (hauteur, timbre, robot, écho, réverbération…)  ->  « câble audio virtuel » (VB-Cable, VoiceMeeter, Hi-Fi Cable…).
Dans Discord / Teams / OBS / un jeu, on choisit alors « CABLE Output » comme micro : les autres entendent la voix modifiée. Sans câble virtuel, on peut quand même
s'écouter (« Je m'entends ») et enregistrer un aperçu. Windows ne permet pas à un programme de remplacer le micro sans pilote : le câble virtuel est donc l'unique
passerelle fiable (E.N.O.S. ne l'installe pas à ta place : lien dans l'interface).

DSP (tout en numpy, par blocs de 20 ms, ~25 ms de latence) :
  * hauteur : décaleur granulaire à deux têtes de lecture (± 12 demi-tons) + jusqu'à 2 voix harmonisées ; * timbre : filtre FIR à phase linéaire dessiné depuis une courbe
  (inclinaison, présence, coupe-bas / coupe-haut) ; * modulation en anneau (robot / alien), vibrato, trémolo, chœur, flanger ; * distorsion, bit-crusher ; * murmure (bruit
  excité par l'enveloppe) ; * écho et réverbération (peignes + passe-tout de Schroeder) ; * porte de bruit, gain, mélange sec / traité, limiteur.
"""
import json
import logging
import math
import os
import threading
import time
from collections import deque

import numpy as np

import nasko_core

log = logging.getLogger("nasko.voicemod")

NEUTRAL = {
    "pitch": 0.0, "timbre": 0.0, "presence": 0.0, "lowcut": 0.0, "highcut": 0.0,
    "v2_st": 0.0, "v2_lvl": 0.0, "v3_st": 0.0, "v3_lvl": 0.0,
    "ring_hz": 0.0, "ring_mix": 0.0, "vib_rate": 0.0, "vib_depth": 0.0, "trem_rate": 0.0, "trem_depth": 0.0,
    "chorus": 0.0, "flanger": 0.0, "drive": 0.0, "crush_bits": 16.0, "crush_div": 1.0, "whisper": 0.0,
    "echo_ms": 0.0, "echo_fb": 0.0, "echo_mix": 0.0, "reverb_size": 0.5, "reverb_mix": 0.0,
    "gate_db": -70.0, "gain_db": 0.0, "wet": 100.0,
}
# (clé, libellé, groupe, min, max, pas, unité) : sert à construire les curseurs de l'interface
PARAMS = [
    ("pitch", "Hauteur", "VOIX", -12, 12, 0.5, " st"), ("timbre", "Timbre (grave ⇄ brillant)", "VOIX", -100, 100, 1, ""), ("presence", "Présence (clarté)", "VOIX", -100, 100, 1, ""),
    ("v2_st", "Voix 2 · décalage", "HARMONIES", -12, 12, 1, " st"), ("v2_lvl", "Voix 2 · niveau", "HARMONIES", 0, 100, 1, " %"),
    ("v3_st", "Voix 3 · décalage", "HARMONIES", -12, 12, 1, " st"), ("v3_lvl", "Voix 3 · niveau", "HARMONIES", 0, 100, 1, " %"),
    ("ring_hz", "Robot · fréquence", "MODULATION", 0, 800, 1, " Hz"), ("ring_mix", "Robot · intensité", "MODULATION", 0, 100, 1, " %"),
    ("vib_rate", "Vibrato · vitesse", "MODULATION", 0, 12, 0.1, " Hz"), ("vib_depth", "Vibrato · profondeur", "MODULATION", 0, 100, 1, " %"),
    ("trem_rate", "Trémolo · vitesse", "MODULATION", 0, 20, 0.1, " Hz"), ("trem_depth", "Trémolo · profondeur", "MODULATION", 0, 100, 1, " %"),
    ("chorus", "Chœur", "MODULATION", 0, 100, 1, " %"), ("flanger", "Flanger", "MODULATION", 0, 100, 1, " %"),
    ("drive", "Distorsion", "SATURATION", 0, 100, 1, " %"), ("crush_bits", "Bit-crusher · bits", "SATURATION", 3, 16, 1, " bits"), ("crush_div", "Bit-crusher · rééchantillonnage", "SATURATION", 1, 24, 1, "×"),
    ("whisper", "Murmure", "SATURATION", 0, 100, 1, " %"),
    ("echo_ms", "Écho · délai", "ESPACE", 0, 900, 10, " ms"), ("echo_fb", "Écho · répétitions", "ESPACE", 0, 90, 1, " %"), ("echo_mix", "Écho · niveau", "ESPACE", 0, 100, 1, " %"),
    ("reverb_size", "Réverbération · taille", "ESPACE", 0, 100, 1, ""), ("reverb_mix", "Réverbération · niveau", "ESPACE", 0, 100, 1, " %"),
    ("lowcut", "Coupe-bas", "FILTRES", 0, 1500, 10, " Hz"), ("highcut", "Coupe-haut", "FILTRES", 0, 12000, 100, " Hz"), ("gate_db", "Porte de bruit", "FILTRES", -70, -20, 1, " dB"),
    ("gain_db", "Gain de sortie", "SORTIE", -20, 12, 0.5, " dB"), ("wet", "Mix voix traitée", "SORTIE", 0, 100, 1, " %"),
]


def _p(**k):
    d = dict(NEUTRAL)
    d.update(k)
    return d


# id, nom, catégorie, emoji, accroche, paramètres
PRESETS = [
    # ---- NATUREL
    ("deep", "Grave profond", "naturel", "🐻", "Une voix de baryton chaleureuse", _p(pitch=-4, timbre=-35, presence=10)),
    ("bass", "Basse océane", "naturel", "🌊", "Très grave, très posée", _p(pitch=-7, timbre=-55, reverb_mix=12)),
    ("bright", "Brillante", "naturel", "✨", "Plus claire, plus aérienne", _p(pitch=2, timbre=40, presence=30)),
    ("man", "Homme mûr", "naturel", "🧔", "Voix d'homme assurée", _p(pitch=-3, timbre=-20, presence=15)),
    ("woman", "Femme", "naturel", "👩", "Voix féminine naturelle", _p(pitch=4, timbre=30, presence=20)),
    ("teen", "Ado", "naturel", "🧑", "Plus jeune, plus vive", _p(pitch=3, timbre=15, presence=10)),
    ("child", "Enfant", "naturel", "🧒", "Voix d'enfant", _p(pitch=7, timbre=45, presence=15)),
    ("elder", "Ancien", "naturel", "🧓", "Voix usée et tremblante", _p(pitch=-2, timbre=-15, vib_rate=5.5, vib_depth=22, highcut=5000)),
    # ---- FUN
    ("chipmunk", "Tamia", "fun", "🐿", "Aigu, rapide, irrésistible", _p(pitch=10, timbre=50, presence=10)),
    ("giant", "Géant", "fun", "🗿", "Un colosse qui gronde", _p(pitch=-10, timbre=-70, drive=8, reverb_mix=10)),
    ("troll", "Troll", "fun", "👹", "Rauque et grognon", _p(pitch=-8, timbre=-45, drive=28)),
    ("pixie", "Lutin", "fun", "🧚", "Minuscule et pétillante", _p(pitch=9, timbre=60, chorus=35, v2_st=12, v2_lvl=18)),
    ("cartoon", "Dessin animé", "fun", "🎬", "Vibrante et exagérée", _p(pitch=6, timbre=35, vib_rate=7, vib_depth=30, presence=25)),
    ("duo", "Duo", "fun", "👯", "Deux voix pour le prix d'une", _p(v2_st=-5, v2_lvl=70, v3_st=4, v3_lvl=45, chorus=15)),
    ("balloon", "Hélium", "fun", "🎈", "Comme après un ballon", _p(pitch=12, timbre=70, presence=20)),
    ("drunk", "Éméché", "fun", "🥴", "Ça tangue un peu", _p(pitch=-2, vib_rate=2.2, vib_depth=55, trem_rate=1.4, trem_depth=25, timbre=-10)),
    # ---- ROBOT & SF
    ("robot", "Robot", "robot", "🤖", "Métal froid", _p(ring_hz=70, ring_mix=70, timbre=15, echo_ms=14, echo_fb=0, echo_mix=0, highcut=7000)),
    ("dalek", "Dalek", "robot", "🛸", "EX-TER-MI-NER", _p(pitch=-3, ring_hz=32, ring_mix=85, drive=15, timbre=20)),
    ("cyborg", "Cyborg", "robot", "🦾", "Mi-homme, mi-machine", _p(pitch=-2, ring_hz=120, ring_mix=40, chorus=40, drive=10)),
    ("alien", "Alien", "robot", "👽", "Pas de cette planète", _p(pitch=5, ring_hz=18, ring_mix=45, vib_rate=9, vib_depth=40, timbre=30)),
    ("droid", "Droïde", "robot", "📟", "Bips et bidouille", _p(pitch=6, crush_bits=7, crush_div=3, ring_hz=210, ring_mix=25, timbre=25)),
    ("vader", "Seigneur sombre", "robot", "🪖", "Grave, métallique, menaçant", _p(pitch=-9, timbre=-50, ring_hz=45, ring_mix=22, reverb_size=60, reverb_mix=14, drive=12)),
    ("ai", "Voix d'IA", "robot", "🧠", "Lisse, froide, légèrement double", _p(chorus=55, ring_hz=300, ring_mix=10, timbre=20, presence=25)),
    ("vocoder", "Synthé vocal", "robot", "🎹", "Ça chante comme un clavier", _p(ring_hz=180, ring_mix=60, v2_st=7, v2_lvl=55, v3_st=12, v3_lvl=35, timbre=10)),
    # ---- RADIO & LIEUX
    ("phone", "Téléphone", "radio", "📞", "Bande étroite d'un vieux combiné", _p(lowcut=400, highcut=3200, presence=40, drive=10)),
    ("megaphone", "Mégaphone", "radio", "📣", "Crié dans un cône", _p(lowcut=500, highcut=4200, drive=45, presence=40)),
    ("walkie", "Talkie-walkie", "radio", "📻", "Grésillant, saturé", _p(lowcut=450, highcut=3500, drive=35, crush_bits=10, crush_div=2, gate_db=-45)),
    ("vintage", "Radio vintage", "radio", "🎙", "Années 40, chaleur d'antan", _p(lowcut=250, highcut=4800, drive=12, timbre=-10, reverb_mix=8)),
    ("cave", "Caverne", "radio", "🕳", "Résonne dans la roche", _p(reverb_size=75, reverb_mix=45, echo_ms=260, echo_fb=35, echo_mix=25, timbre=-10)),
    ("cathedral", "Cathédrale", "radio", "⛪", "Longue traîne sacrée", _p(reverb_size=100, reverb_mix=70, timbre=5, v2_st=12, v2_lvl=12)),
    ("bathroom", "Salle de bain", "radio", "🚿", "Carrelage brillant", _p(reverb_size=22, reverb_mix=40, presence=15)),
    ("underwater", "Sous l'eau", "radio", "🫧", "Bulles et ondulations", _p(pitch=-1, vib_rate=3.2, vib_depth=45, highcut=1800, timbre=-30, chorus=30)),
    ("tunnel", "Tunnel", "radio", "🚇", "Écho métallique des rails", _p(echo_ms=170, echo_fb=45, echo_mix=40, reverb_size=55, reverb_mix=25, lowcut=200)),
    # ---- HORREUR
    ("ghost", "Fantôme", "horreur", "👻", "Il rôde dans la pièce", _p(pitch=-2, whisper=30, reverb_size=85, reverb_mix=50, vib_rate=4, vib_depth=25, highcut=6000)),
    ("whisper", "Murmure", "horreur", "🤫", "Rien qu'à ton oreille", _p(whisper=100, timbre=35, gain_db=4)),
    ("demon", "Démon", "horreur", "😈", "Deux voix de l'abîme", _p(pitch=-8, v2_st=-15, v2_lvl=65, drive=30, timbre=-55, reverb_mix=18)),
    ("zombie", "Zombie", "horreur", "🧟", "Lent, rauque, trébuchant", _p(pitch=-5, timbre=-40, trem_rate=3, trem_depth=45, drive=20, highcut=4500)),
    ("vampire", "Vampire", "horreur", "🧛", "Velours et menace", _p(pitch=-4, timbre=-25, reverb_size=55, reverb_mix=22, presence=25, v2_st=-12, v2_lvl=25)),
    ("possessed", "Possédé", "horreur", "😱", "Plusieurs voix qui se battent", _p(pitch=-6, v2_st=5, v2_lvl=70, v3_st=-12, v3_lvl=60, drive=22, vib_rate=8, vib_depth=30)),
    ("witch", "Sorcière", "horreur", "🧙", "Cacophonie aiguë et rauque", _p(pitch=5, vib_rate=6, vib_depth=45, drive=18, timbre=15, v2_st=-7, v2_lvl=30)),
    # ---- MUSIQUE & FX
    ("choir", "Chorale", "fx", "🎼", "Quatre voix au lieu d'une", _p(v2_st=4, v2_lvl=65, v3_st=-5, v3_lvl=65, chorus=50, reverb_size=70, reverb_mix=30)),
    ("canyon", "Écho canyon", "fx", "🏔", "Elle revient plusieurs fois", _p(echo_ms=420, echo_fb=55, echo_mix=55, reverb_mix=10)),
    ("bit8", "8-bit", "fx", "🕹", "Console des années 80", _p(crush_bits=4, crush_div=8, timbre=20, highcut=6000)),
    ("glitch", "Glitch", "fx", "💾", "Signal en lambeaux", _p(crush_bits=5, crush_div=14, trem_rate=14, trem_depth=70, ring_hz=500, ring_mix=15)),
    ("metal", "Cri métal", "fx", "🤘", "Saturé jusqu'à la racine", _p(drive=85, pitch=-3, timbre=-15, presence=35, lowcut=120)),
    ("tremble", "Tremblote", "fx", "😰", "La peur au ventre", _p(trem_rate=9, trem_depth=60, vib_rate=7, vib_depth=22)),
    ("flange", "Réacteur", "fx", "✈", "Balayage de flanger", _p(flanger=85, chorus=20, presence=15)),
    ("opera", "Chanteur d'opéra", "fx", "🎭", "Ample, vibrante, solennelle", _p(pitch=2, vib_rate=5.8, vib_depth=40, reverb_size=75, reverb_mix=35, presence=20, v2_st=12, v2_lvl=14)),
    # ---- PERSOS
    ("narrator", "Narrateur ciné", "persos", "🎞", "Bande-annonce : « Dans un monde… »", _p(pitch=-5, timbre=-30, presence=30, reverb_size=40, reverb_mix=14, drive=6)),
    ("caster", "Commentateur", "persos", "🏟", "Énergie de stade", _p(pitch=1, presence=45, drive=14, lowcut=150, echo_ms=90, echo_fb=0, echo_mix=0, timbre=10)),
    ("eto", "ETO", "persos", "🌿", "Zen, claire, un peu double", _p(pitch=3, timbre=25, chorus=28, reverb_mix=12, presence=20)),
    ("enos", "E.N.O.S.", "persos", "🔴", "IA froide et précise", _p(pitch=-2, ring_hz=150, ring_mix=22, timbre=-5, presence=35, chorus=18, highcut=9000)),
    ("spy", "Agent secret", "persos", "🕶", "Oreillette et voix posée", _p(pitch=-3, timbre=-20, lowcut=180, highcut=6500, presence=25, gate_db=-50)),
    ("announcer", "Annonce gare", "persos", "🚉", "« Voie 3, attention au départ »", _p(pitch=1, lowcut=300, highcut=5500, echo_ms=140, echo_fb=25, echo_mix=18, reverb_size=60, reverb_mix=25, presence=20)),
]
CATS = [("naturel", "NATUREL", "🎤"), ("fun", "FUN", "🎉"), ("robot", "ROBOT & SF", "🤖"), ("radio", "RADIO & LIEUX", "📻"), ("horreur", "HORREUR", "👻"), ("fx", "MUSIQUE & FX", "🎛"), ("persos", "PERSOS", "🎭")]
PRESET_BY_ID = {p[0]: p for p in PRESETS}
RATE_DEFAULT = 48000
BLOCK_SEC = 0.02


# ====================================================================== briques DSP (numpy pur, état conservé entre les blocs)
class PitchShifter:
    """Décaleur granulaire : deux têtes de lecture qui se croisent sur une ligne à retard, fenêtres en sin² (somme = 1) -> pas de clic au bouclage."""

    def __init__(self, rate):
        self.L = int(rate * 0.04)                                   # fenêtre de 40 ms
        self.size = self.L * 3
        self.buf = np.zeros(self.size, np.float32)
        self.w = 0
        self.phase = 0.0

    def process(self, x, st):
        n = len(x)
        idx = (self.w + np.arange(n)) % self.size
        self.buf[idx] = x
        r = 2.0 ** (st / 12.0)
        L = self.L
        ph = (self.phase + (1.0 - r) * np.arange(n)) % L
        out = np.zeros(n, np.float32)
        pos0 = self.w + np.arange(n)
        for off in (0.0, L / 2.0):
            p = (ph + off) % L
            g = np.sin(np.pi * p / L) ** 2
            rd = pos0 - (p + 2.0)                                   # +2 : marge d'interpolation
            i0 = np.floor(rd).astype(np.int64)
            fr = (rd - i0).astype(np.float32)
            a = self.buf[i0 % self.size]
            b = self.buf[(i0 + 1) % self.size]
            out += (a + (b - a) * fr) * g.astype(np.float32)
        self.phase = (self.phase + (1.0 - r) * n) % L
        self.w = (self.w + n) % self.size
        return out


class FIR:
    def __init__(self, taps=513):
        self.M = taps
        self.h = None
        self.key = None
        self.hist = np.zeros(taps - 1, np.float32)

    def set_curve(self, rate, key, curve_db):
        if key == self.key:
            return
        self.key = key
        nfft = 2048
        f = np.fft.rfftfreq(nfft, 1.0 / rate)
        mag = 10.0 ** (curve_db(f) / 20.0)
        h = np.fft.irfft(mag, nfft)
        h = np.roll(h, self.M // 2)[: self.M] * np.hanning(self.M)
        self.h = h.astype(np.float32)

    def process(self, x):
        if self.h is None:
            return x
        z = np.concatenate([self.hist, x])
        self.hist = z[-(self.M - 1):]
        y = np.convolve(z, self.h, mode="valid")
        return y[: len(x)].astype(np.float32)


class ModDelay:
    def __init__(self, rate, max_ms=60):
        self.size = int(rate * max_ms / 1000) + 8
        self.buf = np.zeros(self.size, np.float32)
        self.w = 0
        self.rate = rate
        self.t = 0.0

    def process(self, x, base_ms, depth_ms, hz):
        n = len(x)
        idx = (self.w + np.arange(n)) % self.size
        self.buf[idx] = x
        t = self.t + np.arange(n) / self.rate
        d = (base_ms + depth_ms * np.sin(2 * np.pi * hz * t)) * self.rate / 1000.0 + 1.0
        rd = (self.w + np.arange(n)) - np.clip(d, 1.0, self.size - 4)
        i0 = np.floor(rd).astype(np.int64)
        fr = (rd - i0).astype(np.float32)
        y = self.buf[i0 % self.size] * (1 - fr) + self.buf[(i0 + 1) % self.size] * fr
        self.w = (self.w + n) % self.size
        self.t += n / self.rate
        return y.astype(np.float32)


class Comb:
    """y[n] = x[n] + g·y[n-D] (peigne) ou passe-tout ; traité par morceaux de D échantillons pour rester vectorisé."""

    def __init__(self, d, allpass=False):
        self.d = int(d)
        self.hist = np.zeros(self.d, np.float32)
        self.ap = allpass
        self.xh = np.zeros(self.d, np.float32)

    def process(self, x, g):
        out = np.empty_like(x)
        d = self.d
        pos = 0
        while pos < len(x):
            m = min(d, len(x) - pos)
            xs = x[pos:pos + m]
            if self.ap:
                ys = -g * xs + self.xh[:m] + g * self.hist[:m]
                self.xh = np.concatenate([self.xh[m:], xs])
            else:
                ys = xs + g * self.hist[:m]
            out[pos:pos + m] = ys
            self.hist = np.concatenate([self.hist[m:], ys])
            pos += m
        return out


class Chain:
    def __init__(self, rate):
        self.rate = rate
        self.ps = [PitchShifter(rate) for _ in range(3)]            # voix principale + 2 harmonies
        self.fir = FIR()
        self.vib = ModDelay(rate, 40)
        self.chor = ModDelay(rate, 60)
        self.flan = ModDelay(rate, 20)
        self.ring_phase = 0.0
        self.trem_phase = 0.0
        self.echo_hist = np.zeros(int(rate * 0.9) + 1, np.float32)
        self.combs = [Comb(int(rate * s)) for s in (0.0323, 0.0337, 0.0309, 0.0295)]
        self.aps = [Comb(int(rate * 0.0051), True), Comb(int(rate * 0.0126), True)]
        self.gate_g = 1.0
        self.noise = np.random.default_rng(7)
        self.env = 0.0
        self.crush_hold = 0.0
        self.spec = np.zeros(32, np.float32)

    def process(self, x, p):
        n = len(x)
        dry = x
        # porte de bruit (rampe douce)
        rms = float(np.sqrt(np.mean(x * x)) + 1e-9)
        tgt = 1.0 if 20 * math.log10(rms) > p["gate_db"] else 0.0
        g = np.linspace(self.gate_g, tgt, n, dtype=np.float32)
        self.gate_g = tgt
        x = x * g
        # voix principale (+ harmonies)
        y = self.ps[0].process(x, p["pitch"]) if abs(p["pitch"]) > 0.01 else x
        if p["v2_lvl"] > 0:
            y = y + self.ps[1].process(x, p["pitch"] + p["v2_st"]) * (p["v2_lvl"] / 100.0)
        if p["v3_lvl"] > 0:
            y = y + self.ps[2].process(x, p["pitch"] + p["v3_st"]) * (p["v3_lvl"] / 100.0)
        # timbre : courbe de réponse en dB
        tb, pr, lo, hi = p["timbre"], p["presence"], p["lowcut"], p["highcut"]
        if tb or pr or lo or hi:
            def curve(f, tb=tb, pr=pr, lo=lo, hi=hi):
                lf = np.log2(np.maximum(f, 20.0) / 1000.0)
                c = tb * 0.12 * np.clip(lf, -3, 3)                   # inclinaison : ± 36 dB aux extrémités à 100 %
                c += pr * 0.09 * np.exp(-0.5 * ((np.log2(np.maximum(f, 20.0) / 3000.0)) / 0.55) ** 2)
                if lo > 0:
                    c -= 40.0 * np.clip(1.0 - (f / lo) ** 2, 0, 1) ** 0.5 * (f < lo)
                if hi > 0:
                    c -= 40.0 * np.clip(1.0 - (hi / np.maximum(f, 1.0)) ** 2, 0, 1) ** 0.5 * (f > hi)
                return np.clip(c, -45, 24)
            self.fir.set_curve(self.rate, (tb, pr, lo, hi), curve)
            y = self.fir.process(y)
        elif self.fir.key is not None:
            self.fir.key = None
            self.fir.h = None
        t = np.arange(n) / self.rate
        # robot / alien : modulation en anneau
        if p["ring_hz"] > 0 and p["ring_mix"] > 0:
            car = np.sin(2 * np.pi * p["ring_hz"] * t + self.ring_phase).astype(np.float32)
            self.ring_phase = (self.ring_phase + 2 * np.pi * p["ring_hz"] * n / self.rate) % (2 * np.pi)
            m = p["ring_mix"] / 100.0
            y = y * (1 - m) + y * car * m * 1.4
        # vibrato / chœur / flanger
        if p["vib_rate"] > 0 and p["vib_depth"] > 0:
            y = self.vib.process(y, 12.0, 8.0 * p["vib_depth"] / 100.0, p["vib_rate"])
        if p["chorus"] > 0:
            m = p["chorus"] / 100.0
            y = y * (1 - 0.4 * m) + self.chor.process(y, 22.0, 6.0, 0.8) * 0.6 * m
        if p["flanger"] > 0:
            m = p["flanger"] / 100.0
            y = y * (1 - 0.3 * m) + self.flan.process(y, 3.5, 2.8, 0.35) * 0.8 * m
        # trémolo
        if p["trem_rate"] > 0 and p["trem_depth"] > 0:
            d = p["trem_depth"] / 100.0
            lfo = 1.0 - d * 0.5 * (1.0 + np.sin(2 * np.pi * p["trem_rate"] * t + self.trem_phase))
            self.trem_phase = (self.trem_phase + 2 * np.pi * p["trem_rate"] * n / self.rate) % (2 * np.pi)
            y = y * lfo.astype(np.float32)
        # murmure : bruit blanc suivant l'enveloppe de la voix
        if p["whisper"] > 0:
            m = p["whisper"] / 100.0
            env = np.convolve(np.abs(y), np.ones(96, np.float32) / 96.0, mode="same")
            noise = (self.noise.standard_normal(n).astype(np.float32)) * env * 2.4
            y = y * (1 - m) + noise * m
        # bit-crusher
        if p["crush_div"] > 1 or p["crush_bits"] < 16:
            div = int(max(1, p["crush_div"]))
            if div > 1:
                y = np.repeat(y[::div], div)[:n]
            lv = 2.0 ** (int(p["crush_bits"]) - 1)
            y = np.round(y * lv) / lv
        # distorsion
        if p["drive"] > 0:
            k = 1.0 + p["drive"] / 100.0 * 24.0
            y = np.tanh(y * k) / math.tanh(min(k, 3.0))
        # écho
        if p["echo_ms"] > 0 and p["echo_mix"] > 0:
            d = int(self.rate * p["echo_ms"] / 1000.0)
            d = max(n, min(d, len(self.echo_hist) - 1))
            tap = self.echo_hist[-d:-d + n] if d > n else self.echo_hist[-d:]
            if len(tap) < n:
                tap = np.pad(tap, (0, n - len(tap)))
            out = y + tap * (p["echo_fb"] / 100.0)
            self.echo_hist = np.concatenate([self.echo_hist[n:], out.astype(np.float32)])
            y = y + tap * (p["echo_mix"] / 100.0) * 1.2
        # réverbération
        if p["reverb_mix"] > 0:
            gfb = 0.62 + 0.33 * (p["reverb_size"] / 100.0)
            wet = sum(c.process(y, gfb) for c in self.combs) * 0.25
            for a in self.aps:
                wet = a.process(wet, 0.5)
            y = y * (1 - 0.25 * p["reverb_mix"] / 100.0) + wet * (p["reverb_mix"] / 100.0) * 0.9
        # mélange sec / traité, gain, limiteur
        w = p["wet"] / 100.0
        y = dry * (1 - w) + y * w
        y = y * (10.0 ** (p["gain_db"] / 20.0))
        y = np.tanh(y * 0.9) / 0.9 if float(np.max(np.abs(y))) > 0.9 else y
        return np.nan_to_num(y.astype(np.float32), nan=0.0, posinf=0.0, neginf=0.0)


# ====================================================================== moteur temps réel
class Engine:
    def __init__(self):
        self.lock = threading.Lock()
        self.stream = None
        self.mon = None
        self.chain = None
        self.params = dict(NEUTRAL)
        self.preset = ""
        self.bypass = False
        self.running = False
        self.error = ""
        self.lvl_in = 0.0
        self.lvl_out = 0.0
        self.spec = np.zeros(32, np.float32)
        self.wave = np.zeros(64, np.float32)
        self.cfg = {}
        self.rate = RATE_DEFAULT
        self.monq = deque(maxlen=6)
        self.mon_gain = 0.8
        self.cpu = 0.0
        self.started = 0.0
        self.preview_busy = False

    # -- périphériques
    @staticmethod
    def devices():
        import sounddevice as sd
        try:
            apis = sd.query_hostapis()
            devs = sd.query_devices()
        except Exception as e:
            return {"inputs": [], "outputs": [], "error": str(e)}
        wasapi = [i for i, a in enumerate(apis) if "WASAPI" in a["name"]]
        use = wasapi[0] if wasapi else None
        ins, outs = [], []
        for i, d in enumerate(devs):
            if use is not None and d["hostapi"] != use:
                continue
            row = {"id": i, "name": d["name"], "rate": int(d["default_samplerate"])}
            if d["max_input_channels"] > 0:
                ins.append(row)
            if d["max_output_channels"] > 0:
                outs.append(row)
        marks = ("cable input", "vb-audio", "voicemeeter input", "hi-fi cable", "virtual cable", "vac ")
        for o in outs:
            o["virtual"] = any(m in o["name"].lower() for m in marks)
        di = do = None
        try:
            if use is not None:
                di, do = apis[use].get("default_input_device"), apis[use].get("default_output_device")
        except Exception:
            pass
        ids_in, ids_out = {r["id"] for r in ins}, {r["id"] for r in outs}
        di = di if di in ids_in else (ins[0]["id"] if ins else None)
        do = do if do in ids_out else (outs[0]["id"] if outs else None)
        return {"inputs": ins, "outputs": outs, "default_in": di, "default_out": do}

    # -- paramètres en direct
    def set_params(self, preset="", params=None, bypass=None):
        with self.lock:
            if preset and preset in PRESET_BY_ID:
                self.params = dict(PRESET_BY_ID[preset][5])
                self.preset = preset
            if params:
                for k, v in params.items():
                    if k in NEUTRAL:
                        try:
                            self.params[k] = float(v)
                        except (TypeError, ValueError):
                            pass
                if not preset:
                    self.preset = self.preset if self.preset.startswith("user:") else "custom"
            if bypass is not None:
                self.bypass = bool(bypass)

    def _process(self, x):
        t0 = time.perf_counter()
        with self.lock:
            p = dict(self.params)
            byp = self.bypass
        y = x if byp else self.chain.process(x, p)
        self.cpu = 0.9 * self.cpu + 0.1 * (time.perf_counter() - t0) / (len(x) / self.rate)
        self.lvl_in = float(np.sqrt(np.mean(x * x)))
        self.lvl_out = float(np.sqrt(np.mean(y * y)))
        if len(y) >= 256:
            sp = np.abs(np.fft.rfft(y[:512] * np.hanning(min(512, len(y))) if len(y) >= 512 else np.pad(y, (0, 512 - len(y)))))[1:225]
            bands = np.array([sp[int(i * 7): int((i + 1) * 7)].mean() for i in range(32)], np.float32)
            self.spec = np.maximum(self.spec * 0.8, np.log10(1 + bands * 40) / 2.2)
        self.wave = y[:: max(1, len(y) // 64)][:64].copy()
        return y

    # -- démarrage / arrêt
    def start(self, in_dev, out_dev, mon_dev=None, mon_gain=0.8):
        import sounddevice as sd
        self.stop()
        self.error = ""
        try:
            din, dout = sd.query_devices(int(in_dev)), sd.query_devices(int(out_dev))
            self.rate = int(din["default_samplerate"])
            if int(dout["default_samplerate"]) != self.rate:
                self.rate = int(dout["default_samplerate"])
            self.chain = Chain(self.rate)
            block = int(self.rate * BLOCK_SEC)
            extra = None
            try:
                ha = sd.query_hostapis(din["hostapi"])["name"]
                if "WASAPI" in ha:
                    extra = sd.WasapiSettings(auto_convert=True)
            except Exception:
                extra = None
            och = 2 if dout["max_output_channels"] >= 2 else 1
            self.mon_gain = float(mon_gain)
            self.monq.clear()
            want_mon = mon_dev not in (None, "", -1)

            self.outq = deque(maxlen=8)

            def cb_in(indata, frames, tinfo, status):
                x = indata[:, 0].astype(np.float32)
                try:
                    y = self._process(x)
                except Exception as e:                                   # un bug de DSP ne doit jamais couper le micro de l'utilisateur
                    log.warning("DSP : %s", e)
                    y = x
                self.outq.append(y)                                      # file bornée : si la sortie prend du retard, les plus vieux blocs sont jetés (pas de latence qui s'accumule)
                if want_mon:
                    self.monq.append(y)

            def cb_out(outdata, frames, tinfo, status):
                outdata.fill(0)
                if self.outq:
                    y = self.outq.popleft()
                    m = min(len(y), frames)
                    outdata[:m] = np.repeat(y[:m, None], och, axis=1) if och > 1 else y[:m, None]

            exo = extra
            try:
                if "WASAPI" in sd.query_hostapis(dout["hostapi"])["name"]:
                    exo = sd.WasapiSettings(auto_convert=True)
            except Exception:
                pass
            self.stream = sd.InputStream(device=int(in_dev), samplerate=self.rate, blocksize=block, channels=1, dtype="float32", callback=cb_in, extra_settings=extra)
            self.mon = None
            self.outs = sd.OutputStream(device=int(out_dev), samplerate=self.rate, blocksize=block, channels=och, dtype="float32", callback=cb_out, extra_settings=exo)
            self.outs.start()
            self.stream.start()
            if want_mon:
                dm = sd.query_devices(int(mon_dev))
                mch = 2 if dm["max_output_channels"] >= 2 else 1
                try:
                    exm = sd.WasapiSettings(auto_convert=True) if "WASAPI" in sd.query_hostapis(dm["hostapi"])["name"] else None
                except Exception:
                    exm = None

                def mcb(outdata, frames, tinfo, status):
                    outdata.fill(0)
                    if self.monq:
                        y = self.monq.popleft() * self.mon_gain
                        m = min(len(y), frames)
                        outdata[:m] = np.repeat(y[:m, None], mch, axis=1) if mch > 1 else y[:m, None]
                self.mon = sd.OutputStream(device=int(mon_dev), samplerate=self.rate, blocksize=block, channels=mch, dtype="float32", callback=mcb, extra_settings=exm)
                self.mon.start()
            self.running = True
            self.started = time.time()
            self.cfg = {"input": int(in_dev), "output": int(out_dev), "monitor": (int(mon_dev) if want_mon else -1)}
        except Exception as e:
            self.error = str(e)
            log.warning("démarrage impossible : %s", e)
            self.stop()
            raise VoiceModError(f"Impossible d'ouvrir l'audio : {e}")

    def stop(self):
        for s in (self.stream, getattr(self, "outs", None), self.mon):
            try:
                if s:
                    s.stop()
                    s.close()
            except Exception:
                pass
        self.stream = self.mon = self.outs = None
        self.running = False
        self.lvl_in = self.lvl_out = 0.0

    # -- aperçu : enregistre quelques secondes du micro, applique la voix, la rejoue
    def preview(self, in_dev, out_dev, seconds=4.0):
        import sounddevice as sd
        if self.preview_busy:
            raise VoiceModError("Un aperçu est déjà en cours.")
        if self.running:
            raise VoiceModError("Arrête le Voice Changer avant de lancer un aperçu (le micro est déjà utilisé).")

        def job():
            self.preview_busy = True
            try:
                din = sd.query_devices(int(in_dev))
                rate = int(din["default_samplerate"])
                rec = sd.rec(int(rate * seconds), samplerate=rate, channels=1, dtype="float32", device=int(in_dev))
                sd.wait()
                ch = Chain(rate)
                n = int(rate * BLOCK_SEC)
                x = rec[:, 0]
                with self.lock:
                    p = dict(self.params)
                out = np.concatenate([ch.process(x[i:i + n], p) for i in range(0, len(x) - n + 1, n)] or [x])
                dout = sd.query_devices(int(out_dev))
                och = 2 if dout["max_output_channels"] >= 2 else 1
                sd.play(np.repeat(out[:, None], och, axis=1) if och > 1 else out[:, None], samplerate=rate, device=int(out_dev))
                sd.wait()
            except Exception as e:
                self.error = str(e)
            finally:
                self.preview_busy = False
        threading.Thread(target=job, daemon=True).start()

    def state(self):
        return {"running": self.running, "preset": self.preset, "bypass": self.bypass, "params": dict(self.params), "lvl_in": round(self.lvl_in, 4), "lvl_out": round(self.lvl_out, 4),
                "spec": [round(float(v), 3) for v in self.spec], "wave": [round(float(v), 3) for v in self.wave], "cpu": round(self.cpu, 3), "error": self.error,
                "latency_ms": round(BLOCK_SEC * 1000 * 1.5 + 20 + 1000.0 * 256 / max(1, self.rate)), "cfg": self.cfg, "preview": self.preview_busy,
                "uptime": int(time.time() - self.started) if self.running else 0}


class VoiceModError(Exception):
    pass


ENGINE = Engine()


# ====================================================================== sauvegarde (voix perso, dernière configuration)
def _file():
    return os.path.join(nasko_core.data_dir(), "voicemod.json")


def load():
    try:
        with open(_file(), "r", encoding="utf-8") as f:
            d = json.load(f)
            return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def save(d):
    tmp = _file() + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
    os.replace(tmp, _file())


def catalog():
    d = load()
    return {
        "presets": [{"id": p[0], "name": p[1], "cat": p[2], "emoji": p[3], "tag": p[4], "params": p[5]} for p in PRESETS],
        "cats": [{"id": c[0], "name": c[1], "emoji": c[2]} for c in CATS],
        "params": [{"key": k, "label": lb, "group": g, "min": mn, "max": mx, "step": st, "unit": un, "default": NEUTRAL[k]} for k, lb, g, mn, mx, st, un in PARAMS],
        "user": d.get("user", []), "last": d.get("last", {}), "favs": d.get("favs", []),
    }


def save_user(name, params):
    name = str(name or "").strip()[:28]
    if not name:
        raise VoiceModError("Donne un nom à ta voix.")
    clean = {k: float(v) for k, v in (params or {}).items() if k in NEUTRAL}
    d = load()
    users = [u for u in d.get("user", []) if u.get("name") != name][-39:]
    users.append({"id": "user:" + name, "name": name, "params": {**NEUTRAL, **clean}})
    d["user"] = users
    save(d)
    return users


def delete_user(uid):
    d = load()
    d["user"] = [u for u in d.get("user", []) if u.get("id") != uid]
    save(d)
    return d["user"]


def remember(**kw):
    d = load()
    favs = kw.pop("favs", None)
    if favs is not None:
        d["favs"] = [str(x) for x in favs][:60]
    d.setdefault("last", {}).update({k: v for k, v in kw.items() if v is not None})
    save(d)


def user_params(uid):
    for u in load().get("user", []):
        if u.get("id") == uid:
            return u.get("params")
    return None
