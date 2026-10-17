"""Reveil a distance (Wake-on-LAN) : paquet magique et detection de l'etat du PC. Bibliotheque standard uniquement
(utilisable sur un Raspberry Pi, un NAS, un vieux PC...)."""
import platform
import re
import socket
import subprocess


def parse_mac(mac):
    """'aa:bb:cc:dd:ee:ff' | 'AA-BB-...' | 'aabbccddeeff' -> 6 octets. ValueError si invalide."""
    clean = re.sub(r"[^0-9a-fA-F]", "", mac or "")
    if len(clean) != 12:
        raise ValueError(f"Adresse MAC invalide : {mac!r}")
    return bytes.fromhex(clean)


def magic_packet(mac):
    """Paquet magique : 6 octets 0xFF puis l'adresse MAC repetee 16 fois (102 octets)."""
    return b"\xff" * 6 + parse_mac(mac) * 16


def send_magic(mac, broadcasts=("255.255.255.255",), ports=(9, 7)):
    """Envoie le paquet en diffusion UDP (ports 9 et 7) vers chaque adresse. Retourne le nombre d'envois reussis."""
    packet, sent = magic_packet(mac), 0
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        for addr in broadcasts:
            for port in ports:
                try:
                    s.sendto(packet, (addr, port))
                    sent += 1
                except OSError:
                    continue
    return sent


def tcp_open(host, port, timeout=1.5):
    try:
        with socket.create_connection((host, int(port)), timeout=timeout):
            return True
    except OSError:
        return False


def ping(host, timeout_ms=900):
    if not re.fullmatch(r"[A-Za-z0-9_.:-]+", host or ""):               # jamais de texte libre dans une commande
        return False
    win = platform.system() == "Windows"
    cmd = ["ping", "-n", "1", "-w", str(timeout_ms), host] if win else ["ping", "-c", "1", "-W", str(max(1, timeout_ms // 1000)), host]
    try:
        kw = {"creationflags": subprocess.CREATE_NO_WINDOW} if win else {}
        return subprocess.run(cmd, capture_output=True, timeout=5, **kw).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def pc_state(host, port):
    """'online' (E.N.O.S. repond), 'booting' (le PC repond mais pas encore E.N.O.S.) ou 'off'."""
    if tcp_open(host, port):
        return "online"
    return "booting" if ping(host) else "off"
