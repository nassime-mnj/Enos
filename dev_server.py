"""Lanceur de dev : serveur ENOS seul, sur un port de test (8790 par defaut), sans toucher a l'ENOS.exe de l'utilisateur (8765).
Usage : py dev_server.py [port]"""
import sys
import time

import nasko_server as ns

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8790
cfg = ns.load_config()
cfg["server_port"] = port
cfg["allow_network_access"] = False
ns.start_servers(cfg)
print(f"ENOS (dev) : http://127.0.0.1:{ns.state['port']}/", flush=True)
while True:
    time.sleep(3600)
