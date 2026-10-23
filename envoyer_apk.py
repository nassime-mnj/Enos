"""Envoie l'APK sur le téléphone : double-clic, scanne le QR code, installe. Rien d'autre.

    py envoyer_apk.py            APK de test la plus récente (mobile_build\\), sinon ENOS.apk
    py envoyer_apk.py --live     ENOS.apk (la version publiée par le PC)
    py envoyer_apk.py --ip 192.168.1.28   forcer l'adresse (Tailscale : 100.x.y.z pour envoyer hors du Wi-Fi)

Un mini-serveur éphémère (lien secret aléatoire, une seule personne, 10 minutes max) s'arrête tout seul dès que le téléphone a fini de télécharger.
Le téléphone et le PC doivent être sur le même Wi-Fi (ou Tailscale). Au premier lancement, Windows peut demander d'autoriser Python sur le réseau PRIVÉ : accepte.
"""
import argparse
import glob
import hashlib
import http.server
import os
import secrets
import socket
import sys
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
LIFETIME = 600


def pick_apk(live):
    if not live:
        found = sorted(glob.glob(os.path.join(HERE, "mobile_build", "*.apk")), key=os.path.getmtime, reverse=True)
        if found:
            return found[0]
    for name in ("ENOS.apk", "NASKO.apk"):                                     # NASKO.apk : ancien nom
        p = os.path.join(HERE, name)
        if os.path.isfile(p):
            return p
    return None


def lan_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:             # aucune donnée envoyée : donne l'adresse de la carte réseau active
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def main():
    ap = argparse.ArgumentParser(description="Envoie l'APK sur le téléphone par QR code.")
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--ip", default="")
    ap.add_argument("--port", type=int, default=0)
    ap.add_argument("--no-open", action="store_true", help="n'ouvre pas l'image du QR code (tests)")
    a = ap.parse_args()

    apk = pick_apk(a.live)
    if not apk:
        sys.exit("Aucun APK trouvé (mobile_build\\*.apk ou ENOS.apk). Construis-le avec : py construire_apk.py")
    data = open(apk, "rb").read()
    sha = hashlib.sha256(data).hexdigest()
    token = secrets.token_urlsafe(12)
    route = f"/{token}/ENOS.apk"
    done = threading.Event()

    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            if self.path != route:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/vnd.android.package-archive")
            self.send_header("Content-Disposition", 'attachment; filename="ENOS.apk"')
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            try:
                self.wfile.write(data)
                print("  Téléchargement terminé : le téléphone a l'APK.")
                done.set()
            except OSError:
                print("  Téléchargement interrompu : scanne à nouveau.")

    srv = http.server.ThreadingHTTPServer(("0.0.0.0", a.port), H)
    ip = a.ip or lan_ip()
    url = f"http://{ip}:{srv.server_address[1]}{route}"
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    print(f"\n  APK : {os.path.basename(apk)} ({len(data) // 1024} Ko)  ·  SHA-256 {sha[:16]}…")
    print(f"  Lien : {url}")
    try:
        import segno
        png = os.path.join(tempfile.gettempdir(), "enos_apk_qr.png")
        segno.make(url, error="m").save(png, scale=12, border=3, dark="#000000", light="#ffffff")
        if not a.no_open and hasattr(os, "startfile"):
            os.startfile(png)
        print("  Scanne le QR code avec l'appareil photo du téléphone (image ouverte sur le PC).")
        print("  Puis : ouvre le lien › Télécharger › Ouvrir › Installer (autorise « cette source » si Android le demande).")
    except ImportError:
        print("  (module segno absent : tape le lien ci-dessus dans le navigateur du téléphone)")
    print(f"  Le lien s'éteint tout seul après le téléchargement ou {LIFETIME // 60} minutes.\n")

    done.wait(LIFETIME)
    time.sleep(1.0)
    srv.shutdown()
    print("  Terminé." if done.is_set() else "  Délai dépassé : relance le script pour un nouveau lien.")


if __name__ == "__main__":
    main()
