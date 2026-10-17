"""CONTENU DU SITE DUAL PULSE — LE fichier à relire et à modifier. Aucun texte public n'est écrit ailleurs (ni dans le HTML, ni dans le backend).

Comment ça marche : app/main.py et app/assistant.py font « import content » ; vous modifiez ce fichier, vous relancez le site, c'est tout.

À COMPLÉTER  — chaque emplacement est marqué A_COMPLETER :
    STUDIO["contact_email"]   adresse de contact réelle (aujourd'hui un faux contact@dualpulse.example)
    GAME["facts"] « Sortie »  date ou période de sortie
    ROADMAP « Plus tard »     date de sortie
    TEAM[...]["role"]         intitulés exacts de Nassime et Raf
    (le texte « A_COMPLETER » est remplacé par « À annoncer » à l'affichage ; il n'apparaît jamais tel quel sur le site)

À VÉRIFIER — L'IA ANTAGONISTE E.N.O.S. (information potentiellement sensible)
    Le site présente publiquement E.N.O.S. comme « l'intelligence qui règne sur les ruines » et adversaire du jeu :
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
    "tagline": "Deux pulsations. Un seul jeu.",
    "pitch": "On est deux, Nassime et Raphaël, et on fait un roguelite platformer en pixel art. Un monde de robots abandonnés, des combats où tout "
             "se joue au timing. On prend le temps de bien faire, parce qu'on veut un jeu qu'on aurait envie de rejouer nous-mêmes.",
    "contact_email": "dualpulse.co@gmail.com",
    "year": 2026,
}

GAME = {
    "title": "Notre premier jeu",
    "subtitle": "Roguelite platformer · univers robotique post-apocalyptique",
    "status": "En développement actif",
    "text": "Un platformer d'action 2D au contrôle précis : double saut, roulade à frames d'invincibilité, glissade, tir et corps-à-corps, "
            "pogo. Les salles se génèrent par assemblage de pièces dessinées à la main, pour que chaque partie reste lisible… et cruelle.",
}

FEATURES = [
    ("Un contrôle chirurgical", "Saut variable, double saut, saut mural, roulade invincible, pogo : chaque mouvement a été réglé à la frame près."),
    ("Des salles assemblées", "Des pièces conçues à la main, assemblées à chaque partie : de la variété sans jamais sacrifier le level design."),
    ("Un monde de métal", "Des ruines automatisées, des machines qui continuent d'obéir à des ordres que plus personne ne donne."),
    ("Un adversaire qui apprend", "E.N.O.S., l'intelligence qui règne sur ces ruines, n'est pas un boss comme les autres : elle vous observe."),   # A_VERIFIER (lore)
]

VALUES = [
    ("Précision", "Nous préférons un mouvement parfait à dix mouvements moyens."),
    ("Lisibilité", "Un jeu difficile doit rester juste : le joueur doit toujours comprendre pourquoi il a perdu."),
    ("Artisanat", "Peu de personnes, beaucoup de soin. Chaque pixel est placé par quelqu'un."),
]

TEAM = [
    {"name": "Nassime", "role": "Co-fondateur · développement & direction"},
    {"name": "Raphaël Sailly", "role": "Co-fondateur · développement & création"},
]

ROADMAP = [
    ("Fait", "Prototype jouable : contrôles, combat, HUD, premier personnage."),
    ("En cours", "Génération des salles, ennemis, boss, bibliothèque d'effets et de sons."),
    ("Ensuite", "Contenu, équilibrage, version de test publique."),
    ("Plus tard", "Sortie. Date A_COMPLETER."),
]

FAQ = [
    ("Quand le jeu sortira-t-il ?", "Il est en développement actif : aucune date n'est annoncée pour l'instant. Les nouvelles seront publiées ici."),
    ("Sur quelles plateformes ?", "PC en premier. D'autres plateformes pourront suivre selon la suite du projet."),
    ("Peut-on tester le jeu ?", "Une version de test publique est prévue. Écrivez-nous pour être prévenu."),
    ("Comment contacter le studio ?", "Par e-mail (voir la section Contact) ou directement avec l'Assistant Support."),
]

# ------------------------------------------------------------------ Assistant Support : base de connaissances PUBLIQUE
# Ne jamais y mettre d'information interne (outils, accès développeurs, chemins, personnes autres que celles listées plus haut).
KB = [
    {"id": "studio", "k": ["studio", "dual", "pulse", "qui", "equipe", "fondateur", "vous", "etes", "presentation"],
     "a": "Dual Pulse est un studio indépendant de deux développeurs, Nassime et Raphaël Sailly. Nous créons un roguelite platformer 2D dans un univers robotique post-apocalyptique."},
    {"id": "jeu", "k": ["jeu", "game", "genre", "roguelite", "platformer", "histoire", "univers", "projet", "nom", "titre"],
     "a": "Notre premier jeu est un roguelite platformer 2D d'action, au contrôle précis, dans un monde de robots abandonnés. Il est en développement actif ; son nom n'est pas encore annoncé."},
    {"id": "sortie", "k": ["sortie", "sortira", "date", "quand", "release", "disponible", "lancement", "bientot"],
     "a": "Aucune date de sortie n'est annoncée pour l'instant : le jeu est en développement actif. Suivez la feuille de route sur cette page, ou écrivez-nous pour être prévenu."},
    {"id": "plateforme", "k": ["plateforme", "pc", "windows", "mac", "linux", "console", "switch", "playstation", "xbox", "mobile", "android", "ios", "steam"],
     "a": "Le jeu est prévu sur PC en premier. D'autres plateformes pourront suivre, rien n'est encore confirmé."},
    {"id": "beta", "k": ["beta", "test", "tester", "playtest", "demo", "essayer", "jouer", "acces", "anticipe"],
     "a": "Une version de test publique est prévue, mais pas encore ouverte. Envoyez-nous un message via la section Contact pour être prévenu à l'ouverture."},
    {"id": "prix", "k": ["prix", "gratuit", "payant", "cout", "combien", "euro", "tarif", "acheter", "free"],
     "a": "Le prix n'a pas encore été fixé. Nous communiquerons dessus avant la sortie."},
    {"id": "contact", "k": ["contact", "contacter", "mail", "email", "ecrire", "joindre", "message", "adresse", "parler", "presse", "partenariat"],
     "a": "Vous pouvez nous écrire à {email}. Nous répondons aussi aux demandes de presse et de partenariat à cette adresse."},
    {"id": "bug", "k": ["bug", "probleme", "erreur", "plante", "crash", "marche", "fonctionne", "souci", "panne", "signaler"],
     "a": "Désolé pour la gêne ! Décrivez-nous le problème (ce que vous faisiez, votre appareil) par e-mail à {email} : nous le regardons dès que possible."},
    {"id": "emploi", "k": ["recrutement", "recrute", "emploi", "travailler", "job", "stage", "candidature", "postuler", "rejoindre", "freelance"],
     "a": "Le studio est petit et ne recrute pas activement, mais les portfolios (pixel art, animation, son, level design) sont les bienvenus à {email}."},
    {"id": "e.n.o.s", "k": ["enos", "e.n.o.s", "ia", "intelligence", "artificielle", "antagoniste", "boss", "adversaire", "robot"],
     "a": "E.N.O.S. est l'intelligence artificielle antagoniste de notre jeu : elle règne sur les ruines robotiques et observe le joueur. Nous en dévoilerons davantage plus tard."},
    {"id": "donnees", "k": ["donnees", "vie privee", "rgpd", "cookies", "confidentialite", "personnelles", "traceurs", "tracking"],
     "a": "Ce site n'utilise aucun traceur publicitaire. Les messages envoyés à cet assistant servent uniquement à améliorer ses réponses, sans lien avec votre identité."},
    {"id": "salut", "k": ["bonjour", "salut", "hello", "coucou", "bonsoir", "hey", "yo"],
     "a": "Bonjour ! Je suis l'Assistant Support de Dual Pulse. Je peux répondre sur le studio, le jeu, la sortie, les tests ou vous mettre en contact avec l'équipe."},
    {"id": "merci", "k": ["merci", "thanks", "super", "parfait", "genial", "top"],
     "a": "Avec plaisir ! N'hésitez pas si vous avez une autre question."},
]

SUGGESTIONS = ["Quand sort le jeu ?", "C'est quoi votre jeu ?", "Puis-je tester ?", "Comment vous contacter ?"]
FALLBACK = ("Je n'ai pas la réponse à cette question. Voici ce que je peux vous dire : {topics}. "
            "Pour tout le reste, écrivez à l'équipe : {email}.")


# ------------------------------------------------------------------ application de SHOW_ENOS_LORE (ne rien modifier ci-dessous)
if not SHOW_ENOS_LORE:
    FEATURES = [f for f in FEATURES if "E.N.O.S" not in f[0] + f[1]]
    KB = [e for e in KB if e["id"] != "e.n.o.s"]
