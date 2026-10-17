"""CONTENU DU SITE DUAL PULSE — LE fichier à relire et à modifier. Aucun texte public n'est écrit ailleurs (ni dans le HTML, ni dans le backend).

Comment ça marche : app/main.py et app/assistant.py font « import content » ; vous modifiez ce fichier, vous relancez le site, c'est tout.

MÉDIAS DU JEU (galerie de la page /studio) : voir MEDIA plus bas. Déposez les fichiers dans static/media/ puis renseignez leur « src » ;
    tant qu'un « src » est vide, un emplacement réservé (placeholder) s'affiche à sa place.

ANONYMAT : le site ne cite que les pseudos « Nasko » et « Hydra ». Aucun vrai nom, visage, ville ou détail personnel dans ce fichier, ni dans les médias
    (vérifier aussi les métadonnées EXIF / noms de fichiers des images avant dépôt).

À COMPLÉTER  — chaque emplacement est marqué A_COMPLETER :
    STUDIO["contact_email"]   adresse de contact réelle (aujourd'hui un faux contact@dualpulse.example)
    GAME["facts"] « Sortie »  date ou période de sortie
    ROADMAP « Plus tard »     date de sortie
    TEAM[...]["role"]         intitulés exacts de Nasko et Hydra (pseudos de développeurs : ne jamais publier de vrais noms)
    (le texte « A_COMPLETER » est remplacé par « À annoncer » à l'affichage ; il n'apparaît jamais tel quel sur le site)

À VÉRIFIER — L'IA ANTAGONISTE E.N.O.S. (information potentiellement sensible)
    Le site évoque publiquement E.N.O.S. comme une présence mystérieuse qui veille sur les ruines, sans aucun détail :
      - dans FEATURES (4e carte « Un adversaire qui apprend »),
      - dans la base de connaissances de l'assistant (entrée « e.n.o.s »).
    Ce sont des textes que j'ai rédigés d'après votre description (« E.N.O.S. est l'IA antagoniste principale du jeu ») ; je ne connais pas
    l'histoire réelle. Relisez-les, corrigez-les, ou masquez-les d'un coup : mettez SHOW_ENOS_LORE = False ci-dessous.
    ⚠ Le nom E.N.O.S. est aussi celui de votre outil développeur : le citer publiquement ne révèle pas l'outil, mais décidez-en en connaissance de cause.
"""

# True : le site parle d'E.N.O.S. comme antagoniste du jeu (textes à VÉRIFIER, voir plus haut). False : aucune mention nulle part (page + assistant).
SHOW_ENOS_LORE = True

STUDIO = {
    "name": "Dual Pulse",
    "tagline": "Deux pulsations, une seule vision.",
    "pitch": "Nasko et Hydra. Deux développeurs, aucune façade. Nous forgeons un roguelite platformer en pixel art dans un monde de robots abandonnés. "
             "Les combats se gagnent au timing. Les erreurs se paient.",
    "manifesto": "On prend le temps de forger le jeu qu'on veut poncer nous-mêmes.",
    "contact_email": "dualpulse.co@gmail.com",
    "year": 2026,
}

GAME = {
    "title": "Premier projet. Titre classifié.",
    "subtitle": "Roguelite platformer · pixel art · monde de robots abandonnés",
    "status": "En forge",
    "text": "Un platformer d'action 2D où tout se joue au timing : esquiver, parer, riposter. Les salles sont assemblées à partir de pièces dessinées à la main. "
            "Chaque partie est différente. Aucune n'est indulgente.",
}

FEATURES = [
    ("Le timing, sans filet", "Des fenêtres de réaction à la frame près. Un geste raté se paie. Un geste juste se mérite."),
    ("Des salles forgées à la main", "Dessinées une à une, réassemblées à chaque partie. Jamais deux fois la même lecture."),
    ("Un monde de métal", "Des ruines, des machines silencieuses. Quelque chose y veille encore."),
    ("Quelqu'un vous observe", "E.N.O.S. ne dit pas ce qu'elle veut. Pas encore."),   # lore volontairement léger : à étoffer plus tard
]

VALUES = [
    ("Précision", "Un mouvement exact vaut mieux que dix approximatifs. Le reste est du bruit."),
    ("Justesse", "La difficulté est une promesse. Chaque défaite doit avoir une cause lisible."),
    ("Discrétion", "Le travail parle. Nous, peu."),
]

TEAM = [
    {"name": "Nasko", "role": "Développement · Direction"},
    {"name": "Hydra", "role": "Développement · Création"},
]

ROADMAP = [
    ("Fait", "Prototype jouable : contrôle, combat, interface."),
    ("En cours", "Salles, ennemis, boss. Le monde prend forme."),
    ("Ensuite", "Contenu, équilibrage, première version de test."),
    ("Plus tard", "Sortie. Date A_COMPLETER."),
]

FAQ = [
    ("Quand le jeu sort-il ?", "Aucune date annoncée. Il sortira quand il sera prêt, pas avant."),
    ("Sur quelles plateformes ?", "PC en premier. Le reste suivra, ou non."),
    ("Peut-on le tester ?", "Une version de test viendra. Écrivez-nous pour être prévenu."),
    ("Qui êtes-vous ?", "Nasko et Hydra. Le reste n'a pas d'importance."),
    ("Comment vous joindre ?", "Par e-mail (section Contact) ou via l'Assistant Support."),
]

# ------------------------------------------------------------------ GALERIE (page /studio) — emplacements pour les images / GIF / vidéos du JEU (jamais l'interface E.N.O.S.)
# Un emplacement = un dict. Pour y mettre un média : déposer le fichier dans static/media/ et renseigner "src" (ex. "/static/media/boss-01.webp").
#   kind   : "image" (png / webp / jpg / gif animé) ou "video" (mp4 / webm : lue en boucle, muette, sans commande)
#   slot   : place dans la grille asymétrique (desktop) — hero (grand, 7x3) · a (5x2) · b (3x2) · c (haut, 2x3) · d (4x2) · e (3x2) · f (3x1). Sur mobile : carrousel à glisser.
#   alt    : description du média pour les lecteurs d'écran (obligatoire dès qu'il y a un « src »)
#   caption: légende courte affichée au survol (facultatif)
#   pixel  : True = agrandissement « pixel net » (recommandé pour le pixel art) ; False = lissé
#   label  : texte du placeholder tant que « src » est vide
MEDIA = [
    {"slot": "hero", "kind": "image", "src": "", "alt": "", "caption": "", "pixel": True, "label": "Signal en attente"},
    {"slot": "a", "kind": "image", "src": "", "alt": "", "caption": "", "pixel": True, "label": "Archive 02"},
    {"slot": "b", "kind": "image", "src": "", "alt": "", "caption": "", "pixel": True, "label": "Archive 03"},
    {"slot": "c", "kind": "video", "src": "", "alt": "", "caption": "", "pixel": True, "label": "Séquence 04"},
    {"slot": "d", "kind": "image", "src": "", "alt": "", "caption": "", "pixel": True, "label": "Archive 05"},
    {"slot": "e", "kind": "image", "src": "", "alt": "", "caption": "", "pixel": True, "label": "Archive 06"},
    {"slot": "f", "kind": "image", "src": "", "alt": "", "caption": "", "pixel": True, "label": "Archive 07"},
]
MEDIA_EXT = {".png", ".webp", ".jpg", ".jpeg", ".gif", ".avif", ".mp4", ".webm"}

# ------------------------------------------------------------------ Assistant Support : base de connaissances PUBLIQUE
# Ne jamais y mettre d'information interne (outils, accès développeurs, chemins, personnes autres que celles listées plus haut).
KB = [
    {"id": "studio", "k": ["studio", "dual", "pulse", "qui", "equipe", "fondateur", "vous", "etes", "presentation"],
     "a": "Dual Pulse : Nasko et Hydra. Deux développeurs, un studio sans visage. Nous forgeons un roguelite platformer en pixel art dans un monde de robots abandonnés."},
    {"id": "jeu", "k": ["jeu", "game", "genre", "roguelite", "platformer", "histoire", "univers", "projet", "nom", "titre"],
     "a": "Un roguelite platformer 2D en pixel art. Des combats punitifs, tout se joue au timing. Le titre est classifié pour l'instant."},
    {"id": "sortie", "k": ["sortie", "sortira", "date", "quand", "release", "disponible", "lancement", "bientot"],
     "a": "Aucune date de sortie n'est annoncée. Le jeu sortira quand il sera prêt. Écrivez-nous pour être prévenu."},
    {"id": "plateforme", "k": ["plateforme", "pc", "windows", "mac", "linux", "console", "switch", "playstation", "xbox", "mobile", "android", "ios", "steam"],
     "a": "PC en premier. Le reste n'est pas confirmé."},
    {"id": "beta", "k": ["beta", "test", "tester", "playtest", "demo", "essayer", "jouer", "acces", "anticipe"],
     "a": "Une version de test viendra, pas encore ouverte. Écrivez-nous via la section Contact pour être prévenu."},
    {"id": "prix", "k": ["prix", "gratuit", "payant", "cout", "combien", "euro", "tarif", "acheter", "free"],
     "a": "Le prix n'est pas fixé. Il sera annoncé avant la sortie."},
    {"id": "contact", "k": ["contact", "contacter", "mail", "email", "ecrire", "joindre", "message", "adresse", "parler", "presse", "partenariat"],
     "a": "Un seul canal : {email}. Presse et partenariats compris."},
    {"id": "bug", "k": ["bug", "probleme", "erreur", "plante", "crash", "marche", "fonctionne", "souci", "panne", "signaler"],
     "a": "Décrivez le problème (ce que vous faisiez, votre appareil) à {email}. Nous le traitons."},
    {"id": "emploi", "k": ["recrutement", "recrute", "emploi", "travailler", "job", "stage", "candidature", "postuler", "rejoindre", "freelance"],
     "a": "Nous ne recrutons pas activement. Un portfolio (pixel art, animation, son, level design) peut être envoyé à {email}."},
    {"id": "e.n.o.s", "k": ["enos", "e.n.o.s", "ia", "intelligence", "artificielle", "antagoniste", "boss", "adversaire", "robot"],
     "a": "E.N.O.S. est une présence qui veille sur les ruines de notre jeu. Nous n'en dirons pas plus pour l'instant."},
    {"id": "donnees", "k": ["donnees", "vie privee", "rgpd", "cookies", "confidentialite", "personnelles", "traceurs", "tracking"],
     "a": "Aucun traceur publicitaire sur ce site. Les messages envoyés à cet assistant servent uniquement à améliorer ses réponses, sans lien avec votre identité."},
    {"id": "salut", "k": ["bonjour", "salut", "hello", "coucou", "bonsoir", "hey", "yo"],
     "a": "Assistant Support de Dual Pulse. Studio, jeu, sortie, tests : posez votre question."},
    {"id": "merci", "k": ["merci", "thanks", "super", "parfait", "genial", "top"],
     "a": "Avec plaisir."},
]

SUGGESTIONS = ["Quand sort le jeu ?", "C'est quoi votre jeu ?", "Puis-je tester ?", "Comment vous contacter ?"]
FALLBACK = ("Je n'ai pas cette réponse. Sujets disponibles : {topics}. "
            "Pour le reste : {email}.")


# ------------------------------------------------------------------ application de SHOW_ENOS_LORE (ne rien modifier ci-dessous)
if not SHOW_ENOS_LORE:
    FEATURES = [f for f in FEATURES if "E.N.O.S" not in f[0] + f[1]]
    KB = [e for e in KB if e["id"] != "e.n.o.s"]
