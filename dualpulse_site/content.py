"""CONTENU DU SITE DUAL PULSE — LE fichier à relire et à modifier. Aucun texte public n'est écrit ailleurs (ni dans le HTML, ni dans le backend).

Comment ça marche : app/main.py et app/assistant.py font « import content » ; vous modifiez ce fichier, vous relancez le site, c'est tout.

MÉDIAS DU JEU (galerie de la page /studio) : voir MEDIA plus bas. Déposez les fichiers dans static/media/ puis renseignez leur « src » ;
    tant qu'un « src » est vide, un emplacement réservé (placeholder) s'affiche à sa place.

ANONYMAT ABSOLU : le site public n'affiche AUCUN nom ni pseudo (ni vrais noms, ni « Nasko » / « Hydra »). Parler de « we », « the team » ou « an independent studio ».
    Idem pour les médias (visages, noms de dossiers, métadonnées EXIF) : à vérifier avant tout dépôt dans static/media/.

LANGUE : tout le texte public est en anglais (marché international). Ce fichier en est la seule source, avec les gabarits templates/*.html (libellés d'interface).

À COMPLÉTER  — chaque emplacement est marqué A_COMPLETER :
    STUDIO["contact_email"]   adresse de contact réelle (aujourd'hui un faux contact@dualpulse.example)
    GAME["facts"] « Sortie »  date ou période de sortie
    ROADMAP « Plus tard »     date de sortie
    (le texte « A_COMPLETER » est remplacé par « to be announced » à l'affichage ; il n'apparaît jamais tel quel sur le site)

E.N.O.S. : SHOW_ENOS_LORE = False (réglage actuel) -> AUCUNE mention publique d'E.N.O.S. (pages, galerie, assistant : une question sur E.N.O.S. reçoit
    la réponse de repli, sans rien révéler). Mettre True réintroduit une phrase de lore dans la carte « A world left running » et une réponse de l'assistant.
    ⚠ Le nom E.N.O.S. est aussi celui de l'outil développeur : à ne citer publiquement qu'en connaissance de cause.
"""

# True : le site évoque E.N.O.S. (IA du jeu). False (actuel) : AUCUNE mention publique, ni sur les pages ni dans l'assistant. Les textes concernés sont repérés plus bas.
SHOW_ENOS_LORE = False

STUDIO = {
    "name": "Dual Pulse",
    "tagline": "Two pulses, one vision.",
    "eyebrow": "Independent game studio",
    "pitch": "An independent studio building a pixel art roguelite platformer set in a desolate world of abandoned machines. "
             "We focus on tight controls, punishing but fair combat, and deep replayability.",
    "manifesto": "We are simply taking the time to build the game we want to play.",
    "about": [
        "Dual Pulse is a small independent studio. Our first project is a pixel art roguelite platformer, and we are building it slowly and carefully, "
        "because the details are what make a game like this feel good to play.",
        "Most of our time goes into the parts players feel more than they notice: tuning jump arcs and hit windows, redrawing sprites until they read clearly, "
        "and playtesting rooms until the difficulty feels fair. We have no release date, and we would rather keep it that way until the game is ready.",
    ],
    "contact_email": "dualpulse.co@gmail.com",
    "year": 2026,
}

GAME = {
    "title": "Our first game",
    "subtitle": "Pixel art roguelite platformer",
    "status": "In development",
    "text": "Set in a desolate world of abandoned machines, the game is built around fast, precise movement and combat that rewards timing. "
            "Rooms are assembled from hand-drawn pieces, so every run plays differently while the level design stays readable.",
}

FEATURES = [
    ("Tight controls", "Variable-height jumps, double jump, wall jump, an invincible roll and pogo attacks, all tuned frame by frame so the character does what you meant."),
    ("Punishing but fair combat", "Enemies telegraph their attacks and timing windows stay consistent, so getting better comes from learning the fight, not from luck."),
    ("Deep replayability", "Hand-built room pieces are reassembled on every run, which keeps each attempt different without giving up careful level design."),
    ("A world left running", "Ruined facilities and machines still following orders nobody gives anymore."),
]

VALUES = [
    ("Precise controls", "Movement is the foundation of a platformer. We tune acceleration, jump height and input timing until it feels right under the fingers."),
    ("Fair difficulty", "The game is demanding, but a defeat should always be readable: you should know what went wrong and what to try next run."),
    ("Hand-drawn pixel art", "Sprites, tiles and rooms are drawn by hand and kept consistent in style, so the world reads clearly at a glance."),
]

ROADMAP = [
    ("Done", "Playable prototype: movement, combat and HUD."),
    ("In progress", "Room generation, enemies, bosses, and a library of effects and sounds."),
    ("Next", "More content, balancing, and a public playtest."),
    ("Later", "Release. Date A_COMPLETER."),
]

FAQ = [
    ("When will the game be released?", "We haven't announced a release date yet. We'll post news on this site as soon as we have something concrete to share."),
    ("Which platforms will it be on?", "PC first. We may look at other platforms later, depending on how the project goes."),
    ("Can I playtest it?", "A public playtest is planned. Send us an email and we'll let you know when it opens."),
    ("Who is making it?", "A small independent team. We'd rather let the game speak for itself."),
    ("How can I contact the studio?", "By email (see the Contact section) or through the Support Assistant."),
]

# ------------------------------------------------------------------ GALERIE (page /studio) — emplacements pour les images / GIF / vidéos du JEU (jamais l'interface E.N.O.S.)
# Un emplacement = un dict. Pour y mettre un média : déposer le fichier dans static/media/ et renseigner "src" (ex. "/static/media/boss-01.webp").
#   kind   : "image" (png / webp / jpg / gif animé) ou "video" (mp4 / webm : lue en boucle, muette, sans commande)
#   slot   : place dans la grille asymétrique (desktop) — hero (grand, 7x3) · a (5x2) · b (3x2) · c (haut, 2x3) · d (4x2) · e (3x2) · f (3x1). Sur mobile : carrousel à glisser.
#   alt    : description du média (en anglais) pour les lecteurs d'écran (obligatoire dès qu'il y a un « src »)
#   caption: légende courte (en anglais) affichée au survol (facultatif)
#   pixel  : True = agrandissement « pixel net » (recommandé pour le pixel art) ; False = lissé
#   label  : texte du placeholder tant que « src » est vide
MEDIA = [
    {"slot": "hero", "kind": "image", "src": "", "alt": "", "caption": "", "pixel": True, "label": "Gameplay capture"},
    {"slot": "a", "kind": "image", "src": "", "alt": "", "caption": "", "pixel": True, "label": "Screenshot"},
    {"slot": "b", "kind": "image", "src": "", "alt": "", "caption": "", "pixel": True, "label": "Screenshot"},
    {"slot": "c", "kind": "video", "src": "", "alt": "", "caption": "", "pixel": True, "label": "Gameplay clip"},
    {"slot": "d", "kind": "image", "src": "", "alt": "", "caption": "", "pixel": True, "label": "Screenshot"},
    {"slot": "e", "kind": "image", "src": "", "alt": "", "caption": "", "pixel": True, "label": "Screenshot"},
    {"slot": "f", "kind": "image", "src": "", "alt": "", "caption": "", "pixel": True, "label": "Screenshot"},
]
MEDIA_EXT = {".png", ".webp", ".jpg", ".jpeg", ".gif", ".avif", ".mp4", ".webm"}

# ------------------------------------------------------------------ Assistant Support : base de connaissances PUBLIQUE (mots-clés en anglais, sans accents)
# Ne jamais y mettre d'information interne (outils, accès développeurs, chemins, noms de personnes).
KB = [
    {"id": "studio", "k": ["studio", "team", "who", "company", "developer", "developers", "dual", "pulse", "behind", "making", "made"],
     "a": "Dual Pulse is a small independent studio. We're building a pixel art roguelite platformer and taking our time to get the details right."},
    {"id": "game", "k": ["game", "genre", "roguelite", "roguelike", "platformer", "pixel", "story", "world", "setting", "project", "title", "gameplay", "combat", "controls"],
     "a": "It's a pixel art roguelite platformer set in a desolate world of abandoned machines. We're focusing on tight controls, punishing but fair combat and deep replayability."},
    {"id": "release", "k": ["release", "released", "launch", "date", "when", "available", "soon", "coming"],
     "a": "We haven't announced a release date yet. If you'd like to hear about it first, send us an email and we'll keep you posted."},
    {"id": "platforms", "k": ["platform", "platforms", "pc", "windows", "mac", "linux", "console", "switch", "playstation", "xbox", "mobile", "android", "ios", "steam"],
     "a": "PC first. We may look at other platforms later, but nothing is confirmed yet."},
    {"id": "playtest", "k": ["beta", "test", "testing", "playtest", "playtests", "demo", "try", "early", "access"],
     "a": "A public playtest is planned but isn't open yet. Email us at {email} and we'll let you know when it starts."},
    {"id": "price", "k": ["price", "pricing", "free", "paid", "cost", "how much", "euro", "dollar", "buy", "purchase"],
     "a": "The price hasn't been decided yet. We'll share it ahead of release."},
    {"id": "contact", "k": ["contact", "email", "mail", "write", "reach", "press", "partnership", "partnerships", "business", "inquiry", "message", "address"],
     "a": "You can reach us at {email} for press, partnerships and general questions."},
    {"id": "bug", "k": ["bug", "bugs", "issue", "problem", "error", "crash", "crashes", "broken", "report", "fix"],
     "a": "Sorry about that. Please email {email} with what you were doing and what device you're on, and we'll take a look."},
    {"id": "jobs", "k": ["job", "jobs", "hiring", "hire", "career", "careers", "work", "join", "apply", "application", "freelance", "artist", "portfolio", "internship"],
     "a": "We're a small team and not hiring right now, but we're always happy to see portfolios (pixel art, animation, sound, level design) at {email}."},
    {"id": "e.n.o.s", "k": ["enos", "e.n.o.s", "ai", "intelligence", "artificial", "antagonist", "boss", "enemy", "machine", "machines", "robot", "robots"],
     "a": "E.N.O.S. is an artificial intelligence that watches over the ruined world of our game. We'll share more about it later."},
    {"id": "privacy", "k": ["privacy", "data", "gdpr", "cookies", "tracking", "tracker", "trackers", "personal", "analytics"],
     "a": "This site has no advertising trackers. Messages sent to this assistant are only used to improve its answers and are not linked to your identity."},
    {"id": "hello", "k": ["hello", "hi", "hey", "greetings", "morning", "evening"],
     "a": "Hello! I'm the Dual Pulse support assistant. Ask me about the studio, the game, the release or playtests."},
    {"id": "thanks", "k": ["thanks", "thank", "great", "awesome", "perfect", "cool"],
     "a": "You're welcome!"},
]

SUGGESTIONS = ["When is the release?", "What is the game about?", "Can I playtest it?", "How can I contact you?"]
FALLBACK = ("I don't have an answer for that. I can help with: {topics}. "
            "For anything else, email us at {email}.")


# ------------------------------------------------------------------ application de SHOW_ENOS_LORE (ne rien modifier ci-dessous)
if SHOW_ENOS_LORE:
    FEATURES[3] = (FEATURES[3][0], FEATURES[3][1] + " An artificial intelligence called E.N.O.S. rules over them. More on that later.")
else:
    KB = [e for e in KB if e["id"] != "e.n.o.s"]
