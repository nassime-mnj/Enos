"""Échecs autonomes : pas de nulle par répétition, coup brillant prioritaire, triple répétition détectée (chess_local.js + Stockfish.js dans un Worker)."""
from mobile_common import *

START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
# Piège de Légal : après 4...g6 les Blancs jouent Cxe5 ! (sacrifice de dame : Fxd1 Fxf7+ Re7 Cd5#)
LEGAL = "rn1qkbnr/ppp2p1p/3p2p1/4p3/2B1P1b1/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 0 5"

errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw)
    pg = open_app(ctx, errs)
    ev = pg.evaluate

    # ---------------------------------------------------------------- détection (règles pures)
    seen = ev("""() => { let s = ENOS.chessLocal.startSeen(%r); const ch = new Chess(%r);
      for (const m of ['g1f3', 'g8f6', 'f3g1']) { ch.move({from: m.slice(0, 2), to: m.slice(2, 4)}); s = ENOS.chessLocal.addSeen(s, ch.fen()); }
      return s; }""" % (START, START))
    shuffled = ev("""() => { const ch = new Chess(%r); for (const m of ['g1f3', 'g8f6', 'f3g1']) ch.move({from: m.slice(0, 2), to: m.slice(2, 4)}); return ch.fen(); }""" % START)
    check(ev("([f, s]) => ENOS.chessLocal.drawAfter(f, 'f6g8', s)", [shuffled, seen]) == "répétition", "Cf6-g8 ramène la position initiale : répétition détectée")
    check(ev("([f, s]) => ENOS.chessLocal.drawAfter(f, 'e7e5', s)", [shuffled, seen]) == "", "e7-e5 : aucune nulle")
    check(ev("() => ENOS.chessLocal.drawAfter('k7/8/1K6/8/8/8/8/2Q5 w - - 0 1', 'c1c7', {})") == "pat", "pat détecté")
    check(ev("() => ENOS.chessLocal.drawAfter('7k/8/5K2/8/8/8/8/6Q1 w - - 0 1', 'g1g7', {})") == "", "un mat n'est pas une nulle")

    # ---------------------------------------------------------------- pick : esquive tant que la partie est tenue
    def pick(lines, d, fen=shuffled, s=seen):
        return ev("""async ([f, l, d, s]) => ENOS.chessLocal.pick(f, l, d, s, null)""", [fen, lines, d, s])
    ln = lambda u, cp, mate=None: {"uci": u, "cp": cp, "mate": mate}
    r = pick([ln("f6g8", 20), ln("e7e5", 0), ln("d7d5", -200)], "f6g8")
    check(r["uci"] == "e7e5" and r["why"] == "répétition", "égalité : la répétition est esquivée : %s" % r)
    r = pick([ln("f6g8", 20), ln("e7e5", -400)], "f6g8")
    check(r["uci"] == "f6g8" and r["why"] == "", "jamais perdre pour éviter la nulle (alternative perdante refusée)")
    r = pick([ln("f6g8", -300), ln("e7e5", -310)], "f6g8")
    check(r["uci"] == "f6g8", "position perdante : la nulle vaut mieux qu'une défaite")
    r = pick([ln("f6g8", 700), ln("e7e5", 450), ln("d7d5", 200)], "f6g8")
    check(r["uci"] == "e7e5", "position gagnante : on paie 2,5 pions pour éviter la nulle et on reste gagnant")
    r = pick([ln("f6g8", 10000, 3), ln("e7e5", 0)], "e7e5")
    check(r["uci"] == "f6g8", "un mat forcé n'est jamais échangé")

    # ---------------------------------------------------------------- coup brillant : sacrifice de dame du piège de Légal (ligne donnée, sans moteur)
    sac = ev("""async () => { const L = ENOS.chessLocal; const lines = [{uci: 'c3e5', pv: ['c3d5'], cp: 0, mate: null}];
      return typeof L.sacrificeOf === 'function' ? L.sacrificeOf(%r, ['f3e5', 'g4d1', 'c4f7']) : null; }""" % LEGAL)
    check(sac and sac["piece"] == "dame" and sac["deficit"] >= 2, "sacrifice de dame reconnu : %s" % sac)
    nosac = ev("() => ENOS.chessLocal.sacrificeOf(%r, ['e2e4', 'e7e5', 'g1f3'])" % START)
    check(nosac is None, "un coup d'ouverture n'est pas un sacrifice")

    # ---------------------------------------------------------------- moteur réel : un coup légal, jamais une répétition quand une alternative existe
    r = ev("""async ([f, s]) => ENOS.chessLocal.choose(f, 100, s, {ms: 500})""", [shuffled, seen])
    check(r and r["uci"] and r["uci"] != "f6g8", "Stockfish à pleine puissance évite Cg8 (répétition) : joue %s" % (r and r["uci"]))
    r = ev("""async ([f, s]) => ENOS.chessLocal.choose(f, 20, s, {})""", [shuffled, seen])
    check(r and r["uci"], "niveau faible : un coup légal (%s)" % (r and r["uci"]))
    r = ev("""async (f) => ENOS.chessLocal.call('/play', {fen: f, uci: 'e2e4', power: 100, answer: true})""", START)
    check(r["san"] == "e4" and r["reply"] and r["seen"], "route /play : réponse + passages mis à jour")

    # ---------------------------------------------------------------- triple répétition détectée par la route d'état
    st = ev("""async (f) => { let s = ENOS.chessLocal.startSeen(f); const ch = new Chess(f);
      for (const m of ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8']) { ch.move({from: m.slice(0, 2), to: m.slice(2, 4)}); s = ENOS.chessLocal.addSeen(s, ch.fen()); }
      return ENOS.chessLocal.call('/state', {fen: ch.fen(), seen: s}); }""", START)
    check("répétition" in st["over"].lower(), "triple répétition annoncée : %s" % st["over"])
    check(not errs, "aucune erreur JavaScript : %s" % errs[:2])
    b.close()
import sys
sys.exit(1 if BAD else 0)
