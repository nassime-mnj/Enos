"use strict";
// ENOS CodeLab — QUÊTES : progression (XP, niveaux, série), vérification automatique par comparaison de sortie, et indices d'ETO.
// ETO ne donne JAMAIS la réponse : le prompt le lui interdit ET la réponse est filtrée (blocs de code supprimés, extraits de code courts seulement).
// Sans clé Groq, ETO retombe sur les 3 indices écrits par l'auteur de la quête (orientation → concept → structure).
(() => {
  const E = window.ENOS;
  const Q = (E.codelab = E.codelab || {}).quest = {};
  const KEY = "codelab.progress";

  // ------------------------------------------------------------------ progression
  const blank = () => ({ done: {}, xp: 0, streak: 0, last: "", best: 0 });
  Q.progress = () => Object.assign(blank(), E.store.get(KEY, null) || {});
  const save = (p) => E.store.set(KEY, p);
  const day = (d) => (d || new Date()).toISOString().slice(0, 10);
  Q.isDone = (id) => !!Q.progress().done[id];
  Q.xp = () => Q.progress().xp;
  // niveau n atteint à 30·n·(n-1) XP : 0, 60, 180, 360, 600…
  Q.level = (xp) => { xp = xp == null ? Q.xp() : xp; let n = 1; while (xp >= 30 * (n + 1) * n) n++; return { n, from: 30 * n * (n - 1), to: 30 * (n + 1) * n }; };
  // XP gagnés : base de la quête − 25 % par indice demandé (plancher 40 %), +20 % la première fois sans aucun indice
  Q.reward = (quest, hints) => Math.max(Math.round(quest.xp * 0.4), Math.round(quest.xp * (1 - 0.25 * hints)));
  Q.complete = (quest, info) => {
    const p = Q.progress(), first = !p.done[quest.id], gained = first ? Q.reward(quest, info.hints || 0) : 0;
    if (first) {
      p.done[quest.id] = { at: Date.now(), tries: info.tries || 1, hints: info.hints || 0, xp: gained };
      p.xp += gained;
      const t = day(), y = day(new Date(Date.now() - 864e5));
      if (p.last !== t) { p.streak = p.last === y ? p.streak + 1 : 1; p.last = t; p.best = Math.max(p.best, p.streak); }
    }
    save(p);
    return { first, gained, xp: p.xp, level: Q.level(p.xp), streak: p.streak };
  };
  Q.reset = () => E.store.del(KEY);

  // ------------------------------------------------------------------ données (chargées à la demande : ~60 Ko)
  Q.load = () => E.suite.api.lib("codelab_quests").then(() => window.CODELAB_QUESTS || { quests: [], languages: {} });
  Q.forLang = (data, lang) => data.quests.filter((q) => q.lang === lang).sort((a, b) => a.level - b.level);
  Q.unlocked = (data, quest) => { const list = Q.forLang(data, quest.lang); const i = list.findIndex((q) => q.id === quest.id); return i <= 0 || Q.isDone(list[i - 1].id); };
  Q.next = (data, quest) => { const list = Q.forLang(data, quest.lang); return list[list.findIndex((q) => q.id === quest.id) + 1] || null; };

  // ------------------------------------------------------------------ vérification de la sortie
  // "lines" : fins de lignes normalisées, espaces de fin de ligne ignorés, sensible à la casse · "tokens" (SQL) : seule la suite des valeurs compte (en-têtes, séparateurs et alignement ignorés)
  Q.normalize = (text, mode) => {
    const t = String(text == null ? "" : text).replace(/\r\n?/g, "\n");
    if (mode === "tokens") return t.split("\n").filter((l) => !/^[\s|+\-=]*$/.test(l)).join(" ").split(/[\s|]+/).filter(Boolean).join(" ");
    return t.split("\n").map((l) => l.replace(/\s+$/, "")).join("\n").replace(/\n+$/, "");
  };
  Q.same = (actual, expected, mode) => {
    if (mode !== "tokens") return Q.normalize(actual) === Q.normalize(expected);
    const a = Q.normalize(actual, "tokens"), e = Q.normalize(expected, "tokens");
    return a === e || a.endsWith(" " + e);                 // les en-têtes de colonnes précèdent les valeurs : on accepte qu'ils soient en trop, jamais en moins
  };

  // run(stdin) -> Promise<{ok, stdout, stderr, phase, timed_out}> ; onStep(i, n, result) à chaque test.
  Q.check = async (quest, run, onStep) => {
    const results = [];
    for (let i = 0; i < quest.tests.length; i++) {
      const t = quest.tests[i];
      const r = await run(t.stdin || "");
      const ok = !!r && r.ok !== false && !r.timed_out && Q.same(r.stdout, t.expected, quest.compare);
      const res = { ok, stdin: t.stdin || "", expected: t.expected, actual: (r && r.stdout) || "", stderr: (r && r.stderr) || "", phase: r && r.phase, timed_out: !!(r && r.timed_out) };
      results.push(res);
      if (onStep) onStep(i + 1, quest.tests.length, res);
      if (r && (r.phase === "compile" && r.ok === false)) break;           // inutile de relancer 3 fois une erreur de compilation
    }
    return { pass: results.length === quest.tests.length && results.every((x) => x.ok), results };
  };

  // ------------------------------------------------------------------ indices d'ETO
  const SYSTEM = `Tu es ETO, mentor de programmation zen, chaleureux et attentif, dans une application mobile. Tu aides l'élève à trouver LUI-MÊME.
RÈGLES ABSOLUES :
- Ne donne JAMAIS la solution complète. Pas de bloc de code. Au plus une toute petite expression de code (30 caractères max) entre accents graves, uniquement pour nommer une fonction ou un mot-clé.
- 2 à 3 phrases maximum, en français, tutoiement, ton chuchoté et bienveillant. Pas de liste, pas de titre, pas de markdown.
- Appuie-toi sur le code RÉEL de l'élève : nomme la ligne, la variable ou l'instruction concernée. Si le code semble juste mais que la sortie diffère, pointe précisément la différence entre la sortie obtenue et la sortie attendue.
- Si l'élève n'a encore rien écrit d'utile, encourage-le et donne une première piste de départ.
- Respecte le niveau d'indice demandé : 1 = pose une question qui oriente la réflexion ; 2 = nomme le concept ou la fonction à utiliser ; 3 = indique où se trouve l'erreur et la forme de la correction, sans l'écrire en entier.`;

  Q.analyse = (quest, code, last) => {
    const notes = [];
    const body = String(code || "").trim();
    const starter = String(quest.starter || "").trim();
    if (!body || body === starter) notes.push("L'élève n'a pas encore modifié le code de départ.");
    if (last && last.stderr) notes.push("Dernière erreur du programme :\n" + String(last.stderr).slice(0, 600));
    if (last && last.results) {
      const f = last.results.find((r) => !r.ok);
      if (f) notes.push(`Premier test en échec — entrée : ${JSON.stringify(f.stdin)} · attendu : ${JSON.stringify(String(f.expected).slice(0, 200))} · obtenu : ${JSON.stringify(String(f.actual).slice(0, 200))}${f.timed_out ? " (délai dépassé : boucle infinie ?)" : ""}`);
    }
    return notes.join("\n");
  };

  // supprime ce qu'ETO n'a pas le droit de donner : blocs de code, longs extraits de code, texte trop long
  Q.sanitize = (text) => {
    let t = String(text || "").replace(/```[\s\S]*?```/g, " ").replace(/`([^`]{31,})`/g, "…").replace(/^\s*[-*•]\s+/gm, "").replace(/\*\*|__|#+\s/g, "").replace(/\s+/g, " ").trim();
    if (t.length > 420) { const cut = t.slice(0, 420); t = cut.slice(0, Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "), 120) + 1).trim(); }
    return t;
  };
  Q.fallback = (quest, level) => (quest.hints && (quest.hints[Math.min(level, quest.hints.length) - 1])) || "Relis la consigne lentement, puis fais un tout petit pas : afficher quelque chose, même faux, te montrera le chemin.";

  // Q.hint(quest, {code, last, level}) -> Promise<{text, source:"eto"|"auteur"}>
  Q.hint = async (quest, ctx) => {
    const level = Math.max(1, Math.min(3, ctx.level || 1));
    if (!E.ai || !E.ai.configured()) return { text: Q.fallback(quest, level), source: "auteur" };
    const user = `Langage : ${quest.lang}\nQuête : ${quest.title}\nConsigne : ${quest.goal}\nNiveau d'indice demandé : ${level}/3\n` +
      `Pistes de l'auteur (à reformuler, ne pas recopier telles quelles) : ${(quest.hints || []).slice(0, level).join(" | ")}\n` +
      `${Q.analyse(quest, ctx.code, ctx.last)}\n\nCode actuel de l'élève :\n${String(ctx.code || "").slice(0, 4000)}`;
    try {
      const raw = await E.suite.api.llm({ system: SYSTEM, user, maxTokens: 300 });
      const text = Q.sanitize(raw);
      if (text.length < 12) throw new Error("réponse vide");
      return { text, source: "eto" };
    } catch (e) {
      return { text: Q.fallback(quest, level), source: "auteur", error: e.message };
    }
  };
})();
