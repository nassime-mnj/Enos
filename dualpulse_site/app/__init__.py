"""Site Dual Pulse. La racine du site (dossier contenant content.py) est ajoutée au chemin d'import : « import content » fonctionne
quel que soit le dossier depuis lequel uvicorn est lancé."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
