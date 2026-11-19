"use strict";
// ASSISTANT ETO (support client, 100 % hors ligne) : détecteur d'intentions + parseur sur la base js/support_kb.js.
//   1. normalisation : minuscules, accents retirés, apostrophes, « e.n.o.s » -> enos ; 2. mots vides retirés ; 3. synonymes ramenés à une forme de référence ;
//   4. correction des fautes (distance de Damerau-Levenshtein vers le vocabulaire de la base) ; 5. entités : offre (free/pro/max/ultra), période, module de l'app ;
//   6. score de chaque intention (couverture de ses formulations + mots-clés forts + entités) ; 7. plusieurs questions dans un même message -> plusieurs réponses ;
//   8. question sur un module (« où est le PDF », « c'est quoi CinePulse ») -> fiche du module avec bouton pour l'ouvrir ; 9. sinon : suggestions + e-mail de DualPulse.
// Rien n'est envoyé : l'assistant ne connaît que sa base et l'état de l'application (offre active, version).
(() => {
  const E = window.ENOS, esc = E.esc, KB = window.ENOS_SUPPORT_KB;
  if (!KB) return;
  const S = (E.support = {});
  const STOP = new Set("le la les un une des de du d l a au aux et ou en dans sur pour par avec sans ce cet cette ces mon ma mes ton ta tes son sa ses mes nos vos leur leurs je tu il elle on nous vous ils elles me te se y est es suis sont etre ai as a avons avez ont fait faire peut peux puis pouvoir veux voudrais vouloir dois doit qu que qui quoi quel quelle quels quelles comment est-ce ca cela ceci c s t n ne pas plus tres bien alors donc aussi juste svp stp please merci_ moi toi lui tout toute tous toutes temps fois vraiment encore deja".split(" "));
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/e\.n\.o\.s\.?/g, "enos").replace(/e\.t\.o\.?/g, "eto").replace(/['’`-]/g, " ").replace(/[^a-z0-9€\s]/g, " ")
    .replace(/\bpar erreur\b/g, "parerreur").replace(/\bmot de passe\b/g, "motdepasse").replace(/\bmise a jour\b/g, "miseajour").replace(/\s+/g, " ").trim();
  const plural = (w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w);
  const syn = (w) => KB.syn[w] || KB.syn[plural(w)] || plural(w);
  const words = (s) => norm(s).split(" ").filter((w) => w && !STOP.has(w));
  // vocabulaire de la base (formes brutes + synonymes) pour corriger les fautes AVANT de ramener aux synonymes
  const VOCAB = new Set(Object.keys(KB.syn).concat(Object.values(KB.syn)));
  KB.intents.forEach((it) => { it.q.forEach((q) => words(q).forEach((w) => VOCAB.add(w))); (it.k || []).forEach((w) => VOCAB.add(w)); });
  function dl(a, b) {                                                              // distance de Damerau-Levenshtein (transpositions comprises)
    const m = a.length, n = b.length; if (Math.abs(m - n) > 2) return 9;
    const d = Array.from({ length: m + 1 }, (_, i) => [i].concat(Array(n).fill(0))); for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
    return d[m][n];
  }
  const fixCache = {};
  function fix(w) {                                                                // mot inconnu -> mot le plus proche (1 faute jusqu'à 6 lettres, 2 au-delà)
    if (VOCAB.has(w) || VOCAB.has(plural(w)) || w.length < 5 || /\d/.test(w)) return w;
    if (w in fixCache) return fixCache[w];
    const lim = w.length <= 8 ? 1 : 2; let best = w, bd = lim + 1;
    for (const v of VOCAB) { if (Math.abs(v.length - w.length) > lim || v.length < 5 || v[0] !== w[0] && lim === 1 && v[1] !== w[1]) continue; const d = dl(w, v); if (d < bd) { bd = d; best = v; } }
    return (fixCache[w] = bd <= lim ? best : w);
  }
  const toks = (s) => words(s).map(fix).map(syn);
  S._toks = toks;
  // poids des mots : un mot présent dans peu d'intentions compte plus (idf)
  const PREP = KB.intents.map((it) => ({ it, pats: it.q.map((q) => [...new Set(toks(q))]).filter((p) => p.length), keys: (it.k || []).map((w) => syn(w)) }));
  const DF = {}; PREP.forEach((p) => new Set(p.pats.flat().concat(p.keys)).forEach((w) => (DF[w] = (DF[w] || 0) + 1)));
  const IDF = (w) => Math.log(1 + PREP.length / (DF[w] || 0.5));
  // ------------------------------------------------------------------ entités
  const PLAN = { free: "eto_free", gratuit: "eto_free", gratuite: "eto_free", pro: "eto_pro", max: "eto_max", ultra: "eto_ultra" };
  function entities(t) {
    const e = {};
    t.forEach((w) => { if (PLAN[w]) e.plan = PLAN[w]; if (w === "annuel" || w === "annee" || w === "an") e.period = "year"; if (w === "mensuel" || w === "mois") e.period = "month"; });
    return e;
  }
  // modules de l'application (registre de modules.js) : « où est le PDF », « c'est quoi CinePulse »
  function moduleHit(raw) {
    if (!E.modules || !E.modules.list) return null;
    const t = norm(raw); let best = null, bs = 0;
    for (const m of E.modules.list()) {
      const n = norm(m.n); if (!n || n.length < 3) continue;
      const words = n.split(" ").filter((w) => w.length > 2 && !STOP.has(w));
      const hit = t.includes(n) ? 2 : words.length && words.every((w) => t.split(" ").some((x) => x === w || (x.length > 4 && dl(x, w) <= 1))) ? 1.4 : 0;
      if (hit > bs) { bs = hit; best = m; }
    }
    return best ? { m: best, s: bs } : null;
  }
  // ------------------------------------------------------------------ score d'une intention
  function score(p, t, ents) {
    if (!t.length) return { s: 0, mass: 0 };
    const set = new Set(t), known = t.filter((w) => DF[w]), kIdf = known.reduce((a, w) => a + IDF(w), 0) || 1;
    let best = 0, mass = 0;
    for (const pat of p.pats) {
      let hit = 0, tot = 0; pat.forEach((w) => { const i = IDF(w); tot += i; if (set.has(w)) hit += i; });
      const sc = (hit / tot) * 0.7 + Math.min(1, hit / kIdf) * 0.3;
      if (sc > best) { best = sc; mass = hit; }
    }
    p.keys.forEach((k) => { if (set.has(k)) { best += 0.12 + 0.05 * IDF(k); mass += IDF(k); } });
    if (ents.plan && p.it.id === ({ eto_free: "free", eto_pro: "pro", eto_max: "max", eto_ultra: "ultra" })[ents.plan]) best += 0.2;
    if (ents.period === "year" && p.it.id === "annual") best += 0.3;
    return { s: best, mass };
  }
  // ------------------------------------------------------------------ variables des réponses
  function vars() {
    const P = E.plans, by = P ? P.BY : {}, cur = P && P.plan ? P.plan() : null, eur = P ? P.eur : (v) => String(v);
    const pr = (id, y) => (by[id] ? eur(y ? by[id].year : by[id].month) : "?");
    return { email: KB.email, plan: cur ? cur.name + " " + cur.tier : "ETO Free", version: E.native && E.native.version ? E.native.version() : "?",
      "price.pro": pr("eto_pro"), "price.max": pr("eto_max"), "price.ultra": pr("eto_ultra"), "price.pro_y": pr("eto_pro", 1), "price.max_y": pr("eto_max", 1), "price.ultra_y": pr("eto_ultra", 1) };
  }
  const fill = (s, v) => s.replace(/\{([a-z._]+)\}/g, (m, k) => (k in v ? v[k] : m));
  /** réponse à un message : [{text, act, next, id, score}] (une par question détectée) */
  S.answer = (msg) => {
    const raw = String(msg || "").slice(0, 600);
    const parts = raw.split(/[?!.\n;]+|\s(?:et aussi|aussi|et puis|ensuite|puis)\s|\s(?:et)\s(?=(?:comment|combien|quel|quelle|quels|pourquoi|ou|est ce|c est|je|j|peut|peux|y a|faut)\b)/i).map((x) => (x || "").trim()).filter((x) => x.length > 1);
    const v = vars(), out = [], seen = new Set();
    for (const part of (parts.length ? parts : [raw]).slice(0, 4)) {
      const t = toks(part), ents = entities(t);
      let best = null, bs = 0;
      let bm = 0;
      for (const p of PREP) { const r = score(p, t, ents); if (r.s > bs) { bs = r.s; bm = r.mass; best = p.it; } }
      if (bm < 1.6) bs = Math.min(bs, 0.45);                                      // trop peu d'indices (un seul mot banal) : pas de réponse au hasard
      const mh = moduleHit(part);
      if (mh && (bs < 0.62 || /\b(ou|trouver|ouvrir|acceder|c est quoi|sert|utiliser)\b/.test(norm(part))) && mh.s >= 1.4 && !(best && bs >= 0.9)) {
        const m = mh.m; if (seen.has("m:" + m.id)) continue; seen.add("m:" + m.id);
        out.push({ id: "module", score: 1, text: `${m.n} : ${m.s || "un module d'ETO"}. Tu le trouves dans Modules (recherche en haut), ou ouvre-le directement.`, act: [["Ouvrir " + m.n, "open:" + m.id]] });
        continue;
      }
      if (best && bs >= 0.5 && !seen.has(best.id)) { seen.add(best.id); out.push({ id: best.id, score: bs, text: fill(best.a, v), act: best.act || [], next: best.next || [] }); }
    }
    if (!out.length) out.push({ id: "fallback", score: 0, text: fill("Je n'ai pas trouvé de réponse sûre à ça. Essaie avec d'autres mots, ou choisis un sujet ci-dessous. Pour une question précise, l'équipe DualPulse te répond par e-mail : {email}.", v),
      act: [["Écrire au support", "mail"]], next: ["Quelles sont les offres ?", "Comment résilier ?", "Mon téléphone est plein", "L'application plante"] });
    return out;
  };
  S.suggestions = () => ["Quelles sont les offres ?", "Les échecs sont-ils gratuits ?", "Qu'est-ce que le Mobile Improver ?", "Comment résilier ?", "Mon téléphone est plein", "Contacter le support"];

  // ------------------------------------------------------------------ module « Assistant ETO »
  E.suite.register({
    id: "support", group: "sync", title: "Assistant ETO", sub: "Questions, offres, aide",
    icon: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    onShow() { if (this._focus) this._focus(); },
    build(el) {
      const ic = (n) => (E.hubIcon ? E.hubIcon(n) : "");
      el.innerHTML = `<div class="sp-wrap"><div class="sp-head"><span class="sp-av">${ic("smile")}</span><div><b>Assistant ETO</b><small><i></i>Hors ligne · réponses immédiates</small></div></div>
        <div class="sp-log" id="sp-log" aria-live="polite"></div>
        <div class="sp-sug" id="sp-sug"></div>
        <form class="sp-in" id="sp-form"><input id="sp-q" type="text" placeholder="Pose ta question…" autocomplete="off" maxlength="600" enterkeyhint="send"><button class="sp-send" aria-label="Envoyer">${ic("arrow")}</button></form>
        <p class="sp-foot">Un humain ? <button type="button" data-a="mail">${esc(KB.email)}</button></p></div>`;
      const log = el.querySelector("#sp-log"), sug = el.querySelector("#sp-sug"), q = el.querySelector("#sp-q");
      const bubble = (cls, html) => { const d = document.createElement("div"); d.className = "sp-m " + cls; d.innerHTML = html; log.appendChild(d); log.scrollTop = 1e6; return d; };
      const chips = (list) => { sug.innerHTML = (list || []).map((s) => `<button type="button" class="sp-chip">${esc(s)}</button>`).join(""); };
      const typing = () => bubble("bot typing", "<i></i><i></i><i></i>");
      function reply(msg) {
        bubble("me", esc(msg));
        const t = typing(), res = S.answer(msg);
        setTimeout(() => {
          t.remove();
          res.forEach((r) => bubble("bot", esc(r.text).replace(/\n/g, "<br>").replace(new RegExp(KB.email.replace(/\./g, "\\."), "g"), `<b>${KB.email}</b>`) +
            (r.act && r.act.length ? `<div class="sp-acts">${r.act.map(([l, a]) => `<button type="button" data-a="${esc(a)}">${esc(l)}</button>`).join("")}</div>` : "")));
          chips(res[res.length - 1].next && res[res.length - 1].next.length ? res[res.length - 1].next : S.suggestions().slice(0, 4));
          E.settings.set("support.last", Date.now());
        }, 380 + Math.min(700, msg.length * 8));
      }
      el.querySelector("#sp-form").onsubmit = (e) => { e.preventDefault(); const v = q.value.trim(); if (!v) return; q.value = ""; reply(v); };
      el.addEventListener("click", (e) => {
        const c = e.target.closest(".sp-chip"); if (c) return reply(c.textContent);
        const b = e.target.closest("[data-a]"); if (!b) return;
        const a = b.dataset.a;
        if (a === "key") return E.plans && E.plans.keySheet ? E.plans.keySheet("") : E.modules.open("plans");
        if (a === "mail") return E.native.openSupportMail("ETO · question", `\n\n— Compte : ${(E.cloud && E.cloud.user && E.cloud.user() || {}).email || "?"} · offre : ${vars().plan} · version : ${vars().version}`);
        if (a === "copy:email") return (E.suite.api.copy || ((t) => navigator.clipboard.writeText(t)))(KB.email);
        if (a.startsWith("open:")) { E.ui.go("tools"); return E.modules.open(a.slice(5)); }
        if (a.startsWith("go:")) return E.ui.go(a.slice(3));
      });
      bubble("bot", "Salut ! Je réponds tout de suite à tes questions sur ETO : offres et paiement, échecs, Mobile Improver, PC, compte, problèmes. Pour un humain : <b>" + KB.email + "</b>.");
      chips(S.suggestions());
      this._focus = () => setTimeout(() => q.focus(), 200);
    },
  });
})();
