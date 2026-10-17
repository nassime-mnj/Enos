"""Fixe la plateforme vue par E.N.O.S. (nasko_wsl.system) pendant un test, quel que soit le système qui exécute la suite.

Les tests de la voie WSL (chemins \\\\wsl.localhost\\…, wsl.exe, base64) décorent leur classe avec @windows ; ceux du mode natif décorent avec @linux.
Sans cela, la suite donnerait des résultats différents sur le PC Windows du CEO et sur le Linux du cloud."""
import os
import sys
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import nasko_wsl  # noqa: E402


def _pin(name):
    return mock.patch.object(nasko_wsl, "system", new=lambda: name)        # `new` : aucun argument supplémentaire n'est injecté dans les méthodes de test


windows = _pin("Windows")
linux = _pin("Linux")
