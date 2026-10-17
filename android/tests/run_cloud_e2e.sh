#!/bin/bash
# usage: run_cloud_e2e.sh <script.py> — API Dual Pulse réelle (8800, SQLite temporaire) + application mobile en navigateur (8802) + test Playwright
D=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$D/../.." && pwd)
fuser -k 8800/tcp 8802/tcp >/dev/null 2>&1; sleep 1
rm -rf /tmp/dpl_e2e; mkdir -p /tmp/dpl_e2e/store
python3 "$ROOT/launcher/tests/e2e/gen.py" && source /tmp/dpl_e2e_env
(cd "$ROOT/dualpulse_site" && python3 -m uvicorn app.main:app --port 8800 --log-level warning > /tmp/dpl_e2e/api.log 2>&1 &)
(python3 -m http.server 8802 --directory "$ROOT/android/assets/mobile" > /tmp/dpl_e2e/ui.log 2>&1 &)
for i in $(seq 1 30); do curl -s localhost:8800/healthz >/dev/null && curl -s localhost:8802/ >/dev/null && break; sleep 0.5; done
python3 "$ROOT/launcher/tests/e2e/seed.py" || tail -20 /tmp/dpl_e2e/api.log
cd "$D" && timeout ${E2E_TIMEOUT:-200} python3 -W ignore "$1" 2>&1 | tail -${2:-80}
fuser -k 8800/tcp 8802/tcp >/dev/null 2>&1
