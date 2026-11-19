"""Faux OpenRouter pour les tests (aucun appel réel) : API de gestion des clés (/api/v1/keys, clé de gestion « mgmt-test ») et chat compatible OpenAI en flux SSE.
Lancer : python fake_openrouter.py PORT ; GET /_state renvoie l'état (clés vivantes, dernier appel de chat)."""
import json, sys, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

KEYS, LOCK, LAST = {}, threading.Lock(), {}
N = [0]


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0); return json.loads(self.rfile.read(n) or b"{}")

    def _mgmt(self):
        if self.headers.get("Authorization") != "Bearer mgmt-test":
            self._send(401, {"error": {"message": "bad management key"}}); return False
        return True

    def do_GET(self):
        if self.path == "/_state":
            return self._send(200, {"keys": {h: {k: v for k, v in d.items() if k != "key"} for h, d in KEYS.items()}, "last_chat": LAST})
        if self.path.startswith("/api/v1/keys/") and self._mgmt():
            h = self.path.rsplit("/", 1)[-1]
            return self._send(200, {"data": KEYS[h]}) if h in KEYS else self._send(404, {"error": "not found"})

    def do_DELETE(self):
        if self.path.startswith("/api/v1/keys/") and self._mgmt():
            h = self.path.rsplit("/", 1)[-1]
            with LOCK:
                ok = KEYS.pop(h, None)
            return self._send(200, {"deleted": True}) if ok else self._send(404, {"error": "not found"})

    def do_PATCH(self):
        if self.path.startswith("/api/v1/keys/") and self._mgmt():
            h = self.path.rsplit("/", 1)[-1]
            if h not in KEYS:
                return self._send(404, {"error": "not found"})
            KEYS[h].update(self._body()); return self._send(200, {"data": {k: v for k, v in KEYS[h].items() if k != "key"}})

    def do_POST(self):
        if self.path == "/api/v1/keys":
            if not self._mgmt():
                return
            b = self._body()
            with LOCK:
                N[0] += 1; h = "hash%03d" % N[0]; key = "sk-or-v1-" + ("%064x" % (N[0] * 7919))
                KEYS[h] = {"hash": h, "name": b.get("name"), "limit": b.get("limit"), "limit_reset": b.get("limit_reset"), "disabled": False, "usage": 0.42, "limit_remaining": (b.get("limit") or 0) - 0.42, "key": key}
            return self._send(201, {"data": {k: v for k, v in KEYS[h].items() if k != "key"}, "key": key})
        if self.path == "/api/v1/chat/completions":
            b = self._body(); auth = self.headers.get("Authorization", "")
            live = [d for d in KEYS.values() if "Bearer " + d["key"] == auth]
            LAST.update(model=b.get("model"), key_ok=bool(live), disabled=bool(live and live[0]["disabled"]), reasoning=b.get("reasoning"), auth_tail=auth[-6:])
            if not live or live[0]["disabled"]:
                return self._send(401, {"error": {"message": "User not found or key disabled."}})
            self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.end_headers()
            for part in ["Bonjour ", "depuis ", "ETO Gateway."]:
                self.wfile.write(("data: " + json.dumps({"choices": [{"delta": {"content": part}}]}) + "\n\n").encode()); self.wfile.flush()
            self.wfile.write(b"data: [DONE]\n\n"); return


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
