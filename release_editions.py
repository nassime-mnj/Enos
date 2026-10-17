"""Éditions d'E.N.O.S. : un build PAR PROFIL, physiquement isolé (utilisé par build_release.py --edition).

  friends : utilitaires seulement (Agenda, PDF, Studio média, Outils rapides, IA, Syllabus) — ni Système/PC, ni Terna/Dev, ni Google, ni loisirs.
  dev     : tout sauf API Control Panel et Notes de frais.
  ceo     : tout.

Isolation = le code des capacités exclues n'est PAS livré : ses modules Python sont remplacés par une coquille vide, ses scripts / feuilles de style
et ses projets Godot sont supprimés, la page d'accueil n'y fait plus référence. Le plafond de profil (enos_edition.json, lu par nasko_roles) interdit en plus
de monter au-dessus de l'édition. Les scripts exclusifs d'une capacité sont DÉDUITS des routes qu'ils appellent (nasko_roles.PREFIX_CAPS), pas listés à la main."""
import glob
import json
import os
import re
import shutil

import nasko_roles

EDITIONS = ("friends", "dev", "ceo")
CHANNEL = {"friends": "stable", "dev": "dev", "ceo": "ceo"}
EXCLUDED_CAPS = {
    "ceo": set(),
    "dev": {"receipts", "apimon"},
    "friends": {"receipts", "apimon", "system", "devtools", "leisure", "creator", "google", "mirror", "gaming"},
}
PY_MODULES = {                                    # modules Python propres à une capacité (remplacés par une coquille dans les éditions qui l'excluent)
    "receipts": ["nasko_receipts"],
    "apimon": ["nasko_apimon"],
    "devtools": ["nasko_env", "nasko_git", "nasko_godotsync", "nasko_godotdiag", "nasko_anim", "nasko_audio"],
    "depot": ["nasko_wsl", "nasko_devmanager", "nasko_depot", "nasko_depot_git", "nasko_depot_study", "nasko_depot_forge", "nasko_depot_term"],   # Dépôt Intranet + Dev Manager : donnés aussi à Friends
    "leisure": ["nasko_chess", "nasko_chessbridge", "nasko_mobchess", "nasko_pet", "opening_manager"],
    "creator": ["nasko_compress", "nasko_youtube"],
    "system": ["nasko_cleaner", "nasko_sysctl", "nasko_sysmon", "nasko_diag", "nasko_power"],
    "google": ["nasko_tabs", "nasko_ext", "nasko_webauto"],
    "mirror": ["nasko_mirror"],
    "gaming": ["nasko_clipper", "nasko_capture", "nasko_babel", "nasko_tilt", "nasko_brb", "nasko_afk"],
}
DIRS = {"leisure": ["godot_chess", "openings"], "depot": ["static/vendor/monaco", "static/vendor/xterm"]}   # dossiers entiers
# Le dossier de travail WSL par défaut nomme l'utilisateur Linux du CEO : hors édition CEO il est remplacé par un nom neutre (chaque utilisateur règle le sien dans « ESPACE WSL »).
OWNER_HOME = re.compile(r"(home(?:\\+|/))nasko\b")
OWNER_REPLACEMENT = r"\1utilisateur"
KEEP_STATIC = {"quick.js", "updatebar.js", "roles.js", "app.js", "sec.js", "team.js", "onboarding.js", "home.js", "defi.js"}   # partagés : jamais supprimés (quick.js appelle /api/receipts mais sert aussi Friends)
MARK = "# ENOS-EDITION-STUB"

STUB = '''"""Module absent de l\'édition « {edition} » d\'E.N.O.S. : son code n\'est pas livré dans ce build."""
{mark}


class _Absent:
    """Objet neutre : tout accès / appel renvoie un objet vide, rien ne s\'exécute. Les routes correspondantes sont de toute façon refusées (403)."""
    def __getattr__(self, name):
        if name.startswith("__"):
            raise AttributeError(name)
        return self
    def __call__(self, *a, **k): return self
    def __iter__(self): return iter(())
    def __bool__(self): return False
    def __len__(self): return 0
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def __getitem__(self, k): return self
    def __fspath__(self): return "/enos-module-absent"
    def __str__(self): return ""


_ABSENT = _Absent()


def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return _ABSENT
'''


def excluded_caps(edition):
    if edition not in EXCLUDED_CAPS:
        raise ValueError(f"édition inconnue : {edition}")
    return EXCLUDED_CAPS[edition]


def _read(path):
    with open(path, encoding="utf-8", errors="ignore") as f:
        return f.read()


def js_caps(path):
    """Capacités des routes appelées par un script (via la table de nasko_roles) ; vide si le script n'appelle aucune route."""
    s = _read(path)
    caps = set()
    for m in re.finditer(r'["\'`](/(?:api|ws|ext)/[A-Za-z0-9_\-/]*)', s):
        p = m.group(1).rstrip("/")
        c = nasko_roles.capability_for(p)
        caps.add(c or "?")
    return caps


def prunable_static(static_dir, edition):
    """Scripts exclusifs des capacités exclues (tous leurs appels visent une capacité exclue). Leurs feuilles de style (même nom) suivent."""
    ex = excluded_caps(edition)
    out = []
    for f in sorted(glob.glob(os.path.join(static_dir, "*.js"))):
        name = os.path.basename(f)
        caps = js_caps(f)
        if name not in KEEP_STATIC and caps and caps <= ex:
            out.append(name)
    return out


def apply(stage, edition):
    """Applique l'isolation sur la copie `stage`. Retourne un rapport {removed_static, stubbed, removed_dirs}."""
    ex = excluded_caps(edition)
    stage = str(stage)
    rep = {"edition": edition, "removed_static": [], "stubbed": [], "removed_dirs": []}
    static = os.path.join(stage, "static")
    for js in prunable_static(static, edition) if os.path.isdir(static) else []:
        for ext in (".js", ".css"):
            p = os.path.join(static, js[:-3] + ext)
            if os.path.isfile(p):
                os.remove(p); rep["removed_static"].append(os.path.basename(p))
    idx = os.path.join(static, "index.html")
    if os.path.isfile(idx):                                    # la page n'appelle plus les fichiers supprimés
        html = _read(idx)
        for name in rep["removed_static"]:
            html = re.sub(r'[ \t]*<(?:script|link)[^>]*/static/' + re.escape(name) + r'[^>]*>(?:</script>)?[ \t]*\r?\n?', "", html)
        with open(idx, "w", encoding="utf-8") as f:
            f.write(html)
    for cap in sorted(ex):
        for mod in PY_MODULES.get(cap, []):
            p = os.path.join(stage, mod + ".py")
            if os.path.isfile(p):
                with open(p, "w", encoding="utf-8") as f:
                    f.write(STUB.format(edition=edition, mark=MARK))
                rep["stubbed"].append(mod)
        for d in DIRS.get(cap, []):
            p = os.path.join(stage, d)
            if os.path.isdir(p):
                shutil.rmtree(p); rep["removed_dirs"].append(d)
    if edition != "ceo":
        for mod in PY_MODULES.get("depot", []):
            p = os.path.join(stage, mod + ".py")
            if os.path.isfile(p):
                src = _read(p)
                new = OWNER_HOME.sub(OWNER_REPLACEMENT, src)
                if new != src:
                    with open(p, "w", encoding="utf-8", newline="") as f:
                        f.write(new)
                    rep.setdefault("neutralized", []).append(mod)
    with open(os.path.join(stage, "enos_edition.json"), "w", encoding="utf-8") as f:
        json.dump({"edition": edition}, f)
    return rep


def verify(stage, edition):
    """Contrôle final : retourne la liste des problèmes (vide = isolation correcte)."""
    ex, stage, bad = excluded_caps(edition), str(stage), []
    for cap in ex:
        for mod in PY_MODULES.get(cap, []):
            p = os.path.join(stage, mod + ".py")
            if os.path.isfile(p) and MARK not in _read(p):
                bad.append(f"{mod}.py : code réel présent")
        for d in DIRS.get(cap, []):
            if os.path.isdir(os.path.join(stage, d)):
                bad.append(f"{d}/ : dossier présent")
    if edition != "ceo":
        for mod in PY_MODULES.get("depot", []):
            p = os.path.join(stage, mod + ".py")
            if os.path.isfile(p) and OWNER_HOME.search(_read(p)):
                bad.append(f"{mod}.py : dossier personnel du CEO (home/nasko) présent")
    static = os.path.join(stage, "static")
    if os.path.isdir(static):
        left = [n for n in prunable_static(static, edition)]
        bad += [f"static/{n} : script exclu présent" for n in left]
        idx = os.path.join(static, "index.html")
        if os.path.isfile(idx):
            html = _read(idx)
            for n in re.findall(r"/static/([A-Za-z0-9_.-]+\.(?:js|css))", html):
                if not os.path.isfile(os.path.join(static, n)) and n != "roles.js":
                    bad.append(f"index.html référence static/{n} qui n'existe pas")
    try:
        if json.loads(_read(os.path.join(stage, "enos_edition.json"))).get("edition") != edition:
            bad.append("enos_edition.json incohérent")
    except (OSError, ValueError):
        bad.append("enos_edition.json manquant")
    return bad
