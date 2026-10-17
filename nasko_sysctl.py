"""Tableau de bord système : profils de performance (powercfg), Turbo Boost, préférence énergie (EPP) + capteurs en lecture.

Principes de sécurité :
  - aucune commande construite depuis du texte libre : les GUID viennent d'une liste blanche (powercfg /list + profils connus),
    les valeurs sont des entiers bornés ; subprocess reçoit toujours une LISTE d'arguments (jamais de shell) ;
  - les sorties de powercfg sont localisées (« Index actuel du paramètre de courant alternatif »…) : on n'analyse JAMAIS les libellés,
    seulement les GUID et les valeurs hexadécimales (0x........) ;
  - PERFBOOSTMODE / PERFEPP sont des paramètres masqués : `powercfg /qh` pour les lire (`/query` ne les montre pas), `/setacvalueindex` les accepte ;
  - tout est journalisé (logger « nasko.sysctl »). Les routes d'écriture sont réservées à ce PC (voir nasko_server).

Profils : « Silencieux / Équilibré / Turbo » sont des alias vers des plans d'alimentation Windows. Le mappage est détecté (plans présents
sur le PC) et peut être forcé dans nasko_config.json : {"sysctl_profiles": {"silent": "<GUID>", "balanced": "<GUID>", "turbo": "<GUID>"}}.
"""
import json
import logging
import re
import subprocess
import threading
import time
import urllib.request

log = logging.getLogger("nasko.sysctl")
NOWIN = getattr(subprocess, "CREATE_NO_WINDOW", 0)

try:
    import psutil
except ImportError:                                  # lecture des capteurs dégradée, le reste fonctionne
    psutil = None

# --- plans d'alimentation connus (GUID publiés par Microsoft)
GUID_SAVER = "a1841308-3541-4fab-bc81-f71556f20b4a"
GUID_BALANCED = "381b4222-f694-41f0-9685-ff5bb260df2e"
GUID_HIGH = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c"
GUID_ULTIMATE = "e9a42b02-d5df-448d-aa00-03f14749eb61"      # modèle « Performances optimales » (le plan copié a un autre GUID)
PROFILES = ("silent", "balanced", "turbo")
LABELS = {"silent": "Silencieux", "balanced": "Équilibré", "turbo": "Turbo"}

SUB_PROCESSOR, BOOST, EPP = "SUB_PROCESSOR", "PERFBOOSTMODE", "PERFEPP"
BOOST_OFF, BOOST_ON = 0, 1                           # 0 = Désactivé, 1 = Activé ; 2 = Offensif (conservé si déjà présent, voir turbo_state)
EPP_PRESETS = {"default": 50, "perf": 0, "balanced_plus": 25, "eco": 75, "min": 100}      # Défaut / Perf. / Équ.+ / Éco / Min

_GUID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
_HEX = re.compile(r"0x[0-9a-fA-F]{8}")


class SysError(Exception):
    """Erreur affichable à l'utilisateur."""


# ---------------------------------------------------------------- exécution (point unique : remplaçable dans les tests)
def _run(args, timeout=15):
    try:
        p = subprocess.run(args, capture_output=True, timeout=timeout, creationflags=NOWIN, stdin=subprocess.DEVNULL)
    except FileNotFoundError:
        raise SysError(f"{args[0]} introuvable")
    except subprocess.TimeoutExpired:
        raise SysError(f"{args[0]} : délai dépassé")
    out = (p.stdout or b"").decode("cp850", "replace") + (p.stderr or b"").decode("cp850", "replace")
    return p.returncode, out


def _powercfg(*args):
    rc, out = _run(["powercfg", *args])
    if rc != 0:
        raise SysError("powercfg a refusé la commande" + (" (droits administrateur requis ?)" if "ccès" in out or "ccess" in out else "") + " : " + out.strip()[:160])
    return out


# ---------------------------------------------------------------- plans d'alimentation
def list_schemes():
    """[{guid, name, active}] d'après `powercfg /list` (analyse indépendante de la langue)."""
    res = []
    for line in _powercfg("/list").splitlines():
        m = _GUID.search(line)
        if not m:
            continue
        name = re.search(r"\((.*?)\)", line[m.end():])
        res.append({"guid": m.group(0).lower(), "name": name.group(1).strip() if name else "", "active": line.rstrip().endswith("*")})
    return res


def _pick_profiles(schemes, forced):
    """Associe silent / balanced / turbo à un plan existant (forcé par la config, sinon GUID connus, sinon par nom approchant)."""
    have = {s["guid"]: s for s in schemes}
    out = {}
    for key in PROFILES:
        g = str((forced or {}).get(key) or "").lower()
        if g in have:
            out[key] = g
    if "silent" not in out and GUID_SAVER in have:
        out["silent"] = GUID_SAVER
    if "balanced" not in out and GUID_BALANCED in have:
        out["balanced"] = GUID_BALANCED
    if "turbo" not in out:
        for s in schemes:                                      # « Performances optimales » (copie du modèle Ultimate) > Haute performance
            if re.search(r"optimales|ultimate|ultime", s["name"], re.I):
                out["turbo"] = s["guid"]
                break
        else:
            if GUID_HIGH in have:
                out["turbo"] = GUID_HIGH
            else:
                for s in schemes:
                    if re.search(r"haute|high", s["name"], re.I):
                        out["turbo"] = s["guid"]
                        break
    return out


def profiles(forced=None):
    schemes = list_schemes()
    mapping = _pick_profiles(schemes, forced)
    active = next((s["guid"] for s in schemes if s["active"]), None)
    current = next((k for k, g in mapping.items() if g == active), "custom")
    return {"active_guid": active, "active_name": next((s["name"] for s in schemes if s["active"]), ""), "current": current,
            "items": [{"id": k, "label": LABELS[k], "guid": mapping.get(k), "available": k in mapping} for k in PROFILES]}


def set_profile(profile, forced=None, create_if_missing=False):
    if profile not in PROFILES:
        raise SysError("profil inconnu")
    mapping = _pick_profiles(list_schemes(), forced)
    guid = mapping.get(profile)
    if guid is None:
        if profile == "silent" and create_if_missing:          # le plan « Économie d'énergie » a été retiré de ce PC : on le recrée depuis le modèle Windows
            out = _powercfg("/duplicatescheme", GUID_SAVER)
            m = _GUID.search(out)
            if not m:
                raise SysError("création du plan Économie d'énergie impossible")
            guid = m.group(0).lower()
            _powercfg("/changename", guid, "E.N.O.S. Silencieux")
            log.info("Plan Silencieux créé : %s", guid)
        else:
            raise SysError(f"aucun plan d'alimentation pour « {LABELS[profile]} » sur ce PC")
    _powercfg("/setactive", guid)
    _invalidate()
    log.info("Profil de performance : %s (%s)", profile, guid)
    return guid


# ---------------------------------------------------------------- paramètres processeur (Turbo Boost, EPP)
def _read_setting(alias):
    """(courant_alternatif, batterie) du plan actif pour un paramètre processeur masqué, ou None si absent."""
    out = _powercfg("/qh", "SCHEME_CURRENT", SUB_PROCESSOR, alias)
    vals = _HEX.findall(out)
    if len(vals) < 2:
        return None
    ac, dc = int(vals[-2], 16), int(vals[-1], 16)               # les deux DERNIÈRES valeurs : AC puis DC (les précédentes sont min/max/incrément)
    return ac, dc


def _write_setting(alias, value):
    value = int(value)
    _powercfg("/setacvalueindex", "SCHEME_CURRENT", SUB_PROCESSOR, alias, str(value))
    _powercfg("/setdcvalueindex", "SCHEME_CURRENT", SUB_PROCESSOR, alias, str(value))
    _powercfg("/setactive", "SCHEME_CURRENT")                   # sans cela, la valeur n'est pas appliquée au plan actif
    _invalidate()


def turbo_state():
    v = _read_setting(BOOST)
    if v is None:
        return {"supported": False, "enabled": None, "mode": None}
    return {"supported": True, "enabled": v[0] != BOOST_OFF, "mode": v[0]}


def set_turbo(enabled):
    cur = _read_setting(BOOST)
    if cur is None:
        raise SysError("Turbo Boost non géré par ce processeur / ce plan d'alimentation")
    if enabled and cur[0] != BOOST_OFF:
        return cur[0]                                           # déjà actif (peut-être en mode « Offensif ») : on ne rétrograde pas
    value = BOOST_ON if enabled else BOOST_OFF
    _write_setting(BOOST, value)
    log.info("Turbo Boost : %s", "activé" if enabled else "désactivé")
    return value


def epp_state():
    v = _read_setting(EPP)
    return {"supported": v is not None, "ac": v[0] if v else None, "dc": v[1] if v else None,
            "preset": next((k for k, p in EPP_PRESETS.items() if v and p == v[0]), None)}


def set_epp(value=None, preset=None):
    if preset is not None:
        if preset not in EPP_PRESETS:
            raise SysError("préréglage inconnu")
        value = EPP_PRESETS[preset]
    if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= 100:
        raise SysError("valeur EPP : entier de 0 à 100")
    if _read_setting(EPP) is None:
        raise SysError("préférence énergie non gérée par ce PC")
    _write_setting(EPP, value)
    log.info("Préférence énergie (EPP) : %s", value)
    return value


# ---------------------------------------------------------------- capteurs (lecture seule)
_cache = {}
_cache_lock = threading.Lock()


def _cached(key, ttl, fn, neg_ttl=None):
    """neg_ttl : durée de mémorisation d'un ÉCHEC (valeur None). Évite de retenter toutes les 2 s un capteur absent (LibreHardwareMonitor non lancé = 1,5 s perdues par appel)."""
    with _cache_lock:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < (neg_ttl if (hit[1] is None and neg_ttl) else ttl):
            return hit[1]
    try:
        val = fn()
    except Exception as e:                                      # noqa: BLE001 — un capteur en panne ne doit pas casser le tableau de bord
        log.debug("capteur %s : %s", key, e)
        val = None
    with _cache_lock:
        _cache[key] = (time.time(), val)
    return val


def _invalidate():
    with _cache_lock:
        _cache.clear()


def _gpu():
    rc, out = _run(["nvidia-smi", "--query-gpu=name,clocks.gr,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw",
                    "--format=csv,noheader,nounits"], timeout=5)
    if rc != 0:
        return None
    f = [x.strip() for x in out.strip().splitlines()[0].split(",")]
    num = lambda s: float(s) if re.fullmatch(r"-?\d+(\.\d+)?", s) else None      # noqa: E731 — « [N/A] » -> None
    return {"name": f[0], "mhz": num(f[1]), "util": num(f[2]), "mem_used_mb": num(f[3]), "mem_total_mb": num(f[4]), "temp": num(f[5]), "watts": num(f[6])}


def _lhm(url="http://127.0.0.1:8085/data.json"):
    """Température CPU et ventilateurs via LibreHardwareMonitor (serveur web local activé), en lecture seule. None si absent."""
    with urllib.request.urlopen(url, timeout=1.5) as r:                # 127.0.0.1 uniquement
        tree = json.loads(r.read().decode("utf-8", "replace"))
    fans, cpu_t = [], None

    def num(v):
        m = re.search(r"-?\d+([.,]\d+)?", str(v or ""))
        return float(m.group(0).replace(",", ".")) if m else None

    def walk(n, path):
        nonlocal cpu_t
        text = str(n.get("Text", ""))
        val = str(n.get("Value", ""))
        if "RPM" in val:
            fans.append({"name": text, "rpm": int(num(val) or 0)})
        elif "°C" in val and cpu_t is None and re.search(r"cpu|package", " ".join(path + [text]), re.I) and re.search(r"package|core \(max\)|average", text, re.I):
            cpu_t = num(val)
        for c in n.get("Children", []) or []:
            walk(c, path + [text])

    walk(tree, [])
    return {"fans": fans, "cpu_temp": cpu_t}


def sensors():
    s = {"cpu": {}, "ram": {}, "battery": None, "net": None, "disk": None, "gpu": None, "fans": None}
    if psutil:
        f = psutil.cpu_freq()
        s["cpu"] = {"util": psutil.cpu_percent(interval=None), "mhz": round(f.current) if f else None, "logical": psutil.cpu_count(logical=True)}
        vm = psutil.virtual_memory()
        s["ram"] = {"used_gb": round((vm.total - vm.available) / 2**30, 1), "total_gb": round(vm.total / 2**30, 1), "pct": vm.percent}
        b = psutil.sensors_battery()
        if b:
            s["battery"] = {"pct": round(b.percent), "plugged": b.power_plugged, "secs_left": b.secsleft if b.secsleft and b.secsleft > 0 else None}
        try:
            du = psutil.disk_usage("C:\\")
            s["disk"] = {"used_gb": round(du.used / 2**30, 1), "total_gb": round(du.total / 2**30, 1), "pct": du.percent}
        except OSError:
            pass
    s["gpu"] = _cached("gpu", 1.5, _gpu)
    lhm = _cached("lhm", 2.0, _lhm, neg_ttl=30.0)
    if lhm:
        s["fans"], s["cpu"]["temp"] = lhm["fans"], lhm["cpu_temp"]
    return s


def state(forced=None):
    """Tout ce dont le tableau de bord a besoin en un appel. Les lectures powercfg sont mises en cache 4 s (3 processus par appel)."""
    def cfg():
        return {"profiles": profiles(forced), "turbo": turbo_state(), "epp": epp_state()}
    c = _cached("cfg", 4.0, cfg) or {"profiles": {"items": [], "current": "custom", "active_name": ""}, "turbo": {"supported": False}, "epp": {"supported": False}}
    return {**c, "sensors": sensors(), "at": time.time(),
            "notes": {"fans_write": "non disponible : le contrôle des ventilateurs passe par le contrôleur embarqué du constructeur",
                      "fans_read": "via LibreHardwareMonitor (serveur web local, port 8085)" if (_cache.get("lhm") or (0, None))[1] else "LibreHardwareMonitor non détecté (serveur web local, port 8085)"}}
