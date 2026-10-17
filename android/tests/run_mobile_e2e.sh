#!/bin/bash
# usage: run_mobile_e2e.sh <script.py> — sert android/assets/mobile sur http://127.0.0.1:${MOBILE_PORT:-8802} (navigateur, sans pont natif), exécute le test Playwright, arrête le serveur
D=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$D/../.." && pwd)
PORT=${MOBILE_PORT:-8802}
fuser -k $PORT/tcp >/dev/null 2>&1; sleep 0.5
python3 -m http.server $PORT --directory "$ROOT/android/assets/mobile" > /tmp/mobile_http_$PORT.log 2>&1 &
PID=$!
for i in $(seq 1 20); do curl -s localhost:$PORT/ >/dev/null && break; sleep 0.3; done
cd "$D" && timeout 240 python3 -W ignore "$1" 2>&1 | tail -${2:-80}
kill $PID 2>/dev/null
