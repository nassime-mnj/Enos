"""Taches d'automatisation locales (utilisees par le serveur et par les actions du LLM)."""
import ctypes
import ctypes.wintypes as wt
import json
import logging
import os
import re
import shutil
import subprocess
import threading
import time

log = logging.getLogger("nasko.tasks")

_GUI = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
TOOLS = ("claude", "godot", "aseprite")        # ordre de lancement de l'environnement
LABELS = {"claude": "Claude", "godot": "Godot", "aseprite": "Aseprite"}


def _ps_quote(text):
    """Litteral PowerShell entre apostrophes (les apostrophes sont doublees)."""
    return "'" + text.replace("'", "''") + "'"


def _find_tool(configured, names, extra=()):
    """Executable : chemin configure s'il existe, sinon PATH, sinon emplacements usuels."""
    if configured and os.path.isfile(configured):
        return configured
    for n in names:
        found = shutil.which(n)
        if found and found.lower().endswith(".exe"):
            return found
    return next((p for p in extra if p and os.path.isfile(p)), None)


def tool_exe(cfg, tool):
    """Executable d'un outil de l'environnement, ou None s'il est introuvable."""
    if tool == "claude":
        return "powershell.exe"
    if tool == "godot":
        return _find_tool(cfg.get("godot_path", "").strip(), ["godot.exe"])
    if tool == "aseprite":
        return _find_tool(cfg.get("aseprite_path", "").strip(), ["aseprite.exe"])
    return None


def check_project(cfg, project_dir=None):
    """(chemin, None) si le dossier du projet existe, sinon (None, dict d'erreur avec `code`)."""
    path = (project_dir or cfg.get("project_dir") or "").strip().strip('"')
    if not path:
        return None, {"ok": False, "code": "no_project",
                      "message": "Aucun projet sélectionné. Choisissez un dossier dans [ PROJETS ] (bouton « … » ou saisie du chemin)."}
    if not os.path.isdir(path):
        return None, {"ok": False, "code": "missing_dir", "path": path,
                      "message": f"Dossier introuvable : {path}. Sélectionnez le bon dossier ou créez-le."}
    return path, None


# ---------------------------------------------------------------- outils deja ouverts (evite les doublons)
_env_pids = {}           # tool -> pid du shell lance par E.N.O.S. (le temps que claude demarre dans la console)

_PS_PROCS = ("Get-CimInstance Win32_Process -Filter \"Name LIKE 'godot%' OR Name='aseprite.exe' OR Name='claude.exe' "
             "OR Name='chrome.exe'\" | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress")
_PS_PARENTS = "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress"


def _powershell(script, timeout=25):
    try:
        return subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script], capture_output=True,
                              text=True, encoding="utf-8", timeout=timeout, creationflags=subprocess.CREATE_NO_WINDOW).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def _processes():
    """Processus pertinents : [{pid, ppid, name, cmd}]. Liste vide si Windows ne repond pas."""
    try:
        data = json.loads(_powershell(_PS_PROCS) or "[]")
    except ValueError:
        return []
    if isinstance(data, dict):
        data = [data]
    return [{"pid": d.get("ProcessId"), "ppid": d.get("ParentProcessId"), "name": (d.get("Name") or "").lower(),
             "cmd": d.get("CommandLine") or ""} for d in data]


def _norm_path(p):
    return os.path.normcase(os.path.normpath(p.strip().strip('"'))).rstrip("\\/")


def _inside(child, root):
    child, root = _norm_path(child), _norm_path(root)
    return child == root or child.startswith(root + os.sep)


def _cwd_of(pid):
    """Dossier courant d'un processus du meme utilisateur (lecture du PEB), ou None si inaccessible."""
    k32, nt = ctypes.WinDLL("kernel32", use_last_error=True), ctypes.WinDLL("ntdll")
    k32.OpenProcess.restype = wt.HANDLE
    k32.OpenProcess.argtypes = [wt.DWORD, wt.BOOL, wt.DWORD]
    k32.ReadProcessMemory.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]
    k32.CloseHandle.argtypes = [wt.HANDLE]
    h = k32.OpenProcess(0x1000 | 0x0010, False, int(pid))        # QUERY_LIMITED_INFORMATION | VM_READ
    if not h:
        return None

    def rd(addr, size):
        buf, got = ctypes.create_string_buffer(size), ctypes.c_size_t()
        return buf.raw[:got.value] if k32.ReadProcessMemory(h, ctypes.c_void_p(addr), buf, size, ctypes.byref(got)) else None
    try:
        pbi = (ctypes.c_void_p * 6)()
        if nt.NtQueryInformationProcess(h, 0, ctypes.byref(pbi), ctypes.sizeof(pbi), ctypes.byref(ctypes.c_ulong())) != 0:
            return None
        params = rd(pbi[1] + 0x20, 8)                            # PEB.ProcessParameters
        if not params:
            return None
        us = rd(int.from_bytes(params, "little") + 0x38, 16)     # CurrentDirectory.DosPath (UNICODE_STRING)
        if not us:
            return None
        raw = rd(int.from_bytes(us[8:16], "little"), int.from_bytes(us[:2], "little"))
        return raw.decode("utf-16-le") if raw else None
    except (OSError, ValueError, TypeError):
        return None
    finally:
        k32.CloseHandle(h)


def _godot_editor_path(cmd):
    """Dossier --path d'un Godot lance en mode editeur (--editor / -e), sinon None."""
    if not re.search(r"(?:^|\s)(?:--editor|-e)(?:\s|$)", cmd):
        return None
    m = re.search(r'--path\s+("[^"]+"|\S+)', cmd)
    return m.group(1).strip('"') if m else None


def _pid_alive(pid):
    try:
        out = subprocess.run(["tasklist", "/FI", f"PID eq {int(pid)}", "/NH"], capture_output=True, text=True, timeout=10,
                             creationflags=subprocess.CREATE_NO_WINDOW).stdout
        return f" {int(pid)} " in out
    except (OSError, subprocess.SubprocessError, ValueError):
        return False


def detect_open(cfg, project_dir, procs=None, cwd_of=None):
    """Outils deja ouverts pour ce projet : {tool: [pid]} (ex. {"godot": [123], "aseprite": [456]}).

    godot    = editeur ouvert SUR CE PROJET (une scene lancee par F6 n'est pas l'editeur)
    aseprite = Aseprite est a instance unique : ouvert = ouvert
    claude   = un claude.exe dont le dossier courant est le projet (ou un sous-dossier), ou le shell que nous venons de lancer
    """
    procs = _processes() if procs is None else procs
    cwd_of = cwd_of or _cwd_of
    found = {}
    for p in procs:
        n, cmd = p["name"], p["cmd"]
        if n.startswith("godot"):
            gp = _godot_editor_path(cmd)
            if gp and _norm_path(gp) == _norm_path(project_dir):
                found.setdefault("godot", []).append(p["pid"])
        elif n == "aseprite.exe":
            found.setdefault("aseprite", []).append(p["pid"])
        elif n == "claude.exe":
            cwd = cwd_of(p["pid"])
            if cwd and _inside(cwd, project_dir):
                found.setdefault("claude", []).append(p["pid"])
    mine = _env_pids.get("claude")
    if mine and "claude" not in found and _pid_alive(mine):
        found["claude"] = [mine]
    return found


def detect_private_chrome(cfg, procs=None):
    """Chrome lance en navigation privee sur les pages configurees (par E.N.O.S. ou a la main) : liste de pid."""
    urls = [u.lower().rstrip("/") for u in (cfg.get("incognito_urls") or [])]
    pids = []
    for p in (_processes() if procs is None else procs):
        c = p["cmd"].lower()
        if p["name"] == "chrome.exe" and "--type=" not in c and ("-incognito" in c or "--incognito" in c) and (not urls or any(u in c for u in urls)):
            pids.append(p["pid"])
    return pids


def _ancestors(pids, depth=4):
    """Les pid donnes + leurs parents (la fenetre d'un claude.exe appartient a son terminal)."""
    try:
        by = {d["ProcessId"]: d["ParentProcessId"] for d in json.loads(_powershell(_PS_PARENTS) or "[]")}
    except (ValueError, KeyError, TypeError):
        by = {}
    out, cur = {int(x) for x in pids}, [int(x) for x in pids]
    for _ in range(depth):
        cur = [by[c] for c in cur if by.get(c)]
        out.update(cur)
    return out


def _focus_pids(pids):
    """Ramene au premier plan la fenetre principale de l'un des processus (au mieux : Windows peut refuser)."""
    try:
        u = ctypes.WinDLL("user32")
        wanted, hits = {int(x) for x in pids}, []
        cb_t = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)

        def cb(hwnd, _):
            pid = wt.DWORD()
            u.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            if pid.value in wanted and u.IsWindowVisible(hwnd) and u.GetWindowTextLengthW(hwnd) > 0:
                hits.append(hwnd)
            return True
        u.EnumWindows(cb_t(cb), 0)
        if not hits:
            return False
        u.ShowWindow(hits[0], 9)                                 # SW_RESTORE (sort de la barre des taches si reduite)
        return bool(u.SetForegroundWindow(hits[0]))
    except OSError:
        return False


def plan_environnement(cfg, project_dir=None):
    """Etapes de l'environnement (outils actifs), sans rien lancer : [{id, ready, open}] (open = deja ouvert)."""
    path, err = check_project(cfg, project_dir)
    if err:
        return err
    opened = detect_open(cfg, path)
    steps = [{"id": t, "ready": tool_exe(cfg, t) is not None, "open": t in opened}
             for t in TOOLS if cfg.get(f"launch_{t}", True)]
    return {"ok": True, "path": path, "steps": steps}


MAX_SCENES = 3000
_scenes_lock = threading.Lock()
_running = {}            # pid -> {pid, name, rel, res, started, by, proc}


def running_scenes():
    """Scenes lancees par E.N.O.S. encore ouvertes (les processus termines sont oublies)."""
    with _scenes_lock:
        for pid in [p for p, r in _running.items() if r["proc"].poll() is not None]:
            del _running[pid]
        return [{k: v for k, v in r.items() if k != "proc"} for r in _running.values()]


def running_pids():
    running_scenes()
    with _scenes_lock:
        return set(_running)


def _kill_tree(proc):
    """Arrete le processus ET ses fils (la version « console » de Godot lance le jeu dans un processus fils)."""
    try:
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True, timeout=10,
                       creationflags=subprocess.CREATE_NO_WINDOW)
    except (OSError, subprocess.SubprocessError):
        try:
            proc.kill()
        except OSError:
            pass


def stop_scenes():
    """Ferme toutes les scenes lancees par E.N.O.S. Retourne le nombre de scenes arretees."""
    with _scenes_lock:
        procs = [r["proc"] for r in _running.values() if r["proc"].poll() is None]
        _running.clear()
    for proc in procs:
        _kill_tree(proc)
    if procs:
        log.info("%d scene(s) arretee(s)", len(procs))
    return len(procs)


def _auto_stop(pid, minutes):
    time.sleep(minutes * 60)
    with _scenes_lock:
        rec = _running.get(pid)
    if rec and rec["proc"].poll() is None:
        log.info("Arret automatique de la scene %s apres %s min", rec["name"], minutes)
        with _scenes_lock:
            _running.pop(pid, None)
        _kill_tree(rec["proc"])


def lister_scenes(cfg, project_dir=None):
    """Scanne le projet actif : toutes les scenes .tscn (hors dossiers exclus). Retourne {ok, path, godot, scenes, truncated}.

    Chaque scene : {name, rel, dir} (rel = chemin relatif au projet, avec « / »). Les dossiers techniques (.godot, addons...)
    sont elagues pendant le parcours : 0,2 s pour un projet de 17 000 fichiers.
    """
    path, err = check_project(cfg, project_dir)
    if err:
        return err
    excl = {e.lower() for e in (cfg.get("godot_scene_excludes") or [])}
    scenes, truncated = [], False
    for dirpath, dirs, files in os.walk(path):
        dirs[:] = sorted(d for d in dirs if d.lower() not in excl)
        reldir = os.path.relpath(dirpath, path).replace("\\", "/")
        reldir = "" if reldir == "." else reldir
        for f in sorted(files):
            if f.lower().endswith(".tscn"):
                scenes.append({"name": f, "rel": f"{reldir}/{f}" if reldir else f, "dir": reldir})
        if len(scenes) >= MAX_SCENES:
            truncated = True
            break
    scenes.sort(key=lambda s: (s["dir"] != "", s["dir"].lower(), s["name"].lower()))   # racine d'abord, puis par dossier
    return {"ok": True, "path": path, "godot": tool_exe(cfg, "godot") is not None, "scenes": scenes[:MAX_SCENES],
            "truncated": truncated}


def _resolve_scene(project, rel):
    """Chemin res:// d'une scene du projet, ou None si `rel` n'est pas une scene .tscn existante DANS le projet."""
    if not isinstance(rel, str) or "\0" in rel:
        return None
    rel = rel.strip().replace("\\", "/").lstrip("/")
    if not rel.lower().endswith(".tscn") or ".." in rel.split("/") or ":" in rel:
        return None
    root = os.path.realpath(project)
    target = os.path.realpath(os.path.join(root, rel))
    try:
        inside = os.path.commonpath([root, target]) == root
    except ValueError:
        return None
    return "res://" + rel if inside and os.path.isfile(target) else None


def _godot_exe(cfg):
    """(exe, console) : la version console de Godot (journal visible) si demandee et presente."""
    exe = tool_exe(cfg, "godot")
    if exe and cfg.get("godot_console"):
        console = exe[:-4] + "_console.exe"
        if os.path.isfile(console):
            return console, True
    return exe, False


def lancer_scene(cfg, rel, project_dir=None, by="PC"):
    """Lance UNE scene du projet sans ouvrir l'editeur (equivalent de F6) :  godot --path <projet> res://<scene>.tscn"""
    path, err = check_project(cfg, project_dir)
    if err:
        return err
    exe, console = _godot_exe(cfg)
    if not exe:
        return {"ok": False, "code": "no_godot", "message": "Godot introuvable (vérifiez godot_path dans nasko_config.json)."}
    res = _resolve_scene(path, rel)
    if not res:
        return {"ok": False, "code": "bad_scene", "message": f"Scène introuvable dans le projet : {rel}"}
    if cfg.get("godot_single_instance", True):
        stop_scenes()                               # comme F6 dans l'editeur : la nouvelle scene remplace la precedente
    try:
        proc = subprocess.Popen([exe, "--path", path, res], cwd=path,
                                creationflags=subprocess.CREATE_NEW_CONSOLE if console else _GUI)
    except OSError as e:
        log.warning("Lancement de la scene impossible : %s", e)
        return {"ok": False, "code": "launch", "message": f"Lancement impossible ({e.strerror or e})."}
    name = res.rsplit("/", 1)[-1]
    with _scenes_lock:
        _running[proc.pid] = {"pid": proc.pid, "name": name, "rel": rel.strip().replace("\\", "/").lstrip("/"),
                              "res": res, "started": time.time(), "by": by, "proc": proc}
    minutes = int(cfg.get("f6_auto_stop_minutes", 30) or 0)
    if minutes > 0 and by != "PC":                  # une scene lancee a distance ne doit pas tourner indefiniment
        threading.Thread(target=_auto_stop, args=(proc.pid, minutes), daemon=True).start()
    log.info("Scene lancee par %s : %s (%s)", by, res, path)
    return {"ok": True, "message": f"Scène « {name} » lancée.", "scene": name, "res": res, "pid": proc.pid}


def lancer_outil(cfg, tool, project_dir=None, force=False):
    """Lance UN outil de l'environnement sur le projet, sauf s'il est deja ouvert (sa fenetre est alors ramenee devant).

    Retourne {ok, message} (+ already=True si rien n'a ete lance car l'outil tournait deja).
    """
    path, err = check_project(cfg, project_dir)
    if err:
        return err
    label = LABELS.get(tool)
    exe = tool_exe(cfg, tool)
    if not label:
        return {"ok": False, "message": f"Outil inconnu : {tool}"}
    if not exe:
        return {"ok": False, "message": f"{label} introuvable (vérifiez {tool}_path dans nasko_config.json)."}
    if not force:
        pids = detect_open(cfg, path).get(tool)
        if pids:
            _focus_pids(_ancestors(pids) if tool == "claude" else pids)
            log.info("%s deja ouvert (pid %s) : pas de doublon", label, pids)
            return {"ok": True, "already": True, "message": f"{label} est déjà ouvert."}
    try:
        if tool == "claude":
            proc = subprocess.Popen([exe, "-NoExit", "-Command", f"Set-Location -LiteralPath {_ps_quote(path)}; claude"],
                                    creationflags=subprocess.CREATE_NEW_CONSOLE)
            _env_pids["claude"] = proc.pid
        elif tool == "godot":
            subprocess.Popen([exe, "--editor", "--path", path], cwd=path, creationflags=_GUI)
        else:
            subprocess.Popen([exe], cwd=path, creationflags=_GUI)
    except OSError as e:
        log.warning("Lancement de %s impossible : %s", label, e)
        return {"ok": False, "message": f"{label} : lancement impossible ({e.strerror or e})."}
    log.info("%s lance sur %s", label, path)
    return {"ok": True, "message": f"{label} lancé."}


def lancer_environnement(cfg, project_dir=None):
    """Lance tout l'environnement d'un coup (sans commentaire vocal) : Claude (PowerShell), Godot, Aseprite.

    Retourne un dict : ok, message, et pour les erreurs de projet `code` ("no_project" | "missing_dir") + `path`.
    Un outil introuvable ou en echec n'empeche jamais les autres de demarrer.
    """
    plan = plan_environnement(cfg, project_dir)
    if not plan["ok"]:
        return plan
    path, launched, skipped, failed, already = plan["path"], [], [], [], []
    for step in plan["steps"]:
        tool = step["id"]
        if not step["ready"]:
            skipped.append(f"{LABELS[tool]} (introuvable : {tool}_path)")
            continue
        if launched or failed:                                   # anti-lag : jamais deux outils lancés dans la même seconde
            time.sleep(float(cfg.get("env_stagger_s", 2.0)))
        res = lancer_outil(cfg, tool, path)
        if res.get("already"):
            already.append(LABELS[tool])
        else:
            (launched if res["ok"] else failed).append(LABELS[tool] if res["ok"] else res["message"].rstrip("."))
    name = os.path.basename(path.rstrip("\\/")) or path
    parts = []
    if launched:
        parts.append(f"Environnement « {name} » lancé : " + ", ".join(launched) + ".")
    if already:
        parts.append("Déjà ouvert (aucun doublon) : " + ", ".join(already) + ".")
    if skipped:
        parts.append("Ignoré : " + " ; ".join(skipped) + ".")
    if failed:
        parts.append("Échec : " + " ; ".join(failed) + ".")
    log.info("Environnement %s : lances=%s deja=%s ignores=%s echecs=%s", path, launched, already, skipped, failed)
    return {"ok": bool(launched or already), "message": " ".join(parts) or "Aucun outil à lancer (tous désactivés).", "path": path}


def _trouver_chrome(cfg):
    candidats = [cfg.get("chrome_path", "").strip(), shutil.which("chrome")]
    for var in ("ProgramFiles", "ProgramFiles(x86)", "LocalAppData"):
        base = os.environ.get(var)
        if base:
            candidats.append(os.path.join(base, "Google", "Chrome", "Application", "chrome.exe"))
    return next((c for c in candidats if c and os.path.isfile(c)), None)


# ----------------------------------------------------------------------------- navigation privée générique (Chrome / Firefox / Edge)
# `webbrowser` ne sait pas demander le mode privé : on lance le navigateur lui-même avec subprocess et son drapeau (--incognito, -private-window, -inprivate).
def _trouver_navigateur_prive(cfg):
    """(nom, chemin, drapeau) du premier navigateur installé : Chrome, puis Firefox, puis Edge. None si aucun."""
    chrome = _trouver_chrome(cfg)
    if chrome:
        return "Chrome", chrome, "--incognito"
    pf = [os.environ.get(v) for v in ("ProgramFiles", "ProgramFiles(x86)", "LocalAppData")]
    firefox = [shutil.which("firefox")] + [os.path.join(b, "Mozilla Firefox", "firefox.exe") for b in pf if b]
    f = next((c for c in firefox if c and os.path.isfile(c)), None)
    if f:
        return "Firefox", f, "-private-window"
    edge = [shutil.which("msedge")] + [os.path.join(b, "Microsoft", "Edge", "Application", "msedge.exe") for b in pf if b]
    e = next((c for c in edge if c and os.path.isfile(c)), None)
    if e:
        return "Edge", e, "-inprivate"
    return None


def ouvrir_prive(urls, cfg):
    """Ouvre `urls` (un onglet chacune) dans UNE fenêtre de navigation privée. Aucune automatisation : la suite est manuelle. Retourne (ok, message)."""
    urls = [u for u in urls if str(u).startswith("https://")]                 # uniquement des adresses https explicites
    nav = _trouver_navigateur_prive(cfg)
    if not nav:
        return False, "Aucun navigateur trouvé (Chrome, Firefox ou Edge). Renseignez chrome_path dans nasko_config.json."
    nom, exe, flag = nav
    try:
        # Firefox : les URL suivantes s'ouvrent en onglets dans la même fenêtre privée si on les passe avec -new-tab
        args = [exe, flag] + ([a for u in urls for a in ("-new-tab", u)] if nom == "Firefox" else urls)
        subprocess.Popen(args)
    except OSError as e:
        return False, f"Impossible de lancer {nom} : {e}"
    log.info("%s privé ouvert : %s", nom, urls)
    return True, f"{nom} ouvert en navigation privée avec {len(urls)} onglets. La suite est manuelle."


ELEVENLABS_PRIVATE_URLS = ["https://elevenlabs.io/sign-up", "https://temp-mail.org/"]


def ouvrir_elevenlabs_prive(cfg):
    """Fenêtre privée avec la page d'inscription ElevenLabs et un générateur d'e-mail temporaire (urls réglables : `elevenlabs_private_urls`)."""
    return ouvrir_prive(cfg.get("elevenlabs_private_urls") or ELEVENLABS_PRIVATE_URLS, cfg)


def ouvrir_navigation_privee(cfg):
    """Raccourci : Chrome en navigation privee sur les pages configurees. Aucune automatisation."""
    chrome = _trouver_chrome(cfg)
    if not chrome:
        return False, "Chrome introuvable. Renseignez chrome_path dans nasko_config.json."
    pids = detect_private_chrome(cfg)
    if pids:
        _focus_pids(pids)
        return True, "La navigation privée est déjà ouverte : je ne l'ouvre pas une deuxième fois."
    urls = cfg.get("incognito_urls") or []
    try:
        subprocess.Popen([chrome, "-incognito", *urls])
    except OSError as e:
        return False, f"Impossible de lancer Chrome : {e}"
    log.info("Chrome prive ouvert : %s", urls)
    return True, "Chrome ouvert en navigation privée (temp-mail + inscription PixelLab). La suite est manuelle."
