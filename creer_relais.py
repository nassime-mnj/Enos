"""Prepare le dossier « relais_reveil » a copier sur un appareil TOUJOURS ALLUME (Raspberry Pi, NAS, mini-PC) du meme reseau.

    py creer_relais.py                       (detection automatique de ce PC)
    py creer_relais.py --mac E4:A8:DF:DF:0B:24 --pc-host 192.168.1.28 --out D:\\relais

Le dossier contient wake_relay.py, nasko_wake.py, relay_config.json (MAC, adresse du PC, code d'acces genere) et un LISEZMOI.
Le MAC choisi est celui de la carte ETHERNET (le reveil par Wi-Fi n'est en general pas pris en charge), meme si le cable
n'est pas branche aujourd'hui.
"""
import argparse
import ipaddress
import json
import os
import secrets
import shutil
import socket
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PS = r"""
$adapters = Get-NetAdapter -Physical -ErrorAction SilentlyContinue | ForEach-Object {
  $ip = Get-NetIPAddress -InterfaceIndex $_.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1
  [pscustomobject]@{ name=$_.Name; desc=$_.InterfaceDescription; status="$($_.Status)"; mac=$_.MacAddress; media="$($_.PhysicalMediaType)"; ip=$ip.IPAddress; prefix=$ip.PrefixLength }
}
$adapters | ConvertTo-Json -Compress
"""


def adapters():
    out = subprocess.run(["powershell.exe", "-NoProfile", "-Command", PS], capture_output=True, text=True, encoding="utf-8", timeout=30).stdout.strip()
    data = json.loads(out) if out else []
    return data if isinstance(data, list) else [data]


def active_ip():
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:        # aucune donnee envoyee
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mac", help="MAC de la carte a reveiller (defaut : carte Ethernet de ce PC)")
    ap.add_argument("--pc-host", help="adresse IP du PC (defaut : IP actuelle)")
    ap.add_argument("--pc-port", type=int, default=8443, help="port HTTPS de E.N.O.S. (https_port)")
    ap.add_argument("--broadcast", help="adresse de diffusion du reseau (defaut : deduite)")
    ap.add_argument("--out", default=os.path.join(HERE, "relais_reveil"))
    a = ap.parse_args()

    ads = [x for x in adapters() if x.get("mac")]
    wired = next((x for x in ads if "802.3" in str(x.get("media"))), None)
    wifi = next((x for x in ads if "802.11" in str(x.get("media")) and x.get("status") == "Up"), None)
    host = a.pc_host or active_ip()
    mac = (a.mac or (wired or {}).get("mac") or (wifi or {}).get("mac") or "").replace("-", ":").lower()
    if not mac:
        sys.exit("Aucune carte reseau trouvee : indiquez --mac.")
    cur = next((x for x in ads if x.get("ip") == host), None)
    prefix = int((cur or {}).get("prefix") or 24)
    bcast = a.broadcast or str(ipaddress.ip_network(f"{host}/{prefix}", strict=False).broadcast_address)

    os.makedirs(a.out, exist_ok=True)
    for f in ("wake_relay.py", "nasko_wake.py"):
        shutil.copy(os.path.join(HERE, f), a.out)
    cfg = {"mac": mac, "pc_host": host, "pc_port": a.pc_port, "pc_url": f"https://{host}:{a.pc_port}/", "broadcast": [bcast],
           "listen_host": "0.0.0.0", "listen_port": 8088, "access_code": secrets.token_hex(4).upper()}
    json.dump(cfg, open(os.path.join(a.out, "relay_config.json"), "w", encoding="utf-8"), indent=2)
    with open(os.path.join(a.out, "lancer_relais.sh"), "w", newline="\n") as f:
        f.write("#!/bin/sh\ncd \"$(dirname \"$0\")\"\nexec python3 wake_relay.py\n")
    with open(os.path.join(a.out, "lancer_relais.bat"), "w") as f:
        f.write("@echo off\ncd /d \"%~dp0\"\npy wake_relay.py\n")
    with open(os.path.join(a.out, "LISEZMOI.txt"), "w", encoding="utf-8") as f:
        f.write(f"""RELAIS DE REVEIL E.N.O.S.
==========================
1. Copiez ce dossier sur un appareil TOUJOURS ALLUME de votre reseau (Raspberry Pi, NAS, mini-PC) avec Python 3.8+.
2. Lancez-le :  python3 wake_relay.py   (ou lancer_relais.sh / lancer_relais.bat). Pour qu'il demarre seul, ajoutez-le
   au demarrage de l'appareil (systemd, cron @reboot, tache planifiee...).
3. Ouvrez http://<IP de l'appareil>:{cfg['listen_port']}/ , entrez le code d'acces ci-dessous : l'appareil devient de confiance.
   Code d'acces : {cfg['access_code']}
4. Depuis l'exterieur : installez Tailscale (ou WireGuard) sur cet appareil et sur votre telephone, puis ouvrez la meme
   page via l'adresse Tailscale du relais. NE REDIRIGEZ JAMAIS ce port sur Internet.
5. Le PC doit etre CABLE EN ETHERNET (MAC ci-dessous), WoL active dans le BIOS et dans Windows, demarrage rapide desactive.
   MAC reveille : {mac}    PC : {host}:{a.pc_port}    diffusion : {bcast}
   Lancez  py diagnostic_reveil.py  sur le PC pour verifier tout cela.
""")
    print(f"Dossier pret : {a.out}")
    print(f"  MAC reveille   : {mac}  ({'carte Ethernet' if wired and mac == wired['mac'].replace('-', ':').lower() else 'carte indiquee / Wi-Fi'})")
    print(f"  PC             : {host}:{a.pc_port}   diffusion : {bcast}")
    print(f"  Code d'acces   : {cfg['access_code']}   (note aussi dans LISEZMOI.txt)")
    if not wired or wired.get("status") != "Up":
        print("\n/!\\ Ce PC n'est pas branche en Ethernet : le reveil ne fonctionnera pas tant qu'un cable n'est pas branche.")
    if not wired:
        print("/!\\ Aucune carte Ethernet detectee : c'est la MAC du Wi-Fi qui est utilisee, rarement reveillable.")
    print("\nSuite : copiez le dossier sur l'appareil toujours allume, puis lancez wake_relay.py (voir LISEZMOI.txt).")


if __name__ == "__main__":
    main()
