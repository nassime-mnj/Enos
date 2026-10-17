"""Relais de reveil E.N.O.S. : a lancer sur un appareil TOUJOURS ALLUME du reseau local (Raspberry Pi, NAS, mini-PC...).

Il sert une page « ALLUMER » (telephone / web) qui envoie le paquet magique Wake-on-LAN au PC, affiche son etat
(ETEINT / DEMARRAGE / EN LIGNE) puis ouvre E.N.O.S. quand le PC repond.

    py wake_relay.py                  (lit relay_config.json a cote du script)
    py wake_relay.py --cert c.pem --key k.pem     (HTTPS optionnel)

A joindre depuis l'exterieur UNIQUEMENT par un VPN (Tailscale/WireGuard) : ne redirigez jamais ce port sur Internet.
Dependances : Python 3.8+, bibliotheque standard (+ nasko_wake.py a cote).
"""
import argparse
import hashlib
import json
import logging
import os
import secrets
import ssl
import sys
import threading
import time
from datetime import datetime
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import nasko_wake

HERE = os.path.dirname(os.path.abspath(__file__))
CFG_PATH = os.path.join(HERE, "relay_config.json")
DEV_PATH = os.path.join(HERE, "relay_devices.json")
COOKIE = "wake_device"
log = logging.getLogger("relais")
lock = threading.Lock()
FAILS, LAST = {}, {"wake": 0.0, "sent": None}


def load_cfg():
    with open(CFG_PATH, encoding="utf-8-sig") as f:
        cfg = json.load(f)
    cfg.setdefault("broadcast", ["255.255.255.255"])
    cfg.setdefault("pc_port", 8443)
    cfg.setdefault("listen_host", "0.0.0.0")
    cfg.setdefault("listen_port", 8088)
    return cfg


def _h(token):
    return hashlib.sha256(token.encode()).hexdigest()


def _devices():
    try:
        with open(DEV_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _save(devs):
    tmp = DEV_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(devs, f, indent=1)
    os.replace(tmp, DEV_PATH)


PAGE = r"""<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#000000">
<title>E.N.O.S. — Réveil</title>
<style>
:root{--n:#00ff41;--m:#00b52c;--d:#0b5a22;--a:#ffb000;--r:#ff2a6d}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:#000;color:var(--n);font:15px/1.5 Consolas,"Courier New",monospace}
body{display:grid;place-items:center;padding:16px;background:radial-gradient(ellipse at 50% 30%,#032a10,#000 70%);overflow:hidden}
.grid{position:fixed;left:-50%;right:-50%;bottom:-6%;height:55%;background:linear-gradient(#00ff4133 1px,transparent 1px) 0 0/100% 50px,linear-gradient(90deg,#00ff4126 1px,transparent 1px) 0 0/50px 100%;transform:perspective(500px) rotateX(64deg);transform-origin:50% 100%;animation:g 2.8s linear infinite;-webkit-mask-image:linear-gradient(transparent,#000 60%);mask-image:linear-gradient(transparent,#000 60%)}
@keyframes g{to{background-position:0 50px,50px 0}}
main{position:relative;width:min(420px,100%);text-align:center}
h1{margin:0 0 4px;font-size:22px;letter-spacing:6px;text-shadow:0 0 14px var(--n)}
.sub{color:var(--d);font-size:11px;letter-spacing:3px;margin-bottom:26px}
#pw{position:relative;width:200px;height:200px;margin:0 auto 18px;border-radius:50%;border:2px solid var(--d);background:#010a03;color:var(--n);cursor:pointer;display:grid;place-items:center;transition:all .4s;--c:var(--n)}
#pw svg{width:78px;height:78px;stroke:currentColor;fill:none;stroke-width:2.2;stroke-linecap:round;filter:drop-shadow(0 0 8px currentColor)}
#pw::before,#pw::after{content:"";position:absolute;inset:-10px;border-radius:50%;border:2px solid var(--c);opacity:0}
body.off #pw{color:var(--n)}body.off #pw:hover{box-shadow:0 0 40px #00ff4166,inset 0 0 30px #00ff4122;border-color:var(--n)}
body.boot #pw{--c:var(--a);color:var(--a);border-color:var(--a);box-shadow:0 0 36px #ffb00066}body.boot #pw::before{animation:w 1.8s ease-out infinite}body.boot #pw::after{animation:w 1.8s ease-out .9s infinite}
body.on #pw{border-color:var(--n);box-shadow:0 0 50px #00ff41aa,inset 0 0 40px #00ff4144;animation:p 2s ease-in-out infinite}
@keyframes w{from{transform:scale(.92);opacity:.8}to{transform:scale(1.4);opacity:0}}@keyframes p{50%{box-shadow:0 0 70px #00ff41,inset 0 0 50px #00ff4166}}
#st{font-size:18px;letter-spacing:4px;min-height:28px;text-shadow:0 0 10px currentColor}body.boot #st{color:var(--a)}body.err #st{color:var(--r)}
#msg{color:var(--m);font-size:13px;min-height:44px;margin:6px 0 14px}
a.go,button.go{display:none;width:100%;padding:14px;font:800 16px Consolas,monospace;letter-spacing:4px;color:#000;background:var(--n);border:0;text-decoration:none;cursor:pointer;box-shadow:0 0 30px #00ff4199}
body.on a.go{display:block}
.box{border:2px solid var(--d);padding:22px;background:#000000d0}input{width:100%;padding:12px;margin:10px 0;background:#010a03;color:var(--n);border:2px solid var(--d);font:20px Consolas,monospace;letter-spacing:4px;text-transform:uppercase;outline:0}
[hidden]{display:none!important}.meta{margin-top:18px;color:var(--d);font-size:11px;letter-spacing:1px}
</style></head><body class="off"><div class="grid"></div>
<main>
 <h1>E.N.O.S.</h1><div class="sub">RELAIS DE RÉVEIL</div>
 <form class="box" id="lf" hidden><div>Code d'accès du relais</div><input id="code" autocomplete="off" autocapitalize="characters"><button class="go" style="display:block;color:#000">CONNEXION</button><div id="lerr" style="color:var(--r);margin-top:8px"></div></form>
 <section id="app" hidden>
  <button id="pw" aria-label="Allumer le PC"><svg viewBox="0 0 24 24"><path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/></svg></button>
  <div id="st">…</div><div id="msg"></div>
  <a class="go" id="open" href="#">OUVRIR E.N.O.S. ▸</a>
  <div class="meta" id="meta"></div>
 </section>
</main>
<script>
const KEY="wake_device",$=id=>document.getElementById(id);let cfg={};
async function post(u,b){return fetch(u,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b||{})})}
function show(auth){$("lf").hidden=auth;$("app").hidden=!auth}
async function boot(){let t=null;try{t=localStorage.getItem(KEY)}catch(e){}
 let r=await fetch("/api/status");
 if(r.status===401&&t){const l=await post("/login-token",{token:t});if(l.ok)r=await fetch("/api/status");else try{localStorage.removeItem(KEY)}catch(e){}}
 if(r.ok){show(true);apply(await r.json());poll()}else show(false)}
$("lf").onsubmit=async e=>{e.preventDefault();const r=await post("/login",{code:$("code").value});
 if(r.ok){const d=await r.json();try{localStorage.setItem(KEY,d.token)}catch(x){}location.reload()}else{let m="Erreur";try{m=(await r.json()).detail}catch(x){}$("lerr").textContent=m}};
let wakeAt=0;
function apply(s){cfg=s;const b=document.body;b.className=s.state==="online"?"on":s.state==="booting"||wakeAt&&Date.now()-wakeAt<90000&&s.state!=="online"?"boot":"off";
 const T={off:"PC ÉTEINT",booting:"DÉMARRAGE…",online:"PC EN LIGNE"};$("st").textContent=s.state==="off"&&b.className==="boot"?"RÉVEIL ENVOYÉ…":T[s.state];
 $("open").href=s.pc_url;
 $("msg").textContent=s.state==="online"?"E.N.O.S. répond. Vous pouvez l'ouvrir.":b.className==="boot"?(s.state==="booting"?"Le PC démarre : E.N.O.S. sera disponible dans un instant.":"Paquet envoyé. En attente du PC… (jusqu'à 90 s)"):"Touchez le bouton pour allumer le PC.";
 if(wakeAt&&Date.now()-wakeAt>=90000&&s.state==="off"){$("msg").textContent="Le PC ne s'est pas allumé. Réveil réseau (WoL) non pris en charge ? Vérifiez le câble Ethernet, le BIOS et GUIDE.md.";b.classList.add("err")}
 $("meta").textContent=(s.last_wake?"Dernier réveil envoyé : "+s.last_wake+" · ":"")+"PC : "+s.pc_host}
async function poll(){try{const r=await fetch("/api/status");if(r.ok)apply(await r.json())}catch(e){}setTimeout(poll,2000)}
$("pw").onclick=async()=>{if(cfg.state==="online"){location.href=cfg.pc_url;return}
 const r=await post("/api/wake");if(r.ok){wakeAt=Date.now();apply(await r.json())}else{let m="Erreur";try{m=(await r.json()).detail}catch(x){}$("msg").textContent=m}};
boot();
</script></body></html>"""


class Handler(BaseHTTPRequestHandler):
    server_version = "NaskoRelay"

    def log_message(self, fmt, *a):
        log.info("%s %s", self.address_string(), fmt % a)

    def _json(self, obj, code=200, headers=None):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def _body(self):
        try:
            n = min(int(self.headers.get("Content-Length") or 0), 4096)
            return json.loads(self.rfile.read(n) or b"{}")
        except (ValueError, OSError):
            return {}

    def _auth(self):
        c = cookies.SimpleCookie(self.headers.get("Cookie", ""))
        tok = c[COOKIE].value if COOKIE in c else ""
        return bool(tok) and _h(tok) in _devices()

    def _cookie(self, token):
        flag = "; Secure" if self.server.tls else ""
        return {"Set-Cookie": f"{COOKIE}={token}; Max-Age={400 * 86400}; Path=/; HttpOnly; SameSite=Strict{flag}"}

    def _locked(self):
        ip = self.client_address[0]
        return time.time() < FAILS.get(ip, (0, 0))[1]

    def _fail(self):
        ip = self.client_address[0]
        n = FAILS.get(ip, (0, 0))[0] + 1
        FAILS[ip] = (n, time.time() + 60 if n >= 5 else 0)
        log.warning("Echec d'authentification depuis %s (%d)", ip, n)

    def _status(self):
        cfg = self.server.cfg
        last = LAST["sent"]
        return {"state": nasko_wake.pc_state(cfg["pc_host"], cfg["pc_port"]), "pc_url": cfg.get("pc_url") or f"https://{cfg['pc_host']}:{cfg['pc_port']}/",
                "pc_host": cfg["pc_host"], "last_wake": last}

    def do_GET(self):
        if self.path.split("?")[0] == "/":
            data = PAGE.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
        elif self.path == "/api/status":
            self._json(self._status()) if self._auth() else self._json({"detail": "authentification requise"}, 401)
        else:
            self._json({"detail": "introuvable"}, 404)

    def do_POST(self):
        path, body, cfg = self.path.split("?")[0], self._body(), self.server.cfg
        if path == "/login":
            if self._locked():
                return self._json({"detail": "Trop d'essais, patientez une minute."}, 429)
            if body.get("code") and secrets.compare_digest(str(body["code"]).strip().upper(), str(cfg["access_code"]).strip().upper()):
                token = secrets.token_urlsafe(32)
                with lock:
                    devs = _devices()
                    devs[_h(token)] = {"ip": self.client_address[0], "created": datetime.now().isoformat(timespec="seconds"), "ua": self.headers.get("User-Agent", "")[:80]}
                    _save(devs)
                FAILS.pop(self.client_address[0], None)
                log.info("Appareil de confiance ajoute depuis %s", self.client_address[0])
                return self._json({"ok": True, "token": token}, headers=self._cookie(token))
            self._fail()
            return self._json({"detail": "Code invalide."}, 403)
        if path == "/login-token":
            if self._locked():
                return self._json({"detail": "Trop d'essais, patientez une minute."}, 429)
            tok = str(body.get("token") or "")
            if tok and _h(tok) in _devices():
                return self._json({"ok": True}, headers=self._cookie(tok))
            self._fail()
            return self._json({"detail": "Appareil non reconnu."}, 403)
        if path == "/api/wake":
            if not self._auth():
                return self._json({"detail": "authentification requise"}, 401)
            with lock:
                if time.time() - LAST["wake"] < 8:                          # anti-rafale
                    return self._json({"detail": "Réveil déjà envoyé à l'instant."}, 429)
                LAST["wake"] = time.time()
            n = nasko_wake.send_magic(cfg["mac"], cfg["broadcast"])
            LAST["sent"] = datetime.now().strftime("%H:%M:%S")
            log.info("Paquet magique envoye (%d envois) vers %s par %s", n, cfg["mac"], self.client_address[0])
            if not n:
                return self._json({"detail": "Envoi impossible (réseau)."}, 500)
            return self._json(self._status())
        self._json({"detail": "introuvable"}, 404)


def build_server(cfg, cert=None, key=None):
    httpd = ThreadingHTTPServer((cfg["listen_host"], int(cfg["listen_port"])), Handler)
    httpd.cfg, httpd.tls = cfg, bool(cert and key)
    if httpd.tls:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(cert, key)
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
    return httpd


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cert")
    ap.add_argument("--key")
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                        handlers=[logging.FileHandler(os.path.join(HERE, "relais.log"), encoding="utf-8"), logging.StreamHandler()])
    try:
        cfg = load_cfg()
        nasko_wake.parse_mac(cfg["mac"])
        assert cfg["pc_host"] and cfg["access_code"]
    except (OSError, ValueError, KeyError, AssertionError) as e:
        sys.exit(f"relay_config.json absent ou incomplet ({e}). Voir creer_relais.py.")
    httpd = build_server(cfg, a.cert, a.key)
    scheme = "https" if httpd.tls else "http"
    log.info("Relais de reveil sur %s://%s:%s/  (PC %s, MAC %s)", scheme, cfg["listen_host"], cfg["listen_port"], cfg["pc_host"], cfg["mac"])
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
