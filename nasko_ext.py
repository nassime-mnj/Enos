"""Extension Chrome « E.N.O.S. Onglets » : liste et fermeture des VRAIS onglets, sans port de débogage (bloqué par Chrome 136+ sur le profil habituel).

Fonctionnement : l'extension (Manifest V3, générée dans data/chrome_ext avec un jeton propre) pousse la liste des onglets vers le serveur local
(POST /ext/tabs) et interroge /ext/poll (long-polling) pour recevoir les ordres de fermeture. Sécurité : routes /ext/* réservées à la boucle locale,
protégées par un jeton aléatoire dédié (en-tête X-Enos-Ext) qui ne donne accès à rien d'autre que ces routes.
"""
import json
import os
import secrets
import subprocess
import threading
import time
from urllib.parse import urlparse

from nasko_core import data_dir

CONNECTED_S = 30              # une extension qui n'a rien envoyé depuis 30 s est considérée absente
_state = {"tabs": [], "seen": 0.0, "thumbs": {}}
_cmds = []
_cond = threading.Condition()


def _token_path():
    return os.path.join(data_dir(), "ext_token.txt")


def token():
    try:
        with open(_token_path(), encoding="utf-8") as f:
            t = f.read().strip()
            if len(t) >= 24:
                return t
    except OSError:
        pass
    t = secrets.token_urlsafe(24)
    with open(_token_path(), "w", encoding="utf-8") as f:
        f.write(t)
    return t


def check(candidate):
    return bool(candidate) and secrets.compare_digest(str(candidate), token())


def seen():
    _state["seen"] = time.time()


def connected():
    return time.time() - _state["seen"] < CONNECTED_S and bool(_state["tabs"])


# ----------------------------------------------------------------------------- routes /ext/*
def put_tabs(tabs, thumbs=None):
    seen()
    clean = []
    for t in tabs[:2000]:
        try:
            clean.append({"id": int(t["id"]), "title": str(t.get("title") or "")[:300], "url": str(t.get("url") or "")[:2000],
                          "fav": str(t.get("fav") or "")[:2000], "active": bool(t.get("active")), "win": int(t.get("win") or 0)})
        except (KeyError, TypeError, ValueError):
            continue
    with _cond:
        _state["tabs"] = clean
        alive = {f"x:{t['id']}" for t in clean}
        _state["thumbs"] = {k: v for k, v in _state["thumbs"].items() if k in alive}
        for k, v in (thumbs or {}).items():
            if isinstance(v, str) and v.startswith("data:image/jpeg;base64,") and len(v) < 400_000:
                _state["thumbs"][f"x:{int(k)}"] = v
        _cond.notify_all()


def poll(wait=15.0):
    seen()
    with _cond:
        if not _cmds:
            _cond.wait(max(0.0, min(25.0, wait)))
        out = list(_cmds)
        _cmds.clear()
    seen()
    return out


# ----------------------------------------------------------------------------- côté E.N.O.S. (nasko_tabs)
def list_tabs():
    out = []
    for t in _state["tabs"]:
        url = t["url"]
        host = urlparse(url).netloc or url.split(":")[0]
        tid = f"x:{t['id']}"
        out.append({"id": tid, "title": t["title"] or "(sans titre)", "url": url, "host": host.replace("www.", ""),
                    "internal": url.startswith(("chrome://", "devtools://", "chrome-extension://", "about:", "chrome-untrusted://", "edge://")),
                    "thumb": _state["thumbs"].get(tid)})
    return out


def thumb(tab_id):
    return _state["thumbs"].get(tab_id)


def close_tab(tab_id, timeout=6.0):
    """Ordre de fermeture envoyé à l'extension ; on attend que l'onglet disparaisse de la liste (confirmation réelle)."""
    try:
        n = int(str(tab_id).split(":", 1)[1])
    except (IndexError, ValueError):
        return False
    with _cond:
        _cmds.append({"op": "close", "id": n})
        _cond.notify_all()
        end = time.time() + timeout
        while any(t["id"] == n for t in _state["tabs"]):
            left = end - time.time()
            if left <= 0:
                return False
            _cond.wait(left)
    return True


# ----------------------------------------------------------------------------- installation (génération des fichiers de l'extension)
MANIFEST = {
    "manifest_version": 3,
    "name": "E.N.O.S. Onglets",
    "version": "1.0",
    "description": "Relie vos onglets Chrome à E.N.O.S. (liste et fermeture depuis GESTION GOOGLE). Parle uniquement à 127.0.0.1.",
    "permissions": ["tabs", "alarms"],
    "host_permissions": ["http://127.0.0.1/*", "<all_urls>"],
    "background": {"service_worker": "background.js"},
}

BACKGROUND_JS = r"""// E.N.O.S. Onglets : pousse la liste des onglets vers E.N.O.S. (127.0.0.1) et exécute les fermetures demandées.
importScripts("config.js");
let base = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const H = () => ({ "X-Enos-Ext": ENOS.token, "Content-Type": "application/json" });

async function find() {
  for (const p of ENOS.ports) {
    try { const r = await fetch(`http://127.0.0.1:${p}/ext/ping`, { headers: H() }); if (r.ok) { base = `http://127.0.0.1:${p}`; return true; } } catch (e) {}
  }
  base = null; return false;
}
async function api(path, body) {
  if (!base && !(await find())) throw new Error("E.N.O.S. injoignable");
  try {
    const r = await fetch(base + path, { method: body === undefined ? "GET" : "POST", headers: H(), body: body === undefined ? undefined : JSON.stringify(body) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } catch (e) { base = null; throw e; }
}

const thumbs = {}, thumbAt = {};
async function shot(tab) {                      // miniature de l'onglet visible d'une fenêtre (Chrome ne sait pas capturer les onglets en arrière-plan)
  try {
    if (!tab.active || !/^https?:/.test(tab.url || "") || Date.now() - (thumbAt[tab.id] || 0) < 60000) return;
    thumbAt[tab.id] = Date.now();
    const url = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 50 });
    const bmp = await createImageBitmap(await (await fetch(url)).blob());
    const w = 320, h = Math.max(1, Math.round(bmp.height * w / bmp.width));
    const cv = new OffscreenCanvas(w, h); cv.getContext("2d").drawImage(bmp, 0, 0, w, h);
    const blob = await cv.convertToBlob({ type: "image/jpeg", quality: 0.5 });
    const buf = new Uint8Array(await blob.arrayBuffer()); let s = "";
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    thumbs[tab.id] = "data:image/jpeg;base64," + btoa(s);
  } catch (e) {}
}

let pushing = false, again = false;
async function push() {
  if (pushing) { again = true; return; }
  pushing = true;
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.map(shot));
    const out = {}; tabs.forEach((t) => { if (thumbs[t.id]) out[t.id] = thumbs[t.id]; });
    await api("/ext/tabs", { tabs: tabs.map((t) => ({ id: t.id, title: t.title, url: t.url || t.pendingUrl, fav: t.favIconUrl, active: t.active, win: t.windowId })), thumbs: out });
  } catch (e) {}
  pushing = false;
  if (again) { again = false; setTimeout(push, 300); }
}
let timer = 0;
const soon = () => { clearTimeout(timer); timer = setTimeout(push, 400); };
["onCreated", "onRemoved", "onUpdated", "onActivated", "onMoved", "onAttached", "onDetached"].forEach((e) => chrome.tabs[e].addListener(soon));

async function run(c) {
  if (c.op === "close") { try { await chrome.tabs.remove(c.id); } catch (e) {} await push(); }
}
let looping = false;
async function loop() {
  if (looping) return; looping = true;
  for (;;) {
    try {
      chrome.runtime.getPlatformInfo();                    // garde le service worker éveillé
      const r = await api("/ext/poll?wait=15");
      for (const c of r.commands || []) await run(c);
    } catch (e) { await sleep(3000); }
  }
}
chrome.alarms.create("enos", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => { push(); loop(); });
chrome.runtime.onStartup.addListener(() => { push(); loop(); });
chrome.runtime.onInstalled.addListener(() => { push(); loop(); });
push(); loop();
"""


def extension_dir():
    return os.path.join(data_dir(), "chrome_ext")


def install(port):
    """Écrit l'extension (avec son jeton et les ports du serveur) dans data/chrome_ext. Retourne le dossier à charger dans chrome://extensions."""
    d = extension_dir()
    os.makedirs(d, exist_ok=True)
    ports = [int(port)] + [p for p in range(8765, 8776) if p != int(port)]
    with open(os.path.join(d, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(MANIFEST, f, indent=2, ensure_ascii=False)
    with open(os.path.join(d, "background.js"), "w", encoding="utf-8") as f:
        f.write(BACKGROUND_JS)
    with open(os.path.join(d, "config.js"), "w", encoding="utf-8") as f:
        f.write(f"const ENOS = {json.dumps({'token': token(), 'ports': ports})};\n")
    return d


def open_installer(port, chrome_exe=None):
    """Génère l'extension, ouvre le dossier dans l'Explorateur et chrome://extensions dans votre Chrome habituel."""
    d = install(port)
    try:
        os.startfile(d)
    except OSError:
        pass
    if chrome_exe:
        try:
            subprocess.Popen([chrome_exe, "chrome://extensions"], creationflags=0x08000000)
        except OSError:
            pass
    return d
