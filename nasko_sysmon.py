"""Historique des capteurs système pour les graphes du tableau de bord (CPU, RAM, GPU, réseau, disque).

Un thread léger échantillonne toutes les 2 s UNIQUEMENT tant que le panneau est ouvert (touch() est appelé à chaque lecture) :
il s'arrête seul après 2 minutes sans lecture, donc aucun coût quand le panneau est fermé. 450 points = 15 minutes d'historique.
"""
import collections
import logging
import threading
import time

import nasko_sysctl

try:
    import psutil
except ImportError:
    psutil = None

log = logging.getLogger("nasko.sysmon")

INTERVAL = 2.0
SIZE = 450
IDLE_STOP = 120.0
KEYS = ("cpu", "cpu_mhz", "ram", "ram_gb", "swap_gb", "net_down", "net_up", "disk_r", "disk_w", "gpu", "gpu_mem", "gpu_temp", "gpu_w", "gpu_mhz", "gpu_vram_gb")


class Sampler:
    def __init__(self):
        self._lock = threading.Lock()
        self._rows = collections.deque(maxlen=SIZE)
        self._cores = []
        self._thread = None
        self._touched = 0.0
        self._prev = None

    def touch(self):
        self._touched = time.time()
        with self._lock:
            if self._thread and self._thread.is_alive():
                return
            self._thread = threading.Thread(target=self._loop, name="sysmon", daemon=True)
            self._thread.start()

    def _loop(self):
        if psutil:
            psutil.cpu_percent(interval=None, percpu=True)         # amorce : la 1re mesure est toujours 0
        self._prev = None
        while time.time() - self._touched < IDLE_STOP:
            t0 = time.time()
            try:
                self._sample(t0)
            except Exception as e:                                  # noqa: BLE001 — un capteur en panne ne doit pas tuer l'historique
                log.debug("échantillon : %s", e)
            time.sleep(max(0.2, INTERVAL - (time.time() - t0)))

    def _sample(self, now):
        if not psutil:
            return
        cores = psutil.cpu_percent(interval=None, percpu=True)
        f = psutil.cpu_freq()
        vm, sw = psutil.virtual_memory(), psutil.swap_memory()
        net, dio = psutil.net_io_counters(), psutil.disk_io_counters()
        cur = {"t": now, "net": (net.bytes_recv, net.bytes_sent) if net else (0, 0), "dio": (dio.read_bytes, dio.write_bytes) if dio else (0, 0)}
        row = {"t": now, "cpu": round(sum(cores) / len(cores), 1) if cores else 0.0, "cpu_mhz": round(f.current) if f else None,
               "ram": vm.percent, "ram_gb": round((vm.total - vm.available) / 2**30, 2), "swap_gb": round(sw.used / 2**30, 2)}
        if self._prev:
            dt = max(0.1, now - self._prev["t"])
            row["net_down"] = max(0.0, (cur["net"][0] - self._prev["net"][0]) / dt)
            row["net_up"] = max(0.0, (cur["net"][1] - self._prev["net"][1]) / dt)
            row["disk_r"] = max(0.0, (cur["dio"][0] - self._prev["dio"][0]) / dt)
            row["disk_w"] = max(0.0, (cur["dio"][1] - self._prev["dio"][1]) / dt)
        self._prev = cur
        try:
            g = nasko_sysctl._gpu()
        except Exception:                                           # noqa: BLE001
            g = None
        if g:
            row.update(gpu=g["util"], gpu_temp=g["temp"], gpu_w=g["watts"], gpu_mhz=g["mhz"],
                       gpu_mem=round(g["mem_used_mb"] / g["mem_total_mb"] * 100, 1) if g.get("mem_total_mb") else None,
                       gpu_vram_gb=round(g["mem_used_mb"] / 1024, 2) if g.get("mem_used_mb") is not None else None)
        with self._lock:
            self._rows.append(row)
            self._cores = [round(c) for c in cores]

    def history(self, seconds=300):
        """{'t': [...], 'cpu': [...], ...} sur les `seconds` dernières secondes (None = mesure absente) + charge par cœur actuelle."""
        self.touch()
        cut = time.time() - max(30, min(seconds, SIZE * INTERVAL))
        with self._lock:
            rows = [r for r in self._rows if r["t"] >= cut]
            cores = list(self._cores)
        out = {"t": [round(r["t"], 1) for r in rows], "cores": cores, "interval": INTERVAL}
        for k in KEYS:
            out[k] = [r.get(k) for r in rows]
        out["stats"] = {k: _stats(out[k]) for k in ("cpu", "ram", "gpu", "gpu_temp", "gpu_w", "gpu_mem")}
        return out


def _stats(vals):
    v = [x for x in vals if x is not None]
    return {"avg": round(sum(v) / len(v), 1), "max": round(max(v), 1), "min": round(min(v), 1)} if v else None


sampler = Sampler()
