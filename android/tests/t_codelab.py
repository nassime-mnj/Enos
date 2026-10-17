"""CodeLab (mobile) : éditeur CodeMirror, Smart Toolbar, terminal à tirer, exécution JS (Worker), aperçu web, quêtes (validation, indices d'ETO filtrés, XP), cloud simulé."""
import json, os
from mobile_common import *

SOL = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "codelab_solutions.json"), encoding="utf-8"))
ERRS = []
FAKE = """(() => {
  window.__g = { calls: [], reply: "Regarde ta boucle : `for i in range(0, 20)` s'arrête avant 20 ! Pense à la borne.\\n```python\\nprint('triche')\\n```" };
  const orig = window.ENOS.native.fetch;
  window.ENOS.native.fetch = async (o) => {
    if (o.provider === 'groq') { const b = JSON.parse(o.body); window.__g.calls.push({ system: b.messages[0].content, user: b.messages[1].content });
      return { status: 200, json: () => ({ choices: [{ message: { content: window.__g.reply } }], usage: { total_tokens: 5 } }) }; }
    return orig(o);
  };
  window.ENOS.native.vault.has = (n) => n === 'groq';
})()"""
ED = "window.ENOS.codelab._state.ed"


def wait_text(pg, sel, text, timeout=8000):
    pg.wait_for_function("([s,t]) => document.querySelector(s).textContent.includes(t)", arg=[sel, text], timeout=timeout)


with sync_playwright() as pw:
    b, ctx = launch(pw)
    pg = open_app(ctx, ERRS)
    pg.evaluate(FAKE)
    open_tool(pg, "codelab")
    pg.wait_for_selector(".cl-app:not([hidden]) #cl-home .cl-newgrid")
    check(pg.locator(".cl-new").count() == 8, "accueil : 8 langages proposés")
    pg.wait_for_selector(".cl-quest")
    check(pg.locator(".cl-quest").count() >= 8, "quêtes Python chargées (%d)" % pg.locator(".cl-quest").count())
    check(pg.locator(".cl-quest:not(.locked)").count() == 1, "une seule quête déverrouillée au départ")
    check("Niveau 1" in pg.inner_text(".cl-lvl"), "niveau 1 affiché")

    # ---------- éditeur + Smart Toolbar
    pg.click('[data-new="js"]')
    pg.wait_for_selector("#cl-ed .cm-editor")
    check(pg.evaluate(f"{ED}.getDoc()").startswith("console.log"), "éditeur JS chargé avec le modèle")
    pg.evaluate(f"{ED}.setDoc('')")
    pg.click("#cl-ed .cm-content")
    pg.wait_for_selector(".cl-app.kb-on .cl-kb")
    check(pg.is_visible("#cl-kb"), "Smart Toolbar visible quand l'éditeur a le focus")
    labels = pg.eval_on_selector_all("#cl-kb button", "els => els.map(e => e.textContent)")
    check(all(x in labels for x in ["⇥", "{ }", "[ ]", "( )", "< >", ";", "/", "←", "→"]), "touches demandées présentes : " + " ".join(labels[:12]))
    pg.click('#cl-kb [data-k="b1"]')                                      # { }
    check(pg.evaluate(f"{ED}.getDoc()") == "{}" and pg.evaluate(f"{ED}.cursor().col") == 2, "{ } insère la paire, curseur au milieu")
    check(pg.evaluate("document.activeElement.closest('.cm-content') !== null"), "le focus reste dans l'éditeur (le clavier ne se ferme pas)")
    pg.click('#cl-kb [data-k="b8"]')                                      # →
    check(pg.evaluate(f"{ED}.cursor().col") == 3, "flèche droite déplace le curseur")
    pg.click('#cl-kb [data-k="b7"]'); pg.click('#cl-kb [data-k="b7"]')    # ← ←
    check(pg.evaluate(f"{ED}.cursor().col") == 1, "flèche gauche x2")
    pg.click('#cl-kb [data-k="b0"]')                                      # Tab
    check(pg.evaluate(f"{ED}.getDoc()") == "    {}", "Tab insère l'indentation")
    pg.evaluate(f"{ED}.setDoc('abc')"); pg.evaluate(f"{ED}.view.dispatch({{selection:{{anchor:0,head:3}}}})")
    pg.click('#cl-kb [data-k="b3"]')                                      # ( ) autour de la sélection
    check(pg.evaluate(f"{ED}.getDoc()") == "(abc)", "( ) entoure la sélection")
    pg.click('#cl-kb [data-k="undo"]')
    check(pg.evaluate(f"{ED}.getDoc()") != "(abc)", "annuler fonctionne")
    pg.evaluate(f"{ED}.setDoc('')")                                       # appui long sur une paire = fermeture seule
    pg.locator('#cl-kb [data-k="b2"]').scroll_into_view_if_needed(); pg.wait_for_timeout(150)
    box = pg.locator('#cl-kb [data-k="b2"]').bounding_box()
    pg.mouse.move(box["x"] + 10, box["y"] + 10); pg.mouse.down(); pg.wait_for_timeout(650); pg.mouse.up()
    doc = pg.evaluate(f"{ED}.getDoc()"); check(doc == "]", "appui long sur [ ] n insère que la fermeture (doc=%r)" % doc)

    # ---------- exécution JS dans le Worker + terminal
    pg.evaluate(f"{ED}.setDoc('console.log(1+2); console.error(\"oups\"); console.log({{a:1}});')")
    pg.click("[data-a=run]")
    wait_text(pg, "#cl-stat", "ms", 10000)
    term = pg.inner_text("#cl-term")
    check("3\n" in term and "oups" in term and '{"a":1}' in term, "console.log/error capturés dans le terminal")
    check(pg.get_attribute("#cl-sheet", "data-s") == "half", "le terminal s'ouvre tout seul au lancement")
    pg.evaluate(f"{ED}.setDoc('const l=readLine(); console.log(l.toUpperCase())')")
    pg.click('.cl-stabs [data-t=in]'); pg.fill("#cl-stdin", "salut\n")
    pg.click("[data-a=run]"); wait_text(pg, "#cl-term", "SALUT")
    check(True, "stdin fourni au programme (readLine)")
    pg.evaluate(f"{ED}.setDoc('let x = ;')"); pg.click("[data-a=run]")
    wait_text(pg, "#cl-term", "syntaxe")
    check(True, "erreur de syntaxe signalée")
    pg.evaluate(f"{ED}.setDoc('while(true){{}}')"); pg.click("[data-a=run]")
    wait_text(pg, "#cl-term", "Délai", 12000)
    pg.wait_for_timeout(300)
    check(pg.evaluate("document.querySelector('.cl-run').disabled") is False, "boucle infinie stoppée (6 s), l'application reste réactive")

    # ---------- terminal à tirer : glisser la poignée vers le haut
    pg.evaluate(f"{ED}.view.contentDOM.blur()")
    g = pg.locator("#cl-grab").bounding_box()
    x, y = g["x"] + g["width"] / 2, g["y"] + 12
    pg.mouse.move(x, y); pg.mouse.down()
    for i in range(1, 11):
        pg.mouse.move(x, y - i * 40)
    pg.mouse.up(); pg.wait_for_timeout(500)
    check(pg.get_attribute("#cl-sheet", "data-s") == "full", "swipe up : terminal plein écran")
    g = pg.locator("#cl-grab").bounding_box(); x, y = g["x"] + g["width"] / 2, g["y"] + 12
    pg.mouse.move(x, y); pg.mouse.down()
    for i in range(1, 15):
        pg.mouse.move(x, y + i * 40)
    pg.mouse.up(); pg.wait_for_timeout(500)
    check(pg.get_attribute("#cl-sheet", "data-s") == "closed", "swipe down : terminal replié")

    # ---------- retour accueil + persistance
    pg.click("#cl-edit [data-a=back]"); pg.wait_for_selector("#cl-home:not([hidden])")
    check(pg.locator(".cl-proj").count() == 1, "projet enregistré dans « Mes projets »")

    # ---------- projet Web : aperçu + console
    pg.click('[data-new="web"]'); pg.wait_for_selector("#cl-ftabs button")
    check(pg.locator("#cl-ftabs button").count() == 3, "projet web : 3 onglets de fichiers")
    pg.click("[data-a=run]"); pg.wait_for_selector(".cl-prev iframe")
    fr = pg.frame_locator(".cl-prev iframe")
    check("Bonjour CodeLab" in fr.locator("h1").inner_text(), "aperçu HTML rendu")
    for _ in range(4):
        fr.locator("#b").click(); pg.wait_for_timeout(500)
        if "clic !" in pg.inner_text("#cl-term"):
            break
    wait_text(pg, "#cl-term", "clic !", 3000)
    check(True, "console.log de l'aperçu remonte dans le terminal")
    bg = fr.locator("body").evaluate("e => getComputedStyle(e).backgroundColor")
    check(bg != "rgb(17, 17, 17)", "le JS du projet web a modifié la page")
    pg.click(".cl-prev button"); pg.click("#cl-edit [data-a=back]")

    # ---------- langage serveur sans cloud
    pg.click('[data-new="python"]'); pg.wait_for_selector("#cl-ed .cm-editor")
    pg.click("[data-a=run]"); wait_text(pg, "#cl-term", "Connecte-toi", 5000)
    check(True, "Python sans compte cloud : message clair")
    pg.click("#cl-edit [data-a=back]")

    # ---------- quêtes : cloud simulé (le « serveur » répond selon la quête ouverte)
    pg.evaluate("""(() => { window.__srv = { mode: 'good' };
      window.ENOS.cloud.loggedIn = () => true;
      window.ENOS.cloud.req = async (path, o) => { const q = window.__quest; const good = window.__srv.mode === 'good';
        const t = q && (q.tests.find(t => (t.stdin || '') === (o.body.stdin || '')) || q.tests[0]);
        return { status: 200, json: { ok: true, phase: 'run', exit_code: 0, stdout: good && t ? t.expected : 'faux\\n', stderr: '', timed_out: false, truncated: false, duration_ms: 12 } }; }; })()""")
    pg.wait_for_selector(".cl-quest:not(.locked)")
    qid = pg.get_attribute(".cl-quest:not(.locked)", "data-quest")
    pg.evaluate(f"window.__quest = window.CODELAB_QUESTS.quests.find(q => q.id === '{qid}')")
    pg.click(f'[data-quest="{qid}"]'); pg.wait_for_selector("#cl-eto .cl-goal")
    check(pg.get_attribute("#cl-sheet", "data-s") == "half" and pg.is_visible("#cl-tab-eto"), "quête : panneau ETO ouvert avec la consigne")
    check(pg.locator(".cl-check").is_visible(), "bouton Valider dans la barre du haut")
    pg.evaluate("window.__srv.mode='bad'")
    pg.click("#cl-eto [data-e=check]"); pg.wait_for_function("document.querySelectorAll('.cl-t.bad').length>0", timeout=8000)
    check(pg.locator(".cl-win").count() == 0, "mauvaise sortie : pas de victoire")
    pg.click("#cl-eto [data-e=hint]"); pg.wait_for_function("window.__g.calls.length>0", timeout=5000)
    call = pg.evaluate("window.__g.calls[0]")
    check("JAMAIS la solution" in call["system"] and "obtenu" in call["user"] and "Code actuel" in call["user"], "ETO reçoit le code, le test en échec et la règle « jamais la solution »")
    pg.wait_for_function("document.querySelectorAll('#cl-eto .cl-eto-say').length>=2 && !document.querySelector('#cl-eto .cl-eto-say.thinking')", timeout=5000)
    txt = pg.inner_text("#cl-eto .cl-chat")
    check("triche" not in txt and "```" not in txt, "bloc de code renvoyé par le modèle supprimé")
    check("(1/3)" in pg.inner_text("#cl-hl"), "compteur d'indices 1/3")
    pg.evaluate("window.__g.reply = ''")
    pg.click("#cl-eto [data-e=hint]"); pg.wait_for_function("document.querySelectorAll('#cl-eto .cl-eto-say.author').length>=1", timeout=5000)
    check(True, "réponse vide du modèle : repli sur l'indice de l'auteur")
    pg.evaluate("window.__srv.mode='good'")
    pg.click("#cl-eto [data-e=check]"); pg.wait_for_selector(".cl-win", timeout=8000)
    gained = pg.evaluate("window.ENOS.codelab.quest.progress().xp")
    check("quête réussie" in pg.inner_text(".cl-win").lower() and gained > 0, "victoire : +%s XP" % gained)
    check(gained < pg.evaluate("window.__quest.xp"), "XP réduits car 2 indices utilisés")
    first_title = pg.evaluate("window.__quest.title")
    pg.click('.cl-win [data-w=next]'); pg.wait_for_selector("#cl-eto .cl-goal")
    check(pg.inner_text("#cl-eto .cl-qhead b") != first_title, "« Quête suivante » ouvre la quête suivante")

    # ---------- quête JS réelle (Worker), solution de référence
    pg.click("#cl-edit [data-a=back]"); pg.wait_for_selector("#cl-home:not([hidden])")
    pg.click('[data-ql="js"]')
    jq = pg.get_attribute(".cl-quest:not(.locked)", "data-quest")
    pg.click(f'[data-quest="{jq}"]'); pg.wait_for_selector("#cl-eto .cl-goal")
    pg.evaluate(f"{ED}.setDoc({json.dumps(SOL[jq])})")
    pg.click("#cl-eto [data-e=check]"); pg.wait_for_selector(".cl-win", timeout=15000)
    check(True, "quête JS %s validée avec la solution de référence (Worker réel)" % jq)
    pg.click(".cl-win [data-w=stay]")

    pg.reload(); pg.wait_for_selector("#tabbar")
    check(pg.evaluate("window.ENOS.codelab.quest.progress().done['%s'] !== undefined" % jq) and pg.evaluate("window.ENOS.store.get('codelab.projects',[]).length") >= 3, "progression et projets persistent après rechargement")
    b.close()

check(not ERRS, "aucune erreur JavaScript de page : %s" % ERRS[:3])
print("\nECHECS:", BAD if BAD else "aucun")
raise SystemExit(1 if BAD else 0)
