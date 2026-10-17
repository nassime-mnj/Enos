"""Synchronisation Godot « invisible » : Git fait le transfert, le chat partagé (Hub) fait la notification.

  Émetteur  : « Diffuser ma mise à jour » = synchronisation Git habituelle (nasko_git : add, commit, pull, push) ; si elle réussit, un message
              système  [MAJ_GODOT_DISPONIBLE] {json}  est posté dans le chat partagé. Il n'est jamais affiché comme un message : l'interface l'intercepte.
  Récepteur : le E.N.O.S. de l'associé détecte ce message (relais par dossier d'entrepôt ou liaison directe), affiche une alerte avec ACCEPTER,
              puis récupère la mise à jour : `git pull --ff-only` si le dossier est déjà un dépôt, `git clone` s'il est vide.

Sécurités : le contenu du message vient d'un autre PC, donc il est traité comme non fiable — l'adresse du dépôt n'est utilisée que pour un clone dans
un dossier VIDE, et seulement si c'est une adresse https/ssh classique (jamais d'identifiants, de chemin local ni de transport spécial) ; un dossier
déjà rempli n'est jamais écrasé ; le pull est « fast-forward seulement » : en cas de divergence ou de modifications locales en conflit, rien n'est
touché et l'utilisateur est renvoyé vers « SYNCHRONISER LE PROJET » (qui sait résoudre les conflits)."""
import json
import os
import re
import threading
import time

import nasko_git

TAG = "[MAJ_GODOT_DISPONIBLE]"
MAX_AGE = 3 * 86400                       # une alerte plus vieille que 3 jours n'est plus proposée
_URL_OK = re.compile(r"^(https://[A-Za-z0-9._-]+(:\d+)?/[A-Za-z0-9._~/-]+|git@[A-Za-z0-9._-]+:[A-Za-z0-9._~/-]+|ssh://git@[A-Za-z0-9._-]+(:\d+)?/[A-Za-z0-9._~/-]+)$")
_lock = threading.Lock()
RECV = {"running": False, "ok": None, "message": "", "t": 0.0}


# ----------------------------------------------------------------------------- message système
def safe_url(url):
    """Adresse de dépôt utilisable sans danger (sinon '') : jamais de identifiant:jeton@, d'espace, de chemin local."""
    url = (url or "").strip()
    url = re.sub(r"^(https://)[^/@\s]+@", r"\1", url)               # retire un éventuel jeton intégré avant de l'envoyer
    return url if _URL_OK.match(url) and ".." not in url else ""


def make_text(root):
    info = nasko_git.info(root)
    rc, sha = nasko_git._git(root, "rev-parse", "--short", "HEAD", timeout=15)
    data = {"remote": safe_url(info.get("remote", "")), "branch": info.get("branch", ""), "sha": sha if rc == 0 else ""}
    return TAG + " " + json.dumps(data, ensure_ascii=False)


def parse(text):
    """-> dict (champs assainis) si c'est un signal de mise à jour, sinon None."""
    if not isinstance(text, str) or not text.startswith(TAG):
        return None
    try:
        d = json.loads(text[len(TAG):].strip() or "{}")
    except ValueError:
        d = {}
    if not isinstance(d, dict):
        d = {}
    return {"remote": safe_url(str(d.get("remote", ""))), "branch": re.sub(r"[^\w./-]", "", str(d.get("branch", "")))[:80],
            "sha": re.sub(r"[^0-9a-f]", "", str(d.get("sha", "")))[:12]}


# ----------------------------------------------------------------------------- alerte côté récepteur
def _seen_file(data_dir):
    return os.path.join(data_dir, "godot_seen.json")


def seen_t(data_dir):
    try:
        with open(_seen_file(data_dir), encoding="utf-8") as f:
            return float(json.load(f).get("t", 0))
    except (OSError, ValueError, AttributeError, TypeError):
        return 0.0


def mark_seen(data_dir, t):
    try:
        with open(_seen_file(data_dir), "w", encoding="utf-8") as f:
            json.dump({"t": max(t, seen_t(data_dir))}, f)
    except OSError:
        pass


def pending(history, me, data_dir):
    """Dernière alerte non traitée envoyée par quelqu'un d'autre que moi, ou None."""
    floor = max(seen_t(data_dir), time.time() - MAX_AGE)
    best = None
    for m in history:
        if m.get("from") == me or m.get("t", 0) <= floor:
            continue
        d = parse(m.get("text"))
        if d is not None and (best is None or m["t"] > best["t"]):
            best = {**d, "id": m["id"], "t": m["t"], "from": m.get("from", "?"), "label": m.get("label", "?")}
    return best


# ----------------------------------------------------------------------------- récupération (pull / clone)
def _is_empty(path):
    try:
        return not any(True for _ in os.scandir(path))
    except OSError:
        return False


def _receive(path, alert):
    try:
        if not nasko_git.available():
            raise RuntimeError("Git n'est pas installé (https://git-scm.com).")
        if not os.path.isdir(path):
            os.makedirs(path, exist_ok=True)
        root = nasko_git.repo_root(path)
        if root and os.path.normcase(os.path.abspath(root)) == os.path.normcase(os.path.abspath(path)):
            rc, out = nasko_git._git(root, "pull", "--no-edit", "--ff-only", timeout=600)
            if rc:
                low = out.lower()
                if "not possible to fast-forward" in low or "diverging" in low or "overwritten" in low or "would be overwritten" in low:
                    raise RuntimeError("Vos fichiers locaux diffèrent de la mise à jour : rien n'a été touché. Utilisez « SYNCHRONISER LE PROJET » "
                                       "(Hub → Projet Git) pour fusionner proprement.")
                raise RuntimeError("Récupération impossible : " + out[-300:] + (" — connexion GitHub requise." if "authent" in low or "denied" in low else ""))
            RECV.update(ok=True, message="Projet à jour." if "up to date" in out.lower() or "déjà à jour" in out.lower() else "Mise à jour récupérée dans votre projet Godot.")
        elif _is_empty(path):
            url = safe_url((alert or {}).get("remote", ""))
            if not url:
                raise RuntimeError("Dossier vide, mais l'adresse du dépôt n'est pas dans l'alerte : utilisez « CONNECTER LE DÉPÔT » (Hub → Projet Git).")
            rc, out = nasko_git._git(path, "clone", "--", url, ".", timeout=1800)
            if rc:
                raise RuntimeError("Clonage impossible : " + out[-300:] + (" — connexion GitHub requise." if "authent" in out.lower() or "denied" in out.lower() else ""))
            RECV.update(ok=True, message="Projet téléchargé (clone) dans le dossier vide.")
        else:
            raise RuntimeError("Le dossier du projet n'est pas vide et n'est pas un dépôt Git : par sécurité rien n'est écrasé. "
                               "Videz-le, ou choisissez un autre dossier dans le profil.")
    except Exception as e:                                                           # noqa: BLE001 — remonté à l'interface
        RECV.update(ok=False, message=str(e))
    finally:
        RECV.update(running=False, t=time.time())


def receive(path, alert):
    """Lance pull/clone en arrière-plan. False si déjà en cours."""
    with _lock:
        if RECV["running"]:
            return False
        RECV.update(running=True, ok=None, message="Téléchargement de la mise à jour…", t=time.time())
    threading.Thread(target=_receive, args=(path, alert), daemon=True).start()
    return True
