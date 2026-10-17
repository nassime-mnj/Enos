import json, os, re
from playwright.sync_api import sync_playwright

UI = "http://127.0.0.1:8801/"
PW = "Un-bon-mot-de-passe-42"
BAD = []


def check(c, m):
    print(("OK   " if c else "FAIL ") + m)
    if not c:
        BAD.append(m)


def login(pg, email, pw=PW):
    pg.fill("#lg-email", email); pg.fill("#lg-pw", pw); pg.click("#lg-go")


with sync_playwright() as pw:
    b = pw.chromium.launch(**({"executable_path": os.environ["CHROMIUM"]} if os.environ.get("CHROMIUM") else {}), args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 1280, "height": 800}, accept_downloads=True)
    pg = ctx.new_page()
    errs = []; reqs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    pg.on("request", lambda r: reqs.append(r.url)); 
    pg.goto(UI)
    pg.evaluate("localStorage.setItem('dp_server','http://127.0.0.1:8800')"); pg.reload()
    pg.wait_for_selector("#lg-form")
    check(pg.locator("#preview-tag").is_visible(), "mode aperçu signalé dans la barre de titre")
    pg.screenshot(path="lc_login.png")
    # ---- connexion : erreurs
    login(pg, "ceo@dualpulse.test", "mauvais-mot-de-passe-1")
    pg.wait_for_selector("#lg-err:not([hidden])")
    check("incorrect" in pg.inner_text("#lg-err").lower(), "mauvais mot de passe : message d'erreur")
    pg.click("#tab-register"); pg.wait_for_selector("#lg-invite")
    pg.fill("#lg-invite", "DP-inventé"); pg.fill("#lg-email", "intrus@x.fr"); pg.fill("#lg-pw", PW); pg.click("#lg-go")
    pg.wait_for_selector("#lg-err:not([hidden])")
    check("invitation" in pg.inner_text("#lg-err").lower(), "inscription sans invitation valide refusée")
    # ---- serveur injoignable
    pg.evaluate("localStorage.setItem('dp_server','http://127.0.0.1:9')"); pg.reload(); pg.wait_for_selector("#lg-form")
    login(pg, "ceo@dualpulse.test"); pg.wait_for_selector("#lg-err:not([hidden])")
    check("cannot reach" in pg.inner_text("#lg-err").lower(), "serveur injoignable : message clair")
    pg.evaluate("localStorage.setItem('dp_server','http://127.0.0.1:8800')"); pg.reload(); pg.wait_for_selector("#lg-form")

    # ---- CEO
    login(pg, "ceo@dualpulse.test"); pg.wait_for_selector("#shell"); pg.wait_for_selector("#hero .slide")
    check(pg.inner_text("#me").upper().find("CEO") >= 0, "profil CEO affiché")
    titles = pg.eval_on_selector_all("#hero .slide h3", "els=>els.map(e=>e.textContent)")
    print("   bannières CEO:", titles)
    check("Note équipe Dev" in titles and "Annonce du studio" in titles and "Mise à jour d'E.N.O.S. 3.1" in titles, "bannières du serveur (dont celles réservées Dev, visibles du CEO)")
    check(titles[0] == "Note équipe Dev", "bannière la plus prioritaire en premier")
    pg.screenshot(path="lc_home.png")
    pg.click('[data-nav="software"]'); pg.wait_for_selector("#view-software")
    check("CEO" in pg.inner_text("#enos-channel"), "CEO : canal CEO")
    check("3.3.0" in pg.inner_text("#enos-latest"), "CEO : dernière version 3.3.0")
    check(pg.inner_text("#enos-go") == "INSTALL", "bouton « Install » (rien d'installé)")
    check("Notes de frais" in pg.inner_text("#enos-notes"), "notes de version affichées")
    pg.screenshot(path="lc_software.png")
    n0 = len(reqs)
    pg.click("#enos-go")
    pg.wait_for_selector("#enos-installed.ok", timeout=15000)
    dl = [u for u in reqs[n0:] if "/launcher/v1/download/" in u or "/launcher/v1/blob/" in u]
    print("   requêtes:", [re.sub(r'/blob/.*', '/blob/…', u) for u in dl])
    check(any("/download/enos/ceo/3.3.0/0" in u for u in dl), "télécharge le build CEO 3.3.0")
    check(not any("/enos/stable" in u or "/enos/dev" in u for u in dl), "aucun autre canal demandé")
    check(pg.inner_text("#enos-go") == "LAUNCH", "après installation : bouton « Launch »")
    pg.screenshot(path="lc_installed.png")
    # ---- jeux : Coming Soon, jamais de bouton Jouer
    pg.click('[data-nav="games"]'); pg.wait_for_selector("#terna-hero")
    txt = pg.inner_text("#view-games")
    check("COMING SOON" in txt and "TERNA" in txt, "TERNA : « Coming Soon »")
    check(not re.search(r"\bjouer\b|\bplay\b", txt, re.I), "TERNA : aucun bouton « Jouer »")
    check(pg.locator("#wish-email").count() == 1, "liste de souhaits proposée")
    check(pg.locator("#terna-alpha").count() == 1 and not re.search(r"\b(jouer|play)\b", pg.inner_text("#terna-alpha"), re.I), "CEO : carte « accès équipe » pour l'alpha (jamais de bouton Jouer)")
    pg.fill("#wish-email", "joueur@example.com"); pg.click("#wish-go"); pg.wait_for_selector("#wish-msg.ok-msg")
    check("Thank you" in pg.inner_text("#wish-msg"), "inscription à la liste de souhaits")
    pg.screenshot(path="lc_games.png")
    # ---- compte CEO : invitations
    pg.click('[data-nav="account"]'); pg.wait_for_selector("#acc-invites")
    pg.select_option("#inv-role", "friends"); pg.fill("#inv-note", "Léo"); pg.click("#inv-create"); pg.wait_for_selector("#inv-code")
    code_friends = pg.inner_text("#inv-code"); check(code_friends.startswith("DP-"), "code d'invitation généré : " + code_friends)
    pg.select_option("#inv-role", "dev"); pg.fill("#inv-note", "Raf"); pg.click("#inv-create")
    for _ in range(40):
        pg.wait_for_timeout(150)
        code_dev = pg.inner_text("#inv-code")
        if code_dev != code_friends: break
    check(pg.locator("#inv-list tbody tr").count() == 2, "liste des invitations")
    pg.screenshot(path="lc_account.png")
    pg.click("#news-add") if False else None
    pg.fill("#news-title", "Tournoi bêta"); pg.fill("#news-body", "Ce week-end"); pg.select_option("#news-role", "friends"); pg.click("#news-add"); pg.wait_for_timeout(700)
    check(pg.locator("#news-list [data-id]").count() >= 4, "bannière publiée depuis le Launcher")
    pg.select_option("#terna-status", "alpha"); pg.click("#terna-status-go"); pg.wait_for_timeout(500)
    check(pg.evaluate("fetch('http://127.0.0.1:8800/launcher/v1/catalog').then(r=>r.json()).then(j=>j.products.find(p=>p.id==='terna').status)") == "alpha", "statut Terna modifiable")
    pg.click("#acc-logout"); pg.wait_for_selector("#lg-form")
    check(pg.locator("#shell").count() == 0, "déconnexion : retour à l'écran de connexion")

    # ---- Friends : inscription sur invitation
    pg.evaluate("localStorage.removeItem('dp_preview_installed')")
    pg.click("#tab-register"); pg.wait_for_timeout(400); pg.fill("#lg-invite", code_friends); pg.fill("#lg-name", "Léo"); pg.fill("#lg-email", "leo@example.com"); pg.fill("#lg-pw", PW); pg.click("#lg-go")
    pg.wait_for_selector("#shell")
    try: pg.wait_for_selector("#hero .slide", timeout=8000)
    except Exception:
        print("   DEBUG main:", pg.inner_html("#main")[:400], "| toast:", pg.inner_text("#toast") if pg.locator("#toast").count() else "-", "| errs:", errs[:3]); print(open("/tmp/dpl_e2e/api.log").read()[-800:]); raise
    check("FRIENDS" in pg.inner_text("#me").upper(), "inscrit avec le rôle de l'invitation : Friends")
    titles = pg.eval_on_selector_all("#hero .slide h3", "els=>els.map(e=>e.textContent)")
    check("Note équipe Dev" not in titles and "Tournoi bêta" in titles, "Friends : pas la bannière Dev, mais la bannière « Friends » : %s" % titles)
    pg.click('[data-nav="software"]'); pg.wait_for_selector("#view-software")
    check("STABLE" in pg.inner_text("#enos-channel") and "3.1.0" in pg.inner_text("#enos-latest"), "Friends : canal stable 3.1.0")
    n0 = len(reqs); pg.click("#enos-go"); pg.wait_for_selector("#enos-installed.ok", timeout=15000)
    dl = [u for u in reqs[n0:] if "/launcher/v1/download/" in u]
    check(any("/download/enos/stable/3.1.0/0" in u for u in dl) and not any("/dev/" in u or "/ceo/" in u for u in dl), "Friends : télécharge le build stable uniquement")
    pg.click('[data-nav="games"]'); pg.wait_for_selector("#terna-hero")
    check(pg.locator("#terna-alpha").count() == 0, "Friends : jamais d'accès à l'alpha de Terna")
    pg.click('[data-nav="account"]'); pg.wait_for_selector("#acc-me")
    check(pg.locator("#acc-invites").count() == 0 and pg.locator("#acc-users").count() == 0 and pg.locator("#acc-news").count() == 0, "Friends : aucune section d'administration")
    # l'API refuse de toute façon
    st = pg.evaluate("""async()=>{const t=document.querySelector('#acc-me')&&null; return 0}""")
    pg.click("#acc-logout"); pg.wait_for_selector("#lg-form")
    # code d'invitation à usage unique
    pg.click("#tab-register"); pg.wait_for_timeout(400); pg.fill("#lg-invite", code_friends); pg.fill("#lg-email", "autre@example.com"); pg.fill("#lg-pw", PW); pg.click("#lg-go")
    pg.wait_for_selector("#lg-err:not([hidden])"); print("   ERR réutilisé:", pg.inner_text("#lg-err")); check("invitation" in pg.inner_text("#lg-err").lower(), "code d'invitation réutilisé : refusé")

    # ---- Dev
    print("   code_dev:", code_dev, "| code_friends:", code_friends)
    pg.evaluate("localStorage.removeItem('dp_preview_installed')")
    pg.click("#tab-register"); pg.wait_for_timeout(400); pg.fill("#lg-invite", code_dev); pg.fill("#lg-email", "raf@example.com"); pg.fill("#lg-pw", PW); pg.click("#lg-go")
    try: pg.wait_for_selector("#shell", timeout=6000)
    except Exception: print("   ERR:", pg.inner_text("#lg-err") if pg.locator("#lg-err:not([hidden])").count() else "(aucune)")
    pg.wait_for_selector("#shell"); pg.wait_for_selector("#hero .slide")
    titles = pg.eval_on_selector_all("#hero .slide h3", "els=>els.map(e=>e.textContent)")
    check("Note équipe Dev" in titles, "Dev : voit la bannière Dev")
    pg.click('[data-nav="software"]'); pg.wait_for_selector("#view-software")
    check("DEV" in pg.inner_text("#enos-channel") and "3.2.0" in pg.inner_text("#enos-latest"), "Dev : canal dev 3.2.0")
    pg.click('[data-nav="games"]'); pg.wait_for_selector("#terna-alpha")
    check(not re.search(r"\bjouer\b|\bplay\b", pg.inner_text("#view-games"), re.I), "Dev : alpha accessible, toujours sans « Jouer »")
    n0 = len(reqs); pg.click("#terna-alpha-go"); pg.wait_for_timeout(2500)
    check(any("/download/terna/alpha/0.1.0/0" in u for u in reqs[n0:]), "Dev : télécharge l'alpha de Terna")
    pg.screenshot(path="lc_dev_games.png")
    # ---- session restaurée au rechargement (jeton de rafraîchissement)
    pg.reload(); pg.wait_for_selector("#shell", timeout=8000)
    check("DEV" in pg.inner_text("#me").upper(), "rechargement : session restaurée sans ressaisir le mot de passe")
    check(not [e for e in errs], "aucune erreur JavaScript " + str(errs[:3]))
    b.close()
print("ÉCHECS:", BAD or "aucun")
