"use strict";
// SUPER ENOS (téléphone) : entraînement aux échecs en arrière-plan, piloté par le LLM (Groq) contre trois profils : E.N.O.S., STOCKFISH et ETO.
// Deux endroits possibles : SUR LE TÉLÉPHONE (Stockfish.js dans un Worker, hors ligne ; le service de premier plan Java garde l'appli active écran éteint)
// ou SUR LE PC (le PC calcule avec son vrai Stockfish, le téléphone suit en direct et peut arrêter).
// Mêmes règles que nasko_train.py : coup brillant de Stockfish prioritaire, pas de nulle par répétition, le LLM ne choisit QUE parmi les coups de Stockfish
// (≤ 40 cp d'écart) et rédige une leçon après chaque partie ; les 6 dernières leçons lui sont rejouées (mémoire dans le stockage de l'appli).
(() => {
  const E = window.ENOS, $ = E.$, esc = E.esc, U = E.ui, B = E.board, L = E.chessLocal, N = E.native, LK = E.link;
  const OPPS = ["enos", "stockfish", "eto"];
  const NAMES = { enos: "E.N.O.S.", stockfish: "STOCKFISH", eto: "ETO" };
  const PROFILE = {
    enos: "E.N.O.S. : Stockfish à pleine puissance, froid et précis ; il joue le coup brillant dès qu'il le trouve et ne répète jamais.",
    stockfish: "STOCKFISH : le moteur pur, sans fioritures ni filtre ; il ne fait presque pas d'erreur et exploite la moindre faiblesse.",
    eto: "ETO : Stockfish en MultiPV avec le goût du spectacle (échecs, captures, tactique) ; il sacrifie dès qu'un sacrifice rapporte.",
  };
  const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  let MAX_PLIES = 240;
  const OPENING_PLIES = 6, LLM_CALLS = 8, LLM_NEAR_CP = 40, KEEP_GAMES = 60, KEEP_LESSONS = 30;
  const WIN_CP = 1000, WIN_PLIES = 6, DEAD_CP = 12, DEAD_PLIES = 50;
  const T = { running: false, stop: false, where: "phone", cfg: null, game: 0, done: 0, results: { w: 0, d: 0, l: 0 }, opp: "", color: "w", fen: START, san: [], last: "", ev: 0, say: "", err: "", llm: false, started: 0, ply: 0 };
  let remote = null, pollTimer = 0;                               // état renvoyé par le PC (mode PC)

  // ------------------------------------------------------------------ mémoire (stockage de l'application)
  const emptyProf = () => ({ g: 0, w: 0, d: 0, l: 0, loss_sum: 0, loss_n: 0, brilliants: 0, dodged: 0 });
  const fresh = () => ({ games: [], profiles: { enos: emptyProf(), stockfish: emptyProf(), eto: emptyProf() }, lessons: [], openings: {}, plies: 0 });
  const loadMem = () => { const m = E.store.get("train.mem", null) || fresh(); OPPS.forEach((o) => (m.profiles[o] = m.profiles[o] || emptyProf())); return m; };
  const saveMem = (m) => E.store.set("train.mem", m);
  // ------------------------------------------------------------------ cloud : cerveau commun au téléphone et au PC (un document par appareil, fusion à l'affichage)
  // Chaque appareil n'envoie que SA mémoire ; celle des autres est gardée à part (m.remote). Appli désinstallée : son document reste dans le compte et revient à la réinstallation.
  const devId = () => { let d = E.store.get("train.dev", ""); if (!d) { d = "ph-" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36); E.store.set("train.dev", d); } return d; };
  function mergeDocs(docs) {
    const out = { profiles: {}, lessons: [], games: [], openings: {}, plies: 0 }, seen = new Set();
    OPPS.forEach((o) => (out.profiles[o] = emptyProf()));
    docs.forEach((d) => {
      const x = d.doc || {};
      Object.entries(x.profiles || {}).forEach(([o, p]) => { const q = (out.profiles[o] = out.profiles[o] || emptyProf()); Object.keys(q).forEach((k) => (q[k] += p[k] || 0)); });
      (x.lessons || []).forEach((l) => { if (l.text && !seen.has(l.text)) { seen.add(l.text); out.lessons.push(l); } });
      out.games.push(...(x.games || []));
      Object.entries(x.openings || {}).forEach(([n, v]) => { const q = (out.openings[n] = out.openings[n] || { w: 0, d: 0, l: 0 }); ["w", "d", "l"].forEach((k) => (q[k] += v[k] || 0)); });
      out.plies += x.plies || 0;
    });
    out.lessons.sort((a, b) => (a.t || 0) - (b.t || 0)); out.games.sort((a, b) => (a.t || 0) - (b.t || 0));
    out.lessons = out.lessons.slice(-KEEP_LESSONS); out.games = out.games.slice(-KEEP_GAMES);
    return out;
  }
  function effective(m) {
    const r = m.remote;
    if (!r) return m;
    const e = { ...m, profiles: {}, openings: {} }, seen = new Set(), ls = [];
    OPPS.forEach((o) => { e.profiles[o] = {}; Object.keys(emptyProf()).forEach((k) => (e.profiles[o][k] = ((m.profiles[o] || {})[k] || 0) + (((r.profiles || {})[o] || {})[k] || 0))); });
    m.lessons.concat(r.lessons || []).sort((a, b) => (a.t || 0) - (b.t || 0)).forEach((l) => { if (!seen.has(l.text)) { seen.add(l.text); ls.push(l); } });
    e.lessons = ls.slice(-KEEP_LESSONS);
    e.games = m.games.concat(r.games || []).sort((a, b) => (a.t || 0) - (b.t || 0)).slice(-KEEP_GAMES);
    Object.entries(m.openings).forEach(([n, v]) => (e.openings[n] = { ...v }));
    Object.entries(r.openings || {}).forEach(([n, v]) => { const q = (e.openings[n] = e.openings[n] || { w: 0, d: 0, l: 0 }); ["w", "d", "l"].forEach((k) => (q[k] += v[k] || 0)); });
    e.plies = m.plies + (r.plies || 0);
    return e;
  }
  let lastSync = 0;
  async function cloudSync(force) {
    const C = E.cloud;
    if (!C || !C.loggedIn() || !E.settings.get("cloudBrain", true)) return { ok: false, devices: 0 };
    if (!force && Date.now() - lastSync < 30000) return { ok: true, devices: T.cloudDevices || 0 };
    const m = loadMem(), doc = { games: m.games, profiles: m.profiles, lessons: m.lessons, openings: m.openings, plies: m.plies };
    try {
      const r = await C.req("/brain/sync", { method: "POST", body: { kind: "superenos", device: devId(), doc } });
      if (r.status !== 200) return { ok: false, devices: 0, error: (r.json && r.json.detail) || "Erreur " + r.status };
      lastSync = Date.now();
      const docs = (r.json && r.json.docs) || [], m2 = loadMem();
      m2.remote = mergeDocs(docs); saveMem(m2); T.cloudDevices = docs.length;
      return { ok: true, devices: docs.length };
    } catch (e) { return { ok: false, devices: 0, error: String(e && e.message || e) }; }          // hors ligne : l'entraînement continue en local
  }

  function summary(m) {
    m = effective(m);
    const profiles = {};
    OPPS.forEach((o) => { const p = m.profiles[o]; profiles[o] = { g: p.g, w: p.w, d: p.d, l: p.l, brilliants: p.brilliants, dodged: p.dodged, acpl: p.loss_n ? Math.round(p.loss_sum / p.loss_n * 10) / 10 : null, score: p.g ? Math.round((p.w + 0.5 * p.d) / p.g * 100) : null }; });
    const openings = Object.entries(m.openings).sort((a, b) => (b[1].w + b[1].d + b[1].l) - (a[1].w + a[1].d + a[1].l)).slice(0, 6).map(([name, v]) => ({ name, ...v }));
    return { profiles, lessons: m.lessons.slice(-10), games: m.games.slice(-10), openings, plies: m.plies };
  }
  function lessonsText(m, opp) {
    m = effective(m);
    const pick = m.lessons.filter((x) => x.opp === opp).slice(-3).concat(m.lessons.slice(-3)), seen = new Set(), out = [];
    pick.forEach((x) => { if (!seen.has(x.text)) { seen.add(x.text); out.push("- " + x.text); } });
    return out.slice(-6).join("\n") || "(aucune leçon pour l'instant)";
  }

  // ------------------------------------------------------------------ LLM (Groq, via le pont natif) : plafonné par partie, coupé après 3 échecs d'affilée
  const brain = { on: false, fails: 0, calls: 0 };
  const llmAsk = async (system, user) => {
    brain.calls++;
    try { const t = await E.ai.chat("enos", user, () => {}, { oneShot: true, system }); brain.fails = 0; return t; }
    catch (e) { if (++brain.fails >= 3) { T.llm = false; T.err = "LLM indisponible (" + String(e.message).slice(0, 80) + ") : Super Enos continue avec Stockfish seul."; paint(); } return null; }
  };
  const canAsk = () => brain.on && brain.fails < 3 && brain.calls < LLM_CALLS;
  const jsonOf = (t) => { const m = /\{[\s\S]*\}/.exec(t || ""); if (!m) return {}; try { return JSON.parse(m[0]); } catch (e) { return {}; } };

  // ------------------------------------------------------------------ choix des coups (point de vue des Blancs pour cp/mate renvoyés par chessLocal)
  const evW = (r) => (r.mate != null ? Math.sign(r.mate) * 1000 : Math.max(-1000, Math.min(1000, r.cp == null ? 0 : r.cp)));
  const topW = (fen, line) => { const sg = fen.split(" ")[1] !== "b" ? 1 : -1; return evW(line.mate ? { mate: line.mate * sg } : { cp: line.cp * sg }); };

  async function varied(fen, seen) {
    const lines = await L.lines(fen, 5, 200);
    if (!lines.length) return null;
    const ok = lines.filter((l) => lines[0].cp - l.cp <= 25 && !l.mate), choice = (ok.length ? ok : lines.slice(0, 1))[Math.floor(Math.random() * (ok.length || 1))];
    const p = await L.pick(fen, lines, choice.uci, seen, null);
    return { uci: p.uci, ev: topW(fen, lines[0]), dodged: p.why };
  }

  async function opponentMove(fen, opp, seen) {
    const ms = T.cfg.ms;
    const r = opp === "stockfish" ? await L.choose(fen, 100, seen, { pure: true, ms: Math.round(ms * 1.5) }) : await L.choose(fen, 100, seen, { ms, taste: opp === "eto" });
    return r && { uci: r.uci, ev: evW(r), dodged: r.dodged || "" };
  }

  async function traineeMove(fen, opp, seen, rec, mem) {
    const lines = await L.lines(fen, 4, T.cfg.ms);
    if (!lines.length) return null;
    const before = topW(fen, lines[0]);
    let r = await L.decide(fen, lines, seen, { brilliant: true });
    if (!r) return null;
    if (r.brilliant) { rec.brilliants++; return { uci: r.uci, before, say: `Coup brillant : sacrifice de ${r.brilliant.piece}.`, dodged: r.dodged || "" }; }
    let uci = r.uci, say = "", dodged = r.dodged || "";
    const top = lines[0];
    if (canAsk() && !top.mate && Math.abs(top.cp) <= 700) {
      const near = lines.filter((l) => top.cp - l.cp <= LLM_NEAR_CP && !l.mate && !L.drawAfter(fen, l.uci, seen));
      if (near.length >= 2) {
        const ch = new Chess(fen), sans = {};
        near.forEach((l) => { const c = new Chess(fen), m = c.move({ from: l.uci.slice(0, 2), to: l.uci.slice(2, 4), promotion: l.uci[4] }); if (m) sans[m.san] = l; });
        const cand = Object.entries(sans).map(([s, l]) => `- ${s} (${l.mate ? "mat" : (l.cp >= 0 ? "+" : "") + (l.cp / 100).toFixed(2)})`).join("\n");
        const sys = "Tu es SUPER ENOS, un joueur d'échecs qui s'entraîne contre des profils différents. Stockfish te propose des coups quasi équivalents ; tu choisis celui qui convient le mieux à l'adversaire et à tes leçons apprises. Réponds UNIQUEMENT par un objet JSON : {\"move\": \"<un coup de la liste, en notation SAN exacte>\", \"why\": \"<10 mots maximum>\"}.";
        const usr = `Adversaire : ${PROFILE[opp]}\nTu as les ${ch.turn() === "w" ? "Blancs" : "Noirs"}. Position (FEN) : ${fen}\nDerniers coups : ${rec.san.slice(-8).join(" ") || "(début de partie)"}\nCandidats (évaluation de ton point de vue) :\n${cand}\nTes leçons :\n${lessonsText(mem, opp)}`;
        const obj = jsonOf(await llmAsk(sys, usr)), san = String(obj.move || "").trim().replace(/0-0/g, "O-O");
        if (sans[san]) {
          const p = await L.pick(fen, lines, sans[san].uci, seen, null);          // jamais de nulle par répétition, même si le LLM la choisit
          uci = p.uci; say = String(obj.why || "").slice(0, 90); if (p.why) dodged = p.why;
        }
      }
    }
    return { uci, before, say, dodged };
  }

  // ------------------------------------------------------------------ une partie
  async function playGame(opp, color, mem) {
    const ch = new Chess();
    let seen = L.startSeen(ch.fen());
    const sgn = color === "w" ? 1 : -1;
    const rec = { opp, color, san: [], brilliants: 0, dodged: 0, loss_sum: 0, loss_n: 0, worst: null };
    let ev = 0, pendingBefore = null, win = 0, dead = 0, verdict = null;
    brain.calls = 0;
    Object.assign(T, { opp, color, fen: ch.fen(), san: [], last: "", ev: 0, say: "", ply: 0 });
    paint();
    while (!T.stop && !ch.game_over() && (seen[L.keyOf(ch.fen())] || 0) < 3 && ch.history().length < MAX_PLIES) {
      const fen = ch.fen(), mine = ch.turn() === color, ply = ch.history().length;
      let r;
      if (ply < OPENING_PLIES) r = await varied(fen, seen);
      else if (mine) r = await traineeMove(fen, opp, seen, rec, mem);
      else {
        r = await opponentMove(fen, opp, seen);
        if (r && pendingBefore !== null) {                                    // perte du coup de Super Enos = meilleure éval avant − éval trouvée par l'adversaire après
          const loss = Math.max(0, sgn * (pendingBefore - r.ev));
          rec.loss_sum += loss; rec.loss_n++;
          if (!rec.worst || loss > rec.worst[0]) rec.worst = [loss, rec.san[rec.san.length - 1], ply];
          pendingBefore = null;
        }
      }
      if (!r || !r.uci) break;
      if (mine && r.before !== undefined && ply >= OPENING_PLIES) pendingBefore = r.before;
      if (r.dodged && mine) rec.dodged++;
      const m = ch.move({ from: r.uci.slice(0, 2), to: r.uci.slice(2, 4), promotion: r.uci[4] });
      if (!m) break;
      seen = L.addSeen(seen, ch.fen());
      rec.san.push(m.san);
      ev = r.ev !== undefined ? r.ev : r.before !== undefined ? r.before : ev;
      win = Math.abs(ev) >= WIN_CP ? win + 1 : 0;
      dead = Math.abs(ev) <= DEAD_CP && ch.history().length > 90 ? dead + 1 : 0;
      Object.assign(T, { fen: ch.fen(), san: rec.san, last: r.uci, ev, ply: ch.history().length, say: mine ? (r.say || "") : T.say });
      paint();
      if (win >= WIN_PLIES) { verdict = [(ev > 0) === (color === "w") ? "w" : "l", "Adjugé (avantage décisif)"]; break; }
      if (dead >= DEAD_PLIES) { verdict = ["d", "Adjugé (position morte)"]; break; }
    }
    if (T.stop && !verdict && !ch.game_over()) return null;
    if (verdict) return { rec, ch, code: verdict[0], why: verdict[1] };
    let code = "d", why = "Nulle";
    if (ch.in_checkmate()) { code = ch.turn() === color ? "l" : "w"; why = "Échec et mat"; }
    else if (ch.in_stalemate()) why = "Pat";
    else if (ch.insufficient_material()) why = "Matériel insuffisant";
    else if ((seen[L.keyOf(ch.fen())] || 0) >= 3 || ch.in_threefold_repetition()) why = "Triple répétition";
    else if (ch.history().length >= MAX_PLIES) why = "Limite de coups";
    return { rec, ch, code, why };
  }

  async function lesson(rec, ch, code, why) {
    const acpl = rec.loss_n ? Math.round(rec.loss_sum / rec.loss_n) : 0, res = { w: "victoire", d: "nulle", l: "défaite" }[code], worst = rec.worst;
    const facts = `Partie contre ${rec.opp.toUpperCase()} avec les ${rec.color === "w" ? "Blancs" : "Noirs"} : ${res} (${why}) en ${ch.history().length} demi-coups. Perte moyenne ${acpl} centipions par coup. Coups brillants : ${rec.brilliants}. Nulles par répétition esquivées : ${rec.dodged}. `
      + (worst && worst[0] >= 60 ? `Pire coup : ${worst[1]} au demi-coup ${worst[2]} (−${Math.round(worst[0])} cp). ` : "") + `Début de partie : ${rec.san.slice(0, 10).join(" ")}.`;
    if (brain.on && brain.fails < 3) {
      const t = await llmAsk("Tu es SUPER ENOS, joueur d'échecs en entraînement. À partir du bilan de la partie, écris UNE seule leçon concrète à retenir pour la prochaine fois contre ce profil (25 mots maximum, à la première personne, texte brut, sans liste).", facts);
      if (t) return t.trim().replace(/\s+/g, " ").slice(0, 240);
    }
    if (code === "l") return `Contre ${rec.opp.toUpperCase()}, je dois vérifier mes pièces en prise avant chaque coup` + (worst && worst[0] >= 60 ? ` (le coup ${worst[1]} m'a coûté ${Math.round(worst[0])} cp).` : ".");
    if (code === "d") return `Contre ${rec.opp.toUpperCase()}, la nulle n'est pas assez : je cherche un plan actif plutôt que d'échanger.` + (rec.dodged ? ` J'ai dû esquiver ${rec.dodged} répétition(s).` : "");
    return `Contre ${rec.opp.toUpperCase()}, mon plan a fonctionné : garder l'initiative et éviter les répétitions.`;
  }

  function record(rec, ch, code, why, text) {
    const m = loadMem(), p = m.profiles[rec.opp], n = ch.history().length;
    p.g++; p[code]++; p.loss_sum += rec.loss_sum; p.loss_n += rec.loss_n; p.brilliants += rec.brilliants; p.dodged += rec.dodged; m.plies += n;
    const name = rec.san.slice(0, 6).join(" ");
    if (name) { const o = (m.openings[name] = m.openings[name] || { w: 0, d: 0, l: 0 }); o[code]++; }
    m.games.push({ t: Date.now(), opp: rec.opp, color: rec.color, result: code, why, plies: n, acpl: rec.loss_n ? Math.round(rec.loss_sum / rec.loss_n * 10) / 10 : null, brilliants: rec.brilliants, dodged: rec.dodged });
    m.games = m.games.slice(-KEEP_GAMES);
    m.lessons.push({ t: Date.now(), opp: rec.opp, result: code, text }); m.lessons = m.lessons.slice(-KEEP_LESSONS);
    // les openings sont des suites de coups : on garde les 40 plus jouées
    const keys = Object.keys(m.openings); if (keys.length > 40) keys.sort((a, b) => (m.openings[a].w + m.openings[a].d + m.openings[a].l) - (m.openings[b].w + m.openings[b].d + m.openings[b].l)).slice(0, keys.length - 40).forEach((k) => delete m.openings[k]);
    saveMem(m); T.results[code]++;
  }

  async function loop() {
    T.running = true; T.stop = false; T.err = ""; T.started = Date.now(); T.done = 0; T.game = 0; T.results = { w: 0, d: 0, l: 0 };
    brain.on = !!T.cfg.llm && E.ai.configured(); brain.fails = 0; T.llm = brain.on;
    if (T.cfg.llm && !brain.on) T.err = "Pas de clé Groq (Réglages) : Super Enos s'entraîne avec Stockfish seul.";
    N.keepAlive(true, "Partie 1 · " + T.cfg.opponents.map((o) => NAMES[o]).join(" · "));        // service de premier plan : l'entraînement continue écran éteint
    paint();
    try {
      await cloudSync(true);                                                // d'abord récupérer ce que le PC a appris
      let i = 0;
      while (!T.stop && (T.cfg.games <= 0 || T.done < T.cfg.games)) {
        const opps = T.cfg.opponents, opp = opps[i % opps.length], color = Math.floor(i / opps.length) % 2 === 0 ? "w" : "b";
        i++; T.game = T.done + 1;
        const out = await playGame(opp, color, loadMem());
        if (!out) break;
        record(out.rec, out.ch, out.code, out.why, await lesson(out.rec, out.ch, out.code, out.why));
        cloudSync();
        T.done++;
        paint();
        await E.sleep(300);
      }
    } catch (e) { T.err = String(e && e.message || e).slice(0, 160); }
    T.running = false; T.stop = false;
    N.keepAlive(false, "");
    paint();
  }

  // ------------------------------------------------------------------ mode PC : le PC calcule, le téléphone suit
  async function pcCall(path, body) {
    const r = await LK.api(path, body ? { method: "POST", body } : {});
    const j = r.json() || {};
    if (r.status !== 200) throw new Error(j.detail || "Erreur " + r.status);
    return j;
  }
  async function pcPoll() {
    clearTimeout(pollTimer);
    try { remote = await pcCall("/api/mobile/train/status"); } catch (e) { remote = null; T.err = "PC injoignable : " + e.message; }
    paint();
    if (T.where === "pc" && ((remote && remote.running) || !$("#tool-train").hidden)) pollTimer = setTimeout(pcPoll, 2000);
  }

  // ------------------------------------------------------------------ interface
  const view = () => {
    if (T.where === "pc" && remote) return { where: "pc", running: remote.running, game: remote.game, done: remote.games_done, opp: remote.opp, color: remote.color, fen: remote.fen, last: remote.last, ev: remote.eval, say: remote.say, san: remote.san, results: remote.results, err: remote.error || (remote.running && remote.cfg.llm && !remote.llm ? remote.llm_error : ""), mem: remote.memory, ply: remote.ply, elapsed: remote.elapsed };
    return { where: "phone", running: T.running, game: T.game, done: T.done, opp: T.opp, color: T.color, fen: T.fen, last: T.last, ev: T.ev, say: T.say, san: T.san, results: T.results, err: T.err, mem: summary(loadMem()), ply: T.ply, elapsed: T.running ? Math.floor((Date.now() - T.started) / 1000) : 0 };
  };
  const RES = { w: "V", d: "N", l: "D" };
  let lastFen = "";

  function paint() {
    const el = $("#tool-train");
    if (!el || el.hidden && !T.running) return;
    const v = view(), m = v.mem;
    $("#su-sub").textContent = v.running ? `PARTIE ${v.game} · ${NAMES[v.opp] || ""} · ${Math.floor(v.elapsed / 60)} MIN` : "ARRÊTÉ";
    $("#su-live").textContent = v.running ? `${v.results.w}V ${v.results.d}N ${v.results.l}D` : "";
    $("#su-go").hidden = v.running; $("#su-stop").hidden = !v.running;
    $("#su-cfg").classList.toggle("lock", v.running);
    $("#su-err").hidden = !v.err; $("#su-err").textContent = v.err || "";
    if (v.fen !== lastFen) { lastFen = v.fen; const pos = B.parse(v.fen); B.render($("#su-board"), pos.m, { flip: v.color === "b", last: v.last ? [v.last.slice(0, 2), v.last.slice(2, 4)] : null, anim: v.last }); }
    const cp = Math.max(-1000, Math.min(1000, v.ev || 0)) * (v.color === "b" ? -1 : 1);
    $("#su-eval").style.setProperty("--w", 50 + cp / 20 + "%");
    $("#su-evtxt").textContent = (cp / 100).toFixed(1).replace(".", ",").replace(/^(\d)/, "+$1");
    $("#su-say").textContent = v.say || ""; $("#su-say").hidden = !v.say;
    $("#su-prof").innerHTML = OPPS.map((o) => { const p = m.profiles[o]; return `<div class="it"><span class="n">${NAMES[o]}<small>${p.g} parties · ${p.w}V ${p.d}N ${p.l}D · perte moy. ${p.acpl == null ? "—" : p.acpl} cp · ${p.brilliants} !! · ${p.dodged} rép. évitées</small></span><span class="tag ${p.score != null && p.score >= 60 ? "" : "warm"}">${p.score == null ? "—" : p.score + " %"}</span></div>`; }).join("");
    $("#su-lessons").innerHTML = m.lessons.length ? m.lessons.slice().reverse().map((l) => `<div class="su-les">${esc(l.text)}<small>contre ${NAMES[l.opp] || ""} · ${{ w: "victoire", d: "nulle", l: "défaite" }[l.result]}</small></div>`).join("") : '<div class="empty">Aucune leçon pour le moment.</div>';
    $("#su-games").innerHTML = m.games.length ? m.games.slice().reverse().map((g) => `<div class="it"><span class="n">${NAMES[g.opp]} (${g.color === "w" ? "B" : "N"})<small>${esc(g.why)} · ${g.plies} demi-coups${g.acpl == null ? "" : " · " + g.acpl + " cp"}</small></span><span class="tag ${g.result === "w" ? "" : g.result === "l" ? "hot" : "warm"}">${RES[g.result]}</span></div>`).join("") : '<div class="empty">—</div>';
  }

  function build() {
    const sv = document.createElement("div");
    sv.id = "tool-train"; sv.className = "subview"; sv.hidden = true;
    sv.innerHTML = `<button class="back" data-back>◂ MODULES</button>
      <div class="card"><h3>Super Enos<span class="sp" id="su-sub">ARRÊTÉ</span></h3>
        <p class="muted" style="font-size:14px;margin-bottom:10px">Il s'entraîne en arrière-plan contre E.N.O.S., Stockfish et ETO. Coups brillants de Stockfish en priorité, jamais de nulle par répétition ; le LLM départage les coups équivalents et retient une leçon après chaque partie.</p>
        <div class="seg" id="su-where" data-p="enos"><button data-w="phone" class="on">SUR LE TÉLÉPHONE</button><button data-w="pc">SUR LE PC</button><i class="seg-ind"></i></div>
        <div id="su-cfg">
          <div class="kchips" id="su-opps">${OPPS.map((o) => `<button class="su-opp on" data-o="${o}">${NAMES[o]}</button>`).join("")}</div>
          <label class="fld">Parties <select id="su-n"><option value="0">Sans fin</option><option value="3">3</option><option value="12">12</option><option value="60">60</option></select></label>
          <label class="fld">Réflexion par coup <select id="su-ms"><option value="300">Rapide · 0,3 s</option><option value="600" selected>Normal · 0,6 s</option><option value="1200">Profond · 1,2 s</option></select></label>
          <label class="fld">LLM (Groq) <input type="checkbox" id="su-llm" checked></label>
        </div>
        <p class="su-note" id="su-err" hidden></p>
        <div class="row"><button class="btn pri" id="su-go">▶ LANCER L'ENTRAÎNEMENT</button><button class="btn" id="su-stop" hidden>⏹ ARRÊTER</button></div>
        <p class="muted" style="font-size:12.5px;margin-top:8px" id="su-hint"></p>
      </div>
      <div class="card"><h3>En direct<span class="sp" id="su-live"></span></h3>
        <div id="su-board"></div>
        <div class="ch-evalbar"><i id="su-eval"></i><b id="su-evtxt">0,0</b></div>
        <div class="su-say" id="su-say" hidden></div>
      </div>
      <div class="card"><h3>Profils affrontés</h3><div class="list" id="su-prof"></div></div>
      <div class="card"><h3>Leçons apprises</h3><div id="su-lessons"></div></div>
      <div class="card"><h3>Dernières parties</h3><div class="list" id="su-games"></div><div class="row"><button class="btn" id="su-reset">EFFACER LA MÉMOIRE</button></div></div>`;
    $(".view[data-v=tools] .scroll").insertBefore(sv, $(".view[data-v=tools] .foot-pad"));
  }

  async function start() {
    const opponents = E.$$("#su-opps .su-opp.on").map((b) => b.dataset.o);
    if (!opponents.length) return U.toast("Choisis au moins un adversaire.", "warn");
    const cfg = { opponents, games: +$("#su-n").value, ms: +$("#su-ms").value, llm: $("#su-llm").checked };
    E.settings.set("train.cfg", { ...cfg, where: T.where });
    if (T.where === "pc") {
      if (LK.state !== "online") return U.toast("PC hors ligne : allume-le sur le même Wi-Fi.", "warn");
      try { remote = await pcCall("/api/mobile/train/start", { opponents, games: cfg.games, secs: cfg.ms / 1000, llm: cfg.llm, threads: 1 }); T.err = ""; pcPoll(); } catch (e) { U.toast(e.message, "warn", 6000); }
      return;
    }
    T.cfg = cfg;
    if (T.running) return;
    loop();
    U.toast("Super Enos s'entraîne. Tu peux quitter l'écran : il continue en arrière-plan.", "ok", 5000);
  }
  async function stop() {
    if (T.where === "pc") { try { remote = await pcCall("/api/mobile/train/stop", {}); } catch (e) { U.toast(e.message, "warn"); } pcPoll(); return; }
    T.stop = true; paint();
  }

  function init() {
    build();
    const cfg = E.settings.get("train.cfg", null);
    if (cfg) {
      T.where = cfg.where === "pc" ? "pc" : "phone";
      E.$$("#su-opps .su-opp").forEach((b) => b.classList.toggle("on", (cfg.opponents || OPPS).includes(b.dataset.o)));
      $("#su-n").value = String(cfg.games || 0); $("#su-ms").value = String(cfg.ms || 600); $("#su-llm").checked = cfg.llm !== false;
    }
    const seg = $("#su-where"), setWhere = (w) => {
      T.where = w; seg.dataset.p = w === "pc" ? "eto" : "enos";
      seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.dataset.w === w));
      $("#su-hint").textContent = w === "pc" ? "Le PC calcule avec son vrai Stockfish (plus fort, plus rapide) ; le téléphone suit en direct. L'entraînement continue même si tu fermes l'appli." : "Calcul sur le téléphone avec Stockfish.js. Une notification reste affichée pendant l'entraînement ; consomme de la batterie : branche-le pour une longue séance.";
      lastFen = ""; if (w === "pc") pcPoll(); else paint();
    };
    seg.querySelectorAll("button").forEach((b) => (b.onclick = () => setWhere(b.dataset.w)));
    setWhere(T.where);
    $("#su-opps").onclick = (e) => { const b = e.target.closest(".su-opp"); if (b && !T.running) b.classList.toggle("on"); };
    $("#su-go").onclick = start;
    $("#su-stop").onclick = stop;
    $("#su-reset").onclick = async () => {
      if (T.running || (remote && remote.running && T.where === "pc")) return U.toast("Arrête d'abord l'entraînement.", "warn");
      if (!(await U.confirm("Effacer la mémoire ?", "Parties, profils et leçons de Super Enos seront supprimés.", "EFFACER", true))) return;
      if (T.where === "pc") return U.toast("La mémoire du PC s'efface depuis le panneau Super Enos du PC.", "");
      saveMem(fresh()); paint();
    };
  }

  E.trainUi = {
    cloudSync, summary: () => summary(loadMem()),
    init,
    open() { lastFen = ""; if (T.where === "pc") pcPoll(); else paint(); },
    stopFromNative() { T.stop = true; paint(); },            // « Arrêter » dans la notification
    running: () => T.running,
    setMaxPlies(n) { MAX_PLIES = n; },                         // tests
  };
})();
