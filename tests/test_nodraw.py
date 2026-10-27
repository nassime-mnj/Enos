"""Pas de nulle par répétition, pas de défaite (nasko_nodraw). Lancer : python tests/test_nodraw.py"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import chess  # noqa: E402

import nasko_nodraw as N  # noqa: E402


def line(board, uci, cp, mate=None):
    return {"move": chess.Move.from_uci(uci), "cp": cp, "mate": mate}


def shuffled():
    b = chess.Board()
    for m in ("g1f3", "g8f6", "f3g1"):
        b.push_uci(m)
    return b                                       # f6g8 ramènerait la position initiale (déjà vue une fois)


class DrawAfter(unittest.TestCase):
    def test_repetition(self):
        self.assertEqual(N.draw_after(shuffled(), chess.Move.from_uci("f6g8")), "répétition")
        self.assertEqual(N.draw_after(shuffled(), chess.Move.from_uci("e7e5")), "")

    def test_board_untouched(self):
        b = shuffled()
        fen, n = b.fen(), len(b.move_stack)
        N.draw_after(b, chess.Move.from_uci("f6g8"))
        self.assertEqual((b.fen(), len(b.move_stack)), (fen, n))

    def test_mate_is_not_a_draw(self):
        self.assertEqual(N.draw_after(chess.Board("7k/8/5K2/8/8/8/8/6Q1 w - - 0 1"), chess.Move.from_uci("g1g7")), "")

    def test_stalemate(self):
        b = chess.Board("k7/8/1K6/8/8/8/8/2Q5 w - - 0 1")
        self.assertEqual(N.draw_after(b, chess.Move.from_uci("c1c7")), "pat")

    def test_insufficient(self):
        b = chess.Board("k7/8/8/8/8/8/1r6/K1B5 w - - 0 1")
        self.assertEqual(N.draw_after(b, chess.Move.from_uci("c1b2")), "matériel insuffisant")

    def test_fifty_guard(self):
        b = chess.Board("k7/8/8/8/8/8/8/K6R w - - 90 80")
        self.assertEqual(N.draw_after(b, chess.Move.from_uci("h1h2")), "50 coups")
        self.assertEqual(N.draw_after(chess.Board("k7/8/8/8/8/8/P7/K6R w - - 90 80"), chess.Move.from_uci("a2a3")), "")


class Pick(unittest.TestCase):
    def test_keeps_safe_move(self):
        b = chess.Board()
        mv, why = N.pick(b, [line(b, "e2e4", 30), line(b, "d2d4", 25)], chess.Move.from_uci("e2e4"))
        self.assertEqual((mv.uci(), why), ("e2e4", ""))

    def test_dodges_repetition_when_equal(self):
        b = shuffled()
        mv, why = N.pick(b, [line(b, "f6g8", 20), line(b, "e7e5", 0), line(b, "d7d5", -200)])
        self.assertEqual((mv.uci(), why), ("e7e5", "répétition"))

    def test_never_throws_game_away(self):
        b = shuffled()
        mv, why = N.pick(b, [line(b, "f6g8", 20), line(b, "e7e5", -400)])      # la seule alternative perd : on garde la nulle
        self.assertEqual((mv.uci(), why), ("f6g8", ""))

    def test_losing_position_accepts_draw(self):
        b = shuffled()
        mv, why = N.pick(b, [line(b, "f6g8", -300), line(b, "e7e5", -310)])
        self.assertEqual((mv.uci(), why), ("f6g8", ""))

    def test_winning_position_pays_for_a_win(self):
        b = shuffled()
        mv, why = N.pick(b, [line(b, "f6g8", 700), line(b, "e7e5", 450), line(b, "d7d5", 200)])
        self.assertEqual(mv.uci(), "e7e5")
        mv, why = N.pick(b, [line(b, "f6g8", 700), line(b, "d7d5", 200)])      # 500 cp cédés : on est encore gagnant mais la limite (350) est dépassée
        self.assertEqual((mv.uci(), why), ("f6g8", ""))

    def test_forced_mate_kept(self):
        b = shuffled()
        mv, why = N.pick(b, [line(b, "f6g8", 10000, 3), line(b, "e7e5", 0)], chess.Move.from_uci("e7e5"))
        self.assertEqual((mv.uci(), why), ("f6g8", ""))

    def test_more_lines_called_only_when_needed(self):
        b = shuffled()
        calls = []

        def more():
            calls.append(1)
            return [line(b, "c7c5", 5)]
        mv, why = N.pick(b, [line(b, "f6g8", 20)], more=more)
        self.assertEqual((mv.uci(), why, len(calls)), ("c7c5", "répétition", 1))
        calls.clear()
        N.pick(chess.Board(), [line(chess.Board(), "e2e4", 20)], more=more)
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
