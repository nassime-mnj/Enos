"""Assistant ETO (support hors ligne) : détection d'intentions sur des questions libres (fautes, sans accents, familier, plusieurs questions à la fois),
réponses avec les vrais prix et l'offre active, questions sur un module de l'app, repli vers l'e-mail de DualPulse, écran de chat."""
from mobile_common import *

CASES = [
    ("bonjour", "hello"), ("salut ça va", "hello"), ("merci bcp", "thanks"),
    ("c'est quoi les offres ?", "plans"), ("quelle offre je dois prendre", "plans"), ("combien ça coute eto", "price"), ("c koi le prix", "price"),
    ("qu'est ce qui est gratuit", "free"), ("y a quoi dans eto pro", "pro"), ("l'offre max elle contient quoi", "max"), ("ultra c'est pour qui", "ultra"),
    ("c'est moins cher a l'année ?", "annual"), ("quel est mon abonement actuel", "current"),
    ("comment je paye", "pay"), ("je veux résilier", "cancel"), ("comment me desabonner svp", "cancel"), ("je veux etre remboursé", "refund"), ("ou est ma facture", "invoice"),
    ("j'ai payé mais je suis toujours en free", "paid_not_active"), ("y a un essai gratuit ?", "trial"),
    ("comment creer un compte", "signup"), ("j'arrive pas a me connecter", "login"), ("mot de passe oublié", "password"), ("supprimer mon compte", "delete_account"),
    ("vous vendez mes données ?", "privacy"), ("les echecs sont payants ?", "chess_free"), ("je peux jouer contre magnus carlsen", "chess_bots"),
    ("comment faire une video de ma partie", "chess_edit"), ("je veux apprendre les ouvertures", "chess_learn"),
    ("c'est quoi le mobile improver", "improver"), ("mon telephone est plein", "space"), ("plus de stockage sur mon tel", "space"), ("ça abime mes photos ?", "quality"),
    ("ca vide la batterie", "battery"), ("mon tel est lent", "perf"), ("j'ai supprimé une photo par erreur", "trash"),
    ("comment connecter mon pc", "pc_pair"), ("le telephone trouve pas le pc", "pc_offline"), ("le chat marche pas il demande une clé", "chat_key"),
    ("comment mettre a jour l'appli", "update"), ("samsung bloque l'installation", "install_blocked"), ("l'appli plante tout le temps", "crash"),
    ("comment sauvegarder mes parties", "backup"), ("ça marche sans internet ?", "offline"), ("je suis une entreprise", "business"), ("je veux investir", "investor"),
    ("comment contacter le support", "contact"), ("je veux parler a un humain", "contact"),
    ("mobil improveur", "improver"), ("resilliation abonement", "cancel"),
]
errs = []
with sync_playwright() as pw:
    b, ctx = launch(pw); pg = open_app(ctx, errs); pg.set_default_timeout(30000)
    pg.wait_for_function("!!(window.ENOS && ENOS.support)")
    res = pg.evaluate("(cases) => cases.map(([q]) => ENOS.support.answer(q).map((r) => r.id))", CASES)
    miss = [(q, exp, got) for (q, exp), got in zip(CASES, res) if exp not in got]
    for m in miss: print("  manqué :", m)
    rate = 1 - len(miss) / len(CASES)
    check(rate >= 0.95, "intentions reconnues : %d / %d (%.0f %%)" % (len(CASES) - len(miss), len(CASES), rate * 100))
    multi = pg.evaluate("ENOS.support.answer('combien coute eto pro et comment résilier ?').map((r) => r.id)")
    check("pro" in multi or "price" in multi, "deux questions dans un message -> deux réponses : %s" % multi)
    check("cancel" in multi, "… dont la résiliation")
    price = pg.evaluate("ENOS.support.answer('prix')[0].text")
    check("2,99" in price and "119,99" in price, "réponses avec les vrais prix du catalogue")
    mod = pg.evaluate("ENOS.support.answer('où est le scanner')[0]")
    check(mod["id"] in ("scan", "module") and any("scan" in a[1] for a in mod["act"]), "question sur un module -> bouton pour l'ouvrir : %s" % mod["id"])
    fb = pg.evaluate("ENOS.support.answer('la recette du couscous de ma grand mère')[0]")
    check(fb["id"] == "fallback" and "dualpulse.co@gmail.com" in fb["text"], "hors sujet -> repli honnête avec l'e-mail de DualPulse")
    # écran de chat
    open_tool(pg, "support"); pg.wait_for_selector("#sp-q")
    pg.fill("#sp-q", "c'est quoi eto max"); pg.press("#sp-q", "Enter"); pg.wait_for_function("document.querySelectorAll('#sp-log .sp-m.bot:not(.typing)').length >= 2", timeout=5000)
    check("pilotage de ton PC" in pg.inner_text("#sp-log"), "chat : réponse affichée")
    pg.click("#sp-sug .sp-chip >> nth=0"); pg.wait_for_function("document.querySelectorAll('#sp-log .sp-m.me').length >= 2", timeout=5000)
    check(True, "suggestion touchée -> nouvelle question")
    pg.add_style_tag(content="#toasts{display:none!important}"); pg.wait_for_timeout(800)
    pg.screenshot(path=(os.environ.get("SHOTS") or "/tmp") + "/support.png")
    check(not errs, "aucune erreur JS : %s" % errs[:3])
    b.close()
raise SystemExit(1 if BAD else 0)
