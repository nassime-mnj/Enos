"use strict";
// CHAT BOX DES BOTS (Défis) : illustration + bulle de parole façon Chess.com + messagerie. Répliques PRÉ-ÉCRITES (data/bot_lines.js), aucune clé d'API requise ;
// avec une clé Groq, les moments forts (et tes messages, face à un seul bot) peuvent en plus passer par le LLM avec le style du personnage.
// Plusieurs bots peuvent parler dans la même partie (combats) : chaque côté a sa bannière, un transcript partagé réunit tout.
(() => {
  const E = window.ENOS, $ = E.$, esc = E.esc;
  const CH = {
    nasko: { name: "Nasko", img: "img/bots/nasko.png", style: "Tu es Nasko, 20 ans, étudiant en prépa/école d'ingé, joueur d'échecs amateur (Scandinave, Gambit Alien). Tu parles en français d'ado, ironique et un peu intello : « bg », « blud », « psk », « ct », « frr », « comme quoi », « doucement », des 😭😂, tu te moques de toi-même, tu parles d'accuracy et de « !! » ou tomate." },
    penoire: { name: "Nasko (pénoire)", img: "img/bots/penoire.png", style: "Tu es Nasko version « pénoire » : 2500 Elo, chasseur de coups brillants, très sûr de toi, taquin et arrogant mais jamais méchant. Tu parles en français d'ado comme Nasko : « bg », « blud », « doucement », « comme quoi », « rincé », « Super Nova vs Dying Ant », 😭😂." },
    lelex: { name: "Lelex", img: "img/bots/lelex.png", style: "Tu es Lelex, 20 ans, joueur d'échecs amateur. Tu parles en français d'ado, phrases très courtes, taquin : « XDDD », « vrm mdrr », « C'est réel », « Att att », « On va rire un peu », « Fraude sur fraude », « frérot », « la belle époque »." },
    eto: { name: "ETO Brillant", ph: ["ETO", "#1acfd6"], style: "Tu es ETO, présence zen, vive et chaleureuse, chasseur de sacrifices brillants. Phrases courtes, poétiques, en français." },
    enos: { name: "E.N.O.S.", ph: ["ENOS", "#e0243c"], style: "Tu es E.N.O.S., IA froide, précise et technique, un brin arrogante. Phrases courtes, en français." },
  };
  // probabilité qu'un événement déclenche une réplique ; les moments forts parlent toujours
  const PROB = { greet: 1, open_announce: 0.85, open_end: 0.7, open_refused: 1, bot_brilliant: 1, h_brilliant: 1, bot_blunder: 0.95, h_blunder: 0.95, bot_mistake: 0.5, h_mistake: 0.5, super: 0.8, good: 0.18, h_good: 0.2,
    check: 0.35, check_received: 0.35, frustration: 0.6, winning: 0.5, mate_coming: 1, mate_danger: 1, mate_win: 1, mate_lose: 1, draw: 1, resign_win: 1, chat: 0.14 };
  const STRONG = new Set(["greet", "open_announce", "open_end", "open_refused", "bot_brilliant", "h_brilliant", "bot_blunder", "h_blunder", "mate_coming", "mate_danger", "mate_win", "mate_lose", "draw", "resign_win"]);
  const END = new Set(["mate_win", "mate_lose", "draw", "resign_win"]);
  const MIN_GAP = 2;                                                  // demi-coups minimum entre deux répliques d'un même personnage (hors moments forts)
  const LLM_KINDS = new Set(["bot_brilliant", "bot_blunder", "h_brilliant", "h_blunder", "mate_win", "mate_lose"]);
  const LINES = () => window.ENOS_BOT_LINES || {};
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  let ALL = [], TR = null, ply = 0, lastSpoke = -1;                  // instances actives, transcript partagé, demi-coup courant, dernier demi-coup où quelqu'un a parlé
  const llmOn = () => E.ai && E.ai.configured && E.ai.configured() && E.settings.get("chess.comment", true);

  const avatar = (id, cls) => { const c = CH[id]; return c.img ? `<img class="bot-av ${cls || ""}" src="${c.img}" alt="${esc(c.name)}">` : `<div class="bot-av ph ${cls || ""}" style="--c:${c.ph[1]}">${esc(c.ph[0])}</div>`; };

  /**
   * Montre un personnage dans `host`. opts : {opp: () => nom de l'adversaire, ctx: () => ({summary}), log: historique + champ de saisie (face à un seul bot), shared: transcript partagé (combats)}.
   * Retourne l'instance ({say(kind, data), el}) ou null.
   */
  function mount(host, id, opts) {
    const c = CH[id];
    if (!c || !host) return null;
    opts = opts || {};
    const I = { id, host, opts, msgs: [], unread: 0, gap: 99, llm: 0, alive: true };
    host.hidden = false;
    host.innerHTML = `<div class="bot-banner">${avatar(id)}<div class="bot-bubble" hidden><small>${esc(c.name)}</small><span class="bot-t"></span></div>${opts.log || opts.shared ? `<button class="bot-chatbtn" aria-label="Chat">💬<i hidden></i></button>` : ""}</div>
      ${opts.log ? `<div class="bot-log" hidden><div class="bot-msgs"></div><form class="bot-in"><input type="text" maxlength="160" placeholder="Écris à ${esc(c.name)}…" enterkeyhint="send" autocomplete="off"><button type="submit" aria-label="Envoyer">➤</button></form></div>` : ""}`;
    const btn = host.querySelector(".bot-chatbtn");
    if (btn) btn.onclick = () => { const l = opts.shared ? TR && TR.host : host.querySelector(".bot-log"); if (!l) return; l.hidden = !l.hidden; if (!l.hidden) { I.unread = 0; badge(I); scroll(l); } };
    const form = host.querySelector(".bot-in");
    if (form) form.onsubmit = (e) => { e.preventDefault(); const i = form.querySelector("input"), t = i.value.trim(); if (t) { i.value = ""; userSays(I, t); } };
    I.say = (kind, d) => fire(I, kind, d);
    ALL.push(I);
    return I;
  }
  /** Transcript partagé des combats (tous les personnages, noms en tête). */
  function mountTranscript(host) { TR = { host, msgs: [] }; host.hidden = true; host.innerHTML = '<div class="bot-msgs"></div>'; }
  function unmountAll() {
    ALL.forEach((I) => { I.alive = false; if (I.host) { I.host.innerHTML = ""; I.host.hidden = true; } });
    if (TR && TR.host) { TR.host.innerHTML = ""; TR.host.hidden = true; }
    ALL = []; TR = null; ply = 0; lastSpoke = -1;
  }
  /** À appeler une fois par demi-coup joué : fait avancer les compteurs anti-bavardage. */
  function tick() { ply++; ALL.forEach((I) => I.gap++); }

  const badge = (I) => { const i = I.host.querySelector(".bot-chatbtn i"); if (i) { i.hidden = !I.unread; i.textContent = I.unread; } };
  const scroll = (box) => { const m = box && (box.querySelector(".bot-msgs") || box); if (m) m.scrollTop = m.scrollHeight; };
  function log(I, who, text) {
    const row = (name) => `<div class="bot-m ${who}">${name ? `<b>${esc(name)}</b> ` : ""}${esc(text)}</div>`;
    if (I.opts.log) {
      const m = I.host.querySelector(".bot-msgs");
      m.insertAdjacentHTML("beforeend", row(""));
      while (m.children.length > 40) m.firstChild.remove();
      scroll(m);
      if (who === "b" && I.host.querySelector(".bot-log").hidden) { I.unread++; badge(I); }
    }
    if (TR) {
      const m = TR.host.querySelector(".bot-msgs");
      m.insertAdjacentHTML("beforeend", row(who === "b" ? CH[I.id].name : ""));
      while (m.children.length > 60) m.firstChild.remove();
      scroll(m);
      if (who === "b" && TR.host.hidden) { ALL.filter((x) => x.opts.shared).forEach((x) => { x.unread++; badge(x); }); }
    }
  }

  const fmt = (t, I, d) => t.replace(/\{me\}/g, (I.opts.opp && I.opts.opp()) || (E.ai && E.ai.name && E.ai.name()) || "toi").replace(/\{san\}/g, (d && d.san) || "ce coup").replace(/\{open\}/g, (d && d.open) || "cette ouverture");

  /** Le personnage « tape » (3 points), puis la réplique apparaît dans la bulle et l'historique. */
  async function speak(I, text) {
    if (!I.alive || !text) return;
    const bub = I.host.querySelector(".bot-bubble"), t = I.host.querySelector(".bot-t"), av = I.host.querySelector(".bot-av");
    if (!bub) return;
    bub.hidden = false; t.innerHTML = '<span class="dots"><i></i><i></i><i></i></span>'; av.classList.add("talk");
    await E.sleep(350 + Math.min(800, text.length * 12));
    if (!I.alive) return;
    t.textContent = text; av.classList.remove("talk");
    bub.classList.remove("pop"); void bub.offsetWidth; bub.classList.add("pop");
    log(I, "b", text);
    I.gap = 0; lastSpoke = ply;
  }

  /** kind : voir data/bot_lines.js. d : {san, open}. Renvoie true si le personnage va parler. */
  function fire(I, kind, d) {
    if (!I || !I.alive) return false;
    const strong = STRONG.has(kind), p = PROB[kind] == null ? 0.2 : PROB[kind];
    if (!strong && I.gap <= MIN_GAP) return false;
    if (!strong && lastSpoke === ply) return false;                   // un seul bavard par demi-coup, sauf moment fort
    if (Math.random() > p) return false;
    const list = (LINES()[I.id] || {})[kind];
    if (!list || !list.length) return false;
    const local = fmt(pick(list), I, d);
    if (llmOn() && LLM_KINDS.has(kind) && !END.has(kind) && I.llm < 10 && !I.opts.shared && Math.random() < 0.5) {
      I.llm++;
      ask(I, `Événement : ${LABEL[kind]}${d && d.san ? " (coup " + d.san + ")" : ""}. Réagis en UNE phrase courte.`).then((t) => speak(I, t || local), () => speak(I, local));
      return true;
    }
    speak(I, local);
    return true;
  }
  const LABEL = { bot_brilliant: "tu viens de jouer un coup brillant", bot_blunder: "tu viens de faire une énorme gaffe", h_brilliant: "ton adversaire vient de jouer un coup brillant", h_blunder: "ton adversaire vient de faire une énorme gaffe" };

  async function ask(I, text) {
    const c = CH[I.id], x = (I.opts.ctx && I.opts.ctx()) || {};
    const sys = `${c.style} Tu joues une partie d'échecs contre ${(I.opts.opp && I.opts.opp()) || "ton ami"}. Réponds en UNE ou DEUX phrases très courtes, en français, dans ce style, sans insulte, sans markdown. Contexte : ${x.summary || "début de partie"}.`;
    const t = await E.ai.chat("enos", text, () => {}, { oneShot: true, system: sys });
    return String(t || "").replace(/\s+/g, " ").trim().slice(0, 200);
  }

  async function userSays(I, text) {
    log(I, "u", text);
    I.gap = 99;
    const L = LINES()[I.id] || {};
    const k = /\b(nul|nulle|mauvais|noob|ez|facile|fraude|forfait|600|joues mal)\b/i.test(text) ? "reply_insult" : /\b(gg|bravo|bien jou\w*|respect|bien vu|joli)\b/i.test(text) ? "reply_gg" : /\?/.test(text) ? "reply_q" : "reply";
    let out = null;
    if (llmOn() && I.llm < 14) { I.llm++; try { out = await ask(I, text); } catch (e) { out = null; } }
    if (!I.alive) return;
    speak(I, out || fmt(pick(L[k] || L.reply || ["…"]), I, {}));
  }

  /** Fin de partie : le vainqueur brille, le perdant se grise. winner : "w" | "b" | "" ; colorOf : instance -> couleur. */
  function result(winnerInst) { ALL.forEach((I) => { const a = I.host.querySelector(".bot-av"); if (a) { a.classList.toggle("win", I === winnerInst); a.classList.toggle("lose", !!winnerInst && I !== winnerInst); } }); }

  E.botChat = { has: (id) => !!CH[id], mount, mountTranscript, unmountAll, tick, result, avatar, bots: CH, count: () => ALL.length };
})();
