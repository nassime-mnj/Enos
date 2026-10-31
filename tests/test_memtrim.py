"""nasko_memtrim : rend bien de la RAM a Windows apres une grosse allocation, sans casser les donnees gardees."""
import os
import sys
import time

import psutil

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import nasko_memtrim as mt

if os.name != "nt":
    print("ignore hors Windows")
    sys.exit(0)
pool = [bytes(150) + bytes([i % 251]) for i in range(1_500_000)]    # millions de petits objets : le tas Python se fragmente
keep = pool[::40]                                                  # on en garde 2,5 % : les arenes restent partiellement occupees
me = psutil.Process()
peak = me.memory_info().rss / 1e6
del pool
time.sleep(0.2)
before = me.memory_info().rss / 1e6
freed = mt.trim_now(children=False)
after = me.memory_info().rss / 1e6
print("pic %.0f Mo, apres liberation %.0f Mo, apres trim %.0f Mo (rendu %.0f Mo)" % (peak, before, after, freed))
assert after < before - 30, "le nettoyage doit rendre au moins 30 Mo"
assert all(len(b) == 151 for b in keep), "donnees gardees intactes"
assert mt.status()["runs"] == 1
print("OK")
