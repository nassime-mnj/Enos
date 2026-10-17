#!/bin/bash
# usage: start.sh <script.py>  (Linux/macOS/WSL ; nécessite playwright + chromium : pip install playwright) — lance l'API Dual Pulse (8800) + l'UI du Launcher (8801), amorce les données, exécute le test, puis arrête tout
D=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$D/../../.." && pwd)
fuser -k 8800/tcp 8801/tcp >/dev/null 2>&1; for i in $(seq 1 30); do (ss -ltn | grep -qE ':(8800|8801) ') || break; sleep 0.3; done
rm -rf /tmp/dpl_e2e; mkdir -p /tmp/dpl_e2e/store
python3 $D/gen.py && source /tmp/dpl_e2e_env
(cd $ROOT/dualpulse_site && python3 -m uvicorn app.main:app --port 8800 --log-level warning > /tmp/dpl_e2e/api.log 2>&1 & echo $! > /tmp/dpl_e2e/api.pid)
(python3 -m http.server 8801 --directory $ROOT/launcher/ui > /tmp/dpl_e2e/ui.log 2>&1 & echo $! > /tmp/dpl_e2e/ui.pid)
for i in $(seq 1 30); do curl -s localhost:8800/healthz >/dev/null && curl -s localhost:8801/ >/dev/null && break; sleep 0.5; done
python3 $D/seed.py || { cat /tmp/dpl_e2e/api.log | tail -20; }
cd $D && timeout 200 python3 -W ignore "$1" 2>&1 | tail -${2:-80}
fuser -k 8800/tcp 8801/tcp >/dev/null 2>&1
