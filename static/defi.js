"use strict";
// DÉFI : liste des jeux + CHESS (plateau 2D en code). La logique (légalité, Stockfish, jugement des coups) est côté serveur : nasko_chess.py.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (p, o = {}) => {
    const r = await fetch(p, { ...o, headers: { "Content-Type": "application/json" } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || r.statusText);
    return j;
  };
  const post = (p, b) => api(p, { method: "POST", body: JSON.stringify(b || {}) });
  const GLYPH = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };      // silhouettes pleines, teintées par CSS
  const S = { st: null, sel: null, busy: false, spoken: 0 };
  const AI = () => (window.enosPersona ? window.enosPersona.name() : "E.N.O.S.");          // nom de la personnalité active (E.N.O.S. / ETO)
  const ETO = () => !!(window.enosPersona && window.enosPersona.isEto());
  const MODE = () => (S.st && S.st.active ? S.st.mode : $("cs-mode").value);
  const SPECT = (m) => m === "speedrun" || m === "titans" || m === "boss";                                          // l'utilisateur regarde : personne ne s'appelle « Vous »
  const sideName = (st, side) => (st && st.players && st.players[side]) || (side === st.me ? "Vous" : "");
  const OPP = () => (MODE() === "coach" || MODE() === "speedrun" ? "Le bot" : AI());                                  // l'adversaire : le bot virtuel (cours) ou E.N.O.S./ETO (défi)
  const powerOfElo = (e) => Math.max(1, Math.min(100, Math.round(e <= 1500 ? 1 + (e - 250) / 1250 * 49 : 50 + (e - 1500) / 1700 * 50)));

  const eloOf = (p) => (p <= 50 ? Math.round(250 + (p - 1) / 49 * 1250) : Math.round(1500 + (p - 50) / 50 * 1700));
  const power = () => Math.max(1, Math.min(100, parseInt($("cs-pow").value, 10) || 100));
  function paintPower() { const p = power(); $("cs-powtxt").textContent = `Puissance : ${p} % (Équivalent : ${eloOf(p)}${p === 100 ? "+" : ""} Elo)`; }
  try { const v = parseInt(localStorage.getItem("enos_chess_power"), 10); if (v >= 1 && v <= 100) $("cs-pow").value = v; } catch (e) {}
  $("cs-pow").addEventListener("input", () => { paintPower(); try { localStorage.setItem("enos_chess_power", String(power())); } catch (e) {} });
  paintPower();

  const flipped = () => S.st && S.st.me === "b";
  const sqName = (c, r) => "abcdefgh"[c] + (r + 1);

  function drawBoard() {
    const st = S.st, el = $("cs-board"); el.innerHTML = "";
    if (!st) return;
    const last = st.last ? [st.last.slice(0, 2), st.last.slice(2, 4)] : [];
    const targets = S.sel ? st.legal[S.sel] || [] : [];
    const kingSq = st.check ? Object.keys(st.board).find((k) => st.board[k] === (st.turn === "w" ? "K" : "k")) : "";
    for (let i = 0; i < 64; i++) {
      const row = Math.floor(i / 8), col = i % 8;
      const r = flipped() ? row : 7 - row, c = flipped() ? 7 - col : col;
      const name = sqName(c, r), p = st.board[name];
      const d = document.createElement("div");
      d.className = "cs-sq" + ((r + c) % 2 ? " l" : "") + (S.sel === name ? " sel" : "") + (last.includes(name) ? " last" : "")
        + (kingSq === name ? " chk" : "") + (targets.includes(name) ? " tg" + (p ? " cap" : "") : "");
      d.dataset.sq = name;
      if (col === 0) d.insertAdjacentHTML("beforeend", `<span class="co r">${r + 1}</span>`);
      if (row === 7) d.insertAdjacentHTML("beforeend", `<span class="co f">${"abcdefgh"[c]}</span>`);
      if (p) d.insertAdjacentHTML("beforeend", `<span class="cs-p ${p === p.toUpperCase() ? "w" : "b"}">${GLYPH[p.toLowerCase()]}</span>`);
      el.appendChild(d);
    }
  }

  function judgeHtml(q, who) {
    if (!q) return "";
    return `<b class="q-${q.key}">${esc(q.label.toUpperCase())}</b>${who} ${esc(q.san)} · ${q.loss ? "perte " + q.loss + " cp" : "aucune perte"}${q.best ? " · meilleur : " + esc(q.best) : ""}`;
  }

  function drawSide() {
    const st = S.st; if (!st) return;
    const ev = Math.max(-1000, Math.min(1000, st.eval));
    $("cs-evalf").style.width = 50 + ev / 20 + "%";
    $("cs-evalv").textContent = Math.abs(st.eval) >= 9000 ? "MAT" : (st.eval > 0 ? "+" : "") + (st.eval / 100).toFixed(1);
    $("cs-moves").innerHTML = st.moves.map((m) => `<div class="cs-mv"><em>${m.color === "w" ? Math.ceil(m.n / 2) + "." : ""}</em><b>${esc(m.san)}</b><span class="q-${m.key}">${esc(m.label)}</span></div>`).join("");
    $("cs-moves").scrollTop = 1e6;
    const j = [];
    const spect = SPECT(st.mode), meN = spect ? sideName(st, st.me) : "Vous", opN = spect ? sideName(st, st.me === "w" ? "b" : "w") : OPP();
    if (st.played) j.push(judgeHtml(st.played, " " + meN + " :"));
    if (st.reply) j.push(judgeHtml(st.reply, " " + opN + " :"));
    if (st.taunt && st.taunt.text) j.push(`<i>« ${esc(st.taunt.text)} »</i>`);
    if (j.length) $("cs-judge").innerHTML = j.join("<br>");
    $("cs-resign").disabled = !!st.over;
    $("cs-cond").hidden = !st.setup;
    const dec = st.decision;
    $("cs-dec").hidden = !dec;
    const dh = document.querySelector("#cs-dec > b"); if (dh) dh.textContent = ETO() ? "UNE ERREUR IMPORTANTE" : "GAFFE CATASTROPHIQUE";
    if (dec) $("cs-dec-t").innerHTML = `Votre coup <b>${esc(dec.san)}</b> (−${dec.loss} cp).<br>Il fallait jouer <b style="color:#7bd64d">${esc(dec.best)}</b>.<br>Continuer, ou l'annuler ?`;
    if (st.over && st.review && S.revShown !== st.seq) { S.revShown = st.seq; setTimeout(() => { if (S.st && S.st.over) showReview(st.review); }, 3200); }
    const s = $("cs-status");
    s.className = st.over ? "over" : "";
    s.textContent = st.over || (SPECT(st.mode) ? sideName(st, st.turn) + " joue…" + (st.check ? " — échec !" : "") : S.busy ? OPP() + " réfléchit…" : st.turn === st.me ? "À vous de jouer" + (st.check ? " — échec !" : "") : "…");
  }
  const render = () => { clearArrows(); drawBoard(); drawSide(); paintSides(); };
  // QUI TIENT QUELLE COULEUR : deux étiquettes verticales à gauche du plateau (camp du haut / camp du bas)
  function paintSides() {
    const st = S.st, board = $("cs-board"), left = document.querySelector(".cs-left");
    let box = $("cs-sides");
    if (!st || !st.active || !st.players || !board || board.hidden || !board.offsetWidth || !left) { if (box) box.remove(); return; }
    if (!box) { box = document.createElement("div"); box.id = "cs-sides"; left.appendChild(box); }
    const top = st.me === "w" ? "b" : "w";
    const mk = (c) => `<div class="cs-sd ${c}"><i></i><b>${esc(st.players[c] || "")}</b><small>${c === "w" ? "BLANCS" : "NOIRS"}</small></div>`;
    box.style.cssText = `left:${Math.max(0, board.offsetLeft - 38)}px;top:${board.offsetTop}px;height:${board.offsetHeight}px`;
    box.innerHTML = mk(top) + mk(st.me);
  }
  // VOIX DE SECOURS : quand ElevenLabs n'a plus de crédits, la parole continue avec la synthèse vocale du navigateur (E.N.O.S. grave et lent, ETO aigu et rapide)
  function browserSpeak(text, persona) {
    return new Promise((res) => {
      try {
        const ss = window.speechSynthesis;
        const on = $("cc-bvoice") && $("cc-bvoice").checked;                  // option « VOIX SECOURS » : jamais activée sans que l'utilisateur la coche
        if (!on || !ss || !text) return res();
        const u = new SpeechSynthesisUtterance(String(text).replace(/\[[^\]]*\]/g, ""));
        const vs = ss.getVoices(), fr = vs.find((v) => /^fr/i.test(v.lang) && (persona === "enos" ? /(henri|paul|male|homme)/i.test(v.name) : /(denise|julie|female|femme)/i.test(v.name))) || vs.find((v) => /^fr/i.test(v.lang));
        if (fr) u.voice = fr;
        u.lang = "fr-FR"; u.pitch = persona === "enos" ? 0.45 : 1.45; u.rate = persona === "enos" ? 0.82 : 1.3;
        u.onend = u.onerror = () => res();
        ss.speak(u);
        setTimeout(res, Math.min(20000, 1500 + text.length * 90));
      } catch (e) { res(); }
    });
  }
  const SPEECH_NOTE = { shown: false };
  function ttsNotice(msg) {
    if (!msg || SPEECH_NOTE.shown) return;
    SPEECH_NOTE.shown = true;
    const st = $("cs-status"); if (st) st.textContent = "⚠ " + msg + " Les répliques restent écrites (aucune voix de remplacement). Rechargez des crédits ou changez la clé dans nasko_config.json pour retrouver les voix ; ou cochez VOIX SECOURS.";
  }

  async function speak(t, wait) {                                // voix ElevenLabs ; texte seul si indisponible ; wait = attendre la fin de la phrase
    try {
      const r = await post("/api/chess/voice", { text: t.text, kind: t.kind || "normal", persona: t.persona || null });
      if (window.say) { const p = window.say(r.text, { audio: r.audio }); if (wait) await p; }
    } catch (e) {}
  }

  const rest = (n) => { if (ETO() && window.enosPersona) window.enosPersona.rest(n); };
  async function request(fn) {
    if (S.busy) return;
    S.busy = true; $("cs-status").textContent = OPP() + " réfléchit…"; rest("thinking");
    try { const st = await fn(); S.st = st; S.sel = null; }
    catch (e) { $("cs-status").textContent = "✕ " + e.message; S.busy = false; rest("smile"); return; }
    S.busy = false; render();
    announce();
  }
  // ETO : son visage vit la partie (balises audio de sa réplique, sinon nature du coup commenté)
  const KIND_FACE = { brilliant: "impressed", blunder: "awkward", check: "curious", capture: "smirk", castle: "cool", promo: "excited", good: "smile", opening: "happy", victory: "warm", defeat: "laugh", draw: "chuckle", takeback: "warm", assume: "proud" };
  function feel(st) {
    if (!ETO() || !window.EtoFace) return;
    rest(st.decision ? "worried" : st.over ? (st.over.toLowerCase().includes("nulle") || st.over.toLowerCase().includes("draw") ? "chuckle" : "smile") : "smile");
    const t = st.taunt; if (!t) return;
    const names = EtoFace.fromTags(t.tags) || (KIND_FACE[t.kind] ? [KIND_FACE[t.kind]] : null);
    if (names) window.enosPersona.emote(names);
  }
  function announce() {
    if (S.st && S.st.seq > S.spoken) {
      S.spoken = S.st.seq; feel(S.st); paintCoach();
      if (S.st.taunt && S.st.taunt.voice) speak(S.st.taunt);                 // E.N.O.S. : provocations, prédiction de mat…
      if (S.st.mode === "speedrun" || isTi(S.st.mode)) return;               // le speedrun / le Choc des Titans / le boss final sont pilotés par srLoop() / tiLoop()
      if (S.st.over && CC.over !== S.st.seq) { CC.over = S.st.seq; if (S.st.mode === "coach") coachEvent("end"); }
      else coachTurn();                                                      // ETO : commentaire pédagogique du dernier échange
    }
  }

  // ---- COACH ETO : commente la partie (cours contre un bot virtuel, ou aide pendant un duel contre E.N.O.S.)
  const CC = { face: null, busy: false, over: 0 };
  const etoFoe = () => MODE() === "enos" && (S.st && S.st.active ? (S.st.opponent ? S.st.opponent !== "enos" : ETO()) : $("cs-opp").value !== "enos");     // duel contre ETO : il ne peut pas aussi être mon coach
  const ccOn = () => MODE() === "coach" || ($("cc-on").checked && !etoFoe());
  function ccFace() { if (!CC.face && window.EtoFace) CC.face = EtoFace.mount($("cs-coach-face"), { expression: "smile" }); return CC.face; }
  function paintCoach() {
    const st = S.st, coach = st && st.mode === "coach", sr = st && st.mode === "speedrun", ti = st && isTi(st.mode), bo = st && st.mode === "boss";
    $("cs-coach").hidden = !(st && st.active) || !!(st && st.active && st.mode === "enos" && etoFoe());       // ETO adversaire : pas de panneau coach
    $("cs").dataset.mode = st && st.active ? st.mode : "";
    $("cc-onwrap").hidden = !!(coach || sr || ti || etoFoe());
    if (st && st.active && st.mode === "enos" && etoFoe()) { $("cc-title").textContent = st.opponent === "eto_brillant" ? "ETO BRILLANT" : "ETO"; }
    $("cs-sr-pause").hidden = !(sr || ti);
    $("cc-title").textContent = bo ? "BOSS FINAL · STOCKFISH" : ti ? "LE CHOC DES TITANS" : "COACH ETO";
    $("cc-sub").textContent = bo ? `${st.players[st.me]} contre STOCKFISH (pleine puissance, muet : il annonce son coup) · tu regardes !` : ti ? "E.N.O.S. vs ETO · 3200 Elo chacun · tu regardes !" : sr ? `ETO joue contre ${st.bot} : tu regardes !` : coach ? `ETO commente votre partie contre ${st.bot}` : "ETO vous aide pendant le duel contre E.N.O.S.";
    $("cs-mode").value = st && st.active ? st.mode : $("cs-mode").value;
    paintMode();
    if (st && st.active) { const sm = document.querySelector("#cs .tm-top h2 small"); if (sm) sm.textContent = bo ? `BOSS FINAL · ${st.players[st.me].toUpperCase()} VS STOCKFISH` : ti ? "LE CHOC DES TITANS · E.N.O.S. VS ETO" : sr ? `SPEEDRUN · ETO VS ${st.bot.toUpperCase()}` : coach ? `COURS AVEC ETO · ${st.bot.toUpperCase()}` : `VOUS CONTRE ${AI()} · ${st.setup ? "POSITION LIBRE" : "STOCKFISH"}`; ccFace(); }
  }
  function paintMode() {
    const coach = $("cs-mode").value !== "enos", titans = isTi($("cs-mode").value);
    $("cs-elo").hidden = !coach || titans;
    $("cs-opp").hidden = coach;                                              // choix de l'adversaire : seulement en duel
    const brill = !coach && $("cs-opp").value === "eto_brillant";
    $("cs-boss").hidden = $("cs-mode").value !== "boss";
    document.querySelector(".cs-power").style.display = coach || brill ? "none" : "";        // ETO Brillant : toujours pleine puissance (3200 Elo)
    try { localStorage.setItem("enos_chess_mode", $("cs-mode").value); localStorage.setItem("enos_chess_opp", $("cs-opp").value); localStorage.setItem("enos_chess_elo", $("cs-elo").value); localStorage.setItem("enos_chess_boss", $("cs-boss").value); } catch (e) {}
  }
  try { const m = localStorage.getItem("enos_chess_mode"), e = localStorage.getItem("enos_chess_elo"); if (m === "coach" || m === "enos" || m === "speedrun" || m === "titans" || m === "boss") $("cs-mode").value = m; const bo = localStorage.getItem("enos_chess_boss"); if (bo && [...$("cs-boss").options].some((o) => o.value === bo)) $("cs-boss").value = bo; if (e && [...$("cs-elo").options].some((o) => o.value === e)) $("cs-elo").value = e; } catch (e) {}
  try { const o = localStorage.getItem("enos_chess_opp"); if (o && [...$("cs-opp").options].some((x) => x.value === o)) $("cs-opp").value = o; } catch (e) {}
  $("cs-mode").onchange = paintMode; $("cs-elo").onchange = paintMode; $("cs-opp").onchange = paintMode;
  // flèches pédagogiques sur le plateau web (le plateau Godot reçoit les mêmes du serveur) : vert = meilleur coup, rouge = menace / réponse attendue, bleu = coup qui punit
  function clearArrows() { const o = $("cs-arrows"); if (o) o.innerHTML = ""; clearTimeout(CC.arrT); CC.arrList = []; }
  // append = true : la flèche s'AJOUTE aux précédentes (elle apparaît quand ETO prononce le coup correspondant)
  function drawArrows(list, n, append) {
    const left = document.querySelector(".cs-left"), board = $("cs-board");
    if (!board || board.hidden || !board.offsetWidth || !list || !list.length) return;
    CC.arrList = append ? (CC.arrList || []).concat(list) : list.slice();
    let svg = $("cs-arrows");
    if (!svg) { svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.id = "cs-arrows"; left.appendChild(svg); }
    const w = board.offsetWidth, h = board.offsetHeight, sq = w / 8, flip = S.st && S.st.me === "b";
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.style.cssText = `position:absolute;left:${board.offsetLeft}px;top:${board.offsetTop}px;width:${w}px;height:${h}px;pointer-events:none;z-index:4`;
    const ctr = (s) => { let c = "abcdefgh".indexOf(s[0]), r = 8 - parseInt(s[1], 10); if (flip) { c = 7 - c; r = 7 - r; } return [(c + 0.5) * sq, (r + 0.5) * sq]; };
    const corner = (a) => (Math.abs(a.to.charCodeAt(0) - a.from.charCodeAt(0)) === 2 ? a.to[0] + a.from[1] : a.from[0] + a.to[1]);      // équerre : 2 cases dans le sens long, puis 1 de côté
    const COL = { best: "#22d36a", threat: "#f23d55", punish: "#3a82ff", brilliant: "#ffcc1f", played: "#f5b82e" };
    svg.innerHTML = CC.arrList.map((a) => {
      const pts = a.knight ? [ctr(a.from), ctr(corner(a)), ctr(a.to)] : [ctr(a.from), ctr(a.to)];
      const [x0, y0] = pts[0], [x1, y1] = pts[pts.length - 1], [px, py] = pts[pts.length - 2];
      const col = COL[a.kind] || COL.best, dx = x1 - px, dy = y1 - py, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, hx = x1 - ux * sq * 0.28, hy = y1 - uy * sq * 0.28;
      const gold = a.kind === "brilliant", W = sq * (gold ? 0.24 : 0.17);
      const line = pts.slice(0, -1).concat([[hx, hy]]).map((q) => q.join(",")).join(" ");
      const bang = gold ? `<text x="${x1 + sq * 0.12}" y="${y1 - sq * 0.12}" font-size="${sq * 0.62}" font-weight="900" font-family="Segoe UI,Arial,sans-serif" fill="#ffcc1f" stroke="#3a1c00" stroke-width="${sq * 0.07}" paint-order="stroke" text-anchor="middle">!!</text>` : "";
      return `<g opacity=".9" class="cs-arw" ${gold ? 'style="filter:drop-shadow(0 0 7px #ffcc1f)"' : ""}><polyline points="${line}" fill="none" stroke="${col}" stroke-width="${W}" stroke-linecap="round" stroke-linejoin="round"/>${bang}<polygon fill="${col}" points="${x1},${y1} ${hx - uy * sq * 0.2},${hy + ux * sq * 0.2} ${hx + uy * sq * 0.2},${hy - ux * sq * 0.2}"/><circle cx="${x0}" cy="${y0}" r="${sq * 0.12}" fill="${col}"/></g>`;
    }).join("");
    clearTimeout(CC.arrT); CC.arrT = setTimeout(clearArrows, Math.max(5000, Math.min(14000, 2000 + n * 75)));
  }
  // Régie : à l'instant où la voix atteint la phrase d'une flèche, on l'AJOUTE (plateau web + plateau Godot) ; `release` = jouer le coup retenu (speedrun).
  function stage(c, info, hooks) {
    const dur = Math.max(1, (info && info.duration) || c.text.length / 14), list = (c.arrows || []).filter((a) => a.from && a.to);
    list.forEach((a, i) => { if (a.at == null) a.at = Math.min(0.9, 0.2 + 0.6 * i / Math.max(1, list.length)); });      // phrase introuvable : réparties dans la parole
    clearArrows();
    post("/api/chess/stage", { say: c.text, append: false }).catch(() => {});
    list.forEach((a) => setTimeout(() => { drawArrows([a], c.text.length, true); post("/api/chess/stage", { arrows: [a], secs: 7, append: true }).catch(() => {}); }, Math.max(0, a.at * dur * 1000)));
    if (hooks && hooks.release) setTimeout(hooks.release, Math.max(0, (c.move_at || 0) * dur * 1000) + (c.move_at ? 750 : 0));      // le coup se joue juste APRÈS que la flèche l'a annoncé
  }
  async function coachSay(c, wait, hooks) {                                // wait : attendre la fin de la parole · hooks.release : jouer le coup retenu (speedrun)
    if (!c || !c.text) { if (hooks && hooks.release) hooks.release(); return; }
    const log = $("cs-coach-log"), d = document.createElement("div");
    d.className = "cc-msg"; d.textContent = c.text; log.appendChild(d); log.scrollTop = 1e6;
    if (c.llm === false && !CC.warned) {                                     // le LLM ne répond pas : ETO reste pédagogue avec les données de Stockfish, mais en version simplifiée
      CC.warned = true; const w = document.createElement("div"); w.className = "cc-msg cc-warn";
      w.textContent = "⚠ Le LLM ne répond pas (clé llm_api_key refusée ?) : ETO commente avec les analyses de Stockfish en mode simplifié."; log.insertBefore(w, d);
    }
    const f = ccFace(), names = window.EtoFace ? (EtoFace.fromTags(c.tags) || [EtoFace.guess(c.text)]) : [];
    if (f) names.forEach((n, i) => setTimeout(() => f.react(n, 1900), i * 1400));
    let staged = false;
    const start = (info) => { if (!staged) { staged = true; stage(c, info, hooks); } };          // appelé au démarrage RÉEL de la voix
    if (c.audio && $("cc-voice").checked) { if (window.say) { const p = window.say(c.text, { audio: c.audio, who: "ETO", onStart: start }); if (wait) await p; } }      // voix déjà synthétisée (speedrun)
    else if ($("cc-voice").checked) { try { const r = await post("/api/chess/voice", { text: c.text, kind: "normal", persona: "eto" }); if (window.say) { const p = window.say(r.text, { audio: r.audio, who: "ETO", onStart: start }); if (!r.audio) { ttsNotice(r.notice || "ElevenLabs indisponible."); const b = browserSpeak(c.text, "eto"); if (wait) await Promise.all([p, b]); } else if (wait) await p; } } catch (e) {} }
    else { start({ duration: Math.min(7, 0.8 + c.text.length / 20) }); if (wait) await sleep(Math.min(7000, 800 + c.text.length * 40)); }
    if (wait) start({ duration: 3 });                                        // sécurité : si la voix n'a jamais démarré, le coup retenu est libéré quand même
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // ---- SPEEDRUN : ETO (3200 Elo) joue contre le bot, tu regardes. Chaque demi-coup : le serveur joue, ETO commente (voix prête), le plateau s'anime, on attend la fin de sa phrase.
  const SR = { on: false, paused: false, running: false };
  async function srLoop() {
    if (SR.running) return;
    SR.running = true; SR.on = true;
    let speech = Promise.resolve();
    try {
      while (SR.on && S.st && S.st.mode === "speedrun" && !S.st.over) {
        if (SR.paused) { await sleep(300); continue; }
        let r;
        try { r = await post("/api/chess/speedrun/step", { voice: $("cc-voice").checked, defer: true }); }     // coup joué côté serveur, ANIMATION retenue
        catch (e) { $("cs-status").textContent = "✕ " + e.message; break; }
        // le coup (plateau web + Godot) se joue quand ETO l'annonce ; la boucle repart aussitôt : le moteur calcule le coup suivant PENDANT qu'il parle
        let played; const released = new Promise((res) => (played = res));
        let once = false;
        const release = async () => {
          if (once) return; once = true;
          try { await post("/api/chess/stage", { release: true }); } catch (e) {}
          S.st = r.state; S.sel = null; render(); S.spoken = Math.max(S.spoken, S.st.seq); paintCoach(); played();
        };
        speech = coachSay(r.coach, true, { release }).then(release, release);
        if (!r.coach) await release();
        await released;
        if (r.done) break;
      }
      await speech;
    } finally { SR.running = false; }
    if (SR.on && S.st && S.st.over && S.st.mode === "speedrun") await coachEvent("end", true);
  }
  $("cs-sr-pause").onclick = () => {
    SR.paused = TI.paused = !(SR.paused || TI.paused); $("cs-sr-pause").textContent = SR.paused ? "▶ REPRENDRE" : "⏸ PAUSE";
    if (!SR.paused && S.st && !S.st.over) {                                 // reprise d'une partie affichée en pause (aucune boucle ne tourne)
      if (S.st.mode === "speedrun" && !SR.running) srLoop();
      if (isTi(S.st.mode) && !TI.running) { TI.orig = TI.orig || (ETO() ? "eto" : "enos"); tiLoop(); }
    }
  };

  // ---- LE CHOC DES TITANS : E.N.O.S. (3200) contre ETO (3200), spectateur. Chaque réplique bascule INSTANTANÉMENT la personnalité (œil rouge 3D + voix grave ↔ visage ETO + voix rapide).
  const TI = { on: false, paused: false, running: false, orig: null };
  function isTi(m) { return m === "titans" || m === "boss"; }                          // les deux modes « spectateur à deux voix » partagent la même boucle
  function tiApi(m) { return "/api/chess/" + (m === "boss" ? "boss" : "titans"); }
  function sfLog(ann) {                                                         // Stockfish ne parle pas : il n'annonce que son coup, une ligne dans le journal
    const log = $("cs-coach-log"), d = document.createElement("div"), im = document.createElement("img"), b = document.createElement("b");
    d.className = "cc-msg cc-sf"; im.src = "/static/stockfish.png"; im.alt = ""; im.style.cssText = "width:18px;height:18px;vertical-align:-4px;margin-right:6px;border-radius:4px";
    b.textContent = "STOCKFISH ▸ " + ann.text; d.append(im, b); log.appendChild(d); log.scrollTop = 1e6;
  }
  async function tiSay(line) {
    if (!line || !line.text) return;
    if (window.enosPersona) await window.enosPersona.quick(line.persona);                       // thème, visage / œil, libellés : instantané
    post("/api/chess/titans/speak", { persona: line.persona, text: line.text }).catch(() => {});   // plateau Godot + widget de bureau + sous-titre
    const log = $("cs-coach-log"), d = document.createElement("div"), nm = document.createElement("b");
    d.className = "cc-msg " + (line.persona === "enos" ? "cc-enos" : "cc-eto");
    nm.textContent = line.name + " "; d.append(nm, document.createTextNode(line.text));
    log.appendChild(d); log.scrollTop = 1e6;
    drawArrows(line.arrows, line.text.length);
    if (line.persona === "eto" && window.EtoFace) { const f = ccFace(), names = EtoFace.fromTags(line.tags) || [EtoFace.guess(line.text)]; if (f) names.forEach((n, i) => setTimeout(() => f.react(n, 1900), i * 1400)); }
    if (line.audio && $("cc-voice").checked && window.say) await window.say(line.text, { audio: line.audio, who: line.name });
    else if ($("cc-voice").checked && window.say) await Promise.all([window.say(line.text, { who: line.name }), browserSpeak(line.text, line.persona)]);      // pas d'audio ElevenLabs : voix du navigateur
    else await sleep(Math.min(7000, 800 + line.text.length * 40));
  }
  async function tiRestore() { if (TI.orig && window.enosPersona) { const o = TI.orig; TI.orig = null; await window.enosPersona.quick(o, true); } }     // la personnalité d'avant le match revient
  async function tiLoop() {
    if (TI.running) return;
    TI.running = true; TI.on = true;
    try {
      while (TI.on && S.st && isTi(S.st.mode) && !S.st.over) {
        if (TI.paused) { await sleep(300); continue; }
        let r;
        try { r = await post(tiApi(S.st.mode) + "/step", { voice: $("cc-voice").checked }); }
        catch (e) { $("cs-status").textContent = "✕ " + e.message; break; }
        S.st = r.state; S.sel = null; render(); S.spoken = Math.max(S.spoken, S.st.seq); paintCoach();
        if (r.announce) sfLog(r.announce);
        ttsNotice(r.tts_notice);
        for (const l of r.lines) { if (!TI.on) break; await tiSay(l); }
        if (!r.lines.length) await sleep(650);
        if (r.done) break;
      }
    } finally { TI.running = false; }
    if (TI.on && S.st && S.st.over && isTi(S.st.mode)) {
      try { const e = await post(tiApi(S.st.mode) + "/event", { event: "end", voice: $("cc-voice").checked }); ttsNotice(e.tts_notice); for (const l of e.lines) { if (!TI.on) break; await tiSay(l); } } catch (e) {}
      await tiRestore();
    }
  }
  $("cs-titans").onclick = () => { $("cs-mode").value = "titans"; paintMode(); newGame(Math.random() < 0.5 ? "w" : "b"); };       // couleurs tirées au sort : ETO a les Blancs ou les Noirs
  async function coachTurn() {
    if (!ccOn() || !S.st || !S.st.active || S.st.decision || CC.busy) return;
    CC.busy = true; const f = ccFace(); if (f) f.set("thinking");
    try { const r = await post("/api/chess/coach", { event: "turn" }); if (r.coach) await coachSay(r.coach); } catch (e) {}
    if (f) f.set("smile"); CC.busy = false;
  }
  async function coachEvent(ev, wait) {
    const f = ccFace(); if (f) f.set("thinking");
    try { await coachSay(await post("/api/chess/coach", { event: ev }), wait); } catch (e) {}
    if (f) f.set("smile");
  }

  async function newGame(color) {
    $("cs-judge").textContent = "";
    let tip = "";
    try { const s = await api("/api/chess/state"); if (!s.stockfish) tip = "Téléchargement de Stockfish (première partie)… patientez."; } catch (e) {}
    if (tip) $("cs-status").textContent = tip;
    const poll = tip ? setInterval(async () => { try { const s = await api("/api/chess/state"); if (s.download && s.download.busy) $("cs-status").textContent = `${tip} ${Math.round(s.download.pct * 100)} %`; } catch (e) {} }, 700) : 0;
    const mode = $("cs-mode").value;                                         // défi : E.N.O.S. (thème sombre) · cours : ETO (thème clair), la bascule se fait avec la transition
    try {
      const r = $("cs-mode").getBoundingClientRect(), o = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      if (isTi(mode)) { if (!TI.orig) TI.orig = ETO() ? "eto" : "enos"; }                      // les personnalités alternent d'elles-mêmes, tiRestore() remettra l'ancienne
      else if (mode !== "enos" && !ETO() && window.enosPersona) await window.enosPersona.set("eto", o);
      else if (mode === "enos" && window.enosPersona) { const wantEto = $("cs-opp").value !== "enos"; if (wantEto !== ETO()) await window.enosPersona.set(wantEto ? "eto" : "enos", o); }      // l'adversaire choisi prend la parole (voix, visage, provocations)
    } catch (e) {}
    SR.on = false; SR.paused = false; TI.on = false; TI.paused = false; $("cs-sr-pause").textContent = "⏸ PAUSE";
    for (let i = 0; i < 100 && (SR.running || TI.running); i++) await sleep(100);       // la boucle d'un speedrun / match précédent doit être terminée
    if (!isTi(mode)) await tiRestore();
    $("cs-coach-log").innerHTML = ""; CC.over = 0;
    await request(() => post("/api/chess/new", { color, power: isTi(mode) ? 100 : mode !== "enos" ? powerOfElo(parseInt($("cs-elo").value, 10) || 600) : power(), mode, opponent: mode === "enos" ? $("cs-opp").value : "", challenger: $("cs-boss").value, elo: isTi(mode) ? 3200 : mode !== "enos" ? parseInt($("cs-elo").value, 10) || 600 : null }));
    clearInterval(poll);
    if (mode === "coach") coachEvent("start");
    else if (mode === "speedrun") { paintCoach(); coachEvent("start", true).then(() => srLoop()); }
    else if (isTi(mode)) {
      paintCoach(); TI.on = true;
      try { const e = await post(tiApi(mode) + "/event", { event: "start", voice: $("cc-voice").checked }); ttsNotice(e.tts_notice); for (const l of e.lines) await tiSay(l); } catch (e) { $("cs-status").textContent = "✕ " + e.message; }
      tiLoop();
    }
  }

  function pick(name) {
    const st = S.st; if (!st || S.busy || st.over || st.turn !== st.me) return;
    if (S.sel && (st.legal[S.sel] || []).includes(name)) {
      const from = S.sel, piece = st.board[from], promo = piece && piece.toLowerCase() === "p" && (name[1] === "8" || name[1] === "1");
      if (promo) return askPromo(from + name);
      return request(() => post("/api/chess/move", { uci: from + name }));
    }
    S.sel = st.legal[name] ? name : null; drawBoard();
  }
  function askPromo(uci) {
    const box = $("cs-promo"), w = S.st.me === "w";
    box.innerHTML = ["q", "r", "b", "n"].map((p) => `<button data-p="${p}" class="cs-p ${w ? "w" : "b"}">${GLYPH[p]}</button>`).join("");
    box.hidden = false;
    box.onclick = (e) => { const b = e.target.closest("button"); if (!b) return; box.hidden = true; request(() => post("/api/chess/move", { uci, promotion: b.dataset.p })); };
  }

  // Encastrement : le serveur lance le jeu en silence et rattache sa fenêtre au conteneur #cs-embed (coordonnées en pixels physiques).
  const EM = { on: false, ro: null, tick: null, last: "" };
  const EMB_RATIO = 1080 / 1264;
  function fitEmbed() {
    const wrap = document.querySelector(".cs-wrap"), box = $("cs-embed");
    const side = window.innerWidth > 900 ? 360 : 0;                  // colonne de droite (jugement, évaluation, coups)
    const aw = wrap.clientWidth - side - 36, ah = wrap.clientHeight - 28;
    const h = Math.max(240, Math.min(ah, aw / EMB_RATIO));
    box.style.height = Math.floor(h) + "px"; box.style.width = Math.floor(h * EMB_RATIO) + "px";
  }
  function covered() {                                              // une autre fenêtre E.N.O.S. recouvre le plateau : la fenêtre native doit s'effacer
    const r = $("cs-embed").getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !(el && $("cs-embed").contains(el));
  }
  function sendRect(force) {
    if (!EM.on) return;
    const r = $("cs-embed").getBoundingClientRect(), d = window.devicePixelRatio || 1;
    const body = { x: Math.round(r.left * d), y: Math.round(r.top * d), w: Math.round(r.width * d), h: Math.round(r.height * d), shown: !covered() && !$("cs").hidden };
    const key = JSON.stringify(body);
    if (force !== true && key === EM.last) return;
    EM.last = key;
    post("/api/chess/embed/rect", body).catch(() => {});
  }
  async function health() {                                        // le plateau Godot a planté ou ne s'est pas rattaché : retour au plateau 2D intégré
    try {
      const st = await api("/api/chess/embed");
      if (EM.on && (!st.running || (!st.attached && Date.now() - EM.t0 > 15000))) { embedStop(); post("/api/chess/embed/stop").catch(() => {}); }
    } catch (e) {}
  }
  async function follow() {                                         // plateau Godot : les clics arrivent côté serveur, l'interface se met à jour par suivi
    if (!EM.on || S.busy) return;
    try { const st = await api("/api/chess/state"); if (st.active && (!S.st || st.seq !== S.st.seq)) { S.st = st; render(); announce(); } } catch (e) {}
  }
  async function embedStart() {
    try {
      const st = await api("/api/chess/embed");
      if (!st.supported || !st.configured) return;                  // pas de jeu externe : le plateau 2D reste affiché
      await post("/api/chess/embed/start");
      EM.on = true; $("cs-embed").hidden = false; document.querySelector(".cs-left").classList.add("embedded");
      EM.ro = EM.ro || new ResizeObserver(() => sendRect());
      fitEmbed(); EM.ro.observe($("cs-embed")); window.addEventListener("resize", () => { fitEmbed(); sendRect(); });
      document.querySelector(".cs-wrap").addEventListener("scroll", sendRect);
      EM.t0 = Date.now(); EM.n = 0;
      EM.tick = setInterval(() => { sendRect(); follow(); if (++EM.n % 6 === 0) health(); }, 500); sendRect(true);
    } catch (e) { /* le plateau 2D prend le relais */ }
  }
  function embedStop() {
    if (!EM.on) return;
    EM.on = false; if (EM.ro) EM.ro.disconnect(); window.removeEventListener("resize", sendRect); clearInterval(EM.tick);
    $("cs-embed").hidden = true; document.querySelector(".cs-left").classList.remove("embedded");
    post("/api/chess/embed/stop").catch(() => {});
  }

  // ---- TRASH TALK : parler à E.N.O.S. pendant la partie (micro du PC -> Whisper -> réponse arrogante + voix ElevenLabs + sous-titres Godot)
  let trashing = false, trashT = 0;
  const micBtn = () => $("cs-mic");
  async function startTrash() {
    if (trashing) return finishTrash();
    micBtn().disabled = true;
    try { const r = await post("/api/stt/start"); if (!r.ok) throw new Error(r.error || "micro indisponible"); }
    catch (e) { micBtn().disabled = false; $("cs-status").textContent = "✕ " + e.message; return; }
    micBtn().disabled = false; trashing = true; rest("listening"); micBtn().classList.add("rec"); micBtn().textContent = "● J'ÉCOUTE… (clic = envoyer)";
    trashT = setInterval(async () => { try { const s = await api("/api/stt/status"); if (!s.recording) finishTrash(); } catch (e) { clearInterval(trashT); } }, 150);
  }
  async function finishTrash() {
    clearInterval(trashT); if (!trashing) return; trashing = false; rest("thinking");
    micBtn().classList.remove("rec"); micBtn().textContent = "TRANSCRIPTION…";
    try {
      const r = await post("/api/stt/stop");
      if (!r.ok) throw new Error(r.error || "transcription impossible");
      if (!r.text) { rest("confused"); setTimeout(() => rest("smile"), 1800); $("cs-status").textContent = "Je n'ai rien entendu : cliquez, puis parlez."; return; }
      $("cs-judge").innerHTML = `<i>Vous : « ${esc(r.text)} »</i>`;
      const t = await post("/api/chess/trash", { text: r.text });
      if (t.task) { coachSay(t); }                                           // cours : la voix de l'élève s'adresse au coach ETO
      else {
        $("cs-judge").innerHTML += `<br><b class="q-${t.focus && !ETO() ? "blunder" : "best"}">${AI()} :</b> ${esc(t.text)}`;
        speak({ text: t.text, kind: t.kind });
      }
      if (ETO() && window.EtoFace) { rest("smile"); const n = EtoFace.fromTags(t.tags); window.enosPersona.emote(n || [t.focus ? "chuckle" : "warm"]); }
    } catch (e) { $("cs-status").textContent = "✕ " + e.message; rest("smile"); }
    finally { micBtn().textContent = ETO() ? "🎤 PARLER À ETO" : "🎤 TRASH TALK"; }
  }
  // ---- ÉCOUTE DISCORD : l'audio de sortie du PC (la voix de l'ami en appel) est transcrit en continu ; chaque phrase part en trash-talk « invité » vers ETO / E.N.O.S.,
  // qui répond à voix haute. Le serveur est mis en SOURDINE pendant que l'IA parle (sa voix sort dans le même casque) et filtre aussi l'écho par ressemblance de texte.
  const DC = { on: false, after: 0, timer: 0, busy: false, queue: [] };
  function paintDiscord(msg) {
    const b = $("cs-discord");
    b.textContent = "🎧 ÉCOUTE DISCORD : " + (DC.on ? "ON" : "OFF"); b.classList.toggle("rec", DC.on);
    $("cs-discord-lv").hidden = !DC.on; if (msg != null) $("cs-discord-lv").textContent = msg;
    $("cs-discord-mic").disabled = DC.on;
  }
  async function discordOff() {
    DC.on = false; clearInterval(DC.timer); DC.queue = [];
    try { await post("/api/discord/stop"); } catch (e) {}
    paintDiscord(); rest("smile");
  }
  async function discordOn() {
    let r;
    try { r = await post("/api/discord/start", { mix_mic: $("cs-discord-mic").checked }); } catch (e) { $("cs-status").textContent = "✕ " + e.message; return; }
    if (!r.ok) { $("cs-status").textContent = "✕ " + r.error; return; }
    try { DC.after = (await api("/api/discord/poll?after=0")).last || 0; } catch (e) { DC.after = 0; }
    DC.on = true; DC.queue = []; paintDiscord("à l'écoute de : " + r.device);
    $("cs-status").textContent = "Écoute Discord active : " + (ETO() ? "ETO" : "E.N.O.S.") + " entend la voix de votre ami (" + r.device + ") et lui répond.";
    DC.timer = setInterval(discordPoll, 700);
  }
  async function discordPoll() {
    if (!DC.on) return;
    let p;
    try { p = await api("/api/discord/poll?after=" + DC.after); } catch (e) { return; }
    if (!p.running && DC.on) { $("cs-status").textContent = "✕ " + (p.error || "L'écoute Discord s'est arrêtée."); return discordOff(); }
    paintDiscord(p.muted ? "⏸ " + (ETO() ? "ETO" : "E.N.O.S.") + " parle…" : "● à l'écoute " + "▮".repeat(Math.round(p.level * 8)) + (p.error ? " · ⚠ " + p.error.slice(0, 70) : ""));
    for (const e of p.events) { DC.after = Math.max(DC.after, e.id); DC.queue.push(e); }
    if (DC.busy || !DC.queue.length) return;
    DC.busy = true;
    try { while (DC.queue.length && DC.on) await guestTurn(DC.queue.shift().text); } finally { DC.busy = false; }
  }
  async function guestTurn(text) {
    if (!S.st || !S.st.active || S.st.over) { $("cs-status").textContent = "Écoute Discord : lancez une partie pour que " + (ETO() ? "ETO" : "E.N.O.S.") + " réponde à votre ami."; return; }
    try { await post("/api/discord/mute", { secs: 60 }); } catch (e) {}                 // sourdine pendant la réflexion et la parole de l'IA
    rest("thinking");
    $("cs-judge").innerHTML = `<i>Invité Discord : « ${esc(text)} »</i>`;
    try {
      const t = await post("/api/chess/trash", { text, guest: true });
      if (t.task) await coachSay(t);
      else {
        $("cs-judge").innerHTML += `<br><b class="q-best">${AI()} :</b> ${esc(t.text)}`;
        if (ETO() && window.EtoFace) { const n = EtoFace.fromTags(t.tags); window.enosPersona.emote(n || ["smug"]); }      // sourire en coin : il s'adresse à l'invité
        await speak({ text: t.text, kind: t.kind }, true);
      }
    } catch (e) { $("cs-status").textContent = "✕ " + e.message; }
    finally { await sleep(600); try { await post("/api/discord/mute", { secs: 0.8 }); } catch (e) {} rest("smile"); }
  }
  $("cs-discord").onclick = () => (DC.on ? discordOff() : discordOn());
  $("cs-mic").onclick = startTrash;
  $("cs-stop").onclick = async () => { if (window.stopSpeaking) await window.stopSpeaking(); if (!trashing) startTrash(); };    // coupe la voix puis ouvre le micro

  // ---- gaffe catastrophique : continuer ou annuler (takeback)
  async function decide(choice) {
    try { S.st = await post("/api/chess/decision", { choice }); S.sel = null; render(); announce(); } catch (e) { $("cs-status").textContent = "✕ " + e.message; }
  }
  $("cs-dec-go").onclick = () => decide("continue");
  $("cs-dec-undo").onclick = () => decide("takeback");

  // ---- thème de pièces (plateau Godot)
  async function loadThemes() {
    try {
      const r = await api("/api/chess/themes");
      $("cs-theme").innerHTML = r.themes.map((t) => `<option value="${esc(t.id)}" ${t.id === r.current ? "selected" : ""}>${esc(t.label)}</option>`).join("");
    } catch (e) {}
  }
  $("cs-theme").onchange = () => post("/api/chess/theme", { name: $("cs-theme").value }).catch((e) => ($("cs-status").textContent = "✕ " + e.message));

  // ---- plateau à couleurs unies (cases claires / foncées), indépendant du thème de pièces
  async function loadBoards() {
    try {
      const r = await api("/api/chess/boards");
      $("cs-board").innerHTML = '<option value="">Plateau : celui du thème</option>' +
        r.boards.map((b) => `<option value="${esc(b.id)}" ${b.id === r.current ? "selected" : ""}>${esc(b.label)}</option>`).join("");
    } catch (e) {}
  }
  $("cs-board").onchange = () => post("/api/chess/board", { name: $("cs-board").value }).catch((e) => ($("cs-status").textContent = "✕ " + e.message));

  // ---- style visuel du plateau (matériaux, néon, yeux des cavaliers) : préréglages, ou E.N.O.S. compose le sien via le LLM
  async function loadVisual() {
    try {
      const r = await api("/api/chess/visual/presets");
      $("cs-vtheme").innerHTML = '<option value="">Style : d’origine</option><option value="__llm">✨ E.N.O.S. choisit</option>' +
        r.presets.map((t) => `<option value="${esc(t.id)}" ${r.current === t.label ? "selected" : ""}>${esc(t.label)}</option>`).join("");
    } catch (e) {}
  }
  $("cs-vtheme").onchange = async () => {
    const v = $("cs-vtheme").value, st = $("cs-status");
    try {
      if (v === "__llm") { st.textContent = "E.N.O.S. compose son style…"; const r = await post("/api/chess/visual/generate", { mood: "", hint: "" }); st.textContent = r.source === "llm" ? "Style : " + r.theme.theme_id : "Style (préréglage) : " + r.theme.theme_id + (r.error ? " — " + r.error : ""); }
      else if (v === "") await post("/api/chess/visual/reset", {});
      else await post("/api/chess/visual/preset", { name: v });
    } catch (e) { st.textContent = "✕ " + e.message; }
  };

  // ---- BILAN (review) : précision, niveau estimé, coups par catégorie, courbe d'avantage, moments critiques
  const CATS = [["brilliant", "Brillant", "#1acfd6"], ["best", "Meilleur coup", "#7bd64d"], ["excellent", "Excellent", "#9ecc38"], ["good", "Bon", "#739e66"],
    ["inaccuracy", "Imprécision", "#fac72e"], ["mistake", "Erreur", "#fa8a24"], ["blunder", "Gaffe", "#eb2e33"]];
  const catColor = (k) => (CATS.find((c) => c[0] === k) || [0, 0, "#888"])[2];
  const WP = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * Math.max(-2000, Math.min(2000, cp)))) - 1);
  const RANKS = [[800, "DÉBUTANT", "#9aa0a6"], [1200, "AMATEUR", "#7bd64d"], [1600, "JOUEUR DE CLUB", "#1acfd6"], [2000, "EXPERT", "#6aa8ff"], [2400, "MAÎTRE", "#c06bff"], [2800, "GRAND MAÎTRE", "#ffb020"], [9999, "SURHUMAIN", "#ff2a3a"]];
  const rankOf = (elo) => RANKS.find((r) => elo < r[0]) || RANKS[RANKS.length - 1];
  function verdict(rev) {
    const a = rev.me.accuracy || 0;
    return a >= 95 ? "PERFORMANCE PARFAITE" : a >= 85 ? "MAGISTRAL" : a >= 70 ? "SOLIDE" : a >= 55 ? "FRAGILE" : "DÉSASTRE";
  }
  function graphSvg(rev) {
    const ev = rev.evals || [], W = 400, H = 110, n = Math.max(1, ev.length);
    if (!ev.length) return "";
    const x = (i) => ((i + 1) / n) * (W - 12) + 6, y = (cp) => H - 6 - (WP(cp) / 100) * (H - 12);
    const pts = [[6, y(0)], ...ev.map((c, i) => [x(i), y(c)])];
    let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const line = pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
    const area = `6,${H - 6} ${line} ${W - 6},${H - 6}`;
    const mine = rev.me_color === "w" ? 0 : 1;
    const dots = ev.map((c, i) => ((rev.keys[i] === "blunder" || rev.keys[i] === "mistake" || rev.keys[i] === "brilliant") && (i % 2 === mine))
      ? `<circle class="dt" style="animation-delay:${(2.4 + i * 0.05).toFixed(2)}s" cx="${x(i).toFixed(1)}" cy="${y(c).toFixed(1)}" r="4.5" fill="${catColor(rev.keys[i])}" stroke="#fff" stroke-width="1"/>` : "").join("");
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Courbe d'avantage"><rect width="${W}" height="${H}" fill="#120a0c"/><polygon class="ar" points="${area}" fill="#e8dcde"/>
      <line x1="6" x2="${W - 6}" y1="${y(0)}" y2="${y(0)}" stroke="#ff2a3a" stroke-width="1" stroke-dasharray="4 3" opacity=".8"/>
      <polyline class="ln" style="--len:${Math.ceil(len)}" points="${line}" fill="none" stroke="#ff2a3a" stroke-width="2"/>${dots}</svg>`;
  }
  function ring(r, who, delay) {
    const C = 2 * Math.PI * 54, acc = r.accuracy == null ? 0 : r.accuracy, elo = r.elo == null ? 0 : r.elo, rk = rankOf(elo);
    return `<div class="rv-side" style="animation-delay:${delay}s"><h4>${who}</h4>
      <div class="rv-ring"><svg viewBox="0 0 130 130"><circle class="bg" cx="65" cy="65" r="54"/><circle class="fg" cx="65" cy="65" r="54" style="--c:${C.toFixed(1)}" data-pct="${acc}"/></svg>
        <div class="num"><span><span data-count="${acc}" data-dec="1">0</span> %<small>PRÉCISION</small></span></div></div>
      <div class="rv-elo">≈ <span data-count="${elo}">0</span> Elo</div><div class="rv-lab">NIVEAU ESTIMÉ SUR CETTE PARTIE</div>
      <div class="rv-rank" style="color:${rk[2]}">${rk[1]}</div>
      <div class="rv-lab" style="margin-top:8px">${r.moves} COUPS · PERTE MOYENNE ${r.acpl == null ? "—" : r.acpl + " cp"}</div></div>`;
  }
  function animateReview(el) {
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    el.querySelectorAll("[data-count]").forEach((n) => {                        // compteurs animés
      const to = +n.dataset.count, dec = +(n.dataset.dec || 0), t0 = performance.now(), dur = 1800;
      (function f(now) { const k = Math.min(1, (now - t0) / dur); n.textContent = (to * ease(k)).toFixed(dec); if (k < 1) requestAnimationFrame(f); else n.textContent = to.toFixed(dec); })(t0);
    });
    requestAnimationFrame(() => requestAnimationFrame(() => {                   // anneaux de précision + barres de catégories
      el.querySelectorAll(".rv-ring .fg").forEach((c) => { const C = parseFloat(c.style.getPropertyValue("--c")); c.style.strokeDashoffset = (C * (1 - Math.min(100, +c.dataset.pct) / 100)).toFixed(1); });
      el.querySelectorAll(".rv-bar i").forEach((b) => (b.style.width = b.dataset.w + "%"));
    }));
  }
  function reviewNames() {                                                                                           // bilan : « VOUS » seulement si l'utilisateur a joué
    const st = S.st;
    if (st && st.over && SPECT(st.mode)) return { me: sideName(st, st.me).toUpperCase(), opp: sideName(st, st.me === "w" ? "b" : "w").toUpperCase() };
    return { me: "VOUS", opp: "E.N.O.S." };
  }
  function renderReview(rev, el, names) {
    names = names || { me: "VOUS", opp: "E.N.O.S." };
    if (!rev) { el.innerHTML = `<div class="rv-note">Review indisponible pour cette partie (enregistrée avant cette mise à jour).</div>`; return; }
    const max = Math.max(1, ...CATS.map((c) => Math.max(rev.me.counts[c[0]] || 0, rev.engine.counts[c[0]] || 0)));
    const bar = (k, n) => `<div class="rv-bar" style="--c:${catColor(k)}"><i data-w="${(100 * n / max).toFixed(0)}"></i><em>${n}</em></div>`;
    const rows = CATS.map(([k, label, col], i) => `<div class="rv-row" style="--c:${col};animation-delay:${(0.9 + i * 0.12).toFixed(2)}s"><img class="rv-bi" alt="" src="/static/badges/${k}.png"><span>${label}</span>${bar(k, rev.me.counts[k] || 0)}${bar(k, rev.engine.counts[k] || 0)}</div>`).join("");
    const crit = (rev.critical || []).map((m, i) => `<div style="animation-delay:${(1.6 + i * 0.15).toFixed(2)}s">${Math.ceil(m.n / 2)}. <b style="color:${catColor(m.key)}">${esc(m.san)}</b> — ${esc(m.label)} (−${m.loss} cp)${m.best ? " · il fallait jouer <b>" + esc(m.best) + "</b>" : ""}</div>`).join("");
    el.innerHTML = `<div class="rv-hero"><div class="rv-verdict">${verdict(rev)}</div><div class="rv-sub">BILAN DE LA PARTIE</div></div>
      <div class="rv-top">${ring(rev.me, esc(names.me), 0)}${ring(rev.engine, esc(names.opp), 0.25)}</div>
      <div class="rv-cats"><div class="rv-colh"><span></span><span></span><span>${esc(names.me)}</span><span>${esc(names.opp)}</span></div>${rows}</div>
      <div class="rv-graph"><div class="rv-lab">AVANTAGE AU FIL DE LA PARTIE (clair = Blancs) · points : brillants, erreurs et gaffes</div>${graphSvg(rev)}</div>
      ${crit ? `<div class="rv-crit rv-cats"><b>MOMENTS CRITIQUES</b>${crit}</div>` : ""}
      ${rev.confidence === "faible" ? `<div class="rv-note">Partie courte (moins de 8 coups) : l'Elo estimé est peu fiable.</div>` : ""}
      <div class="rv-note">Précision : chute de probabilité de gain (formule exponentielle). Elo estimé d'après la perte moyenne en centipions (indicatif).</div>`;
    animateReview(el);
  }
  async function showReview(rev) {
    $("cs-rev").hidden = false;
    $("cs-rbody").innerHTML = `<div class="rv" id="cs-rv"></div>`;
    try { rev = rev || await api("/api/chess/review"); } catch (e) { $("cs-rv").innerHTML = `<div class="rv-note">${esc(e.message)}</div>`; return; }
    $("cs-rsub").textContent = S.st && S.st.over ? S.st.over.toUpperCase() : "PARTIE EN COURS";
    renderReview(rev, $("cs-rv"), reviewNames());
  }
  $("cs-revbtn").onclick = () => showReview();
  $("cs-rclose").onclick = () => ($("cs-rev").hidden = true);

  // ---- historique des 10 dernières parties : liste + relecture coup par coup
  const H = { games: [], g: null, ply: 0, total: 0 };
  const DATE = (iso) => { const d = new Date(iso); return d.toLocaleDateString("fr-FR") + " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }); };
  async function drawHist() {
    if (!H.g) return;
    const p = await api(`/api/chess/history/${H.g.id}/position?ply=${H.ply}`);
    H.total = p.total; H.ply = p.ply;
    const flip = H.g.me === "b", el = $("cs-hboard"), last = p.last ? [p.last.slice(0, 2), p.last.slice(2, 4)] : [];
    el.innerHTML = "";
    for (let i = 0; i < 64; i++) {
      const row = Math.floor(i / 8), col = i % 8, r = flip ? row : 7 - row, c = flip ? 7 - col : col, name = sqName(c, r), pc = p.board[name];
      const d = document.createElement("div");
      d.className = "cs-sq" + ((r + c) % 2 ? " l" : "") + (last.includes(name) ? " last" : "");
      if (pc) d.insertAdjacentHTML("beforeend", `<span class="cs-p ${pc === pc.toUpperCase() ? "w" : "b"}">${GLYPH[pc.toLowerCase()]}</span>`);
      el.appendChild(d);
    }
    $("cs-hply").textContent = `${H.ply} / ${H.total}`;
    $("cs-hmoves").querySelectorAll("span").forEach((s) => s.classList.toggle("on", +s.dataset.p === H.ply));
  }
  function openGame(g) {
    H.g = g; H.ply = g.moves.length;
    $("cs-hview").hidden = false;
    renderReview(g.review, $("cs-hrev"));
    $("cs-hmoves").innerHTML = g.moves.map((m, i) => (i % 2 === 0 ? `<b>${i / 2 + 1}.</b> ` : "") + `<span data-p="${i + 1}">${esc(m)}</span>`).join(" ");
    $("cs-hlist").querySelectorAll(".cs-hrow").forEach((r) => r.classList.toggle("on", r.dataset.id === g.id));
    drawHist();
  }
  async function showHistory() {
    $("cs-hist").hidden = false; $("cs-hview").hidden = true; H.g = null;
    try {
      const r = await api("/api/chess/history"); H.games = r.games;
      $("cs-hcount").textContent = `${r.games.length} / ${r.max} PARTIES`;
      $("cs-hlist").innerHTML = r.games.length ? r.games.map((g) =>
        `<div class="cs-hrow" data-id="${g.id}"><b class="o-${g.outcome}">${g.outcome.toUpperCase()}</b><div>${esc(g.player)} (${g.me === "w" ? "Blancs" : "Noirs"}) vs E.N.O.S. ${g.elo} Elo<small>${DATE(g.date)} · ${g.n_moves} demi-coups${g.opening ? " · " + esc(g.opening) : ""}</small></div><span>${esc(g.result)}</span></div>`).join("")
        : `<div class="tm-empty">Aucune partie enregistrée pour le moment.</div>`;
      $("cs-hlist").querySelectorAll(".cs-hrow").forEach((el) => (el.onclick = () => openGame(H.games.find((g) => g.id === el.dataset.id))));
    } catch (e) { $("cs-hlist").innerHTML = `<div class="tm-empty">${esc(e.message)}</div>`; }
  }
  $("cs-hbtn").onclick = showHistory;
  $("cs-hclose").onclick = () => ($("cs-hist").hidden = true);
  $("cs-hfirst").onclick = () => { H.ply = 0; drawHist(); };
  $("cs-hprev").onclick = () => { H.ply = Math.max(0, H.ply - 1); drawHist(); };
  $("cs-hnext").onclick = () => { H.ply = Math.min(H.total, H.ply + 1); drawHist(); };
  $("cs-hlast").onclick = () => { H.ply = 1e6; drawHist(); };
  $("cs-hmoves").onclick = (e) => { const s = e.target.closest("span[data-p]"); if (s) { H.ply = +s.dataset.p; drawHist(); } };
  $("cs-hcopy").onclick = async () => { try { await navigator.clipboard.writeText(H.g.pgn); $("cs-hcopy").textContent = "COPIÉ ✓"; setTimeout(() => ($("cs-hcopy").textContent = "COPIER LE PGN"), 1500); } catch (e) {} };

  // ---- MISE EN CONDITION : plateau libre (E.N.O.S. et ETO « en sommeil »). On pose les pièces, on interroge ETO, puis on réveille l'un des deux pour jouer depuis cette position.
  const CD = { board: {}, turn: "w", castle: { K: 0, Q: 0, k: 0, q: 0 }, tool: "hand", sel: null, flip: false, hint: [], ok: false, over: "", timer: 0, asleep: 0, asking: false };
  const startBoard = () => { const b = {}; [..."abcdefgh"].forEach((f, i) => { b[f + "1"] = "RNBQKBNR"[i]; b[f + "2"] = "P"; b[f + "7"] = "p"; b[f + "8"] = "rnbqkbnr"[i]; }); return b; };
  const cdPos = () => ({ board: CD.board, turn: CD.turn, castling: Object.keys(CD.castle).filter((k) => CD.castle[k]).join(""), side: $("cd-side").value });
  const cdSave = () => { try { localStorage.setItem("enos_cd", JSON.stringify({ board: CD.board, turn: CD.turn, castle: CD.castle, flip: CD.flip })); } catch (e) {} };
  const cdMsg = (t, err) => { const m = $("cd-msg"); m.textContent = t || ""; m.classList.toggle("err", !!err); };
  function cdLoad() {
    try { const j = JSON.parse(localStorage.getItem("enos_cd")); if (j && j.board && typeof j.board === "object") { CD.board = j.board; CD.turn = j.turn === "b" ? "b" : "w"; CD.castle = { K: 0, Q: 0, k: 0, q: 0, ...(j.castle || {}) }; CD.flip = !!j.flip; } } catch (e) {}
  }
  function cdPalette() {
    const el = $("cd-pal"); if (el.childElementCount) return;
    const mk = (tool, inner, title) => `<button type="button" data-tool="${tool}" title="${title}">${inner}</button>`;
    el.innerHTML = mk("hand", '<span class="tx">DÉPLACER</span>', "Déplacer une pièce (clic sur la pièce, puis sur la case)") + mk("erase", '<span class="tx">GOMME</span>', "Retirer une pièce")
      + [..."KQRBNP"].map((p) => mk(p, `<span class="cs-p w">${GLYPH[p.toLowerCase()]}</span>`, "Poser une pièce blanche")).join("")
      + [..."kqrbnp"].map((p) => mk(p, `<span class="cs-p b">${GLYPH[p]}</span>`, "Poser une pièce noire")).join("");
    el.onclick = (e) => { const b = e.target.closest("button"); if (!b) return; CD.tool = b.dataset.tool; CD.sel = null; cdPaint(); };
  }
  function cdPaint() {
    $("cd-pal").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.tool === CD.tool));
    const el = $("cd-board"); el.innerHTML = "";
    for (let i = 0; i < 64; i++) {
      const row = Math.floor(i / 8), col = i % 8, r = CD.flip ? row : 7 - row, c = CD.flip ? 7 - col : col, name = sqName(c, r), p = CD.board[name];
      const d = document.createElement("div");
      d.className = "cs-sq" + ((r + c) % 2 ? " l" : "") + (CD.sel === name ? " sel" : "") + (CD.hint.includes(name) ? " last" : "");
      d.dataset.sq = name;
      if (col === 0) d.insertAdjacentHTML("beforeend", `<span class="co r">${r + 1}</span>`);
      if (row === 7) d.insertAdjacentHTML("beforeend", `<span class="co f">${"abcdefgh"[c]}</span>`);
      if (p) d.insertAdjacentHTML("beforeend", `<span class="cs-p ${p === p.toUpperCase() ? "w" : "b"}">${GLYPH[p.toLowerCase()]}</span>`);
      el.appendChild(d);
    }
    $("cd-turn").value = CD.turn;
    document.querySelectorAll("#cd .cd-castle input").forEach((b) => (b.checked = !!CD.castle[b.dataset.c]));
  }
  function cdChanged() { CD.hint = []; cdSave(); cdPaint(); clearTimeout(CD.timer); CD.timer = setTimeout(cdValidate, 120); }
  async function cdValidate() {
    try {
      const j = await post("/api/chess/setup/check", cdPos());
      CD.ok = !!j.ok; CD.over = j.over || "";
      if (!j.ok) cdMsg(j.error, true);
      else {
        CD.castle = { K: 0, Q: 0, k: 0, q: 0 }; [...j.castling].forEach((c) => (CD.castle[c] = 1)); cdPaint();      // un roque impossible est décoché
        cdMsg(j.over ? "Position terminée (" + j.over + ") : modifiez-la pour pouvoir jouer." : (j.opening ? "Ouverture reconnue : " + j.opening + ". " : "") + (j.check ? "Le roi au trait est en échec." : "Position valide."), !!j.over);
        if (j.over) CD.ok = false;
      }
    } catch (e) { CD.ok = false; cdMsg(e.message, true); }
    $("cd-call-enos").disabled = $("cd-call-eto").disabled = !CD.ok;
  }
  const cdPow = () => { const p = Math.max(1, Math.min(100, parseInt($("cd-pow").value, 10) || 100)); $("cd-powtxt").textContent = `Puissance : ${p} % (Équivalent : ${eloOf(p)}${p === 100 ? "+" : ""} Elo)`; return p; };
  function cdSleep() { for (const id of ["cd-enos", "cd-eto"]) { const c = $(id); c.className = "cd-card sleep"; c.querySelector("i").textContent = "💤 en sommeil"; } }
  function cdWake(id) { const c = $(id); c.className = "cd-card awake"; c.querySelector("i").textContent = "👁 éveillé"; }
  function openCond() {
    cdPalette(); if (!openCond.loaded) { cdLoad(); openCond.loaded = true; }
    $("df").hidden = true; $("cs").hidden = true; $("cd").hidden = false;
    $("cd-pow").value = $("cs-pow").value; cdPow(); cdSleep(); cdPaint(); cdValidate();
  }
  $("cd-board").addEventListener("click", (e) => {
    const q = e.target.closest(".cs-sq"); if (!q) return; const n = q.dataset.sq;
    if (CD.tool === "hand") {
      if (CD.sel && CD.sel !== n) { CD.board[n] = CD.board[CD.sel]; delete CD.board[CD.sel]; CD.sel = null; return cdChanged(); }
      CD.sel = CD.sel === n || !CD.board[n] ? null : n; return cdPaint();
    }
    if (CD.tool === "erase" || CD.board[n] === CD.tool) delete CD.board[n];
    else CD.board[n] = CD.tool;
    cdChanged();
  });
  $("cd-start").onclick = () => { CD.board = startBoard(); CD.turn = "w"; CD.castle = { K: 1, Q: 1, k: 1, q: 1 }; CD.sel = null; cdChanged(); };
  $("cd-clear").onclick = () => { CD.board = {}; CD.castle = { K: 0, Q: 0, k: 0, q: 0 }; CD.sel = null; cdChanged(); };
  $("cd-flip").onclick = () => { CD.flip = !CD.flip; cdSave(); cdPaint(); };
  $("cd-turn").onchange = () => { CD.turn = $("cd-turn").value; cdChanged(); };
  document.querySelectorAll("#cd .cd-castle input").forEach((b) => (b.onchange = () => { CD.castle[b.dataset.c] = b.checked ? 1 : 0; cdChanged(); }));
  $("cd-pow").addEventListener("input", cdPow);
  async function cdPlay() {
    const t = $("cd-moves").value.trim(); if (!t) return;
    try {
      const j = await post("/api/chess/setup/moves", { ...cdPos(), moves: t });
      CD.board = j.board; CD.turn = j.turn; CD.castle = { K: 0, Q: 0, k: 0, q: 0 }; [...j.castling].forEach((c) => (CD.castle[c] = 1));
      CD.sel = null; $("cd-moves").value = ""; cdChanged(); CD.hint = j.last ? [j.last.slice(0, 2), j.last.slice(2, 4)] : []; cdPaint();
    } catch (e) { cdMsg(e.message, true); }
  }
  $("cd-play").onclick = cdPlay;
  $("cd-moves").addEventListener("keydown", (e) => { if (e.key === "Enter") cdPlay(); });
  // question à ETO : Stockfish calcule les lignes, ETO les explique ; le meilleur coup est surligné sur le plateau
  async function cdAsk() {
    const q = $("cd-q").value.trim(); if (!q || CD.asking) return;
    if (!CD.ok) { cdMsg("Corrigez d'abord la position avant d'interroger ETO.", true); return; }
    CD.asking = true; $("cd-ask").disabled = true; cdWake("cd-eto");
    const log = $("cd-log"), dq = document.createElement("div"), da = document.createElement("div");
    dq.className = "q"; dq.textContent = "Vous : " + q; da.className = "a"; da.textContent = "ETO réfléchit…"; log.append(dq, da); log.scrollTop = 1e6;
    try {
      const r = await post("/api/chess/setup/ask", { ...cdPos(), question: q });
      da.textContent = r.text + (r.llm === false ? "  (LLM indisponible : analyse Stockfish simplifiée)" : "");
      const a = (r.arrows || [])[0]; CD.hint = a ? [a.from, a.to] : []; cdPaint(); $("cd-q").value = "";
      if ($("cd-voice").checked) { try { const v = await post("/api/chess/voice", { text: r.text, kind: "normal", persona: "eto" }); if (window.say) window.say(v.text, { audio: v.audio, who: "ETO" }); } catch (e) {} }
    } catch (e) { da.textContent = "✕ " + e.message; }
    log.scrollTop = 1e6; CD.asking = false; $("cd-ask").disabled = false;
    clearTimeout(CD.asleep); CD.asleep = setTimeout(() => { if ($("cd-eto").classList.contains("awake")) cdSleep(); }, 12000);
  }
  $("cd-ask").onclick = cdAsk;
  // réveil : la partie démarre depuis la position ; l'adversaire choisi joue la couleur demandée (s'il a le trait, il joue en premier)
  async function cdCall(who) {
    await cdValidate(); if (!CD.ok) return;
    let j; try { j = await post("/api/chess/setup/check", cdPos()); } catch (e) { return; }
    if (!j.ok) return;
    const player = $("cd-ai").value === "w" ? "b" : "w", pw = cdPow();
    cdWake(who === "eto" ? "cd-eto" : "cd-enos"); cdSave();
    try { localStorage.setItem("enos_chess_power", String(pw)); } catch (e) {}
    await sleep(700);
    $("cd").hidden = true; $("cs").hidden = false;
    loadThemes(); loadBoards(); loadVisual(); embedStart();
    try {
      const r = $("cs-mode").getBoundingClientRect(), o = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      if (who === "eto" && !ETO() && window.enosPersona) await window.enosPersona.set("eto", o);
      else if (who !== "eto" && ETO() && window.enosPersona) await window.enosPersona.set("enos", o);
    } catch (e) {}
    $("cs-mode").value = "enos"; paintMode(); $("cs-pow").value = pw; paintPower();
    SR.on = false; SR.paused = false; for (let i = 0; i < 100 && SR.running; i++) await sleep(100);
    $("cs-coach-log").innerHTML = ""; $("cs-judge").textContent = ""; CC.over = 0;
    await request(() => post("/api/chess/new", { color: player, power: pw, mode: "enos", elo: null, fen: j.fen }));
  }
  $("cd-call-enos").onclick = () => cdCall("enos");
  $("cd-call-eto").onclick = () => cdCall("eto");
  $("df-cond").onclick = () => { document.body.classList.remove("menu-open"); openCond(); };
  $("cd-close").onclick = () => { $("cd").hidden = true; $("df").hidden = false; };
  $("cs-cond").onclick = () => { SR.on = false; embedStop(); openCond(); };

  async function openChess() {
    loadThemes(); loadBoards(); loadVisual();
    embedStart();
    $("df").hidden = true; $("cs").hidden = false;
    // Rien ne démarre tout seul : ni nouvelle partie, ni reprise d'un speedrun / match Titans. Une partie encore en cours est AFFICHÉE en pause ; c'est l'utilisateur qui choisit.
    SR.on = false; TI.on = false;
    try {
      const s = await api("/api/chess/state");
      if (s.active) {
        S.st = s; render(); paintCoach();
        if ((s.mode === "speedrun" || isTi(s.mode)) && !s.over) {
          SR.paused = TI.paused = true; $("cs-sr-pause").textContent = "▶ REPRENDRE";
          $("cs-status").textContent = "Partie précédente en pause : ▶ REPRENDRE pour la continuer, ou lancez-en une nouvelle.";
        }
        return;
      }
    } catch (e) {}
    S.st = null; render(); paintCoach();
    $("cs-status").textContent = "Choisissez le mode, puis lancez : NOUVELLE PARTIE · BLANCS / NOIRS, ou ⚔ ORGANISER UN 1v1 E.N.O.S. VS ETO.";
  }

  $("b-df").onclick = () => { $("df").hidden = false; document.body.classList.remove("menu-open"); };
  $("df-close").onclick = () => ($("df").hidden = true);
  $("df-chess").onclick = openChess;
  $("cs-close").onclick = () => { SR.on = false; TI.on = false; tiRestore(); embedStop(); $("cs").hidden = true; $("df").hidden = false; };
  // ---- abandon : double confirmation (1er clic = « CONFIRMER ? »), puis moquerie vocale prédéfinie d'E.N.O.S.
  let resignT = 0;
  $("cs-resign").onclick = async () => {
    const b = $("cs-resign");
    if (!S.st || S.st.over) return;
    if (!resignT) { b.textContent = "CONFIRMER ?"; resignT = setTimeout(() => { resignT = 0; b.textContent = "ABANDONNER"; }, 3500); return; }
    clearTimeout(resignT); resignT = 0; b.textContent = "ABANDONNER";
    try { S.st = await post("/api/chess/resign"); S.sel = null; render(); announce(); }
    catch (e) { $("cs-status").textContent = "✕ " + e.message; }
  };
  $("cs-w").onclick = () => newGame("w");
  $("cs-b").onclick = () => newGame("b");
  $("cs-board").addEventListener("click", (e) => { const q = e.target.closest(".cs-sq"); if (q) pick(q.dataset.sq); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("cd").hidden) $("cd-close").click(); else if (!$("cs-rev").hidden) $("cs-rclose").click(); else if (!$("cs-hist").hidden) $("cs-hclose").click(); else if (!$("cs").hidden) $("cs-close").click(); else if (!$("df").hidden) $("df-close").click();
  });
})();
