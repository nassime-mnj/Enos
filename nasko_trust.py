"""Appareils de confiance : jetons permanents (jamais stockes en clair) et IP de confiance.

Principe : le code PIN est saisi UNE fois sur un telephone. Le serveur lui remet un jeton aleatoire de 256 bits, qui est
conserve par le telephone (cookie + localStorage). Ne subsiste cote PC que l'empreinte SHA-256 du jeton : lire le
fichier `data\\trusted_devices.json` ne permet pas de se faire passer pour un telephone. Le jeton n'expire jamais,
mais chaque appareil se revoque a tout moment depuis le PC (ou depuis le telephone : « oublier cet appareil »).
"""
import hashlib
import ipaddress
import json
import logging
import os
import re
import secrets
import threading
import time
from datetime import datetime

from nasko_core import data_dir

log = logging.getLogger("nasko.trust")

COOKIE = "nasko_device"
COOKIE_MAX_AGE = 400 * 24 * 3600      # plafond impose par Chrome ; le jeton du localStorage retablit le cookie ensuite
TOUCH_EVERY = 60                      # s : « derniere activite » ecrite au plus une fois par minute

_MODELS = {"SM-S916": "Galaxy S23+", "SM-S911": "Galaxy S23", "SM-S918": "Galaxy S23 Ultra"}


def _hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def device_name(user_agent):
    """Nom lisible deduit du User-Agent (ex. « Galaxy S23+ · Chrome »)."""
    ua = user_agent or ""
    m = re.search(r"\b(SM-[A-Z]\d{3})\w*", ua)
    if m:
        model = _MODELS.get(m.group(1), m.group(0))
    elif "iPhone" in ua:
        model = "iPhone"
    elif "Android" in ua:
        model = "Android"
    elif "Windows" in ua:
        model = "PC Windows"
    else:
        model = "Appareil"
    browser = ("Samsung Internet" if "SamsungBrowser" in ua else "Edge" if "Edg/" in ua else
               "Firefox" if "Firefox" in ua else "Chrome" if "Chrome" in ua else "Safari" if "Safari" in ua else "navigateur")
    return f"{model} · {browser}"


class DeviceStore:
    def __init__(self):
        self._lock = threading.RLock()
        self._touched = {}
        self._devices = self._load()

    @staticmethod
    def _file():
        return os.path.join(data_dir(), "trusted_devices.json")

    def _load(self):
        try:
            with open(self._file(), encoding="utf-8") as f:
                return {d["hash"]: d for d in json.load(f).get("devices", [])}
        except (OSError, ValueError, KeyError):
            return {}

    def _save(self):
        tmp = self._file() + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"devices": list(self._devices.values())}, f, ensure_ascii=False, indent=1)
        os.replace(tmp, self._file())

    def reload(self):
        with self._lock:
            self._devices = self._load()

    def create(self, user_agent, ip):
        """Nouvel appareil de confiance. Retourne (jeton_en_clair, fiche). Le jeton n'est montre qu'ici."""
        token = secrets.token_urlsafe(32)
        now = datetime.now().isoformat(timespec="seconds")
        rec = {"id": secrets.token_hex(4), "hash": _hash(token), "name": device_name(user_agent), "ip": ip,
               "created": now, "last_seen": now}
        with self._lock:
            self._devices[rec["hash"]] = rec
            self._save()
        log.info("Appareil de confiance ajoute : %s (%s)", rec["name"], ip)
        return token, rec

    def verify(self, token, ip=None):
        """Fiche de l'appareil si le jeton est valide, sinon None. Met a jour la derniere activite."""
        if not token or len(token) > 200:
            return None
        with self._lock:
            rec = self._devices.get(_hash(token))
            if rec and time.time() - self._touched.get(rec["id"], 0) > TOUCH_EVERY:
                self._touched[rec["id"]] = time.time()
                rec["last_seen"] = datetime.now().isoformat(timespec="seconds")
                if ip:
                    rec["ip"] = ip
                try:
                    self._save()
                except OSError:
                    pass
            return rec

    def rotate(self, token):
        """Remplace le jeton d'un appareil existant (le precedent cesse de fonctionner). Retourne le nouveau jeton."""
        with self._lock:
            rec = self._devices.pop(_hash(token), None)
            if not rec:
                return None
            new = secrets.token_urlsafe(32)
            rec["hash"] = _hash(new)
            self._devices[rec["hash"]] = rec
            self._save()
            return new

    def revoke(self, device_id):
        with self._lock:
            for h, rec in list(self._devices.items()):
                if rec["id"] == device_id:
                    del self._devices[h]
                    self._save()
                    log.info("Appareil revoque : %s", rec["name"])
                    return True
        return False

    def revoke_all(self):
        with self._lock:
            n = len(self._devices)
            self._devices.clear()
            self._save()
            log.info("Tous les appareils revoques (%d)", n)
            return n

    def listing(self):
        with self._lock:
            return sorted(({k: v for k, v in d.items() if k != "hash"} for d in self._devices.values()),
                          key=lambda d: d["last_seen"], reverse=True)


# ----------------------------------------------------------------------------- IP de confiance
VPN_NET = ipaddress.ip_network("100.64.0.0/10")        # Tailscale & co (CGNAT)


def _is_local_like(addr, vpn):
    return addr.is_private or addr.is_loopback or (vpn and addr in VPN_NET)


def valid_trusted_entry(entry, vpn=False):
    """True si l'entree (IP ou reseau CIDR) est privee/locale (ou VPN si autorise) : une IP publique n'est jamais « de confiance »."""
    try:
        net = ipaddress.ip_network(str(entry).strip(), strict=False)
    except ValueError:
        return False
    return net.is_private or net.is_loopback or (vpn and net.subnet_of(VPN_NET))


def ip_trusted(ip, entries, vpn=False):
    """True si `ip` (locale) fait partie de la liste `trusted_ips` du fichier de configuration."""
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    if getattr(addr, "ipv4_mapped", None):
        addr = addr.ipv4_mapped
    if not _is_local_like(addr, vpn):
        return False
    for entry in entries or []:
        if valid_trusted_entry(entry, vpn) and addr in ipaddress.ip_network(str(entry).strip(), strict=False):
            return True
    return False
