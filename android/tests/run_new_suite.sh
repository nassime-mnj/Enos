#!/bin/bash
# Régression de la mise à jour 1.15 (échecs hors ligne, Défis, Conseiller, outils natifs) : navigateur, sans pont natif.
# usage : run_new_suite.sh   (PIECE_SETS = dossier des jeux de pièces SVG de lichess-org/lila pour les tests de reconnaissance ; Python 3 + Playwright)
D=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$D/../.." && pwd)
PORT=${MOBILE_PORT:-8802}
python3 -m http.server $PORT --directory "$ROOT/android/assets/mobile" >/dev/null 2>&1 & M=$!
python3 -m http.server 8803 --directory "$ROOT/static/learn" >/dev/null 2>&1 & P=$!
python3 -m http.server 8806 --directory "$ROOT" >/dev/null 2>&1 & R=$!
sleep 1.5
cd "$D"
for t in t_brain t_defis t_native_modules t_learn; do echo "== $t"; python3 -W ignore $t.py 2>&1 | tail -3; done
if [ -n "$PIECE_SETS" ]; then
  for t in t_advisor t_scanlearn t_pc_learn t_pc_scan; do echo "== $t"; python3 -W ignore $t.py 2>&1 | tail -3; done
  echo "== t_boardscan lib"; NB=1 python3 -W ignore t_boardscan.py lib 2>&1 | tail -6
fi
kill $M $P $R 2>/dev/null
