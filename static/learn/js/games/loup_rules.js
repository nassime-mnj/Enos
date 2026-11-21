"use strict";
// LOUP-GAROU — module pur (testable dans Node) : distribution des rôles, nuit (voyante, loups, sorcière), aube, chasseur, débat et vote,
// conditions de victoire, cerveau des bots (soupçons, annonces de voyante, bluff des loups) et répliques.
(function (root) {
  const W = {};
  W.ROLES = {
    wolf: { name: "Loup-garou", team: "wolf", img: "role_wolf", desc: "Chaque nuit, avec les autres loups, tu choisis une victime. Le jour, fais-toi passer pour un villageois." },
    seer: { name: "Voyante", team: "village", img: "role_seer", desc: "Chaque nuit, tu découvres le vrai rôle d'un joueur." },
    witch: { name: "Sorcière", team: "village", img: "role_witch", desc: "Une potion de vie pour sauver la victime des loups, une potion de mort pour éliminer quelqu'un. Une seule fois chacune." },
    hunter: { name: "Chasseur", team: "village", img: "role_hunter", desc: "Si tu meurs, tu tires une dernière balle sur le joueur de ton choix." },
    villager: { name: "Villageois", team: "village", img: "role_villager", desc: "Pas de pouvoir. Écoute, observe, et vote juste pour démasquer les loups." },
  };
  /** composition selon le nombre de joueurs (5 à 10) */
  W.deck = (n) => { const wolves = n >= 10 ? 3 : n >= 7 ? 2 : 1, d = Array(wolves).fill("wolf").concat(["seer", "witch"]); if (n >= 6) d.push("hunter"); while (d.length < n) d.push("villager"); return d; };
  const shuffle = (a, rnd) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  /** nouvelle partie : players = [{name, bot?, human?}] */
  W.newGame = (players, rnd) => {
    rnd = rnd || Math.random; const roles = shuffle(W.deck(players.length), rnd);
    const ps = players.map((p, i) => Object.assign({}, p, { i, role: roles[i], alive: true, sus: {}, known: {}, claim: null }));
    ps.forEach((p) => ps.forEach((q) => { if (q.i !== p.i) p.sus[q.i] = 0.35 + rnd() * 0.3; }));
    ps.filter((p) => p.role === "wolf").forEach((p) => ps.filter((q) => q.role === "wolf").forEach((q) => (p.known[q.i] = "wolf")));
    return { ps, day: 0, potions: { life: true, death: true }, log: [], over: null, rnd, seerFound: [] };
  };
  W.alive = (st) => st.ps.filter((p) => p.alive);
  W.wolves = (st) => W.alive(st).filter((p) => p.role === "wolf");
  W.winner = (st) => { const w = W.wolves(st).length, v = W.alive(st).length - w; return w === 0 ? "village" : w >= v ? "wolf" : null; };
  const pickMax = (arr, f, rnd) => { let best = [], bv = -1e9; arr.forEach((x) => { const v = f(x) + (rnd() - 0.5) * 0.02; if (v > bv) { bv = v; best = [x]; } }); return best[0]; };

  // ------------------------------------------------------------------ décisions des bots
  /** cible de la voyante : le plus suspect parmi ceux qu'elle n'a pas encore sondés */
  W.botSeer = (st, me) => { const c = W.alive(st).filter((p) => p.i !== me.i && !me.known[p.i]); return c.length ? pickMax(c, (p) => me.sus[p.i], st.rnd) : null; };
  /** victime des loups : la voyante démasquée d'abord, puis ceux qui accusent les loups, puis au hasard */
  W.botWolfTarget = (st) => { const c = W.alive(st).filter((p) => p.role !== "wolf"), wolves = W.wolves(st);
    return pickMax(c, (p) => (p.claim === "seer" ? 3 : 0) + wolves.reduce((a, w) => a + (p.sus[w.i] || 0), 0) / Math.max(1, wolves.length) + st.rnd() * 0.6, st.rnd); };
  /** sorcière : sauve la victime (souvent la 1re fois, sauf si elle soupçonne la victime) ; empoisonne un loup quasi certain */
  W.botWitch = (st, me, victim) => { const out = { save: false, kill: null };
    if (st.potions.life && victim != null && (victim === me.i || st.rnd() < (st.day <= 1 ? 0.75 : 0.45))) out.save = true;
    if (st.potions.death) { const c = W.alive(st).filter((p) => p.i !== me.i && p.i !== victim); const t = c.length ? pickMax(c, (p) => (me.known[p.i] === "wolf" ? 2 : me.sus[p.i]), st.rnd) : null;
      if (t && (me.known[t.i] === "wolf" || me.sus[t.i] > 0.86)) out.kill = t.i; }
    return out; };
  /** tir du chasseur : le plus suspect */
  W.botHunter = (st, me) => { const c = W.alive(st).filter((p) => p.i !== me.i); if (!c.length) return null; return pickMax(c, (p) => (me.role === "wolf" ? (p.role === "wolf" ? -5 : 0) + st.rnd() : me.known[p.i] === "wolf" ? 3 : me.sus[p.i]), st.rnd).i; };
  /** vote du jour */
  W.botVote = (st, me) => { const c = W.alive(st).filter((p) => p.i !== me.i);
    if (me.role === "wolf") { const scared = c.filter((p) => p.role !== "wolf"); const mob = W.mob(st); if (mob != null && st.ps[mob].role !== "wolf" && st.rnd() < 0.7) return mob; return pickMax(scared, (p) => (p.claim === "seer" ? 2 : 0) + (p.sus[me.i] || 0) + st.rnd() * 0.4, st.rnd).i; }
    return pickMax(c, (p) => (me.known[p.i] === "wolf" ? 5 : me.known[p.i] ? -3 : me.sus[p.i]), st.rnd).i; };
  /** tendance du village (le plus soupçonné en moyenne) */
  W.mob = (st) => { const a = W.alive(st); if (a.length < 2) return null; const t = pickMax(a, (p) => a.reduce((s, q) => s + (q.i !== p.i ? q.sus[p.i] || 0 : 0), 0), st.rnd); return t ? t.i : null; };

  /** le joueur `from` accuse `to` : les autres ajustent leurs soupçons selon la confiance qu'ils lui portent */
  W.accuse = (st, from, to, weight) => { W.alive(st).forEach((p) => { if (p.i === from || p.i === to || p.role === "wolf" && st.ps[to].role === "wolf") return; const trust = 1 - (p.sus[from] || 0.5); p.sus[to] = Math.min(0.99, (p.sus[to] || 0.5) + (weight || 0.12) * trust * 1.4); if (to === p.i) p.sus[from] = Math.min(0.99, (p.sus[from] || 0.5) + 0.12); }); };
  /** annonce de voyante (vraie ou bluff) : « X est loup » / « X est innocent » */
  W.seerClaim = (st, from, to, isWolf) => { st.ps[from].claim = "seer"; const others = W.alive(st).filter((p) => p.i !== from && p.claim === "seer");
    W.alive(st).forEach((p) => { if (p.i === from) return; if (p.role === "seer" && p.i !== from) { p.sus[from] = 0.99; return; } const trust = others.length ? 0.45 : 0.78;
      if (p.role === "wolf") return; if (isWolf) p.sus[to] = Math.max(p.sus[to] || 0.5, 0.5 + 0.48 * trust); else p.sus[to] = Math.min(p.sus[to] || 0.5, 0.5 - 0.35 * trust); p.sus[from] = Math.max(0.05, (p.sus[from] || 0.5) - 0.2 * trust); }); };
  /** après une élimination au vote : le rôle révélé renseigne sur ceux qui ont voté contre */
  W.learnFromVote = (st, votes, dead) => { const wolf = st.ps[dead].role === "wolf";
    W.alive(st).forEach((p) => { Object.entries(votes).forEach(([v, t]) => { v = +v; if (v === p.i || t !== dead) return; p.sus[v] = Math.max(0.03, Math.min(0.99, (p.sus[v] || 0.5) + (wolf ? -0.12 : 0.14))); });
      if (st.ps[dead].claim === "seer" && !wolf) W.alive(st).forEach((q) => { if (q.claim === "seer" && q.i !== dead) p.sus[q.i] = 0.95; }); }); };

  /** plan de parole d'un bot pour le débat : [{type, to?, wolf?}] */
  W.botTalk = (st, me) => { const out = [], a = W.alive(st).filter((p) => p.i !== me.i), r = st.rnd;
    if (me.role === "seer") { const found = Object.entries(me.known).filter(([i, role]) => st.ps[i].alive && role === "wolf"); if (found.length && (r() < 0.75 || a.length <= 4)) { out.push({ type: "claim", to: +found[0][0], wolf: true }); return out; }
      if (st.day >= 2 && r() < 0.3) { const inn = Object.entries(me.known).find(([i, role]) => st.ps[i].alive && role !== "wolf"); if (inn) { out.push({ type: "claim", to: +inn[0], wolf: false }); return out; } } }
    if (me.role === "wolf") { const seer = a.find((p) => p.claim === "seer" && p.role !== "wolf"); if (seer && r() < 0.35 && !W.alive(st).some((p) => p.role === "wolf" && p.claim === "seer")) { const t = pickMax(a.filter((p) => p.role !== "wolf" && p.i !== seer.i), () => r(), r); if (t) { out.push({ type: "claim", to: t.i, wolf: true }); return out; } }
      const t = pickMax(a.filter((p) => p.role !== "wolf"), (p) => (p.claim === "seer" ? 1 : 0) + (p.sus[me.i] || 0) + r() * 0.5, r); if (t && r() < 0.8) out.push({ type: "accuse", to: t.i }); else out.push({ type: "calm" }); return out; }
    const t = pickMax(a, (p) => (me.known[p.i] === "wolf" ? 5 : me.known[p.i] ? -3 : me.sus[p.i]), r);
    if (t && me.sus[t.i] > 0.58) out.push({ type: "accuse", to: t.i }); else if (r() < 0.5) out.push({ type: "doubt", to: t ? t.i : null }); else out.push({ type: "calm" });
    if (me.sus && Object.values(me.sus).length && r() < 0.25) out.push({ type: "defend" });
    return out; };

  // ------------------------------------------------------------------ résolution
  /** la voyante sonde : elle connaît désormais le rôle */
  W.see = (st, seer, target) => { st.ps[seer].known[target] = st.ps[target].role === "wolf" ? "wolf" : "good"; if (st.ps[target].role === "wolf") st.seerFound.push(target); return st.ps[target].role; };
  /** fin de nuit : victime des loups (sauf potion de vie) + empoisonné ; renvoie la liste des morts */
  W.dawn = (st, victim, witch) => { const dead = []; witch = witch || {};
    if (witch.save && st.potions.life && victim != null) { st.potions.life = false; victim = null; }
    if (victim != null) dead.push(victim);
    if (witch.kill != null && st.potions.death) { st.potions.death = false; if (!dead.includes(witch.kill)) dead.push(witch.kill); }
    dead.forEach((i) => (st.ps[i].alive = false)); return dead; };
  /** dépouillement : {votant: cible} -> {top: index | null (égalité), counts} */
  W.tally = (votes) => { const c = {}; Object.values(votes).forEach((t) => { if (t != null) c[t] = (c[t] || 0) + 1; }); const mx = Math.max(0, ...Object.values(c)), tops = Object.keys(c).filter((k) => c[k] === mx).map(Number);
    return { top: tops.length === 1 && mx > 0 ? tops[0] : null, counts: c }; };

  // ------------------------------------------------------------------ répliques (courtes, à l'oral)
  W.LINES = {
    accuse: ["{x}, t'étais où cette nuit ?", "Moi je vote {x}, il parle trop peu.", "{x} me met pas à l'aise.", "Franchement {x}, t'as la tête d'un loup aujourd'hui.", "{x} a changé d'avis trois fois, c'est louche.", "Je le sens pas, {x}.", "{x} défend toujours les mêmes, bizarre non ?", "On regarde {x} de près, s'il vous plaît."],
    doubt: ["J'hésite entre plusieurs, mais {x} m'intrigue.", "Pas sûr, mais {x} est bien silencieux.", "Je n'ai pas de piste solide. Peut-être {x} ?", "{x}, tu peux nous expliquer ton vote d'hier ?"],
    calm: ["On se calme, on réfléchit avant de voter.", "Je n'ai rien vu de spécial.", "Attendez, on va pas voter au hasard.", "Moi je suis villageois, je regarde.", "Quelqu'un a une vraie info ?"],
    defend: ["C'est pas moi, je vous jure.", "Si vous me sortez, vous perdez un villageois.", "Je suis clean, regardez mes votes.", "Arrêtez de me fixer comme ça."],
    claimWolf: ["Je suis la voyante. J'ai regardé {x} : c'est un loup.", "Je me dévoile : voyante. {x} est loup, votez-le.", "Voyante ici. {x}, je t'ai vu. Loup."],
    claimGood: ["Je suis voyante. {x} est innocent, laissez-le tranquille.", "Info de voyante : {x} est du village."],
    accused: ["Moi ? N'importe quoi.", "Tu te trompes de cible.", "Pourquoi moi d'un coup ?", "C'est exactement ce qu'un loup dirait, ça."],
    dawnNone: ["Personne n'est mort cette nuit.", "Le village se réveille au complet."],
    lastWords: ["Vous faites une erreur…", "Vengez-moi.", "Bonne chance, vous allez en avoir besoin.", "Je savais que ça finirait comme ça."],
  };
  W.line = (st, kind, x) => { const L = W.LINES[kind] || [""]; return L[Math.floor(st.rnd() * L.length)].replace("{x}", x || ""); };

  if (typeof module !== "undefined" && module.exports) module.exports = W; else (root.ENOS = root.ENOS || {}).loup = W;
})(typeof window !== "undefined" ? window : globalThis);
