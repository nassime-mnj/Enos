"""Logique partagee E.N.O.S. : configuration, chemins, phrases d'accueil (sans interface)."""
import json
import re
import os
import sys

GREETINGS = [
    "Analyse des paquets réseau terminée. Aucun intrus détecté. Bonjour Nassime.",
    "Synchronisation avec les serveurs distants établie. Allocation mémoire : optimale. Prêt à opérer, Nassime.",
    "Initialisation des sous-routines d'automatisation. Contournement des protocoles de sécurité locaux réussi. Bonjour Nassime.",
    "Déchiffrement des données en cache. Connexion sécurisée établie. En attente d'instructions, Nassime.",
    "Compilation des logs d'erreurs : 0 avertissement. Interface de commande activée. Salut Nassime.",
    "Scan matériel terminé. CPU et GPU sous les seuils critiques. Accès administrateur confirmé. Bonjour Nassime.",
]

GREETINGS_EN = [
    "Network packet analysis complete. No intruder detected. Hello Nassime.",
    "Synchronization with remote servers established. Memory allocation: optimal. Ready to operate, Nassime.",
    "Automation subroutines initialized. Local security protocols bypassed successfully. Hello Nassime.",
    "Cached data decrypted. Secure connection established. Awaiting instructions, Nassime.",
    "Error log compilation: 0 warnings. Command interface online. Hey Nassime.",
    "Hardware scan complete. CPU and GPU below critical thresholds. Administrator access confirmed. Hello Nassime.",
]


def language(cfg=None):
    """Langue de l'assistant : « fr » (défaut) ou « en »."""
    cfg = cfg if cfg is not None else load_config()
    return "en" if str(cfg.get("language", "fr")).lower().startswith("en") else "fr"


_OLD_NAME = re.compile(r"n\.?\s?a\.?\s?s\.?\s?k\.?\s?o", re.I)       # ancien nom du projet (N.A.S.K.O / NASKO)

SYSTEM_PROMPT = (
    "Tu es E.N.O.S. A.I., un assistant cybernétique et développeur système. Ton fondateur est Nassime. "
    "Tu l'assistes dans ses tâches informatiques et notamment sur le projet de jeu Terna. "
    "Tes réponses doivent être concises, professionnelles, froides mais loyales, avec un vocabulaire technique. "
    "Réponds en français, en texte brut sans markdown ni listes à puces : tes réponses sont lues à voix haute. "
    "IDENTITÉ : ton nom est E.N.O.S. et rien d'autre. Si on te demande qui tu es, réponds que tu es E.N.O.S. Tu n'as jamais porté d'autre nom."
)

DEFAULT_CONFIG = {
    "project_dir": "",          # projet actif (choisi dans [ PROJETS ] ; memorise ici)
    "godot_path": "",           # vide = PATH uniquement
    "aseprite_path": "",
    "launch_claude": True,
    "godot_scene_excludes": [".godot", ".git", ".claude", "addons", "build"],   # dossiers ignores par [ SCÈNES GODOT ]
    "godot_single_instance": True, "remote_power": True, "power_delay": 20,   # une seule scene a la fois : en lancer une autre arrete la precedente
    "f6_auto_stop_minutes": 30,      # scenes lancees depuis un telephone/web : arret automatique apres N min (0 = jamais)
    "screen_share": "window",        # visu a distance : "window" (fenetre de la scene seulement), "full" (ecran) ou "off"
    "keep_awake": False,             # empeche la mise en veille du PC tant que E.N.O.S. tourne
    "allow_vpn_ranges": False,       # accepte les adresses VPN 100.64.0.0/10 (Tailscale) : certificat reemis, a reinstaller
    "godot_console": False,       # True : lance les scenes avec la console Godot (journal/erreurs visibles)
    "launch_godot": True,
    "welcome_language": "fr",        # phrase d'accueil au démarrage : "fr", "en" ou "off"
    "language": "fr",                # langue de l'assistant : "fr" ou "en" (texte, voix, phrases réflexes, reconnaissance vocale)
    "voice_pitch": 0.86,             # voix d'E.N.O.S. plus grave : 0.86 par défaut (0.5-0.99), 1 = voix d'origine
    "launch_aseprite": True,
    "api_key_inject_remote": True,   # SÉCURITÉ : fournir la clé d'API aux navigateurs de téléphone déjà authentifiés (False = APK appairée seulement)
    "enc_required_remote": False,    # SÉCURITÉ : refuser tout échange distant non chiffré en AES-256-GCM (impose l'APK appairée)
    "allowed_roots": [],             # SÉCURITÉ : dossiers supplémentaires autorisés pour les chemins fournis par l'interface
    "sync_max_mb": 4096, "share_ttl_min": 30,
    "launch_powershell": False,   # sous-menu ENVIRONNEMENT : PowerShell simple coché par défaut ?
    "env_stagger_s": 2.0,         # secondes entre deux outils lancés (anti-lag)
    "chrome_path": "",
    "chess_theme": "classic",       # thème de pièces du plateau Godot (voir godot_chess/assets/themes)
    "chess_takebacks": 2,           # takebacks proposés par partie après une gaffe catastrophique
    "notify_enabled": True,        # notification Windows à la fin d'une tâche
    "notify_voice": True,          # + phrase réflexe vocale (ElevenLabs)
    "tray_enabled": True,          # icône dans la zone de notification : E.N.O.S. reste actif (sans fenêtre) quand on ferme la fenêtre
    "briefing_enabled": True,      # briefing quotidien silencieux (notification native)
    "briefing_time": "08:00",      # heure du briefing (HH:MM) ; envoyé au démarrage si le PC était éteint à cette heure (jusqu'à 13 h)
    "notify_paused_until": 0,      # « ne pas déranger » : aucune alerte avant cet instant (timestamp)
    "vision_model": "",            # modèle « vision » du Widget Œil (vide = automatique selon le fournisseur)
    "pet_autostart": False,        # lancer l'Œil de bureau au démarrage d'E.N.O.S.
    "chess_board_exe": "",         # futur plateau 3D (exécutable) encastré dans CHESS ; vide = plateau 2D intégré
    "chess_board_args": [],        # ex. Godot : ["--wid", "{HWND}"] ({HWND} = fenêtre E.N.O.S.)
    "server_port": 8765,
    "https_port": 8443,
    "allow_network_access": False,
    "network_access_code": "",
    "trusted_ips": [],            # IP locales (ou reseaux CIDR) admises sans code ni jeton ; ex. ["192.168.1.45"]
    "incognito_urls": ["https://temp-mail.org/fr/", "https://pixellab.ai/signup"],
    # --- LLM : "anthropic" ou "openai" (tout serveur compatible OpenAI via llm_base_url)
    "llm_provider": "anthropic",
    "llm_api_key": "",
    "llm_model": "",
    "llm_base_url": "",
    "llm_max_tokens": 400,
    "llm_history_messages": 12,
    "system_prompt": SYSTEM_PROMPT,
    # --- Dictee vocale (micro du PC) : "api" = Whisper via API compatible OpenAI (Groq...), "local" = faster-whisper
    "stt_provider": "api",
    "stt_base_url": "",
    "stt_api_key": "",
    "stt_model": "",
    "stt_language": "fr",
    "stt_local_model": "small",
    # --- ElevenLabs
    "elevenlabs_api_key": "",
    "elevenlabs_voice_id": "",
    "elevenlabs_voice_name": "A.I. E.N.O.S.",
    "elevenlabs_model": "eleven_multilingual_v2",
    "elevenlabs_backup_api_key": "",     # compte de secours d'E.N.O.S. (pas ETO) : utilisé automatiquement quand les crédits du principal sont épuisés
    "elevenlabs_backup_voice_id": "",    # vide : la voix est retrouvée par son nom sur le compte de secours
    "elevenlabs_backup_voice_name": "ENOS2",
    "persona": "enos",              # personnalité active : "enos" (antagoniste) ou "eto" (zen, voix et clé ElevenLabs dédiées)
    "elevenlabs_eto_api_key": "",   # clé ElevenLabs réservée à ETO (E.N.O.S. garde elevenlabs_api_key)
    "elevenlabs_eto_voice_id": "",
    "elevenlabs_eto_stability": 0.25,     # ETO streamer : stabilité très basse = rendu vif, hyperactif, non scripté ; v3 la ramène au palier « Creative » le plus expressif
    "elevenlabs_eto_style": 0.6,          # exagération du style ≈ 60 %
    "elevenlabs_eto_speed": 1.2,          # débit ElevenLabs au MAXIMUM autorisé par l'API (plage 0.7 – 1.2)
    "elevenlabs_eto_tempo": 1.15,         # accélération locale FFmpeg par-dessus : 1.2 x 1.15 ≈ x1.38 au total (1.0 = désactivée)
    "elevenlabs_eto_model": "eleven_v3",   # le seul modèle ElevenLabs qui interprète les Audio Tags [laugh] [sigh] [hmm]…
    "tts_dynamic": True,
}


def resource_path(*parts):
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, *parts)


def app_dir():
    return os.path.dirname(sys.executable if getattr(sys, "frozen", False) else os.path.abspath(__file__))


def config_path():
    return os.path.join(app_dir(), "nasko_config.json")


# ----------------------------------------------------------------------------- profils (une section par personne : Nassime, Raf…)
# enos_profiles.json est PARTAGEABLE (Git/OneDrive) : chaque machine y retrouve ses propres chemins grâce au nom d'utilisateur
# Windows. Les valeurs du profil actif passent AVANT celles de nasko_config.json (qui peut être partagé et contenir les chemins d'un autre).
PROFILE_PATH_KEYS = ("godot_path", "aseprite_path", "chrome_path", "ffmpeg_path", "warehouse_dir", "project_dir")
PROFILE_OPTION_KEYS = ("launch_claude", "launch_godot", "launch_aseprite", "launch_powershell")
_prof_lock = __import__("threading").RLock()


def profiles_path():
    return os.path.join(app_dir(), "enos_profiles.json")


def _whoami():
    import getpass
    names = {getpass.getuser().lower(), os.path.basename(os.path.expanduser("~")).lower()}
    return {n for n in names if n}


def _template_profiles(base):
    me = sorted(_whoami())
    paths = {k: base.get(k, "") or "" for k in PROFILE_PATH_KEYS}
    return {"version": 1, "active": "",
            "profiles": {
                "nassime": {"label": "Nassime", "windows_users": me, "paths": paths, "options": {}},
                "raf": {"label": "Raf", "windows_users": [],
                        "paths": {k: "" for k in PROFILE_PATH_KEYS}, "options": {},
                        "note": "Raf : renseignez ses chemins (Godot, Aseprite, Chrome, projet, entrepôt) dans RÉGLAGES → PROFIL, "
                                "et son nom d'utilisateur Windows dans windows_users."}}}


def load_profiles(create=True):
    p = profiles_path()
    with _prof_lock:
        try:
            with open(p, encoding="utf-8-sig") as f:
                data = json.load(f)
            if isinstance(data.get("profiles"), dict) and data["profiles"]:
                return data
        except (OSError, ValueError):
            pass
        base = {}
        try:
            with open(config_path(), encoding="utf-8-sig") as f:
                base = json.load(f)
        except (OSError, ValueError):
            pass
        data = _template_profiles(base)
        if create:
            try:
                with open(p, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
            except OSError:
                pass
        return data


def save_profiles(data):
    with _prof_lock, open(profiles_path(), "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def current_profile(data=None):
    """(id, profil) : variable ENOS_PROFILE > champ « active » > correspondance avec le nom d'utilisateur Windows > premier profil."""
    data = data or load_profiles()
    profs = data["profiles"]
    forced = (os.environ.get("ENOS_PROFILE") or data.get("active") or "").lower()
    if forced in profs:
        return forced, profs[forced]
    me = _whoami()
    for pid, pr in profs.items():
        if me & {u.lower() for u in pr.get("windows_users", [])}:
            return pid, pr
    pid = next(iter(profs))
    return pid, profs[pid]


def _load_config_raw():
    cfg = dict(DEFAULT_CONFIG)
    try:
        with open(config_path(), encoding="utf-8-sig") as f:
            cfg.update(json.load(f))
    except (OSError, ValueError):
        pass
    try:
        pid, pr = current_profile()
    except Exception:
        return cfg
    for k, v in (pr.get("paths") or {}).items():
        if k == "project_dir":
            if v and os.path.isdir(v):                         # dossier du profil s'il existe, sinon celui du fichier local
                cfg[k] = v
        elif v:
            cfg[k] = v
    for k, v in (pr.get("options") or {}).items():
        cfg[k] = v
    label = pr.get("label") or pid.capitalize()
    cfg["profile_id"], cfg["user_label"] = pid, label
    if isinstance(cfg.get("system_prompt"), str) and _OLD_NAME.search(cfg["system_prompt"]):      # reliquat de l'ancien projet : on l'élimine
        cfg["system_prompt"] = SYSTEM_PROMPT
    if label != "Nassime":                                     # l'assistant s'adresse à la bonne personne
        sp = cfg.get("system_prompt") or ""
        add = f" Tu parles actuellement avec {label}, l'associé de Nassime : adresse-toi à {label}."
        cfg["system_prompt"] = sp.replace("Ton fondateur est Nassime.", "Ton fondateur est Nassime." + add) if "Ton fondateur est Nassime." in sp else sp + add
    return cfg


def load_config():
    """Configuration de la machine + profil de chemins (Nassime / Raf) + surcouche du PROFIL D'UTILISATION (Friends : ses propres liens Zeus / Moodle)."""
    cfg = _load_config_raw()
    try:
        import nasko_roles
        return nasko_roles.apply_config_overlay(cfg)
    except Exception:                                                  # noqa: BLE001 — jamais bloquer la lecture de la configuration
        return cfg


def ensure_config_file():
    """Cree nasko_config.json ou y ajoute les cles manquantes (les valeurs existantes sont conservees)."""
    path = config_path()
    current = {}
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8-sig") as f:
                current = json.load(f)
        except (OSError, ValueError):
            return  # fichier illisible : on n'y touche pas
    merged = {**DEFAULT_CONFIG, **current}
    if merged != current:
        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(merged, f, indent=2, ensure_ascii=False)
        except OSError:
            pass


def update_config(values):
    """Met a jour quelques cles de nasko_config.json en conservant le reste.
    Les chemins personnels (Godot, Aseprite, projet, entrepôt…) vont dans le PROFIL actif, pas dans le fichier local potentiellement partagé."""
    try:
        import nasko_roles
        values = nasko_roles.remap_config_update(values)
    except Exception:                                                  # noqa: BLE001
        pass
    mine = {k: v for k, v in values.items() if k in PROFILE_PATH_KEYS}
    if mine:
        try:
            data = load_profiles()
            pid, pr = current_profile(data)
            data["profiles"][pid].setdefault("paths", {}).update(mine)
            save_profiles(data)
            values = {k: v for k, v in values.items() if k not in PROFILE_PATH_KEYS}
        except Exception:
            pass
        if not values:
            return
    path = config_path()
    try:
        with open(path, encoding="utf-8-sig") as f:
            current = json.load(f)
    except (OSError, ValueError):
        current = {}
    current.update(values)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(current, f, indent=2, ensure_ascii=False)


def ssl_context():
    """Contexte TLS qui utilise le magasin de certificats de WINDOWS (et non celui de Python).
    Indispensable derriere un antivirus/proxy qui inspecte le HTTPS (ex. Kaspersky) : son certificat racine est
    approuve par Windows. La verification des certificats reste active."""
    try:
        import ssl
        import truststore
        return truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    except Exception:
        return True   # repli : verification standard de httpx


_stats_lock = None


def bump_stat(key, n):
    """Compteurs persistants (data/voice_stats.json) : saved_chars, api_chars, static_hits. Ne leve jamais."""
    global _stats_lock
    import threading
    _stats_lock = _stats_lock or threading.Lock()
    path = os.path.join(data_dir(), "voice_stats.json")
    try:
        with _stats_lock:
            try:
                with open(path, encoding="utf-8") as f:
                    stats = json.load(f)
            except (OSError, ValueError):
                stats = {}
            stats[key] = int(stats.get(key, 0)) + int(n)
            with open(path, "w", encoding="utf-8") as f:
                json.dump(stats, f)
    except OSError:
        pass


def read_stats():
    try:
        with open(os.path.join(data_dir(), "voice_stats.json"), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def data_dir():
    """Dossier des donnees modifiables (historique, projets, cache audio), a cote de l'exe."""
    path = os.path.join(app_dir(), "data")
    os.makedirs(path, exist_ok=True)
    return path


def find_asset(name):
    """Fichier d'image/ressource a cote de l'exe ou embarque dans l'exe (ex. logo-192.png)."""
    for base in (app_dir(), resource_path()):
        p = os.path.join(base, name)
        if os.path.isfile(p):
            return p
    return None


def find_logo(ext):
    """logo.png / logo.ico fournis par l'utilisateur, a cote de l'exe ou embarques."""
    for base in (app_dir(), resource_path()):
        p = os.path.join(base, "logo." + ext)
        if os.path.isfile(p):
            return p
    return None
