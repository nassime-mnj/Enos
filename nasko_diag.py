"""Diagnostic système : d'où vient le problème sur la RAM, le stockage, le GPU et le CPU.

Tout est LECTURE SEULE : rien n'est supprimé, tué ni modifié. Chaque constat porte un niveau (ok / info / warn / danger), les chiffres qui
le justifient et une piste d'action que VOUS appliquez.

  run()            : diagnostic complet (~6 s) -> {ram, storage, gpu, cpu, findings}
  storage_job      : analyse du contenu du disque en arrière-plan (dossiers les plus gros, plus gros fichiers), budget de temps
  helpers partagés : ps_json (PowerShell -> JSON), wmi_snapshot (GPU/disque par processus, noms de classes WMI NON localisés),
                     Job (tâche de fond avec progression), dir_size (taille d'un dossier avec échéance)
"""
import collections
import concurrent.futures
import heapq
import json
import logging
import os
import re
import subprocess
import threading
import time

import nasko_sysctl

try:
    import psutil
except ImportError:
    psutil = None

log = logging.getLogger("nasko.diag")
NOWIN = getattr(subprocess, "CREATE_NO_WINDOW", 0)
GB, MB = 2**30, 2**20

_WMI_SCRIPT = r"""
$ErrorActionPreference='SilentlyContinue'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$e=@(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine | Where-Object { $_.UtilizationPercentage -gt 0 } | ForEach-Object { @{n=$_.Name;u=[int]$_.UtilizationPercentage} })
$m=@(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory | Where-Object { $_.DedicatedUsage -gt 0 } | ForEach-Object { @{n=$_.Name;d=[int64]$_.DedicatedUsage} })
$a=@(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory | ForEach-Object { @{n=$_.Name;d=[int64]$_.DedicatedUsage;s=[int64]$_.SharedUsage} })
$d=@(Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk | ForEach-Object { @{n=$_.Name;busy=[int]$_.PercentDiskTime;q=[double]$_.AvgDiskQueueLength;r=[int64]$_.DiskReadBytesPersec;w=[int64]$_.DiskWriteBytesPersec} })
$v=@(Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name })
@{engine=$e;procmem=$m;adapter=$a;disk=$d;video=$v} | ConvertTo-Json -Compress -Depth 5
"""


# ---------------------------------------------------------------- PowerShell / WMI
def ps_json(script, timeout=40):
    try:
        p = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
                           capture_output=True, timeout=timeout, creationflags=NOWIN, stdin=subprocess.DEVNULL)
        txt = p.stdout.decode("utf-8", "replace").strip()
        return json.loads(txt) if txt else None
    except (OSError, subprocess.TimeoutExpired, ValueError) as e:
        log.debug("powershell : %s", e)
        return None


def wmi_snapshot():
    """GPU (moteurs, mémoire par processus, mémoire par carte), disque physique, liste des cartes. {} si indisponible."""
    return ps_json(_WMI_SCRIPT) or {}


_ENG = re.compile(r"pid_(\d+)_luid_(0x[0-9a-fA-F]+_0x[0-9a-fA-F]+)_phys_\d+_eng_\d+_engtype_(\w+)", re.I)
_MEM = re.compile(r"pid_(\d+)_luid_(0x[0-9a-fA-F]+_0x[0-9a-fA-F]+)_phys_\d+", re.I)


def gpu_by_process(w, nv=None):
    """[{pid, name, util, vram_mb, luid, adapter}] triés par utilisation, + {luid: libellé}. Libellé « dédiée » déduit en comparant la VRAM
    utilisée de chaque carte à celle que rapporte nvidia-smi (Windows n'expose pas le LUID <-> nom de carte sans DXGI)."""
    adapters = {}
    for a in w.get("adapter") or []:
        m = re.search(r"luid_(0x[0-9a-fA-F]+_0x[0-9a-fA-F]+)", a.get("n", ""), re.I)
        if m:
            adapters[m.group(1).lower()] = a.get("d", 0)
    labels = {l: "GPU intégré / autre" for l in adapters}
    if nv and nv.get("mem_used_mb") is not None and adapters:
        target = nv["mem_used_mb"] * MB
        best = min(adapters, key=lambda l: abs(adapters[l] - target))
        if abs(adapters[best] - target) < max(300 * MB, target * 0.5):
            labels[best] = "GPU dédié (" + str(nv.get("name", "NVIDIA")).replace("NVIDIA GeForce ", "") + ")"
    per = collections.defaultdict(lambda: collections.defaultdict(float))        # (pid, luid) -> engtype -> somme
    for e in w.get("engine") or []:
        m = _ENG.search(e.get("n", ""))
        if m:
            per[(int(m.group(1)), m.group(2).lower())][m.group(3)] += e.get("u", 0)
    mem = {}
    for x in w.get("procmem") or []:
        m = _MEM.search(x.get("n", ""))
        if m:
            mem[(int(m.group(1)), m.group(2).lower())] = x.get("d", 0)
    rows = []
    for key in set(per) | set(mem):
        pid, luid = key
        util = min(100.0, max(per[key].values())) if per.get(key) else 0.0
        rows.append({"pid": pid, "name": _pname(pid), "util": round(util, 1), "vram_mb": round(mem.get(key, 0) / MB), "luid": luid,
                     "adapter": labels.get(luid, luid)})
    rows.sort(key=lambda r: (r["util"], r["vram_mb"]), reverse=True)
    return rows, labels


def _pname(pid):
    try:
        return psutil.Process(pid).name() if psutil else str(pid)
    except Exception:                                                # noqa: BLE001
        return "pid " + str(pid)


# ---------------------------------------------------------------- processus (fenêtre de mesure 1 s)
def sample_processes(window=1.0):
    """Liste de processus avec CPU % (normalisé 0-100 sur tous les cœurs), mémoire privée, E/S disque par seconde."""
    if not psutil:
        return []
    ncpu = psutil.cpu_count(logical=True) or 1
    procs, io0 = [], {}
    for p in psutil.process_iter(["pid", "name"]):
        if p.info["pid"] == 0:
            continue
        try:
            p.cpu_percent(None)
            io0[p.pid] = p.io_counters()
        except (psutil.Error, OSError):
            pass
        procs.append(p)
    t0 = time.time()
    time.sleep(window)
    dt = max(0.2, time.time() - t0)
    rows = []
    for p in procs:
        try:
            mi = p.memory_info()
            cpu = p.cpu_percent(None) / ncpu
            r = w = 0.0
            if p.pid in io0:
                io1 = p.io_counters()
                r, w = (io1.read_bytes - io0[p.pid].read_bytes) / dt, (io1.write_bytes - io0[p.pid].write_bytes) / dt
            rows.append({"pid": p.pid, "name": p.info["name"] or "?", "cpu": round(cpu, 1), "mem_mb": round(getattr(mi, "private", mi.rss) / MB),
                         "ws_mb": round(mi.rss / MB), "io_r": max(0.0, r), "io_w": max(0.0, w)})
        except (psutil.Error, OSError):
            continue
    return rows


def group_processes(rows):
    """Regroupe par nom d'exécutable (chrome.exe = 40 processus -> 1 ligne)."""
    g = {}
    for r in rows:
        k = r["name"].lower()
        x = g.setdefault(k, {"name": r["name"], "count": 0, "cpu": 0.0, "mem_mb": 0, "ws_mb": 0, "io_r": 0.0, "io_w": 0.0, "pids": []})
        x["count"] += 1
        x["cpu"] += r["cpu"]
        x["mem_mb"] += r["mem_mb"]
        x["ws_mb"] += r["ws_mb"]
        x["io_r"] += r["io_r"]
        x["io_w"] += r["io_w"]
        if len(x["pids"]) < 6:
            x["pids"].append(r["pid"])
    for x in g.values():
        x["cpu"] = round(x["cpu"], 1)
    return list(g.values())


def F(area, level, title, detail="", hint=""):
    return {"area": area, "level": level, "title": title, "detail": detail, "hint": hint}


KNOWN = {"avp.exe": "Kaspersky (antivirus)", "avpui.exe": "Kaspersky (interface)", "msmpeng.exe": "Microsoft Defender", "searchindexer.exe": "Indexation Windows",
         "onedrive.exe": "OneDrive (synchronisation)", "chrome.exe": "Google Chrome", "msedge.exe": "Microsoft Edge", "msedgewebview2.exe": "WebView2 (applications)",
         "firefox.exe": "Firefox", "discord.exe": "Discord", "code.exe": "VS Code", "explorer.exe": "Explorateur Windows", "dwm.exe": "Gestionnaire de fenêtres (affichage)",
         "vmmem": "WSL / machines virtuelles", "vmmemwsl": "WSL2", "docker desktop.exe": "Docker", "steam.exe": "Steam"}


# processus d'affichage / interface : sur un portable hybride ils tournent NORMALEMENT sur le GPU intégré (c'est lui qui pilote l'écran) ;
# applications qui s'exécutent légitimement sur les deux GPU : pas d'alerte « mauvais GPU » pour eux
_DISPLAY_SIDE = {"dwm.exe", "explorer.exe", "csrss.exe", "system", "winlogon.exe", "searchhost.exe", "startmenuexperiencehost.exe", "textinputhost.exe",
                 "shellexperiencehost.exe", "msedgewebview2.exe", "windowsterminal.exe", "applicationframehost.exe", "taskmgr.exe"}
KNOWN.update({"lenovovantage-(lenovogamingsystemaddin).exe": "Lenovo Vantage (module gaming)", "wmiprvse.exe": "Hôte WMI Windows"})


def _label(name):
    return KNOWN.get(name.lower(), name)


# ---------------------------------------------------------------- RAM
def diag_ram(groups):
    vm = psutil.virtual_memory()
    sw = psutil.swap_memory()
    total = vm.total / GB
    used = (vm.total - vm.available) / GB
    top = sorted(groups, key=lambda g: g["mem_mb"], reverse=True)[:10]
    out = {"total_gb": round(total, 1), "used_gb": round(used, 1), "pct": vm.percent, "swap_used_gb": round(sw.used / GB, 1), "swap_total_gb": round(sw.total / GB, 1),
           "top": [{**g, "label": _label(g["name"]), "share": round(g["mem_mb"] / (vm.total / MB) * 100, 1)} for g in top]}
    f = []
    if vm.percent >= 90:
        f.append(F("ram", "danger", f"RAM saturée : {used:.1f} / {total:.1f} Go ({vm.percent:.0f} %)", "Au-delà de ~90 %, Windows compresse et écrit sur le disque : tout ralentit, y compris Godot.",
                   "Fermez en priorité les applications de la liste ci-dessous."))
    elif vm.percent >= 80:
        f.append(F("ram", "warn", f"RAM chargée : {used:.1f} / {total:.1f} Go ({vm.percent:.0f} %)", "Peu de marge pour Godot et le jeu en test.", "Surveillez les plus gros consommateurs."))
    else:
        f.append(F("ram", "ok", f"RAM correcte : {used:.1f} / {total:.1f} Go ({vm.percent:.0f} %)"))
    for g in top[:3]:
        share = g["mem_mb"] / (vm.total / MB) * 100
        if share >= 12:
            n = f" ({g['count']} processus)" if g["count"] > 1 else ""
            f.append(F("ram", "warn" if share >= 25 else "info", f"{_label(g['name'])}{n} : {g['mem_mb'] / 1024:.1f} Go, {share:.0f} % de la RAM",
                       "Mémoire privée cumulée de tous ses processus (la mémoire partagée n'est pas comptée deux fois).",
                       "Navigateur : fermez les onglets inutiles ou activez les onglets en veille." if re.search(r"chrome|edge|firefox", g["name"], re.I) else ""))
    if sw.total and sw.used / GB >= 1.0:
        f.append(F("ram", "warn", f"Fichier d'échange utilisé : {sw.used / GB:.1f} Go", "Le système a déjà dû déborder de la RAM vers le disque.", "Libérer de la RAM évitera ces écritures disque."))
    return out, f


# ---------------------------------------------------------------- CPU
def diag_cpu(groups, hist_cpu=None):
    ncpu = psutil.cpu_count(logical=True)
    util = psutil.cpu_percent(interval=None)
    fr = psutil.cpu_freq()
    top = sorted(groups, key=lambda g: g["cpu"], reverse=True)[:8]
    total_proc = sum(g["cpu"] for g in groups)
    out = {"logical": ncpu, "util": round(total_proc, 1), "mhz": round(fr.current) if fr else None, "mhz_max": round(fr.max) if fr and fr.max else None,
           "top": [{**g, "label": _label(g["name"])} for g in top]}
    f = []
    if total_proc >= 85:
        f.append(F("cpu", "danger", f"CPU saturé : {total_proc:.0f} %", "", "Le plus gros consommateur est en tête de la liste ci-dessous."))
    elif total_proc >= 60:
        f.append(F("cpu", "warn", f"CPU très sollicité : {total_proc:.0f} %"))
    else:
        f.append(F("cpu", "ok", f"CPU disponible : {total_proc:.0f} % utilisé sur {ncpu} cœurs logiques"))
    for g in top[:3]:
        if g["cpu"] >= 8:
            f.append(F("cpu", "warn" if g["cpu"] >= 20 else "info", f"{_label(g['name'])} : {g['cpu']:.0f} % du CPU" + (f" ({g['count']} processus)" if g["count"] > 1 else ""),
                       "Mesuré sur 1 seconde, tous cœurs confondus.",
                       "Antivirus qui scanne : ajoutez vos dossiers de projets en exclusion." if g["name"].lower() in ("avp.exe", "msmpeng.exe") else
                       "Indexation Windows : excluez vos dossiers de projets de l'indexation." if g["name"].lower() == "searchindexer.exe" else ""))
    if fr and fr.max and util >= 50 and fr.current < fr.max * 0.6:
        f.append(F("cpu", "warn", f"Fréquence basse sous charge : {fr.current:.0f} MHz (max {fr.max:.0f})", "Le processeur est bridé (plan d'alimentation, thermique ou batterie).",
                   "Vérifiez le profil de performance et le Turbo Boost dans l'onglet Vue d'ensemble."))
    return out, f


# ---------------------------------------------------------------- GPU
def diag_gpu(w, groups_proc):
    nv = nasko_sysctl._gpu()
    rows, labels = gpu_by_process(w, nv)
    out = {"nvidia": nv, "adapters": sorted(set(labels.values())), "video": w.get("video") or [], "top": rows[:10]}
    f = []
    if nv:
        mem_pct = nv["mem_used_mb"] / nv["mem_total_mb"] * 100 if nv.get("mem_total_mb") else 0
        lvl = "danger" if (nv["util"] or 0) >= 95 else "warn" if (nv["util"] or 0) >= 80 else "ok"
        f.append(F("gpu", lvl, f"{nv['name']} : {nv['util']:.0f} % d'utilisation, {nv['temp']:.0f} °C, {nv['watts']:.0f} W"))
        if mem_pct >= 85:
            f.append(F("gpu", "danger" if mem_pct >= 95 else "warn", f"VRAM presque pleine : {nv['mem_used_mb'] / 1024:.1f} / {nv['mem_total_mb'] / 1024:.1f} Go",
                       "Quand la VRAM déborde, les textures passent par la RAM : saccades.", "Voir l'onglet Godot : textures non compressées et résolution des images."))
        if (nv["temp"] or 0) >= 83:
            f.append(F("gpu", "warn", f"GPU chaud : {nv['temp']:.0f} °C", "Au-delà de ~85 °C le GPU réduit ses fréquences (throttling).", "Plafonnez les FPS (V-Sync) et vérifiez le refroidissement."))
    else:
        f.append(F("gpu", "info", "nvidia-smi indisponible : seules les mesures Windows par processus sont disponibles"))
    busy = [r for r in rows if r["util"] >= 3 or r["vram_mb"] >= 150]
    for r in busy[:3]:
        f.append(F("gpu", "info", f"{_label(r['name'])} : {r['util']:.0f} % GPU, {r['vram_mb']} Mo de VRAM sur {r['adapter']}"))
    heavy_on_igpu = [r for r in rows if "intégré" in r["adapter"] and r["util"] >= 15 and r["name"].lower() not in _DISPLAY_SIDE]
    if len(labels) >= 2 and heavy_on_igpu:
        r = heavy_on_igpu[0]
        f.append(F("gpu", "warn", f"{_label(r['name'])} utilise le GPU intégré ({r['util']:.0f} %) alors qu'un GPU dédié est disponible",
                   "Sur un portable hybride, Windows envoie par défaut les applications peu connues sur le GPU économe.",
                   "Paramètres Windows › Système › Affichage › Graphismes › ajoutez l'exécutable › Options › Hautes performances."))
    return out, f


# ---------------------------------------------------------------- stockage (activité instantanée ; le contenu = storage_job)
def diag_storage(w, procs):
    vols = []
    for p in psutil.disk_partitions(all=False):
        if "cdrom" in (p.opts or "") or not p.fstype:
            continue
        try:
            u = psutil.disk_usage(p.mountpoint)
        except OSError:
            continue
        vols.append({"mount": p.mountpoint, "fstype": p.fstype, "total_gb": round(u.total / GB), "used_gb": round(u.used / GB), "free_gb": round(u.free / GB, 1), "pct": u.percent})
    disk = next((d for d in (w.get("disk") or []) if d.get("n") == "_Total"), None) or {}
    io = sorted(group_processes(procs), key=lambda g: g["io_r"] + g["io_w"], reverse=True)[:8]
    special = {}
    for name in ("pagefile.sys", "hiberfil.sys", "swapfile.sys"):
        try:
            special[name] = round(os.stat("C:\\" + name).st_size / GB, 1)
        except OSError:
            pass
    out = {"volumes": vols, "busy": disk.get("busy"), "queue": disk.get("q"), "read_bps": disk.get("r"), "write_bps": disk.get("w"), "special": special,
           "io_top": [{**g, "label": _label(g["name"])} for g in io if g["io_r"] + g["io_w"] > 50_000]}
    f = []
    for v in vols:
        if v["pct"] >= 90 or v["free_gb"] < 15:
            f.append(F("storage", "danger", f"Disque {v['mount']} presque plein : {v['free_gb']:.0f} Go libres ({v['pct']:.0f} % utilisé)",
                       "Un SSD très rempli ralentit les écritures et Godot (cache .godot, imports).", "Lancez « Analyser le contenu du disque » pour voir ce qui occupe la place."))
        elif v["pct"] >= 80:
            f.append(F("storage", "warn", f"Disque {v['mount']} : {v['pct']:.0f} % utilisé, {v['free_gb']:.0f} Go libres", "", "Lancez « Analyser le contenu du disque »."))
        else:
            f.append(F("storage", "ok", f"Disque {v['mount']} : {v['free_gb']:.0f} Go libres sur {v['total_gb']} Go"))
    if (disk.get("busy") or 0) >= 70:
        top = io[0] if io else None
        f.append(F("storage", "danger" if disk["busy"] >= 90 else "warn", f"Disque saturé : {disk['busy']} % d'activité, file d'attente {disk.get('q', 0):.1f}",
                   f"Plus gros écrivain/lecteur : {_label(top['name'])} ({(top['io_r'] + top['io_w']) / MB:.1f} Mo/s)" if top else "", "Antivirus, indexation ou synchronisation OneDrive sont les causes fréquentes."))
    elif io and (io[0]["io_r"] + io[0]["io_w"]) > 20 * MB:
        top = io[0]
        f.append(F("storage", "info", f"{_label(top['name'])} lit/écrit {(top['io_r'] + top['io_w']) / MB:.0f} Mo/s en ce moment"))
    big = {k: v for k, v in special.items() if v >= 8}
    for k, v in big.items():
        f.append(F("storage", "info", f"{k} : {v} Go", "Fichier système géré par Windows.", "hiberfil.sys peut être réduit/désactivé (powercfg /hibernate off) si vous n'utilisez pas l'hibernation." if k == "hiberfil.sys" else ""))
    return out, f


# ---------------------------------------------------------------- diagnostic complet
def run():
    if not psutil:
        return {"error": "psutil manquant (pip install psutil)"}
    t0 = time.time()
    with concurrent.futures.ThreadPoolExecutor(2) as ex:
        fw = ex.submit(wmi_snapshot)
        fp = ex.submit(sample_processes, 1.0)
        w, procs = fw.result(), fp.result()
    groups = group_processes(procs)
    ram, f_ram = diag_ram(groups)
    cpu, f_cpu = diag_cpu(groups)
    gpu, f_gpu = diag_gpu(w, groups)
    sto, f_sto = diag_storage(w, procs)
    return {"ram": ram, "cpu": cpu, "gpu": gpu, "storage": sto, "findings": f_ram + f_cpu + f_gpu + f_sto, "took": round(time.time() - t0, 1), "at": time.time()}


# ---------------------------------------------------------------- tâche de fond générique
class Job:
    """Une tâche à la fois, avec progression consultable (pour les analyses longues : disque, projet Godot)."""

    def __init__(self, fn):
        self._fn = fn
        self._lock = threading.Lock()
        self.s = {"state": "idle", "progress": "", "result": None, "error": "", "started": 0, "finished": 0}

    def progress(self, msg):
        with self._lock:
            self.s["progress"] = msg

    def start(self, *a, **kw):
        with self._lock:
            if self.s["state"] == "running":
                return False
            self.s = {"state": "running", "progress": "démarrage…", "result": None, "error": "", "started": time.time(), "finished": 0}
        threading.Thread(target=self._run, args=a, kwargs=kw, name="diag-job", daemon=True).start()
        return True

    def _run(self, *a, **kw):
        try:
            res = self._fn(self.progress, *a, **kw)
            with self._lock:
                self.s.update(state="done", result=res, finished=time.time(), progress="terminé")
        except Exception as e:                                       # noqa: BLE001 — l'erreur est renvoyée à l'interface, jamais propagée
            log.exception("tâche de diagnostic")
            with self._lock:
                self.s.update(state="error", error=f"{e.__class__.__name__}: {e}", finished=time.time())

    def status(self):
        with self._lock:
            return dict(self.s)


# ---------------------------------------------------------------- tailles de dossiers (échéance obligatoire)
_CLOUD = 0x1000 | 0x400000 | 0x40000                   # OFFLINE | RECALL_ON_DATA_ACCESS | RECALL_ON_OPEN : fichier OneDrive « en ligne seulement » (0 octet sur le disque)


def dir_size(root, deadline, top_files=None, want=0):
    """(octets, nb fichiers, partiel?, octets_cloud). N'entre pas dans les liens/jonctions. top_files : tas de (taille, chemin) à remplir."""
    size = files = cloud = 0
    stack = [root]
    while stack:
        if time.time() > deadline:
            return size, files, True, cloud
        try:
            with os.scandir(stack.pop()) as it:
                for e in it:
                    try:
                        if e.is_symlink():
                            continue
                        if e.is_dir(follow_symlinks=False):
                            stack.append(e.path)
                            continue
                        st = e.stat(follow_symlinks=False)
                    except OSError:
                        continue
                    if getattr(st, "st_file_attributes", 0) & _CLOUD:
                        cloud += st.st_size
                        continue
                    size += st.st_size
                    files += 1
                    if top_files is not None and st.st_size > want:
                        if len(top_files) < 15:
                            heapq.heappush(top_files, (st.st_size, e.path))
                        elif st.st_size > top_files[0][0]:
                            heapq.heapreplace(top_files, (st.st_size, e.path))
        except OSError:
            continue
    return size, files, False, cloud


def _storage_scan(progress, budget=70):
    home = os.path.expanduser("~")
    local = os.environ.get("LOCALAPPDATA") or os.path.join(home, "AppData", "Local")
    roam = os.environ.get("APPDATA") or os.path.join(home, "AppData", "Roaming")
    targets = []
    for base, tag in ((home, "Profil"), (local, "AppData\\Local"), (roam, "AppData\\Roaming")):
        try:
            for n in os.listdir(base):
                p = os.path.join(base, n)
                if os.path.isdir(p) and not os.path.islink(p) and (base == home and n != "AppData" or base != home):
                    targets.append((p, tag))
        except OSError:
            pass
    for p in (os.environ.get("TEMP"), r"C:\Windows\Temp", r"C:\Windows\SoftwareDistribution\Download", r"C:\Windows.old", r"C:\ProgramData"):
        if p and os.path.isdir(p) and all(p.lower() != t[0].lower() for t in targets):
            targets.append((p, "Système"))
    deadline = time.time() + budget
    per = max(4.0, budget / max(1, len(targets)) * 2.5)
    heap, rows = [], []
    for i, (p, tag) in enumerate(targets):
        if time.time() > deadline:
            break
        progress(f"{i + 1}/{len(targets)} : {p}")
        s, n, partial, cloud = dir_size(p, min(deadline, time.time() + per), heap, 200 * MB)
        rows.append({"path": p, "where": tag, "size": s, "files": n, "partial": partial, "cloud": cloud})
    rows.sort(key=lambda r: r["size"], reverse=True)
    findings = []
    for r in rows[:25]:
        gb, low = r["size"] / GB, r["path"].lower()
        if gb < 1.5:
            continue
        hint = ""
        if low.endswith("\\temp") or "softwaredistribution" in low:
            hint = "Dossier temporaire : généralement sûr à vider (fermez les applications avant)."
        elif "windows.old" in low:
            hint = "Ancienne installation de Windows : supprimable via « Nettoyage de disque » (jamais à la main)."
        elif "onedrive" in low:
            hint = "Fichiers OneDrive réellement présents sur le disque : « Libérer de l'espace » les remet en ligne seulement."
        elif "downloads" in low or "téléchargements" in low:
            hint = "Vérifiez les anciens installateurs et archives."
        elif "packages" in low or "docker" in low or "wsl" in low:
            hint = "Peut contenir des disques virtuels WSL/Docker (ext4.vhdx) : voir la liste des gros fichiers."
        findings.append(F("storage", "warn" if gb >= 15 else "info", f"{r['path']} : {gb:.1f} Go" + (" (analyse partielle)" if r["partial"] else ""), f"{r['files']:,} fichiers".replace(",", " "), hint))
    return {"folders": rows[:25], "big_files": [{"size": s, "path": p} for s, p in sorted(heap, reverse=True)], "findings": findings, "budget": budget, "took": round(time.time() - (deadline - budget), 1)}


storage_job = Job(_storage_scan)
