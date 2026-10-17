"""Automatisation web (Playwright, CDP) : PhotoRoom (detourage) et Sprite Slicer (decoupage Auto-Slice).

On se connecte a un Chrome DEJA OUVERT via `chromium.connect_over_cdp()` (port `chrome_debug_port`, 9222 par defaut) :
sessions et verifications humaines deja validees sont reutilisees, et un onglet PhotoRoom / Sprite Slicer deja ouvert est repris.
Depuis Chrome 136, le port de debogage est IGNORE sur le profil par defaut : il faut un profil dedie. Si aucun Chrome
n'ecoute sur le port, E.N.O.S. le lance une fois avec le profil data/chrome_cdp_profile (a conserver : on s'y connecte une seule fois).
Raccourci equivalent :  chrome.exe --remote-debugging-port=9222 --user-data-dir="<E.N.O.S.>\\data\\chrome_cdp_profile"
"""
import json
import os
import queue
import re
import socket
import subprocess
import threading
import time
import urllib.request

from nasko_core import data_dir, load_config

PHOTOROOM_URL = "https://www.photoroom.com/tools/background-remover"
SLICER_URL = "https://spriteslicer.app"
PR_HOSTS = ("photoroom.com",)
SL_HOSTS = ("spriteslicer.app",)

# Selecteurs VERIFIES en direct sur spriteslicer.app (boutons <button>, libelles anglais)
SL_POPUP = ["Maybe Later", "Close"]                 # fenetre « Join Discord » a l'ouverture
SL_AUTO_SLICE = "Auto Slice Sheet"
SL_EXPORT_ZIP = "Export ZIP"
# Selecteurs VERIFIES en direct sur photoroom.com/tools/background-remover : apres l'envoi, la page affiche le resultat avec
# les boutons « Edit for free · Edit cutout · Resize · Add background · Download » ; « Download » telecharge directement un PNG RGBA.
PR_DONE = "Edit cutout"                              # apparait quand le detourage est termine
PR_DOWNLOAD = "Download"                             # nom exact (le pied de page contient d'autres liens « download »)
PR_COOKIES = [r"^(reject all|tout refuser|refuser)$"]

WAIT_HUMAN_S = 900          # temps laissé PAR PAUSE pour valider « Vérifiez que vous êtes humain » / se connecter dans Chrome (15 min ; la tâche reprend dès la validation)
WAIT_AI_S = 150             # delai max du detourage par l'IA (compté hors pauses : il repart à zéro après chaque intervention manuelle)
RESUME_GRACE_S = 25         # après une validation manuelle : temps laissé au traitement pour reprendre seul avant de renvoyer l'image (la vérification recharge souvent la page)


class AutomationError(Exception):
    pass


# ----------------------------------------------------------------------------- connexion au Chrome ouvert (CDP)
def _port():
    try:
        return int(load_config().get("chrome_debug_port") or 9222)
    except (TypeError, ValueError):
        return 9222


def _probe(port, host):
    """Vrai Chrome en débogage ? Une simple connexion TCP ne suffit pas (un autre programme peut occuper le port) : on lit /json/version."""
    import json
    import urllib.request
    try:
        with urllib.request.urlopen(f"http://{host}:{port}/json/version", timeout=0.8) as r:
            return "Browser" in json.load(r)
    except Exception:                                                # noqa: BLE001
        return False


def _tcp_open(port, family, host):
    with socket.socket(family, socket.SOCK_STREAM) as s:
        s.settimeout(0.25)
        try:
            return s.connect_ex((host, port)) == 0
        except OSError:
            return False


def _listening(port):
    """Chrome écoute-t-il ce port de débogage ? IPv4 ET IPv6 (Chrome peut ne se lier qu'à ::1). TCP rapide d'abord, puis vérification HTTP."""
    for fam, host, url in ((socket.AF_INET, "127.0.0.1", "127.0.0.1"), (socket.AF_INET6, "::1", "[::1]")):
        if _tcp_open(port, fam, host) and _probe(port, url):
            return True
    return False


_scan = {"t": 0.0, "ports": [], "busy": False}


def _scan_cmdlines():
    ports = []
    try:
        out = subprocess.run(["powershell", "-NoProfile", "-Command",
                              "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | ForEach-Object { $_.CommandLine }"],
                             capture_output=True, text=True, timeout=12, creationflags=0x08000000, encoding="utf-8", errors="replace").stdout
        for m in re.finditer(r"--remote-debugging-port=(\d+)", out):
            if int(m.group(1)) > 0 and int(m.group(1)) not in ports:
                ports.append(int(m.group(1)))
    except Exception:                                                # noqa: BLE001
        pass
    _scan.update(t=time.time(), ports=ports, busy=False)


def _chrome_cmdline_ports():
    """Ports de débogage annoncés par les Chrome en cours d'exécution (--remote-debugging-port=N), quel que soit le profil.
    L'inspection WMI est lente (~4 s) : elle tourne en arrière-plan, au plus une fois toutes les 20 s ; l'appelant lit le dernier résultat."""
    if time.time() - _scan["t"] > 20 and not _scan["busy"]:
        _scan["busy"] = True
        import threading
        threading.Thread(target=_scan_cmdlines, daemon=True, name="chrome-scan").start()
    return list(_scan["ports"])


def _devtools_file_ports():
    """Port écrit par Chrome dans <profil>/DevToolsActivePort (profil E.N.O.S. ou profil Chrome habituel)."""
    out = []
    for d in (os.path.join(data_dir(), "chrome_cdp_profile"),
              os.path.join(os.environ.get("LOCALAPPDATA", ""), r"Google\Chrome\User Data")):
        try:
            with open(os.path.join(d, "DevToolsActivePort"), encoding="utf-8") as f:
                p = int(f.readline().strip())
                if p > 0:
                    out.append(p)
        except (OSError, ValueError):
            continue
    return out


def chrome_running():
    try:
        out = subprocess.run(["tasklist", "/FI", "IMAGENAME eq chrome.exe", "/NH"], capture_output=True, text=True, timeout=5,
                             creationflags=0x08000000, encoding="utf-8", errors="replace").stdout
        return "chrome.exe" in out.lower()
    except Exception:                                                # noqa: BLE001
        return False


def cdp_port():
    """Port de débogage d'un Chrome VIVANT, ou None : réglage `chrome_debug_port`, puis fichiers DevToolsActivePort, puis lignes de commande des Chrome ouverts."""
    seen = []
    for p in [_port()] + _devtools_file_ports() + [9222]:
        if p not in seen:
            seen.append(p)
            if _listening(p):
                return p
    for p in _chrome_cmdline_ports():
        if p not in seen:
            seen.append(p)
            if _listening(p):
                return p
    return None


def _chrome_exe():
    cfg = load_config()
    cands = [(cfg.get("chrome_path") or "").strip(),
             r"C:\Program Files\Google\Chrome\Application\chrome.exe",
             r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
             os.path.join(os.environ.get("LOCALAPPDATA", ""), r"Google\Chrome\Application\chrome.exe")]
    return next((c for c in cands if c and os.path.isfile(c)), None)


_chrome_lock = __import__("threading").Lock()


def ensure_chrome(progress=None):
    """Garantit un Chrome a l'ecoute sur le port de debogage ; le lance (profil dedie) s'il n'y en a pas.
    Verrouillé : deux traitements simultanés ne lancent pas deux Chrome."""
    with _chrome_lock:
        return _ensure_chrome(progress)


def _ensure_chrome(progress=None):
    port = cdp_port()
    if port:
        return port
    port = _port()
    exe = _chrome_exe()
    if not exe:
        raise AutomationError("Chrome introuvable : renseignez `chrome_path` dans nasko_config.json.")
    if progress:
        progress("Ouverture de Chrome (profil E.N.O.S.)…", 3)
    # Lancement DISCRET : fenêtre réduite sans prendre le focus (SW_SHOWMINNOACTIVE), ou totalement invisible si `imgproc_headless`.
    # Les options « no-backgrounding » évitent que Chrome endorme les pages d'une fenêtre réduite.
    args = [exe, f"--remote-debugging-port={port}", "--remote-allow-origins=*",
            f"--user-data-dir={os.path.join(data_dir(), 'chrome_cdp_profile')}",
            "--no-first-run", "--no-default-browser-check", "--start-minimized",
            "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"]
    if load_config().get("imgproc_headless"):
        args.append("--headless=new")
    si = subprocess.STARTUPINFO()
    si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    si.wShowWindow = 7                                            # SW_SHOWMINNOACTIVE
    subprocess.Popen(args + ["about:blank"], startupinfo=si)
    for _ in range(60):
        if _listening(port):
            return port
        time.sleep(0.5)
    raise AutomationError(f"Chrome n'a pas ouvert le port de débogage {port}.")


def _tool_page(ctx, hosts, url, fresh=False):
    """Reprend l'onglet deja ouvert sur le site (le premier trouve), sinon en ouvre un. Retourne (page, cree).
    fresh=True (traitements en parallèle) : TOUJOURS un onglet neuf, sinon deux images se disputeraient le même onglet."""
    if fresh:
        return _new_page_bg(ctx), True
    for pg in ctx.pages:
        if any(h in pg.url for h in hosts):
            return pg, False
    return _new_page_bg(ctx), True


def _new_page_bg(ctx):
    """Nouvel onglet OUVERT EN ARRIÈRE-PLAN (Target.createTarget background=true) : il ne vole jamais le focus.
    Repli : ctx.new_page() classique si le navigateur refuse."""
    try:
        sess = ctx.browser.new_browser_cdp_session()
        try:
            with ctx.expect_page(timeout=8000) as info:               # expect_page fait avancer la boucle d'événements Playwright
                sess.send("Target.createTarget", {"url": "about:blank", "background": True})
            return info.value
        finally:
            try:
                sess.detach()
            except Exception:                                        # noqa: BLE001
                pass
    except Exception:                                                # noqa: BLE001
        return ctx.new_page()


# ----------------------------------------------------------------------------- utilitaires de page
def _find(page, patterns, roles=("button", "link", "menuitem")):
    for pat in patterns:
        rx = re.compile(pat, re.I)
        for role in roles:
            loc = page.get_by_role(role, name=rx)
            for i in range(min(loc.count(), 6)):
                if loc.nth(i).is_visible():
                    return loc.nth(i)
    return None


def _wait_find(page, patterns, timeout_s, roles=("button", "link", "menuitem"), tick=None):
    end = time.time() + timeout_s
    while time.time() < end:
        el = _find(page, patterns, roles)
        if el is not None:
            return el
        if tick:
            tick()
        page.wait_for_timeout(800)
    return None


_HUMAN_TEXT = re.compile(r"v[ée]rifiez que vous [êe]tes (un )?humain|verify (that )?you are (a )?human|checking your browser", re.I)
_HUMAN_TITLE = re.compile(r"just a moment|un instant|attention required|verify you are human|v[ée]rifiez que vous", re.I)
# Évalué DANS la page sur l'élément <iframe> : vrai seulement si le cadre est réellement affiché à l'écran. On vérifie, pour lui et chacun de ses ancêtres,
# display != none, visibility != hidden, opacity >= 0,1 ; puis dimensions réelles (>= 100x40), présence dans la zone visible de la fenêtre,
# (pas de test de recouvrement : le widget vit dans un shadow DOM, elementFromPoint y renvoie l'hôte et non le cadre).
_VISIBLE_JS = """el => {
  const r = el.getBoundingClientRect();
  if (r.width < 100 || r.height < 40) return false;
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (n.hidden || s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) < 0.1) return false;
  }
  const vw = window.innerWidth, vh = window.innerHeight;
  return !(r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh);
}"""
_last_reason = {"why": ""}                                         # dernier indice de détection (affiché dans le message d'attente : on voit POURQUOI la tâche attend)


def _human_check(page):
    """(genre, raison) : « captcha » / « login » SEULEMENT si une page de sécurité est explicitement détectée, sinon ("", ""). Ne lève jamais.
    Règle d'or : en cas de doute, il n'y a PAS de vérification (la tâche continue ; si elle bute vraiment, c'est le délai d'attente qui le dira).
      1. page de connexion (adresse) ;
      2. titre typique d'une page de défi (« Just a moment… ») ;
      3. cadre Cloudflare VISIBLE et de taille réelle (un cadre invisible / détaché / minuscule est ignoré : PhotoRoom en charge en permanence) ;
      4. texte « Vérifiez que vous êtes humain » VISIBLE, seulement si la page d'envoi (input[type=file]) est absente."""
    try:
        url = page.url
        if re.search(r"/(login|log-in|signin|sign-in|sign_in|signup|sign-up|register)\b", url):
            return "login", "adresse de connexion : " + url[:70]
        title = page.title() or ""
        if _HUMAN_TITLE.search(title):
            return "captcha", "titre de la page : « " + title[:40] + " »"
        for fr in page.frames:
            if "challenges.cloudflare.com" in fr.url:
                try:
                    el = fr.frame_element()
                    shown = bool(el.evaluate(_VISIBLE_JS))             # visibilité RÉELLE à l'écran (voir _VISIBLE_JS), pas la simple présence dans le DOM
                    box = el.bounding_box() if shown else None
                except Exception:                                    # noqa: BLE001 — cadre détaché / invisible : ignoré (avant : compté comme un CAPTCHA, d'où la pause fantôme)
                    continue
                if shown and box:
                    return "captcha", "cadre Cloudflare réellement visible à l'écran (%dx%d)" % (box["width"], box["height"])
        if not page.locator("input[type=file]").count():
            t = page.get_by_text(_HUMAN_TEXT)
            if t.count() and t.first.is_visible():
                return "captcha", "texte de vérification visible"
    except Exception:                                                # noqa: BLE001
        pass
    return "", ""


def _upload_ready(page):
    """La page d'envoi est-elle accessible ? (champ fichier présent, ou bouton « Start from a photo » affiché). Si oui, c'est la PREUVE que rien ne bloque :
    on ignore toute détection Cloudflare et on injecte l'image tout de suite."""
    try:
        if page.locator("input[type=file]").count():
            return True
        b = page.get_by_role("button", name=re.compile(r"start from a photo|commencer.*photo|upload", re.I))
        return bool(b.count() and b.first.is_visible())
    except Exception:                                                # noqa: BLE001
        return False


def _human_check_visible(page):
    kind, why = _human_check(page)
    _last_reason["why"] = why
    return kind


def _wait_human_clear(page, kind, progress, budget_s=None):
    """PAUSE « humain dans la boucle » : tant que la vérification / la connexion est affichée, on ATTEND en sondant la page toutes les 0,7 s (aucun
    délai Playwright n'est en cours : la pause peut durer aussi longtemps que nécessaire, dans la limite de `budget_s`). Rend la main dès que la
    page est libérée (2 sondages propres d'affilée : évite de repartir sur un clignotement)."""
    budget = budget_s or WAIT_HUMAN_S
    what = "cochez « Vérifiez que vous êtes humain »" if kind == "captcha" else "connectez-vous à PhotoRoom"
    # pas de bring_to_front : E.N.O.S. ne vole jamais le focus ; le message s'affiche dans l'interface, Chrome est dans la barre des tâches
    msg = ("Action requise dans Chrome (barre des tâches) : " + what + " — la tâche reprend toute seule dès que c'est validé"
           + (f" [détecté : {_last_reason['why']}]" if _last_reason["why"] else ""))
    progress(msg, 25)
    t0, last_msg, clear = time.time(), time.time(), 0
    while True:
        try:
            page.wait_for_timeout(700)
        except Exception:                                            # noqa: BLE001
            pass
        if page.is_closed():
            raise AutomationError("L'onglet Chrome a été fermé pendant la vérification : tâche annulée.")
        k = _human_check_visible(page)
        clear = clear + 1 if not k else 0
        if clear >= 2:
            break
        waited = time.time() - t0
        if waited > budget:
            raise AutomationError(f"Vérification humaine non validée après {int(budget // 60)} min : tâche annulée (relancez-la quand vous êtes prêt).")
        if time.time() - last_msg > 15:                              # message rafraîchi : la tâche reste visiblement vivante
            last_msg = time.time()
            progress(msg + f" ({int(waited)} s)", 25)
    progress("Vérification validée : reprise…", 30)


def _upload(page, path, timeout_ms=20000, progress=None):
    """Injecte le fichier dans le champ <input type=file> (set_input_files : aucun clic, aucune boîte de dialogue). Si le champ n'apparaît pas :
    vérification de sécurité réellement détectée -> pause puis nouvel essai (3 au plus) ; sinon erreur claire (jamais d'attente fantôme)."""
    inp = page.locator("input[type=file]")
    last = ""
    for _ in range(3):
        try:
            inp.first.wait_for(state="attached", timeout=timeout_ms)
            inp.first.set_input_files(path)
            return
        except Exception as e:                                       # noqa: BLE001
            last = (str(e).strip().splitlines() or [e.__class__.__name__])[0][:100]
            if page.is_closed():
                raise AutomationError("L'onglet Chrome a été fermé pendant l'envoi : tâche annulée.")
            k = _human_check_visible(page)
            if k and progress:
                _wait_human_clear(page, k, progress)
                continue
            break
    raise AutomationError("Champ d'envoi de fichier introuvable sur " + page.url + " — " + last)


def _save(dl, dest_dir, fallback):
    out = os.path.join(dest_dir, dl.suggested_filename or fallback)
    dl.save_as(out)
    return out


# ----------------------------------------------------------------------------- PhotoRoom
def photoroom_remove_bg(ctx, src, out_dir, progress, fresh=False):
    page, created = _tool_page(ctx, PR_HOSTS, PHOTOROOM_URL, fresh)
    try:
        return _photoroom_page(page, src, out_dir, progress, fresh)
    finally:
        if fresh:
            _close_quiet(page)                             # onglet refermé même en cas d'échec (plus d'onglets orphelins)


def _pr_open_and_upload(page, src, progress):
    progress("Ouverture de PhotoRoom…", 10)
    page.goto(PHOTOROOM_URL, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(1500)
    if not _upload_ready(page):                                      # PRIORITÉ À L'ENVOI : page d'envoi accessible = aucune vérification à attendre, on passe directement à l'injection
        k = _human_check_visible(page)
        if k:                                                        # sinon, et seulement si une page de sécurité est réellement affichée : pause puis reprise
            _wait_human_clear(page, k, progress)
            page.wait_for_timeout(1500)
    b = _find(page, PR_COOKIES, roles=("button",))
    if b:
        try: b.click(timeout=2000)
        except Exception: pass
    progress("Envoi de l'image originale…", 20)
    _upload(page, src, progress=progress)                            # page normale : l'image est injectée tout de suite, sans aucune pause


def _pr_wait_result(page, progress, resend):
    """Attend « Edit cutout ». Boucle de SONDAGE (jamais de wait_for_selector long : il ne survivrait pas à une pause manuelle) :
      - le résultat apparaît -> terminé ;
      - une vérification / connexion apparaît -> PAUSE (_wait_human_clear), puis reprise automatique ; si le traitement ne repart pas dans RESUME_GRACE_S
        (la vérification a rechargé la page : l'envoi est perdu), l'image est renvoyée (`resend`), 2 fois au plus ;
      - sinon, délai de l'IA (WAIT_AI_S) compté hors pauses."""
    progress("L'IA de PhotoRoom détoure l'image…", 35)
    done = page.get_by_role("button", name=PR_DONE, exact=True)
    ai_deadline = time.time() + WAIT_AI_S
    resumed_at, resends = 0.0, 0
    while True:
        try:
            if done.count() and done.first.is_visible():
                return
        except Exception:                                            # noqa: BLE001 — page en navigation
            pass
        if page.is_closed():
            raise AutomationError("L'onglet Chrome a été fermé pendant le traitement : tâche annulée.")
        k = _human_check_visible(page)
        if k:
            _wait_human_clear(page, k, progress)
            resumed_at, ai_deadline = time.time(), time.time() + WAIT_AI_S       # le délai de l'IA repart de zéro après l'intervention
            continue
        if resumed_at and time.time() - resumed_at > RESUME_GRACE_S:
            resumed_at = 0.0
            if resends < 2:
                resends += 1
                progress(f"Reprise après vérification : renvoi de l'image ({resends}/2)…", 30)
                resend()
                progress("L'IA de PhotoRoom détoure l'image…", 35)
                ai_deadline = time.time() + WAIT_AI_S
                continue
        if time.time() > ai_deadline:
            raise AutomationError("PhotoRoom : détourage non terminé (délai dépassé, page modifiée ?).")
        try:
            page.wait_for_timeout(800)
        except Exception:                                            # noqa: BLE001
            time.sleep(0.8)


def _pr_download(page, progress):
    """Clique « Download ». Si une vérification apparaît à ce moment (fréquent), pause puis NOUVEL essai du clic : jusqu'à 8 essais."""
    last = ""
    for _ in range(8):
        k = _human_check_visible(page)
        if k:
            _wait_human_clear(page, k, progress)
            progress("Détourage terminé, téléchargement…", 60)
        try:
            btn = page.get_by_role("button", name=PR_DOWNLOAD, exact=True).first
            with page.expect_download(timeout=12000) as info:
                btn.click(timeout=6000)
            return info.value
        except Exception as e:                                       # noqa: BLE001
            last = (str(e).strip().splitlines() or [e.__class__.__name__])[0][:100]
            if page.is_closed():
                raise AutomationError("L'onglet Chrome a été fermé avant le téléchargement : tâche annulée.")
            if not _human_check_visible(page):
                try:
                    page.wait_for_timeout(1500)
                except Exception:                                    # noqa: BLE001
                    time.sleep(1.5)
    raise AutomationError("PhotoRoom : le téléchargement n'a pas démarré (connexion / quota / vérification ?) — " + last)


def _photoroom_page(page, src, out_dir, progress, fresh):
    _pr_open_and_upload(page, src, progress)
    _pr_wait_result(page, progress, lambda: _pr_open_and_upload(page, src, progress))
    progress("Détourage terminé, téléchargement…", 60)
    dl = _pr_download(page, progress)
    base = os.path.splitext(os.path.basename(src))[0]
    got = _save(dl, out_dir, base + ".png")
    final = os.path.join(out_dir, base + ".png")
    if os.path.abspath(got) != os.path.abspath(final):
        if os.path.exists(final):
            os.remove(final)
        os.replace(got, final)
    return final


# ----------------------------------------------------------------------------- Sprite Slicer (selecteurs verifies)
def slicer_auto_slice(ctx, png, out_dir, progress, fresh=False):
    page, created = _tool_page(ctx, SL_HOSTS, SLICER_URL, fresh)
    try:
        return _slicer_page(page, png, out_dir, progress)
    finally:
        if fresh:
            _close_quiet(page)


def _slicer_page(page, png, out_dir, progress):
    progress("Ouverture de Sprite Slicer…", 66)
    page.goto(SLICER_URL, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(2500)
    for label in SL_POPUP:                                     # fenetre « Join Discord »
        b = page.get_by_role("button", name=label, exact=True)
        if b.count() and b.first.is_visible():
            b.first.click()
            break
    progress("Envoi du PNG transparent…", 72)
    _upload(page, png)
    page.wait_for_timeout(2000)
    auto = page.get_by_role("button", name="Auto", exact=True)
    if auto.count() and auto.first.is_visible():               # mode Auto (deja actif par defaut)
        auto.first.click()
    progress("Auto-Slice : détection des tuiles…", 80)
    go = page.get_by_role("button", name=SL_AUTO_SLICE)
    try:
        go.first.wait_for(state="visible", timeout=30000)
    except Exception:
        raise AutomationError("Sprite Slicer : bouton « Auto Slice Sheet » introuvable.")
    go.first.click()
    page.wait_for_timeout(2500)
    progress("Téléchargement des tuiles (ZIP)…", 90)
    try:
        with page.expect_download(timeout=60000) as info:
            page.get_by_role("button", name=SL_EXPORT_ZIP).last.click()
        dl = info.value
    except Exception:
        raise AutomationError("Sprite Slicer : l'export ZIP n'a pas démarré.")
    return _save(dl, out_dir, os.path.splitext(os.path.basename(png))[0] + "_tiles.zip")


def _close_quiet(page):
    try:
        page.close()
    except Exception:                                      # noqa: BLE001
        pass


# ----------------------------------------------------------------------------- connexion CDP : file FIFO, délais stricts, récupération automatique
CONNECT_TIMEOUT_MS = 15000        # délai d'UNE tentative de connexion CDP
CONNECT_DEADLINE_S = 75           # délai total pour obtenir une connexion (3 essais + nettoyage + relance de Chrome), sinon erreur propre dans l'interface


class _Fifo:
    """Verrou FIFO : les connexions CDP s'établissent UNE par UNE, dans l'ordre d'arrivée (plusieurs connexions simultanées sur un Chrome
    chargé se gênent). Libérable de force par un jeton (si le thread qui le détient est bloqué, la file ne reste pas bouchée)."""

    def __init__(self):
        self._cv = threading.Condition()
        self._queue = []
        self._holder = None

    def acquire(self, token, timeout):
        end = time.time() + timeout
        with self._cv:
            self._queue.append(token)
            while not (self._holder is None and self._queue[0] is token):
                left = end - time.time()
                if left <= 0:
                    self._queue.remove(token)
                    self._cv.notify_all()
                    return False
                self._cv.wait(left)
            self._queue.pop(0)
            self._holder = token
            return True

    def release(self, token):
        with self._cv:
            if self._holder is token:
                self._holder = None
            elif token in self._queue:
                self._queue.remove(token)
            self._cv.notify_all()

    def waiting(self):
        with self._cv:
            return len(self._queue)


_connect_fifo = _Fifo()
_stats = {"in_browser": 0}                                          # tâches actuellement connectées à Chrome (le nettoyage n'a lieu que si 0)
_stats_lock = threading.Lock()


def _cdp_get(port, path, timeout=3):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=timeout) as r:
        return r.read()


def _close_stale_tabs(port):
    """Ferme les onglets abandonnés (échecs précédents, fenêtres de dialogue bloquées…) ; en garde UN (fermer le dernier ferait quitter Chrome)."""
    n = 0
    try:
        pages = [t for t in json.loads(_cdp_get(port, "/json/list")) if t.get("type") == "page"]
    except Exception:                                                # noqa: BLE001
        return 0
    for t in pages[1:]:
        try:
            _cdp_get(port, "/json/close/" + t["id"])
            n += 1
        except Exception:                                            # noqa: BLE001
            pass
    return n


def _kill_cdp_chrome():
    """Arrête UNIQUEMENT le Chrome du profil dédié E.N.O.S. (chrome_cdp_profile) : votre Chrome habituel n'est jamais touché."""
    ps = ("Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -like '*chrome_cdp_profile*' } "
          "| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }")
    try:
        subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, timeout=25, creationflags=0x08000000)
    except Exception:                                                # noqa: BLE001
        pass


def _connect_with_recovery(pw, progress, st):
    """3 essais, chacun limité à CONNECT_TIMEOUT_MS. Après le 1er échec : fermeture des onglets obsolètes ; après le 2e : redémarrage du Chrome dédié."""
    last = ""
    for attempt in (1, 2, 3):
        if st["abandoned"]:
            break
        port = ensure_chrome(progress)                               # relance Chrome (profil dédié) s'il n'écoute plus
        progress(f"Connexion à votre Chrome (CDP)… essai {attempt}/3", 6)
        try:
            return pw.chromium.connect_over_cdp(f"http://127.0.0.1:{port}", timeout=CONNECT_TIMEOUT_MS)
        except Exception as e:                                       # noqa: BLE001
            last = (str(e).strip().splitlines() or [e.__class__.__name__])[0][:140]
        idle = _stats["in_browser"] == 0                             # on ne touche à rien tant qu'une autre tâche travaille dans Chrome
        if attempt == 1:
            n = _close_stale_tabs(port) if idle else 0
            progress(f"Chrome ne répond pas ({n} onglet(s) obsolète(s) fermé(s)) : nouvel essai…", 6)
        elif attempt == 2 and idle:
            progress("Chrome toujours bloqué : redémarrage du Chrome E.N.O.S. (profil dédié)…", 6)
            _kill_cdp_chrome()
            time.sleep(2.0)
    raise AutomationError("Connexion à Chrome (CDP) impossible après 3 essais : " + last)


def _browser_job(job, src, out_dir, scratch, progress, fresh, st):
    """Exécuté dans un thread dédié : connexion (sous verrou FIFO), puis le travail PhotoRoom / Sprite Slicer."""
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        token = st["token"]
        try:
            progress("Connexion à Chrome : en file d'attente…", 5)
            if not _connect_fifo.acquire(token, CONNECT_DEADLINE_S * 2):
                raise AutomationError("Connexion à Chrome : file d'attente saturée, réessayez dans un instant.")
            st["locked_at"] = time.time()
            browser = _connect_with_recovery(pw, progress, st)
        finally:
            _connect_fifo.release(token)                              # la connexion suivante peut commencer (le travail, lui, se fait en parallèle)
        if st["abandoned"]:
            try:
                browser.close()
            except Exception:                                        # noqa: BLE001
                pass
            raise AutomationError("Connexion CDP abandonnée (délai dépassé).")
        with _stats_lock:
            _stats["in_browser"] += 1
        st["ready"].set()
        try:
            ctx = browser.contexts[0] if browser.contexts else browser.new_context(accept_downloads=True)
            if job == "slice":
                rescale = lambda m, p: progress(m, 8 + (p - 66) * 90 / 34)      # Sprite Slicer seul : barre de 8 a 98 %
                return slicer_auto_slice(ctx, src, scratch, rescale, fresh)
            if job == "simple":
                return photoroom_remove_bg(ctx, src, out_dir, progress, fresh)
            png = photoroom_remove_bg(ctx, src, scratch, progress, fresh)
            return slicer_auto_slice(ctx, png, scratch, progress, fresh)
        finally:
            with _stats_lock:
                _stats["in_browser"] -= 1
            try:
                browser.close()          # CDP : ne ferme que la connexion, Chrome et ses onglets restent ouverts
            except Exception:                                        # noqa: BLE001
                pass


def run(job, src, out_dir, scratch, progress, fresh=False):
    """job: 'simple' | 'multiple' | 'slice' (PNG deja detoure : Sprite Slicer seul, PhotoRoom contourne).
    Retourne le fichier final (png pour simple, zip pour multiple et slice).
    Le travail navigateur tourne dans un thread dédié ; CE thread-ci (celui de la tâche) relaie la progression et surveille le délai de connexion :
    si Chrome ne répond pas dans CONNECT_DEADLINE_S, la tâche échoue proprement (erreur dans l'interface) au lieu de rester figée à 6 %."""
    try:
        import playwright.sync_api                                   # noqa: F401 — simple vérification de présence
    except ImportError:
        raise AutomationError("Playwright n'est pas installé : py -m pip install playwright")
    os.makedirs(scratch, exist_ok=True)
    msgs = queue.Queue()
    st = {"ready": threading.Event(), "abandoned": False, "token": object(), "locked_at": 0.0}
    res = {}
    done = threading.Event()

    def worker():
        try:
            res["out"] = _browser_job(job, src, out_dir, scratch, lambda m, p: msgs.put((m, p)), fresh, st)
        except BaseException as e:                                   # noqa: BLE001 — l'erreur est relayée au thread de la tâche
            res["err"] = e
        finally:
            done.set()

    threading.Thread(target=worker, daemon=True, name="cdp-job").start()

    def drain():
        try:
            while True:
                m, p = msgs.get_nowait()
                progress(m, p)
        except queue.Empty:
            pass

    while not done.wait(0.25):
        drain()
        if not st["ready"].is_set() and st["locked_at"] and time.time() - st["locked_at"] > CONNECT_DEADLINE_S:
            st["abandoned"] = True
            _connect_fifo.release(st["token"])                       # libère la file même si le thread de connexion est bloqué
            raise AutomationError(f"Connexion à Chrome (CDP) bloquée depuis plus de {CONNECT_DEADLINE_S} s : tâche annulée. "
                                  "Fermez le Chrome E.N.O.S. (profil dédié) puis relancez.")
    drain()
    if "err" in res:
        raise res["err"]
    return res["out"]
