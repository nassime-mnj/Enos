"""Prépare les données d'apprentissage d'échecs (puzzles + ouvertures) à partir des bases LIBRES de Lichess (CC0).

Usage : python build_learn_data.py <dossier_telechargements>
  puzzle.csv.zst  <- https://database.lichess.org/lichess_db_puzzle.csv.zst
  a.tsv .. e.tsv  <- https://github.com/lichess-org/chess-openings (dossier raw)
Sortie : android/assets/mobile/data/learn_puzzles.js et learn_openings.js (scripts classiques : file:// interdit fetch/modules),
puis copie tout (données + m_learn.js, plateau, sons, pièces) dans static/learn/ pour la version PC : la source reste android/assets/mobile.
`python build_learn_data.py --sync` ne refait que la copie (après une modification de m_learn.js). Outil de développement : zstandard n'est PAS embarqué dans ENOS.exe.
"""
import csv, io, json, os, random, re, shutil, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
MOBILE = os.path.join(ROOT, "android", "assets", "mobile")
PC = os.path.join(ROOT, "static", "learn")
OUT_DIRS = [os.path.join(MOBILE, "data")]
PER_BUCKET = 38                      # puzzles gardés par (tranche de 100 Elo x thème principal)
MIN_PLAYS, MIN_POP = 400, 85
# thèmes enseignés (id Lichess -> libellé français) ; l'ordre fixe l'indice stocké dans les puzzles
THEMES = {
    "mateIn1": "Mat en 1", "mateIn2": "Mat en 2", "mateIn3": "Mat en 3", "fork": "Fourchette", "pin": "Clouage", "skewer": "Enfilade",
    "discoveredAttack": "Attaque à la découverte", "hangingPiece": "Pièce en prise", "trappedPiece": "Pièce piégée", "sacrifice": "Sacrifice",
    "backRankMate": "Mat du couloir", "smotheredMate": "Mat étouffé", "deflection": "Déviation", "attraction": "Attraction", "clearance": "Dégagement",
    "intermezzo": "Coup intermédiaire", "doubleCheck": "Double échec", "quietMove": "Coup tranquille", "endgame": "Finale", "advancedPawn": "Pion avancé",
    "promotion": "Promotion", "zugzwang": "Zugzwang", "defensiveMove": "Défense", "exposedKing": "Roi exposé", "xRayAttack": "Rayons X",
    "capturingDefender": "Prise du défenseur", "interference": "Interférence", "kingsideAttack": "Attaque à l'aile roi", "queensideAttack": "Attaque à l'aile dame",
    "opening": "Ouverture", "middlegame": "Milieu de partie", "short": "Court", "long": "Long", "crushing": "Écrasant", "advantage": "Avantage", "equality": "Égalité",
}
KEEP = list(THEMES)


def puzzles(path):
    import zstandard
    rnd = random.Random(1337)
    buckets = {}
    with open(path, "rb") as fh, zstandard.ZstdDecompressor().stream_reader(fh) as rd:
        for row in csv.DictReader(io.TextIOWrapper(rd, encoding="utf-8")):
            try:
                rating, pop, plays = int(row["Rating"]), int(row["Popularity"]), int(row["NbPlays"])
            except ValueError:
                continue
            if plays < MIN_PLAYS or pop < MIN_POP:
                continue
            th = [t for t in row["Themes"].split() if t in THEMES]
            if not th:
                continue
            main = next((t for t in th if t not in ("opening", "middlegame", "endgame", "short", "long", "crushing", "advantage", "equality")), th[0])
            buckets.setdefault((rating // 100, main), []).append((row["PuzzleId"], row["FEN"], row["Moves"], rating, th, row["OpeningTags"].split()[0] if row["OpeningTags"] else ""))
    out = []
    for key in sorted(buckets):
        lst = buckets[key]
        rnd.shuffle(lst)
        out += lst[:PER_BUCKET]
    out.sort(key=lambda p: p[3])
    return out


def openings(folder):
    seen, out = set(), []
    for f in "abcde":
        with open(os.path.join(folder, f + ".tsv"), encoding="utf-8") as fh:
            for row in csv.DictReader(fh, delimiter="\t"):
                moves = re.sub(r"\d+\.\s*", "", row["pgn"]).split()
                key = " ".join(moves)
                if key in seen:
                    continue
                seen.add(key)
                out.append([row["eco"], row["name"], key])
    return out


def write(name, var, data):
    for d in OUT_DIRS:
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, name), "w", encoding="utf-8") as fh:
            fh.write("window." + var + "=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n")


def sync_pc():
    """Copie les fichiers partagés mobile -> PC (m_learn.js est le même code des deux côtés)."""
    files = [("vendor/chess.js", "chess.js"), ("js/chess_sounds_data.js", "chess_sounds_data.js"), ("js/chess_sound.js", "chess_sound.js"),
             ("js/board.js", "board.js"), ("js/m_learn.js", "m_learn.js"), ("css/chess.css", "chess.css"),
             ("data/learn_puzzles.js", "data/learn_puzzles.js"), ("data/learn_openings.js", "data/learn_openings.js"),
             # Conseiller brillants (chargé à la demande par pc_boot.js) : moteur, cerveau, reconnaissance de capture d'écran
             ("vendor/stockfish_src.js", "stockfish_src.js"), ("js/chess_local.js", "chess_local.js"), ("js/chess_brain.js", "chess_brain.js"),
             ("js/chess_tools.js", "chess_tools.js"), ("js/chess_course.js", "chess_course.js"), ("js/board_scan.js", "board_scan.js"), ("js/m_advisor.js", "m_advisor.js"), ("data/piece_model.js", "data/piece_model.js")]
    files += [("img/chess/" + n, "img/chess/" + n) for n in os.listdir(os.path.join(MOBILE, "img", "chess")) if n.endswith(".png")]
    for a, b in files:
        os.makedirs(os.path.dirname(os.path.join(PC, b)), exist_ok=True)
        shutil.copyfile(os.path.join(MOBILE, a), os.path.join(PC, b))
    print(len(files), "fichiers copiés dans static/learn")


if __name__ == "__main__":
    if sys.argv[1:] == ["--sync"]:
        sync_pc()
        raise SystemExit(0)
    src = sys.argv[1]
    P = puzzles(os.path.join(src, "puzzle.csv.zst"))
    ids = {t: i for i, t in enumerate(KEEP)}
    write("learn_puzzles.js", "ENOS_PUZZLES", {
        "themes": [[t, THEMES[t]] for t in KEEP],
        "p": [[p[0], p[1], p[2], p[3], [ids[t] for t in p[4]], p[5]] for p in P],
    })
    O = openings(src)
    write("learn_openings.js", "ENOS_OPENINGS", O)
    print(len(P), "puzzles,", len(O), "ouvertures")
    sync_pc()
