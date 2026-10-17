"""Analyse de l'éditeur Godot et d'un projet : où partent les FPS, et que changer SANS dégrader l'image.

LECTURE SEULE : le projet, project.godot et les réglages de l'éditeur ne sont jamais modifiés. Chaque recommandation cite les chiffres
mesurés sur VOTRE projet (preuve), dit où cliquer (comment) et est classée :
  sans_perte    : aucun changement visuel (V-Sync/plafond FPS, CSG converties, plugin inutile, cache, journal…)
  environnement : Windows / antivirus / GPU / disque (hors Godot lui-même)
  compromis     : un gain réel mais avec un effet visuel possible : à vous de juger, jamais présenté comme gratuit

  live()          : processus Godot en cours (éditeur / jeu), CPU, RAM, GPU utilisé (dédié ou intégré)
  projects()      : projets connus (projects.cfg de Godot + dossiers godot_* d'ENOS)
  analyze_job     : analyse d'un projet en tâche de fond (budget de temps, progression)
"""
import collections
import heapq
import logging
import os
import re
import struct
import time

import nasko_core
import nasko_diag as D

try:
    import psutil
except ImportError:
    psutil = None

log = logging.getLogger("nasko.godotdiag")
MB, GB = 2**20, 2**30
_KV = re.compile(r"^([A-Za-z0-9_./\-]+)\s*=\s*(.*)$")
IMG_EXT = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tga", ".exr", ".hdr"}
SCENE_EXT = {".tscn", ".tres", ".scn"}
CLOUD_DIRS = re.compile(r"onedrive|dropbox|google ?drive|icloud|sync", re.I)
AV = {"avp.exe": "Kaspersky", "msmpeng.exe": "Microsoft Defender", "avgsvc.exe": "AVG", "avastsvc.exe": "Avast", "mbamservice.exe": "Malwarebytes", "bdagent.exe": "Bitdefender", "mcshield.exe": "McAfee"}
GAMEDIR_CANDIDATES = re.compile(r"archive|backup|bak|\bold\b|source|sources|src_art|export|exports|raw|dump|concept|ref(erence)?s?\b|psd|aseprite|_old|trash|temp|tmp|screenshots?|captures?|sauvegarde|brouillon|essai|ancien|copie|rendus?\b", re.I)


def parse_cfg(text):
    """Lit project.godot / *.import / editor_settings.tres : {section: {clé: valeur brute}}. Les valeurs multi-lignes (touches, etc.) sont ignorées."""
    out, sec = {}, ""
    for line in text.splitlines():
        line = line.strip()
        if not line or line[0] in ";#":
            continue
        if line.startswith("["):
            sec = line.strip("[]").split(" ")[0]
            out.setdefault(sec, {})
            continue
        m = _KV.match(line)
        if m:
            out.setdefault(sec, {})[m.group(1)] = m.group(2).strip()
    return out


def _bool(v):
    return str(v).strip().lower() == "true"


def _num(v, d=None):
    try:
        return float(str(v).strip().strip('"'))
    except (TypeError, ValueError):
        return d


def _unq(v):
    return str(v).strip().strip('"') if v is not None else None


def rec(group, impact, title, evidence, how, gain=""):
    return {"group": group, "impact": impact, "title": title, "evidence": evidence, "how": how, "gain": gain}


# ---------------------------------------------------------------- environnement
def godot_exe():
    exe = (nasko_core.load_config() or {}).get("godot_path") or ""
    if exe and os.path.isfile(exe):
        return exe
    if psutil:
        for p in psutil.process_iter(["name", "exe"]):
            if re.match(r"godot", p.info["name"] or "", re.I) and p.info["exe"]:
                return p.info["exe"]
    return exe


def editor_settings_path():
    base = os.path.join(os.environ.get("APPDATA", ""), "Godot")
    try:
        files = [f for f in os.listdir(base) if re.match(r"editor_settings-[\d.]+\.tres$", f)]
    except OSError:
        return None
    files.sort(key=lambda f: [int(x) for x in re.findall(r"\d+", f)], reverse=True)
    return os.path.join(base, files[0]) if files else None


def projects():
    items = []
    cfg = os.path.join(os.environ.get("APPDATA", ""), "Godot", "projects.cfg")
    try:
        with open(cfg, encoding="utf-8") as f:
            for sec in parse_cfg(f.read()):
                if sec:
                    p = os.path.normpath(sec)
                    if os.path.isfile(os.path.join(p, "project.godot")):
                        items.append({"path": p, "name": os.path.basename(p), "src": "Gestionnaire de projets Godot"})
    except OSError:
        pass
    here = os.path.dirname(os.path.abspath(__file__))
    try:
        for n in sorted(os.listdir(here)):
            p = os.path.join(here, n)
            if n.startswith("godot_") and os.path.isfile(os.path.join(p, "project.godot")):
                items.append({"path": p, "name": n, "src": "ENOS"})
    except OSError:
        pass
    return items


def _hybrid(video):
    gpus = [v for v in video if re.search(r"nvidia|radeon|intel.*(graphics|uhd|iris|arc)", v, re.I)]
    dgpu = any(re.search(r"nvidia|geforce|rtx|gtx|radeon rx|arc a", v, re.I) for v in gpus)
    return len(gpus) >= 2 and dgpu, gpus


def gpu_preference(exe):
    """'high' / 'power' / 'auto' (aucune entrée = Windows décide) pour cet exécutable, d'après HKCU\\...\\UserGpuPreferences."""
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\DirectX\UserGpuPreferences") as k:
            i = 0
            while True:
                try:
                    name, val, _ = winreg.EnumValue(k, i)
                except OSError:
                    break
                i += 1
                if exe and os.path.normcase(os.path.normpath(name)) == os.path.normcase(os.path.normpath(exe)):
                    m = re.search(r"GpuPreference=(\d)", str(val))
                    return {"2": "high", "1": "power"}.get(m.group(1) if m else "", "auto")
    except OSError:
        pass
    return "auto"


# ---------------------------------------------------------------- Godot en cours d'exécution
def live():
    if not psutil:
        return {"running": False, "procs": [], "findings": []}
    gp = []
    for p in psutil.process_iter(["pid", "name", "exe", "cmdline", "ppid"]):
        if re.match(r"godot", p.info["name"] or "", re.I):
            gp.append(p)
    if not gp:
        return {"running": False, "procs": [], "findings": [D.F("godot", "info", "Godot n'est pas lancé", "", "Lancez l'éditeur (et jouez la scène) puis relancez cette mesure : on voit alors quel GPU il utilise et ce qu'il consomme.")]}
    ncpu = psutil.cpu_count(logical=True) or 1
    for p in gp:
        try:
            p.cpu_percent(None)
        except psutil.Error:
            pass
    time.sleep(1.5)
    w = D.wmi_snapshot()
    nv = D.nasko_sysctl._gpu()
    rows, labels = D.gpu_by_process(w, nv)
    procs, findings = [], []
    for p in gp:
        try:
            cmd = " ".join(p.info["cmdline"] or [])
            role = "jeu (lancé depuis l'éditeur)" if "--remote-debug" in cmd else "éditeur" if re.search(r"(^|\s)(--editor|-e)(\s|$)", cmd) else "gestionnaire de projets" if "--project-manager" in cmd else "éditeur ou jeu"
            cpu = p.cpu_percent(None) / ncpu
            mi = p.memory_info()
            g = [r for r in rows if r["pid"] == p.pid]
            procs.append({"pid": p.pid, "role": role, "cpu": round(cpu, 1), "mem_mb": round(getattr(mi, "private", mi.rss) / MB), "threads": p.num_threads(),
                          "gpu_util": max([r["util"] for r in g], default=0), "vram_mb": sum(r["vram_mb"] for r in g),
                          "adapters": sorted({r["adapter"] for r in g if r["util"] >= 1 or r["vram_mb"] >= 50}), "cmd": cmd[:160]})
        except psutil.Error:
            continue
    for x in procs:
        lbl = f"Godot ({x['role']}, pid {x['pid']})"
        findings.append(D.F("godot", "info", f"{lbl} : {x['cpu']:.0f} % CPU, {x['mem_mb'] / 1024:.1f} Go RAM, GPU {x['gpu_util']:.0f} %, {x['vram_mb']} Mo VRAM sur {', '.join(x['adapters']) or 'aucun GPU actif'}"))
        if any("intégré" in a for a in x["adapters"]) and not any("dédié" in a for a in x["adapters"]) and len(labels) >= 2:
            findings.append(D.F("godot", "danger", f"CONFIRMÉ : {lbl} s'exécute sur le GPU intégré, pas sur la GTX", "C'est la cause la plus fréquente de FPS très bas sur un portable hybride.",
                                "Paramètres Windows › Système › Affichage › Graphismes › Godot › Options › Hautes performances (voir l'onglet Recommandations)."))
        if x["role"] == "éditeur" and x["cpu"] >= 15:
            findings.append(D.F("godot", "warn", f"L'éditeur consomme {x['cpu']:.0f} % du CPU", "Un éditeur au repos devrait rester sous ~5 %. Scan de fichiers, plugin ou import en cours ?",
                                "Laissez finir l'import (barre en haut à droite), puis voir plugins et antivirus."))
    return {"running": True, "procs": procs, "findings": findings, "adapters": sorted(set(labels.values()))}


# ---------------------------------------------------------------- analyse de projet
def _png_size(path):
    try:
        with open(path, "rb") as f:
            h = f.read(24)
        if h[:8] == b"\x89PNG\r\n\x1a\n":
            return struct.unpack(">II", h[16:24])
    except OSError:
        pass
    return None


def _img_size(path):
    if path.lower().endswith(".png"):
        return _png_size(path)
    try:
        from PIL import Image
        with Image.open(path) as im:
            return im.size
    except Exception:                                               # noqa: BLE001 — format exotique : ignoré
        return None


def _walk_project(root, deadline, progress):
    st = {"files": 0, "bytes": 0, "ext": collections.Counter(), "ext_bytes": collections.Counter(), "dirs": collections.Counter(), "dir_bytes": collections.Counter(),
          "gdignore": [], "addons_files": 0, "tmp": [], "zips": [], "big": [], "scenes": [], "scripts": [], "imports": [], "images": [], "partial": False}
    stack = [(root, 0)]
    while stack:
        if time.time() > deadline:
            st["partial"] = True
            break
        d, depth = stack.pop()
        try:
            it = list(os.scandir(d))
        except OSError:
            continue
        if any(e.name == ".gdignore" for e in it):
            st["gdignore"].append(os.path.relpath(d, root))
            continue
        for e in it:
            try:
                if e.is_dir(follow_symlinks=False):
                    if not e.name.startswith("."):                  # Godot ignore les dossiers cachés (.git, .godot…)
                        stack.append((e.path, depth + 1))
                    continue
                size = e.stat(follow_symlinks=False).st_size
            except OSError:
                continue
            ext = os.path.splitext(e.name)[1].lower()
            st["files"] += 1
            st["bytes"] += size
            st["ext"][ext] += 1
            st["ext_bytes"][ext] += size
            parts = os.path.relpath(d, root).split(os.sep)
            top = (parts[0] if parts[0] != "." else "(racine)")
            st["dirs"][top] += 1
            st["dir_bytes"][top] += size
            if ext == ".tmp":
                st["tmp"].append((size, e.path))
            elif ext == ".zip" or ext == ".rar" or ext == ".7z":
                st["zips"].append((size, e.path))
            in_addons = parts[0] == "addons"
            st["addons_files"] += in_addons
            if ext in SCENE_EXT:
                if not in_addons:
                    st["scenes"].append(e.path)
            elif ext == ".gd":
                if not in_addons:
                    st["scripts"].append(e.path)
            elif ext == ".import":
                st["imports"].append(e.path)
            elif ext in IMG_EXT:
                st["images"].append((e.path, size))
            if len(st["big"]) < 12:
                heapq.heappush(st["big"], (size, e.path))
            elif size > st["big"][0][0]:
                heapq.heapreplace(st["big"], (size, e.path))
        progress(f"{st['files']:,} fichiers parcourus".replace(",", " "))
    return st


def _scan_imports(images, deadline, root, progress=None, limit=3500, refs=frozenset()):
    """Textures : mode de compression, mipmaps, taille VRAM du pire cas (tout chargé en même temps).
    Les images sont traitées de la plus lourde à la plus légère : ce sont elles qui dominent la VRAM. `coverage` = part du poids total
    des images réellement examinée (les ouvertures de fichiers sont lentes quand un antivirus les scanne)."""
    modes, mip = collections.Counter(), 0
    vram, over2048, over4096, sized = 0, 0, 0, 0
    used = {"vram": 0, "n": 0, "over2048": 0, "over4096": 0, "modes": collections.Counter(), "mip": 0}
    heap = []
    total_bytes = sum(sz for _, sz in images) or 1
    done_bytes = 0
    order = sorted(images, key=lambda x: x[1], reverse=True)[:limit]
    scanned = 0
    for img, size in order:
        if time.time() > deadline:
            break
        scanned += 1
        done_bytes += size
        if progress and scanned % 250 == 0:
            progress(f"textures : {scanned} / {min(limit, len(order))}")
        try:
            with open(img + ".import", encoding="utf-8", errors="ignore") as f:
                txt = f.read(5000)
        except OSError:
            continue                                                 # image sans .import (pas encore importée / ignorée)
        if 'importer="texture"' not in txt:
            continue
        m = re.search(r"compress/mode=(\d)", txt)
        mode = int(m.group(1)) if m else 0
        modes[mode] += 1
        has_mip = "mipmaps/generate=true" in txt
        mip += has_mip
        sz = _img_size(img)
        if not sz:
            continue
        w, h = sz
        sized += 1
        bpp = 1 if mode == 2 else 4                                  # VRAM compressée : ~1 octet/pixel ; Lossless/Lossy/Uncompressed : décompressées en RGBA8
        b = w * h * bpp * (1.33 if has_mip else 1)
        vram += b
        over2048 += max(w, h) >= 2048
        over4096 += max(w, h) >= 4096
        rel = os.path.relpath(img, root).replace(os.sep, "/")
        if rel in refs:                                              # texture explicitement référencée par une scène ou un script de VOTRE jeu
            used["vram"] += b
            used["n"] += 1
            used["over2048"] += max(w, h) >= 2048
            used["over4096"] += max(w, h) >= 4096
            used["modes"][mode] += 1
            used["mip"] += has_mip
            if len(heap) < 10:
                heapq.heappush(heap, (b, rel, w, h, mode))
            elif b > heap[0][0]:
                heapq.heapreplace(heap, (b, rel, w, h, mode))
    return {"modes": dict(modes), "mipmaps": mip, "vram_gb": round(vram / GB, 2), "used": {"vram_gb": round(used["vram"] / GB, 2), "n": used["n"], "over2048": used["over2048"], "over4096": used["over4096"], "modes": dict(used["modes"]), "mip": used["mip"]}, "sized": sized, "over2048": over2048, "over4096": over4096,
            "top": [{"path": p, "w": w, "h": h, "mode": m, "mb": round(b / MB)} for b, p, w, h, m in sorted(heap, reverse=True)],
            "scanned": scanned, "images": len(images), "coverage": round(done_bytes / total_bytes * 100)}


_REF = re.compile(r"res://([^\"'\s)\]]+?\.(?:png|jpe?g|webp|svg|exr|hdr|tga|bmp))", re.I)
_ENV_FLAGS = ("glow_enabled", "sdfgi_enabled", "ssao_enabled", "ssil_enabled", "ssr_enabled", "volumetric_fog_enabled", "fog_enabled", "ssr_enabled", "adjustment_enabled")
_NODE = re.compile(r'^\[node name="[^"]*"(?: type="([^"]+)")?')


def _scan_scenes(paths, deadline):
    types, flags = collections.Counter(), collections.Counter()
    csg_files = collections.Counter()
    shadows = 0
    done = 0
    refs = set()
    for p in paths:
        if time.time() > deadline:
            break
        try:
            with open(p, encoding="utf-8", errors="ignore") as f:
                for line in f:
                    if "res://" in line:
                        refs.update(m.replace("\\", "/") for m in _REF.findall(line))
                    if line.startswith("[node "):
                        m = _NODE.match(line)
                        if m and m.group(1):
                            t = m.group(1)
                            types[t] += 1
                            if t.startswith("CSG"):
                                csg_files[p] += 1
                    elif " = true" in line:
                        k = line.split(" = ", 1)[0]
                        if k in _ENV_FLAGS:
                            flags[k] += 1
                        elif k == "shadow_enabled":
                            shadows += 1
        except OSError:
            continue
        done += 1
    d3 = sum(n for t, n in types.items() if t.endswith("3D") or t in ("WorldEnvironment",) or t.startswith("CSG"))
    d2 = sum(n for t, n in types.items() if t.endswith("2D") or t.endswith("Container") or t in ("Control", "Label", "Button", "Panel", "TextureRect", "ColorRect", "CanvasLayer", "RichTextLabel"))
    return {"types": types.most_common(12), "flags": dict(flags), "shadows": shadows, "n3d": d3, "n2d": d2, "scanned": done,
            "csg": sum(n for t, n in types.items() if t.startswith("CSG")), "csg_files": csg_files.most_common(6),
            "refs": refs, "particles": sum(n for t, n in types.items() if "Particles" in t), "tilemaps": types.get("TileMapLayer", 0) + types.get("TileMap", 0)}


def _scan_scripts(paths, deadline):
    proc = phys = prints = 0
    by_print = collections.Counter()
    done = 0
    refs = set()
    dyn = 0
    for p in paths:
        if time.time() > deadline:
            break
        try:
            with open(p, encoding="utf-8", errors="ignore") as f:
                txt = f.read()
        except OSError:
            continue
        refs.update(_REF.findall(txt))
        dyn += len(re.findall(r"""res://[^"']*["']\s*(?:\+|%)|(?:load|preload)\(\s*[A-Za-z_$]|DirAccess\.open\(|ResourceLoader\.(?:load|exists)\(\s*[A-Za-z_]""", txt))
        proc += len(re.findall(r"^func _process\(", txt, re.M))
        phys += len(re.findall(r"^func _physics_process\(", txt, re.M))
        n = len(re.findall(r"\bprint(?:_rich|_verbose)?\(|\bprinterr\(|\bpush_warning\(", txt))
        prints += n
        if n:
            by_print[p] = n
        done += 1
    return {"process": proc, "physics": phys, "prints": prints, "top_prints": by_print.most_common(5), "scanned": done, "refs": refs, "dynamic": dyn}


def _analyze(progress, project=None, budget=60):
    if not psutil:
        raise RuntimeError("psutil manquant")
    known = [p["path"] for p in projects()]
    root = os.path.normpath(project) if project else (known[0] if known else None)
    if not root or not os.path.isfile(os.path.join(root, "project.godot")):
        raise RuntimeError("projet introuvable (project.godot manquant)")
    t0 = time.time()
    deadline = t0 + budget
    progress("lecture de project.godot")
    with open(os.path.join(root, "project.godot"), encoding="utf-8", errors="ignore") as f:
        P = parse_cfg(f.read())
    app, disp, rend, phys = P.get("application", {}), P.get("display", {}), P.get("rendering", {}), P.get("physics", {})
    feats = app.get("config/features", "")
    renderer = "Forward+" if "Forward Plus" in feats else "Mobile" if "Mobile" in feats else "Compatibility" if "GL Compatibility" in feats else "Forward+"
    progress("parcours des fichiers")
    st = _walk_project(root, min(deadline, t0 + 25), progress)
    progress("analyse des scènes")
    sc = _scan_scenes(st["scenes"], min(deadline, time.time() + 10))
    progress("analyse des scripts")
    sr = _scan_scripts(st["scripts"], min(deadline, time.time() + 8))
    refs = sc["refs"] | sr["refs"]
    progress("lecture des réglages d'import")
    imp = _scan_imports(st["images"], min(deadline, time.time() + 25), root, progress, refs=refs)
    progress("taille du cache .godot")
    cache_b = D.dir_size(os.path.join(root, ".godot"), time.time() + 6)[0]
    progress("environnement Windows")
    exe = godot_exe()
    w = D.wmi_snapshot()
    hybrid, gpus = _hybrid(w.get("video") or [])
    pref = gpu_preference(exe)
    avs = sorted({AV[p.info["name"].lower()] for p in psutil.process_iter(["name"]) if (p.info["name"] or "").lower() in AV})
    av_ram = sum(p.memory_info().rss for p in psutil.process_iter(["name"]) if (p.info["name"] or "").lower() in AV) / MB if avs else 0
    vm = psutil.virtual_memory()
    try:
        du = psutil.disk_usage(os.path.splitdrive(root)[0] + "\\")
    except OSError:
        du = None
    # RAM par application (mémoire privée), sans fenêtre de mesure
    ram_groups = collections.Counter()
    for p in psutil.process_iter(["name", "memory_info"]):
        try:
            mi = p.info["memory_info"]
            ram_groups[p.info["name"] or "?"] += getattr(mi, "private", mi.rss)
        except (psutil.Error, AttributeError):
            pass
    top_ram = ram_groups.most_common(1)[0] if ram_groups else None

    recs, ok = [], []
    n_files = f"{st['files']:,}".replace(",", " ")
    # ---------- environnement
    if du and (du.free / GB < 25 or du.percent >= 90):
        recs.append(rec("environnement", "high", f"Disque du projet presque plein : {du.free / GB:.0f} Go libres ({du.percent:.0f} % utilisé)",
                        f"Le cache .godot fait {cache_b / GB:.1f} Go et se reconstruit à chaque ré-import. Un SSD plein à ce point ralentit fortement les écritures.",
                        "Libérez de la place (onglet Diagnostic › Analyser le contenu du disque). Visez au moins 15 % de libre.", "Import, sauvegarde et chargement de l'éditeur"))
    if avs and st["files"] >= 3000:
        recs.append(rec("environnement", "high", f"Exclure le projet de l'antivirus ({', '.join(avs)})",
                        f"{', '.join(avs)} est actif ({av_ram:.0f} Mo de RAM) et le projet compte {n_files} fichiers dont {len(st['imports']):,} .import : chaque ouverture, import et sauvegarde est scanné.".replace(",", " "),
                        f"Dans l'antivirus, ajoutez en exclusion : le dossier {root}, le sous-dossier {os.path.join(root, '.godot')}, l'exécutable {exe or 'Godot'} et le dossier {os.path.join(os.environ.get('APPDATA', ''), 'Godot')}. À faire seulement pour vos propres projets.",
                        "Ouverture du projet, import des ressources, réactivité de l'éditeur"))
    if hybrid:
        if pref != "high":
            recs.append(rec("environnement", "high", "Forcer Godot sur le GPU dédié (portable hybride)",
                            f"Cartes détectées : {', '.join(gpus)}. Aucune préférence « Hautes performances » n'est enregistrée pour {os.path.basename(exe) or 'Godot'} (état : {pref}), alors que d'autres applications en ont une. Windows envoie par défaut les applications non listées sur le GPU économe.",
                            f"Paramètres › Système › Affichage › Graphismes › Parcourir › {exe or 'Godot.exe'} › Options › Hautes performances. Ou en ligne de commande : reg add \"HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences\" /v \"{exe}\" /t REG_SZ /d \"GpuPreference=2;\" /f . Faites de même pour l'exécutable exporté de votre jeu.",
                            "FPS de l'éditeur et du jeu (souvent le plus gros gain sur un portable hybride)"))
        else:
            ok.append("Godot est réglé sur « Hautes performances » dans Windows")
    if CLOUD_DIRS.search(root):
        recs.append(rec("environnement", "high", "Le projet est dans un dossier synchronisé (OneDrive/Dropbox…)",
                        f"Chemin : {root}. La synchronisation relit et verrouille les milliers de fichiers du cache .godot.", "Déplacez le projet hors du dossier synchronisé (ex. C:\\Projets) et utilisez Git pour la sauvegarde."))
    else:
        ok.append("Le projet n'est pas dans un dossier synchronisé")
    if vm.percent >= 80 and top_ram:
        recs.append(rec("environnement", "medium", f"RAM déjà à {vm.percent:.0f} % avant d'ouvrir Godot",
                        f"Plus gros consommateur : {D._label(top_ram[0])} ({top_ram[1] / GB:.1f} Go). Godot et le jeu en test se retrouvent à swapper sur le disque.",
                        "Fermez le navigateur et les applications inutiles pendant que vous travaillez sur Godot.", "Saccades et temps de chargement"))
    # ---------- sans perte visuelle
    vs, mfps = _num(disp.get("window/vsync/vsync_mode")), _num(app.get("run/max_fps"), 0)
    if vs == 0 and not mfps:
        recs.append(rec("sans_perte", "high", "Activer le V-Sync ou plafonner les FPS",
                        f"vsync_mode = 0 (désactivé) et aucun application/run/max_fps : le jeu et la fenêtre de test tournent aussi vite que possible, GPU poussé au maximum, sans qu'un seul pixel de plus soit visible au-delà de la fréquence de l'écran.",
                        "Project Settings › Display › Window › V-Sync Mode = Enabled (ou Application › Run › Max FPS = 60/144 selon l'écran). Gardez-le à 0 uniquement pour mesurer les performances.", "Charge GPU, chaleur, bruit des ventilateurs, FPS plus stables"))
    elif vs is not None and vs != 0:
        ok.append("V-Sync actif (FPS plafonnés à l'écran)")
    if _bool(app.get("run/flush_stdout_on_print")) and sr["prints"] >= 30:
        recs.append(rec("sans_perte", "medium", "Désactiver flush_stdout_on_print",
                        f"Activé dans le projet, avec {sr['prints']} appels print/push_warning dans les scripts : chaque affichage force une écriture immédiate de la sortie.",
                        "Project Settings › Application › Run › Flush Stdout On Print = off (à réactiver seulement pour déboguer un plantage).", "Moins de micro-saccades quand le jeu écrit dans la console"))
    if sc["csg"] >= 10:
        files = ", ".join(os.path.relpath(p, root) + f" ({n})" for p, n in sc["csg_files"][:3])
        recs.append(rec("sans_perte", "medium", f"Convertir les {sc['csg']} nœuds CSG en maillages",
                        f"Les CSG recalculent leur géométrie à chaque modification et sont coûteux dans l'éditeur comme au runtime. Scènes concernées : {files}.",
                        "Sélectionnez le nœud CSG racine › menu CSG de la barre 3D › Bake Mesh Instance (et Bake Collision Shape), puis supprimez le CSG. Le rendu reste identique.", "Éditeur 3D plus fluide, moins de CPU/GPU en jeu"))
    drv = _unq(rend.get("rendering_device/driver.windows"))
    if drv == "d3d12":
        recs.append(rec("sans_perte", "medium", "Tester le driver Vulkan à la place de D3D12",
                        "rendering_device/driver.windows = d3d12 : c'est le backend de rendu le plus récent de Godot, en général moins éprouvé et moins optimisé que Vulkan (le défaut).",
                        "Project Settings › Rendering › Rendering Device › Driver (Windows) = vulkan, redémarrez Godot et comparez les FPS. Si c'est pareil ou mieux, gardez Vulkan. Même image.", "Peut améliorer les FPS (à mesurer)"))
    elif drv:
        ok.append(f"Driver de rendu : {drv}")
    if renderer == "Forward+" and sc["scanned"] and sc["n2d"] > 3 * max(1, sc["n3d"]) and not any(sc["flags"].get(k) for k in ("sdfgi_enabled", "ssao_enabled", "ssil_enabled", "ssr_enabled", "volumetric_fog_enabled")):
        recs.append(rec("sans_perte", "medium", "Essayer le moteur de rendu Mobile (projet surtout 2D)",
                        f"Projet à dominante 2D ({sc['n2d']} nœuds 2D/UI contre {sc['n3d']} nœuds 3D) en Forward+, et aucune fonction exclusive à Forward+ (SDFGI, SSAO, SSIL, SSR, brouillard volumétrique) n'est activée dans vos scènes. Le glow et le HDR 2D existent aussi en Mobile.",
                        "Project Settings › Rendering › Renderer › Rendering Method = Mobile, redémarrez et comparez visuellement quelques scènes. Annulez si un effet disparaît.", "Moins de charge GPU sur un GPU 4 Go"))
    if "Todo_Manager" in " ".join(P.get("editor_plugins", {}).values()) and st["files"] >= 3000:
        recs.append(rec("sans_perte", "high", "Désactiver (ou restreindre) le plugin Todo_Manager",
                        f"Activé dans le projet : il parcourt tous les fichiers ({n_files}) pour y chercher des TODO, et se relance à chaque enregistrement.",
                        "Project Settings › Plugins › décocher Todo_Manager quand vous n'en avez pas besoin, ou dans ses paramètres : ignorer .godot, addons, les dossiers d'assets et les archives.", "Éditeur plus réactif à l'enregistrement et au démarrage"))
    tmp_total = sum(s for s, _ in st["tmp"])
    if tmp_total >= 50 * MB:
        big = sorted(st["tmp"], reverse=True)[:3]
        recs.append(rec("sans_perte", "medium", f"{len(st['tmp'])} fichiers .tmp dans le projet ({tmp_total / MB:.0f} Mo)",
                        "Restes de rechargements à chaud de plugins natifs (DLL temporaires de addons/…) ou d'un plantage ; Godot ne les utilise pas mais les parcourt. Plus gros : " + " ; ".join(f"{os.path.relpath(p, root)} ({s / MB:.0f} Mo)" for s, p in big),
                        "Vérifiez qu'ils sont anciens et que l'éditeur est fermé, puis supprimez-les (ou ajoutez *.tmp au .gitignore).", "Libère de l'espace disque, scan plus rapide"))
    if len(st["zips"]) >= 10:
        zs = sum(s for s, _ in st["zips"])
        recs.append(rec("sans_perte", "low", f"{len(st['zips'])} archives (.zip…) dans le projet ({zs / MB:.0f} Mo)",
                        "Godot les indexe à chaque scan sans pouvoir les importer.", "Rangez-les hors du projet, ou dans un dossier contenant un fichier vide nommé .gdignore (Godot l'ignore alors complètement)."))
    img_dir = collections.defaultdict(lambda: [0, 0, 0])             # dossier de 1er niveau -> [images, référencées, octets non référencés]
    for ip, size in st["images"]:
        rel = os.path.relpath(ip, root).replace(os.sep, "/")
        top = rel.split("/")[0]
        if top == "addons":
            continue
        img_dir[top][0] += 1
        if rel in refs:
            img_dir[top][1] += 1
        else:
            img_dir[top][2] += size
    dynamic = sr["dynamic"] >= 5
    unused = sorted(((d, v[0] - v[1], v[0], v[2]) for d, v in img_dir.items() if v[0] - v[1] >= 150), key=lambda x: x[1], reverse=True)
    if dynamic:                                                      # le code construit des chemins : « non référencée » ne prouve rien, sauf pour les dossiers manifestement de déchet
        unused = [x for x in unused if GAMEDIR_CANDIDATES.search(x[0]) or x[1] == x[2]]
    if unused:
        tot_n, tot_b = sum(x[1] for x in unused), sum(x[3] for x in unused)

        def _line(d, n, tot, b):
            hint = " (nom évoquant une archive/source)" if GAMEDIR_CANDIDATES.search(d) else ""
            return f"{d} : {n} images sur {tot} non référencées, {b / MB:.0f} Mo{hint}" + (" — aucune n'est référencée" if n == tot else "")
        caveat = (f" ATTENTION : votre code construit des chemins à l'exécution ({sr['dynamic']} endroits : concaténation, DirAccess, load(variable)) : « non référencée » ne veut donc PAS dire « inutilisée ». Seuls les dossiers à nom d'archive ou entièrement non référencés sont listés."
                  if dynamic else "")
        recs.append(rec("sans_perte", "medium" if dynamic else ("high" if tot_n >= 1000 else "medium"), f"{tot_n} images importées sans être référencées par vos scènes/scripts ({tot_b / MB:.0f} Mo) : à vérifier",
                        "Godot importe chacune (un .import + une copie dans .godot/imported) et la liste dans l'éditeur. Dossiers : " + " ; ".join(_line(*x) for x in unused[:5]) + "." + caveat,
                        "Vérifiez dossier par dossier que le jeu ne les charge pas par code. Dossier réellement inutile : créez-y un fichier vide .gdignore. Dossier mixte : déplacez les inutiles hors du projet. Aucun effet visuel si vous ne retirez que des images inutilisées.",
                        "Ouverture du projet, ré-imports et scan du système de fichiers plus rapides"))
    # réglages de l'éditeur (fichier lu, jamais écrit)
    es_path = editor_settings_path()
    es = {}
    if es_path:
        try:
            with open(es_path, encoding="utf-8", errors="ignore") as f:
                es = parse_cfg(f.read()).get("resource", {})
        except OSError:
            pass
    checks = [("interface/editor/display/update_continuously", lambda v: _bool(v), "Mise à jour continue de l'éditeur activée",
               "L'éditeur redessine en permanence au lieu de seulement quand quelque chose change : CPU/GPU constamment sollicités.", "Editor Settings › Interface › Editor › Update Continuously = off"),
              ("interface/editor/timers/low_processor_mode_sleep_usec", lambda v: (_num(v, 6900) or 6900) < 6000, "Veille de l'éditeur trop courte",
               "Une valeur basse force l'éditeur à tourner plus vite que nécessaire (6900 µs ≈ 145 images/s par défaut).", "Editor Settings › Interface › Editor › Low Processor Mode Sleep (µs) = 6900 ou 16600"),
              ("interface/editor/timers/unfocused_low_processor_mode_sleep_usec", lambda v: (_num(v, 100000) or 100000) < 50000, "Veille hors focus trop courte",
               "Quand la fenêtre n'est pas au premier plan l'éditeur devrait presque dormir.", "Editor Settings › Interface › Editor › Unfocused Low Processor Mode Sleep = 100000"),
              ("interface/editor/behavior/import_resources_when_unfocused", lambda v: _bool(v), "Import en arrière-plan quand l'éditeur n'a pas le focus",
               "Les ré-imports se déclenchent pendant que vous êtes dans un autre programme et concurrencent le jeu en test.", "Editor Settings › Interface › Editor › Import Resources When Unfocused = off"),
              ("interface/editor/display/vsync_mode", lambda v: _num(v) == 0, "V-Sync de l'éditeur désactivé", "La fenêtre de l'éditeur dessine sans limite.", "Editor Settings › Interface › Editor › V-Sync Mode = Enabled")]
    bad = 0
    for key, is_bad, title, why, how in checks:
        if key in es and is_bad(es[key]):
            recs.append(rec("sans_perte", "medium", title, f"{key} = {es[key]}. {why}", how, "CPU/GPU de l'éditeur au repos"))
            bad += 1
    if es and not bad:
        ok.append("Réglages de l'éditeur déjà optimaux (mise à jour continue off, veille 6900 µs, V-Sync actif, pas d'import hors focus)")
    # ---------- compromis
    u = imp["used"]
    if u["n"]:
        lossless = u["modes"].get(0, 0) + u["modes"].get(1, 0) + u["modes"].get(3, 0)
        if u["vram_gb"] >= 1.5:
            tops = " ; ".join(f"{t['path']} {t['w']}×{t['h']} ({t['mb']} Mo)" for t in imp["top"][:4])
            recs.append(rec("compromis", "high" if u["vram_gb"] >= 3 else "medium", f"Textures de votre jeu : {u['vram_gb']:.1f} Go de VRAM si tout est chargé en même temps",
                            f"{u['n']} textures référencées par vos scènes/scripts (sur {imp['sized']} mesurées, plus lourdes d'abord), dont {u['over2048']} de 2048 px ou plus ({u['over4096']} de 4096+). {lossless} ne sont PAS en VRAM compressée : elles occupent 4 octets par pixel en mémoire vidéo. Votre carte a 4 Go. En pratique seul le niveau en cours est chargé : regardez les plus grosses. Plus lourdes : {tops}.",
                            "Pour les plus grandes seulement : double-clic sur l'image › onglet Import › Compress Mode = VRAM Compressed (÷4 en VRAM), ou réduisez à la résolution réellement affichée (Process › Size Limit). Les grandes feuilles de sprites (ex. 14000×1000) sont de bons candidats. Effet visuel : léger sur les dégradés ; à éviter sur le pixel art net. Vérifiez image par image.",
                            "Évite le débordement de VRAM vers la RAM (saccades de chargement)"))
        if u["mip"] >= 5:
            recs.append(rec("compromis", "low", f"{u['mip']} textures utilisées avec mipmaps",
                            "Les mipmaps ajoutent ~33 % de VRAM. Utiles seulement quand une texture est affichée bien plus petite que sa taille réelle ou en 3D.",
                            "Désactivez Mipmaps › Generate pour les textures 2D affichées à taille normale : aucun changement visible dans ce cas ; vérifiez le dézoom de caméra."))
    if u["n"] and u["vram_gb"] < 1.5:
        ok.append(f"Textures : pas un goulot d'étranglement ({u['vram_gb']:.1f} Go de VRAM pour les {u['n']} textures référencées)")
    if sc["flags"].get("glow_enabled"):
        ok.append(f"Glow activé dans {sc['flags']['glow_enabled']} environnements : cohérent avec hdr_2d={'oui' if _bool(rend.get('viewport/hdr_2d')) else 'non'} (gardé : c'est un choix visuel)")
    if sc["shadows"] >= 8:
        recs.append(rec("compromis", "low", f"{sc['shadows']} lumières avec ombres", "Chaque ombre dynamique coûte du temps GPU.", "Désactivez shadow_enabled sur les lumières dont l'ombre n'est pas visible ; gardez celles qui comptent."))
    ok.append(f"{st['files']:,} fichiers analysés ({st['bytes'] / GB:.1f} Go)".replace(",", " "))
    order = {"high": 0, "medium": 1, "low": 2}
    recs.sort(key=lambda r: (["environnement", "sans_perte", "compromis"].index(r["group"]), order[r["impact"]]))
    return {"project": root, "name": app.get("config/name", os.path.basename(root)).strip('"'), "renderer": renderer, "godot": exe, "godot_version": (re.search(r"v?(\d+\.\d+(?:\.\d+)?)", os.path.basename(exe or "")) or [None, None])[1],
            "stats": {"files": st["files"], "gb": round(st["bytes"] / GB, 2), "imports": len(st["imports"]), "cache_gb": round(cache_b / GB, 2), "partial": st["partial"],
                      "ext": [{"ext": e or "(aucune)", "n": n, "mb": round(st["ext_bytes"][e] / MB)} for e, n in st["ext"].most_common(8)],
                      "dirs": [{"dir": d, "n": n, "mb": round(st["dir_bytes"][d] / MB)} for d, n in st["dirs"].most_common(8)], "gdignore": st["gdignore"][:10],
                      "big": [{"path": os.path.relpath(p, root), "mb": round(s / MB)} for s, p in sorted(st["big"], reverse=True)[:8]]},
            "textures": imp, "scenes": sc, "scripts": sr, "recs": recs, "ok": ok, "hybrid": hybrid, "gpus": gpus, "gpu_pref": pref, "antivirus": avs,
            "settings": {"vsync_mode": disp.get("window/vsync/vsync_mode"), "max_fps": app.get("run/max_fps"), "driver": drv, "hdr_2d": rend.get("viewport/hdr_2d"),
                         "physics_3d": _unq(phys.get("3d/physics_engine")), "autoloads": len(P.get("autoload", {})), "plugins": P.get("editor_plugins", {}).get("enabled", "")},
            "took": round(time.time() - t0, 1)}


analyze_job = D.Job(_analyze)
