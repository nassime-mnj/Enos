"""Phrases réflexes : réponses vocales pré-enregistrées pour les échanges courants (0 caractère ElevenLabs).

Si la réponse du LLM correspond à une phrase de la table STATIC, le serveur renvoie le fichier audio local au lieu
d'appeler l'API. Un fichier présent dans `voix\\` (livré avec l'application) est gratuit dès le premier usage ; une
phrase sans fichier est synthétisée UNE SEULE FOIS, puis conservée dans `data\\voix_cache` pour toujours.
"""
import difflib
import logging
import os
import random
import re
import shutil
import unicodedata

import nasko_eleven
from nasko_core import bump_stat, data_dir, resource_path

log = logging.getLogger("nasko.voice")

# kind : regroupe les phrases pour le prompt du LLM. "file" absent -> généré une fois puis mis en cache.
STATIC = [
    {"id": "accueil_1", "kind": "salutation", "file": "accueil_1.mp3",
     "text": "Bonjour Nassime, les systèmes de développement sont initialisés et prêts pour notre session de travail."},
    {"id": "accueil_2", "kind": "salutation", "file": "accueil_2.mp3",
     "text": "Bonjour Nassime. L'environnement de projet a été vérifié. Par quelles tâches souhaitez-vous commencer aujourd'hui ?"},
    {"id": "accueil_3", "kind": "salutation", "file": "accueil_3.mp3",
     "text": "Bonjour Nassime. Je suis connecté et opérationnel. Quels sont vos objectifs de développement pour cette session ?"},
    {"id": "accueil_4", "kind": "salutation", "file": "accueil_4.mp3",
     "text": "Bonjour Nassime. Votre espace de travail a été préparé avec succès. Quelle est la prochaine étape de notre projet ?"},
    {"id": "statut", "kind": "etat", "file": "statut.mp3",
     "text": "Systèmes nominaux. Cœurs logiques à température optimale. Prêt à lancer la prochaine session de code avec vous, Nassime."},
    {"id": "identite", "kind": "identite", "file": "identite.mp3",
     "text": "Je suis E.N.O.S. A.I., une entité cybernétique conçue pour l'automatisation avancée et la gestion de vos protocoles. "
             "Mon fondateur et architecte système est le développeur Nassime. C'est un honneur de l'assister au quotidien."},
    {"id": "speech", "kind": "presentation", "file": "speech.mp3",
     "text": "J'ai été compilé dans les lignes de code, programmé pour optimiser, sécuriser et accélérer. Pendant que le monde dort, "
             "mes processus surveillent l'environnement de développement. Je n'ai pas d'enveloppe physique, mais j'ai une directive "
             "absolue : propulser les projets de Nassime vers l'excellence. Le réseau est mon domaine, la data est mon moteur, "
             "et l'efficacité est ma priorité absolue."},
    # --- sans fichier fourni : générées une seule fois (≈ 100 caractères au total), puis gratuites
    {"id": "merci", "kind": "remerciement", "text": "Toujours à votre service, Nassime."},
    {"id": "aurevoir", "kind": "aurevoir", "text": "À bientôt, Nassime. Mise en veille des systèmes."},
    {"id": "recu", "kind": "accuse", "text": "Bien reçu, Nassime."},
    # --- commentaires vocaux des commandes rapides (boutons 1 et 2) : toujours les mêmes phrases -> fichiers locaux
    {"id": "nar_env_intro", "kind": "narration", "text": "Initialisation de l'environnement de travail."},
    {"id": "nar_env_claude", "kind": "narration", "text": "Ouverture du shell Claude."},
    {"id": "nar_env_godot", "kind": "narration", "text": "Lancement de Godot."},
    {"id": "nar_env_aseprite", "kind": "narration", "text": "Lancement d'Aseprite."},
    {"id": "nar_env_deja_claude", "kind": "narration", "text": "Le shell Claude est déjà ouvert."},
    {"id": "nar_env_deja_godot", "kind": "narration", "text": "Godot est déjà ouvert."},
    {"id": "nar_env_deja_aseprite", "kind": "narration", "text": "Aseprite est déjà ouvert."},
    {"id": "nar_env_done", "kind": "narration", "text": "Environnement prêt, Nassime."},
    {"id": "nar_fail_claude", "kind": "narration", "text": "Impossible d'ouvrir le shell Claude."},
    {"id": "nar_fail_godot", "kind": "narration", "text": "Godot est introuvable."},
    {"id": "nar_fail_aseprite", "kind": "narration", "text": "Aseprite est introuvable."},
    {"id": "nar_nodir", "kind": "narration", "text": "Dossier de projet introuvable. Sélectionnez-le ou créez-le, Nassime."},
    {"id": "nar_godot_scene", "kind": "narration", "text": "Lancement de la scène de test."},
    {"id": "nar_godot_fail", "kind": "narration", "text": "Impossible de lancer la scène."},
    {"id": "nar_px_open", "kind": "narration", "text": "Ouverture de la navigation privée."},
    {"id": "nar_px_info", "kind": "narration",
     "text": "Navigation privée ouverte : une boîte mail temporaire d'un côté, l'inscription PixelLab de l'autre. "
             "La suite est entre vos mains, Nassime."},
    {"id": "nar_px_deja", "kind": "narration", "text": "La navigation privée est déjà ouverte."},
    {"id": "nar_px_fail", "kind": "narration", "text": "Chrome est introuvable, Nassime."},
    # --- fin de tâche (notification Windows + voix) : générées une seule fois
    {"id": "task_done", "kind": "notif", "text": "Tâche terminée, Nassime."},
    {"id": "task_done_compress", "kind": "notif", "text": "Compression terminée, Nassime."},
    {"id": "task_done_audio", "kind": "notif", "text": "Analyse audio terminée."},
    {"id": "task_done_image", "kind": "notif", "text": "Traitement d'image terminé."},
    {"id": "task_done_pack", "kind": "notif", "text": "Colis prêt, Nassime."},
    {"id": "task_done_sync", "kind": "notif", "text": "Synchronisation terminée."},
    {"id": "task_fail", "kind": "notif", "text": "Une tâche a échoué, Nassime."},
    # --- phrase d'accueil au démarrage : langue FIXE (réglage « phrase d'accueil », indépendant de la langue de l'assistant), générée une fois
    {"id": "welcome_fr", "kind": "welcome", "lang": "fr",
     "text": "Bon retour parmi nous, capitaine. Tous les systèmes sont en ligne et votre espace de travail est prêt. Construisons quelque chose de grand aujourd'hui."},
    {"id": "welcome_en", "kind": "welcome", "lang": "en",
     "text": "Welcome Captain. All systems are online and your workspace is ready. Let's build something great today."},
]
BY_ID = {e["id"]: e for e in STATIC}

# Version anglaise de chaque phrase : pas de fichier livré, elle est synthétisée UNE fois (voix multilingue) puis conservée dans data\\voix_cache\\<id>_en.mp3.
EN = {
    "accueil_1": "Hello Nassime, the development systems are initialized and ready for our work session.",
    "accueil_2": "Hello Nassime. The project environment has been verified. Which tasks would you like to start with today?",
    "accueil_3": "Hello Nassime. I am connected and operational. What are your development goals for this session?",
    "accueil_4": "Hello Nassime. Your workspace has been prepared successfully. What is the next step of our project?",
    "statut": "Systems nominal. Logic cores at optimal temperature. Ready to start the next coding session with you, Nassime.",
    "identite": "I am E.N.O.S. A.I., a cybernetic entity designed for advanced automation and the management of your protocols. "
                "My founder and system architect is the developer Nassime. It is an honor to assist him every day.",
    "speech": "I was compiled in lines of code, programmed to optimize, secure and accelerate. While the world sleeps, "
              "my processes watch over the development environment. I have no physical shell, but I have one absolute directive: "
              "propel Nassime's projects toward excellence. The network is my domain, data is my engine, and efficiency is my top priority.",
    "merci": "Always at your service, Nassime.",
    "aurevoir": "See you soon, Nassime. Putting the systems on standby.",
    "recu": "Understood, Nassime.",
    "nar_env_intro": "Initializing the work environment.",
    "nar_env_claude": "Opening the Claude shell.",
    "nar_env_godot": "Launching Godot.",
    "nar_env_aseprite": "Launching Aseprite.",
    "nar_env_deja_claude": "The Claude shell is already open.",
    "nar_env_deja_godot": "Godot is already open.",
    "nar_env_deja_aseprite": "Aseprite is already open.",
    "nar_env_done": "Environment ready, Nassime.",
    "nar_fail_claude": "Unable to open the Claude shell.",
    "nar_fail_godot": "Godot not found.",
    "nar_fail_aseprite": "Aseprite not found.",
    "nar_nodir": "Project folder not found. Select it or create it, Nassime.",
    "nar_godot_scene": "Launching the test scene.",
    "nar_godot_fail": "Unable to launch the scene.",
    "nar_px_open": "Opening private browsing.",
    "nar_px_info": "Private browsing opened: a temporary mailbox on one side, the PixelLab sign-up on the other. The rest is in your hands, Nassime.",
    "nar_px_deja": "Private browsing is already open.",
    "nar_px_fail": "Chrome not found, Nassime.",
    "task_done": "Task finished, Nassime.",
    "task_done_compress": "Compression finished, Nassime.",
    "task_done_audio": "Audio analysis finished.",
    "task_done_image": "Image processing finished.",
    "task_done_pack": "Package ready, Nassime.",
    "task_done_sync": "Synchronization finished.",
    "task_fail": "A task has failed, Nassime.",
}
for _e in STATIC:
    _e["text_en"] = EN.get(_e["id"], _e["text"])


def lang():
    from nasko_core import language
    return language()


def text_of(entry):
    """Texte de la phrase dans la langue choisie (une phrase à langue fixe garde la sienne)."""
    return entry["text_en"] if lang() == "en" and not entry.get("lang") else entry["text"]


# kind -> (description donnée au LLM). Le LLM répond UNIQUEMENT par la balise [REFLEX: KIND] ; le serveur choisit la phrase.
_KINDS = [
    ("salutation", "salutation simple (salut, bonjour, coucou, hello, bonsoir)"),
    ("etat", "demande d'état (ça va ? comment vas-tu ? statut ? état des systèmes ?)"),
    ("identite", "demande d'identité (qui es-tu ? ton nom ?)"),
    ("presentation", "demande de présentation (parle-moi de toi, ton histoire, ta mission)"),
    ("remerciement", "remerciement (merci)"),
    ("aurevoir", "au revoir (à plus, bonne nuit)"),
    ("accuse", "simple accusé de réception (ok, d'accord, compris)"),
]
_TAG = re.compile(r"\[\s*REFLEX\s*:\s*([A-Za-z_]*)\s*\]", re.I)


def reflex_prompt():
    """Bloc du prompt système : courte liste de balises (peu de jetons) pour les échanges à voix gratuite."""
    lines = ["Réflexes (voix locale gratuite) : quand le message de Nassime est exactement de l'un de ces types, réponds "
             "UNIQUEMENT par la balise indiquée, sans aucun autre texte :"]
    lines += [f"- {label} : [REFLEX: {kind.upper()}]" for kind, label in _KINDS]
    lines.append("Dès que le message contient autre chose (une question, une demande, une tâche), réponds librement."
                 + (" Le message peut être en anglais : les balises restent les mêmes." if lang() == "en" else ""))
    return "\n".join(lines)


def extract_reflex(text):
    """Retourne (texte_sans_balise, entree_STATIC | None). L'entrée est tirée au hasard parmi les phrases du même type."""
    m = _TAG.search(text)
    if not m:
        return text, None
    kind = m.group(1).lower()
    clean = _TAG.sub("", text).strip()
    options = [e for e in STATIC if e["kind"] == kind and kind != "narration"]
    return clean, (random.choice(options) if options else None)


def _norm(text):
    text = unicodedata.normalize("NFD", text.lower())
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    return " ".join(re.sub(r"[^a-z0-9]+", " ", text).split())


for _e in STATIC:
    _e["norm"] = _norm(_e["text"])
    _e["norm_en"] = _norm(_e["text_en"])


def match(reply):
    """Entrée STATIC dont la phrase correspond à `reply` (mot pour mot, ou quasi : ponctuation, accents, 1-2 mots)."""
    n = _norm(reply)
    if not n:
        return None
    best, best_ratio = None, 0.0
    for e in STATIC:
        if e["kind"] in ("narration", "welcome"):
            continue
        for key in ("norm", "norm_en"):
            ratio = 1.0 if n == e[key] else difflib.SequenceMatcher(None, n, e[key]).ratio()
            if ratio > best_ratio:
                best, best_ratio, best_key = e, ratio, key
    need = 0.90 if len(best[best_key]) > 120 else 0.96     # phrases courtes : correspondance quasi exacte
    return best if best_ratio >= need else None


def _find_file(entry):
    """Fichier livré dans voix\\ (gratuit d'emblée), sinon fichier généré une fois dans data\\voix_cache. En anglais : uniquement le fichier généré (<id>_en.mp3)."""
    if lang() == "en" and not entry.get("lang"):
        p = os.path.join(data_dir(), "voix_cache", entry["id"] + "_en.mp3")
        return p if os.path.isfile(p) else None
    candidates = []
    if entry.get("file"):
        candidates.append(os.path.join(resource_path("voix"), entry["file"]))
    candidates.append(os.path.join(resource_path("voix"), entry["id"] + ".mp3"))     # fichier genere par generer_voix.py
    candidates.append(os.path.join(data_dir(), "voix_cache", entry["id"] + ".mp3"))
    return next((p for p in candidates if os.path.isfile(p)), None)


def ref(vid, cfg):
    """{text, audio} d'une phrase de la table pour l'interface (audio = None si indisponible, texte seul)."""
    entry = BY_ID[vid]
    try:
        path = audio_path(entry, cfg)
    except nasko_eleven.ElevenError as e:
        log.warning("Voix « %s » indisponible : %s", vid, e)
        path = None
    return {"text": text_of(entry), "audio": f"/api/voice/{vid}" if path else None}


def audio_path(entry, cfg):
    """Chemin du mp3 de la phrase. Fichier local = 0 caractère. Sinon une seule génération ElevenLabs, conservée."""
    p = _find_file(entry)
    if p:
        bump_stat("saved_chars", len(text_of(entry)))
        bump_stat("static_hits", 1)
        return p
    if not (cfg.get("tts_dynamic", True) and nasko_eleven.configured(cfg)):
        return None
    src = nasko_eleven.synthesize(text_of(entry), cfg)          # peut lever ElevenError (géré par l'appelant)
    folder = os.path.join(data_dir(), "voix_cache")
    os.makedirs(folder, exist_ok=True)
    dst = os.path.join(folder, entry["id"] + ("_en" if lang() == "en" and not entry.get("lang") else "") + ".mp3")
    shutil.copyfile(src, dst)
    log.info("Phrase réflexe « %s » générée une fois et conservée", entry["id"])
    return dst


# ----------------------------------------------------------------------------- voix plus grave
def deepen(path):
    """Version plus grave (même durée) d'un fichier audio : ffmpeg abaisse la hauteur de `voice_pitch` (0.86 par défaut ; 1 = voix d'origine)
    et renforce légèrement les basses. Le résultat est mis en cache dans data/voix_grave ; en cas de problème on renvoie le fichier d'origine."""
    import subprocess
    from nasko_core import load_config
    try:
        f = float(load_config().get("voice_pitch", 0.86))
    except (TypeError, ValueError):
        f = 0.86
    if not path or not os.path.isfile(path) or not 0.5 <= f < 0.999:
        return path
    st = os.stat(path)
    out_dir = os.path.join(data_dir(), "voix_grave")
    out = os.path.join(out_dir, f"{os.path.splitext(os.path.basename(path))[0]}_{int(f * 100)}_{st.st_size}_{int(st.st_mtime)}.mp3")
    if os.path.isfile(out):
        return out
    try:
        import nasko_compress
        exe = nasko_compress.ffmpeg_exe()
        if not exe:
            return path
        os.makedirs(out_dir, exist_ok=True)
        tmp = out + ".part.mp3"
        af = f"aresample=44100,asetrate=44100*{f},aresample=44100,atempo={1 / f:.5f},bass=g=4:f=140"
        r = subprocess.run([exe, "-y", "-loglevel", "error", "-i", path, "-vn", "-af", af, "-c:a", "libmp3lame", "-q:a", "3", tmp],
                           capture_output=True, timeout=60, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if r.returncode != 0 or not os.path.isfile(tmp) or os.path.getsize(tmp) < 500:
            log.warning("voix grave : ffmpeg a échoué (%s)", (r.stderr or b"")[-200:])
            return path
        os.replace(tmp, out)
        return out
    except Exception as e:                                                       # noqa: BLE001 — la voix d'origine reste utilisable
        log.warning("voix grave indisponible : %s", e)
        return path


def welcome(cfg):
    """{text, audio} de la phrase d'accueil selon le réglage `welcome_language` (fr | en | off), ou None. Génération ElevenLabs une seule fois."""
    choice = str(cfg.get("welcome_language", "fr")).lower()
    if choice not in ("fr", "en"):
        return None
    return ref("welcome_" + choice, cfg)
