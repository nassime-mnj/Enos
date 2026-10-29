"""Profils de style des bots NASKO et LELEX : analyse des parties Chess.com publiques de deux joueurs.

Usage : python build_style.py [--pgn DOSSIER] [--no-sf]
  --pgn : dossier de PGN déjà téléchargés (<pseudo>_<AAAA>-<MM>.pgn) ; sinon téléchargement via l'API publique de Chess.com.
Sortie : android/assets/mobile/data/style_bots.js  (window.ENOS_STYLE = {...}) : pour chaque bot
  - book  : arbre d'ouvertures {chemin UCI: {coup UCI: nombre}} par couleur (profondeur ≤ 16 demi-coups)
  - stats : agressivité (prises, échecs, roque tardif…), longueur moyenne, résultats
  - skill : niveau estimé (Elo) et taux d'erreurs mesurés par Stockfish sur un échantillon de parties
"""
import argparse
import collections
import glob
import io
import json
import os
import random
import re
import sys
import urllib.request

import chess
import chess.engine
import chess.pgn

BOTS = {"nasko": "la_loi_de_fortes", "lelex": "lepoissonsteve80"}
NAMES = {"nasko": "Nasko", "lelex": "Lelex"}
ELO_EST = {"nasko": 1300, "lelex": 1150}      # niveau déclaré par le joueur (Stockfish le situe entre 1200 et 1500) ; Lelex est un peu en dessous

BOOK_PLIES = 16
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "android", "assets", "mobile", "data", "style_bots.js")


def fetch(user, dest):
    ua = {"User-Agent": "ENOS/1.0 (style profile)"}
    req = urllib.request.Request(f"https://api.chess.com/pub/player/{user}/games/archives", headers=ua)
    for url in json.load(urllib.request.urlopen(req, timeout=30))["archives"]:
        ym = "-".join(url.rsplit("/", 2)[-2:])
        with urllib.request.urlopen(urllib.request.Request(url + "/pgn", headers=ua), timeout=60) as r:
            open(os.path.join(dest, f"{user}_{ym}.pgn"), "wb").write(r.read())


def games_of(user, folder):
    for fn in sorted(glob.glob(os.path.join(folder, f"{user}_*.pgn"))):
        with open(fn, encoding="utf-8", errors="replace") as f:
            while True:
                g = chess.pgn.read_game(f)
                if g is None:
                    break
                w, b = g.headers.get("White", "").lower(), g.headers.get("Black", "").lower()
                if user in (w, b) and not g.headers.get("FEN") and g.headers.get("Variant", "Chess") == "Chess":
                    yield g, chess.WHITE if w == user else chess.BLACK


def profile(user, folder, sf):
    book = {"w": collections.defaultdict(collections.Counter), "b": collections.defaultdict(collections.Counter)}
    n = 0
    res = collections.Counter()
    plies_tot = caps = checks = mine = 0
    early_q = late_castle = castled = nocastle = 0
    elos = []
    ecos = {"w": collections.Counter(), "b": collections.Counter()}
    sample = []
    for g, me in games_of(user, folder):
        mv = list(g.mainline_moves())
        if len(mv) < 6:
            continue
        n += 1
        side = "w" if me == chess.WHITE else "b"
        r = g.headers.get("Result", "*")
        res["w" if (r == "1-0") == (me == chess.WHITE) and r != "1/2-1/2" and r != "*" else "d" if r == "1/2-1/2" else "l"] += 1
        try:
            elos.append(int(g.headers.get("WhiteElo" if me == chess.WHITE else "BlackElo", 0)))
        except ValueError:
            pass
        eco = (g.headers.get("ECOUrl") or "").rsplit("/", 1)[-1]
        if eco:
            ecos[side][re.sub(r"-\d.*$", "", eco)] += 1
        b = g.board()
        path = []
        had_castle = False
        for i, m in enumerate(mv):
            if b.turn == me:
                if i < BOOK_PLIES:
                    book[side][" ".join(path)][m.uci()] += 1
                mine += 1
                caps += b.is_capture(m)
                if b.gives_check(m):
                    checks += 1
                if b.is_castling(m):
                    castled += 1
                    had_castle = True
                    late_castle += i // 2 + 1 > 12
                if b.piece_type_at(m.from_square) == chess.QUEEN and i // 2 < 6:
                    early_q += 1
            path.append(m.uci())
            b.push(m)
        nocastle += not had_castle
        plies_tot += len(mv)
        if len(mv) >= 24:
            sample.append((g, me))
    out = {
        "user": user, "games": n, "wdl": [res["w"], res["d"], res["l"]], "avgPlies": round(plies_tot / max(1, n), 1),
        "capRate": round(caps / max(1, mine), 3), "checkRate": round(checks / max(1, mine), 3), "earlyQueen": round(early_q / max(1, n), 3),
        "castleRate": round(castled / max(1, n), 3), "lateCastle": round(late_castle / max(1, n), 3),
        "rating": round(sum(elos) / len(elos)) if elos else 0, "topOpenings": {s: ecos[s].most_common(8) for s in "wb"},
    }
    # on garde les nœuds fréquents : tout en tête de partie, ≥ 2 passages ensuite (le bot sort alors du livre et joue au moteur)
    pruned = {}
    for s in "wb":
        pruned[s] = {p: dict(c.most_common(6)) for p, c in book[s].items() if len(p.split()) < 6 or sum(c.values()) >= 2}
    out["book"] = pruned
    if sf:
        out["skill"] = measure(sf, sample)
    return out


def measure(eng, sample, take=40, plies=24):
    """Perte moyenne (centipions) et taux d'erreurs du joueur, mesurés par Stockfish sur un échantillon de parties."""
    random.seed(7)
    pick = random.sample(sample, min(take, len(sample)))
    loss = []
    for g, me in pick:
        b = g.board()
        mv = list(g.mainline_moves())
        for i, m in enumerate(mv[:plies * 2]):
            if b.turn == me and i >= 8:                                     # on ne juge pas la théorie
                lim = chess.engine.Limit(depth=9)
                a = eng.analyse(b, lim)["score"].pov(me).score(mate_score=2000)
                b.push(m)
                c = eng.analyse(b, lim)["score"].pov(me).score(mate_score=2000)
                loss.append(max(0, min(1000, a - c)))
            else:
                b.push(m)
    if not loss:
        return {}
    acpl = sum(loss) / len(loss)
    return {"acpl": round(acpl), "n": len(loss), "inaccuracy": round(sum(1 for x in loss if 50 <= x < 100) / len(loss), 3),
            "mistake": round(sum(1 for x in loss if 100 <= x < 250) / len(loss), 3), "blunder": round(sum(1 for x in loss if x >= 250) / len(loss), 3)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pgn", default="")
    ap.add_argument("--no-sf", action="store_true")
    a = ap.parse_args()
    folder = a.pgn or os.path.join(HERE, "data", "style")
    os.makedirs(folder, exist_ok=True)
    if not a.pgn:
        for u in BOTS.values():
            fetch(u, folder)
    sf = None
    if not a.no_sf:
        sys.path.insert(0, HERE)
        import nasko_chess as C
        sf = chess.engine.SimpleEngine.popen_uci(C.stockfish_path())
    out = {}
    try:
        for key, user in BOTS.items():
            out[key] = {"name": NAMES[key], "eloEst": ELO_EST[key], **profile(user, folder, sf)}
            print(key, {k: v for k, v in out[key].items() if k not in ("book",)})
    finally:
        if sf:
            sf.quit()
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("window.ENOS_STYLE=" + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print("écrit", OUT, os.path.getsize(OUT) // 1024, "Ko")


if __name__ == "__main__":
    main()
