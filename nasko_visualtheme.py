"""Thèmes visuels dynamiques du plateau : E.N.O.S. choisit lui-même son esthétique (LLM -> JSON), Godot l'applique en direct.

  generate(mood, hint)  : demande au LLM un JSON de configuration visuelle, l'assainit, le sauvegarde et l'envoie à Godot (transition animée).
  apply(theme)          : applique un thème déjà prêt (préréglage ou JSON sauvegardé).      reset() : retour au rendu d'origine.
  set_anger(level)      : colère 0..1 -> yeux des cavaliers rouge intense (sans changer le thème).

Format (tout ce que renvoie le LLM est revalidé : couleurs « #RRGGBB » strictes, matériaux et intensités bornés) :
  {"theme_id": "Luxe Noir Doré",
   "light_square_color": "#2a2a2e", "dark_square_color": "#0a0a0c",
   "white_pieces_color": {"color": "#d4af37", "material": "gold"}, "black_pieces_color": {"color": "#16161a", "material": "obsidian"},
   "knight_eyes_emission": {"color": "#ff2a1a", "intensity": 4.0},
   "board_neon_glow": {"enabled": false, "color": "#00e5ff"}}
Le pont Godot (nasko_chessbridge) reçoit {"t":"visual","cfg":{…}} ; le JSON validé est conservé dans data/visual_theme.json (rechargé à chaque `hello` de Godot)."""
import json
import logging
import os
import re
import threading

import nasko_core
import nasko_llm

log = logging.getLogger("nasko.visualtheme")

MATERIALS = ("gold", "silver", "chrome", "bronze", "obsidian", "ebony", "ivory", "marble", "ice", "neon", "matte")
_ALIASES = {"or": "gold", "doré": "gold", "dore": "gold", "golden": "gold", "argent": "silver", "argenté": "silver", "platinum": "silver", "platine": "silver",
            "acier": "chrome", "steel": "chrome", "metal": "chrome", "métal": "chrome", "cuivre": "bronze", "copper": "bronze",
            "obsidienne": "obsidian", "onyx": "obsidian", "noir": "obsidian", "ébène": "ebony", "ebene": "ebony", "bois": "ebony", "wood": "ebony",
            "ivoire": "ivory", "os": "ivory", "marbre": "marble", "glace": "ice", "cristal": "ice", "crystal": "ice", "glass": "ice", "verre": "ice",
            "néon": "neon", "mat": "matte", "plastic": "matte", "plastique": "matte"}
_HEX = re.compile(r"^#?([0-9a-fA-F]{6})$")
_lock = threading.Lock()

# Préréglages : repli hors-ligne (LLM absent / réponse invalide) et exemples donnés au LLM.
PRESETS = {
    "luxe_noir_dore": {
        "theme_id": "Luxe Noir Doré",
        "light_square_color": "#2b2b30", "dark_square_color": "#0b0b0d",
        "white_pieces_color": {"color": "#d9b44a", "material": "gold"}, "black_pieces_color": {"color": "#15151a", "material": "obsidian"},
        "knight_eyes_emission": {"color": "#ffb02e", "intensity": 3.5}, "board_neon_glow": {"enabled": False, "color": "#d9b44a"}},
    "cyberpunk": {
        "theme_id": "Cyberpunk",
        "light_square_color": "#1a1038", "dark_square_color": "#07040f",
        "white_pieces_color": {"color": "#e8f4ff", "material": "chrome"}, "black_pieces_color": {"color": "#ff2bd6", "material": "neon"},
        "knight_eyes_emission": {"color": "#00f0ff", "intensity": 6.0}, "board_neon_glow": {"enabled": True, "color": "#00e5ff"}},
    "dark": {
        "theme_id": "Dark",
        "light_square_color": "#3a1216", "dark_square_color": "#0d0305",
        "white_pieces_color": {"color": "#b9b9c2", "material": "silver"}, "black_pieces_color": {"color": "#08080a", "material": "obsidian"},
        "knight_eyes_emission": {"color": "#ff1010", "intensity": 5.0}, "board_neon_glow": {"enabled": True, "color": "#ff1020"}},
}

SYSTEM = (
    "Tu es E.N.O.S., une IA qui choisit elle-même l'apparence de son plateau d'échecs selon son humeur et le contexte. "
    "Réponds UNIQUEMENT par un objet JSON valide (aucun texte autour, aucun markdown) avec exactement ces clés :\n"
    '{"theme_id": "nom court du thème",\n'
    ' "light_square_color": "#RRGGBB", "dark_square_color": "#RRGGBB",\n'
    ' "white_pieces_color": {"color": "#RRGGBB", "material": "<matériau>"},\n'
    ' "black_pieces_color": {"color": "#RRGGBB", "material": "<matériau>"},\n'
    ' "knight_eyes_emission": {"color": "#RRGGBB", "intensity": <nombre 0..12>},\n'
    ' "board_neon_glow": {"enabled": true|false, "color": "#RRGGBB"}}\n'
    "Matériaux autorisés : " + ", ".join(MATERIALS) + ". "
    "Règles : les deux camps doivent rester bien distincts (une pièce claire et une pièce sombre) et lisibles sur les cases ; "
    "les cases claires et sombres doivent avoir un contraste net ; intensité des yeux : 2 = discret, 5 = brillant, 8+ = éblouissant ; "
    "le néon convient aux thèmes futuristes ou agressifs, pas aux thèmes élégants. Inspire-toi (sans copier) de cet exemple :\n"
    + json.dumps(PRESETS["luxe_noir_dore"], ensure_ascii=False))


# ----------------------------------------------------------------------------- validation
def _hex(v, default):
    m = _HEX.match(str(v or "").strip())
    return "#" + m.group(1).lower() if m else default


def _material(v):
    s = str(v or "").strip().lower()
    s = _ALIASES.get(s, s)
    return s if s in MATERIALS else "matte"


def _piece(v, default):
    if isinstance(v, str):                                  # forme courte tolérée : "#d4af37"
        v = {"color": v}
    if not isinstance(v, dict):
        v = {}
    return {"color": _hex(v.get("color"), default["color"]), "material": _material(v.get("material", default["material"]))}


def sanitize(raw):
    """-> configuration sûre et complète (jamais d'exception : toute valeur invalide est remplacée par celle du préréglage « Dark »)."""
    d = PRESETS["dark"]
    raw = raw if isinstance(raw, dict) else {}
    eyes = raw.get("knight_eyes_emission") if isinstance(raw.get("knight_eyes_emission"), dict) else {}
    neon = raw.get("board_neon_glow") if isinstance(raw.get("board_neon_glow"), dict) else {}
    try:
        intensity = float(eyes.get("intensity", d["knight_eyes_emission"]["intensity"]))
    except (TypeError, ValueError):
        intensity = d["knight_eyes_emission"]["intensity"]
    theme_id = re.sub(r"[^\w .'’-]", "", str(raw.get("theme_id") or "Custom"))[:40].strip() or "Custom"
    return {
        "theme_id": theme_id,
        "light_square_color": _hex(raw.get("light_square_color"), d["light_square_color"]),
        "dark_square_color": _hex(raw.get("dark_square_color"), d["dark_square_color"]),
        "white_pieces_color": _piece(raw.get("white_pieces_color"), d["white_pieces_color"]),
        "black_pieces_color": _piece(raw.get("black_pieces_color"), d["black_pieces_color"]),
        "knight_eyes_emission": {"color": _hex(eyes.get("color"), d["knight_eyes_emission"]["color"]),
                                 "intensity": round(min(max(intensity if intensity == intensity else 2.0, 0.0), 12.0), 2)},   # NaN -> 2.0
        "board_neon_glow": {"enabled": neon.get("enabled") is True, "color": _hex(neon.get("color"), d["board_neon_glow"]["color"])},
    }


def parse_llm_json(text):
    """Extrait le premier objet JSON d'une réponse (tolère ```json … ``` et du texte autour). Lève ValueError."""
    text = str(text or "")
    start = text.find("{")
    if start < 0:
        raise ValueError("aucun objet JSON")
    obj, _ = json.JSONDecoder().raw_decode(text[start:])
    if not isinstance(obj, dict):
        raise ValueError("JSON inattendu")
    return obj


# ----------------------------------------------------------------------------- persistance / envoi à Godot
def _path():
    return os.path.join(nasko_core.data_dir(), "visual_theme.json")


def current():
    """Dernier thème appliqué (assaini) ou None."""
    try:
        with open(_path(), encoding="utf-8") as f:
            return sanitize(json.load(f))
    except (OSError, ValueError):
        return None


def _emit(kind, payload):
    import nasko_chess                                       # import tardif : nasko_chess ne dépend pas de ce module
    nasko_chess._emit(kind, payload)


def apply(theme, secs=1.4):
    """Sauvegarde puis envoie à Godot (transition animée de `secs` secondes). `theme` : dict brut, il est assaini ici."""
    cfg = sanitize(theme)
    with _lock:
        try:
            with open(_path(), "w", encoding="utf-8") as f:
                json.dump(cfg, f, ensure_ascii=False, indent=1)
        except OSError:
            log.warning("thème visuel non sauvegardé", exc_info=True)
    _emit("visual", {"cfg": cfg, "secs": secs})
    return cfg


def reset():
    try:
        os.remove(_path())
    except OSError:
        pass
    _emit("visual", {"cfg": {}, "secs": 0.8})
    return {"theme_id": None}


def set_anger(level):
    """Colère d'E.N.O.S. : 0 = calme, 1 = yeux des cavaliers rouge intense qui palpitent."""
    level = min(max(float(level), 0.0), 1.0)
    _emit("visual_mood", level)
    return {"anger": level}


# ----------------------------------------------------------------------------- le cerveau : le LLM choisit
def generate(mood="", hint="", cfg=None, secs=1.4):
    """Demande au LLM (E.N.O.S.) de composer son thème, l'assainit et l'applique. `mood` : humeur / contexte de la partie
    (« furieux, je perds », « serein »…) ; `hint` : souhait de l'utilisateur (« luxe noir doré »). Bloquant (appel réseau) : à lancer hors boucle asyncio.
    Retourne {"theme": cfg, "source": "llm"|"preset", "error": str|None}. Si le LLM est indisponible ou répond n'importe quoi,
    un préréglage cohérent avec l'humeur est appliqué : le plateau ne reste jamais sans thème."""
    cfg = cfg or nasko_core.load_config()
    user = "Compose ton thème visuel maintenant.\nHumeur / contexte : %s\nDemande : %s" % (str(mood or "libre")[:300], str(hint or "aucune, choisis librement")[:300])
    err = None
    try:
        text = nasko_llm.complete(cfg, SYSTEM, user, max_tokens=500, clean=False)
        theme = parse_llm_json(text)
        return {"theme": apply(theme, secs), "source": "llm", "error": None}
    except nasko_llm.LLMError as e:
        err = str(e)
    except ValueError as e:                                   # JSON.JSONDecodeError en hérite
        err = "réponse du LLM illisible (%s)" % e
    log.info("thème visuel : repli sur un préréglage (%s)", err)
    key = "dark" if re.search(r"furi|col[eè]r|rage|angry|mad|perd|lose|lost", str(mood), re.I) else "luxe_noir_dore"
    return {"theme": apply(PRESETS[key], secs), "source": "preset", "error": err}
