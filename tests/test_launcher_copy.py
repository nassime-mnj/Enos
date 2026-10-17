"""Textes du Launcher visibles par tous les profils : le pitch de TERNA ne doit jamais citer E.N.O.S. (nom réservé à l'équipe de développement)."""
import re, subprocess, sys, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent


class T(unittest.TestCase):
    def test_terna_pitch_does_not_name_enos(self):
        js = (ROOT / "launcher" / "ui" / "js" / "config.js").read_text(encoding="utf-8")
        m = re.search(r"export const TERNA_PITCH = \{(.*?)\n\};", js, re.S)
        self.assertTrue(m, "TERNA_PITCH introuvable")
        self.assertNotRegex(m.group(1), r"(?i)e\.?n\.?o\.?s")
        self.assertIn("the Core", m.group(1))
        fallback = re.search(r"export const FALLBACK_NEWS = \[(.*?)\n\];", js, re.S).group(1)
        self.assertNotRegex(fallback, r"(?i)e\.?n\.?o\.?s")                        # bannières par défaut : jamais le nom non plus


if __name__ == "__main__":
    unittest.main()
