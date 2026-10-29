"use strict";
// CHAT BOX DES BOTS NASKO / LELEX (Défis) : illustration en haut, bulle de parole façon Chess.com, et une petite messagerie (historique + champ pour leur répondre).
// Les répliques sont écrites à la main dans leur façon de parler (data/bot_lines.js) ; si une clé Groq est configurée, les moments forts et tes messages passent par le LLM
// avec quelques exemples de leur style (une phrase courte, toujours en français, sans insulte).
(() => {
  const E = window.ENOS, $ = E.$, esc = E.esc;
  const BOTS = {
    nasko: { name: "Nasko", img: "img/bots/nasko.png", style: "Tu es Nasko, 20 ans, étudiant en prépa/école d'ingé, joueur d'échecs amateur (Scandinave, Gambit Alien). Tu parles en français d'ado, ironique et un peu intello : « bg », « blud », « psk », « ct », « frr », « comme quoi », « doucement », des 😭😂, tu te moques de toi-même, tu parles d'accuracy et de « !! » ou tomate." },
    lelex: { name: "Lelex", img: "img/bots/lelex.png", style: "Tu es Lelex, 20 ans, joueur d'échecs amateur. Tu parles en français d'ado, phrases très courtes, taquin : « XDDD », « vrm mdrr », « C'est réel », « Att att », « On va rire un peu », « Fraude sur fraude », « frérot », « la belle époque »." },
  };
  const LINES = () => window.ENOS_BOT_LINES || {};
  // probabilité qu'un événement déclenche une réplique (les moments forts parlent toujours)
  const PROB = { greet: 1, bot_brilliant: 1, bot_blunder: 0.9, h_brilliant: 1, h_blunder: 0.9, mate_win: 1, mate_lose: 1, draw: 1, resign_win: 1, bot_mistake: 0.5, h_mistake: 0.5, h_good: 0.22, good: 0.2, check: 0.3, chat: 0.12 };
  const MIN_GAP = 2;                                                  // demi-coups minimum entre deux répliques (hors fin de partie et moments forts)
  const STRONG = new Set(["greet", "bot_brilliant", "h_brilliant", "mate_win", "mate_lose", "draw", "resign_win", "bot_blunder", "h_blunder"]);
  let S = null;                                                       // {id, host, ctx, msgs, unread, gap, busy, llmCalls}

  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const fmt = (t, d) => t.replace(/\{me\}/g, (E.ai && E.ai.name && E.ai.name()) || "toi").replace(/\{san\}/g, (d && d.san) || "ce coup");
  const llmOn = () => E.ai && E.ai.configured() && E.settings.get("chess.comment", true);

  function mount(host, id, ctx) {
    unmount();
    const b = BOTS[id];
    if (!b || !host) return;
    S = { id, host, ctx: ctx || (() => ({})), msgs: [], unread: 0, gap: 99, busy: 0, llmCalls: 0 };
    host.hidden = false;
    host.innerHTML = `<div class="bot-banner"><img class="bot-av" src="${b.img}" alt="${esc(b.name)}"><div class="bot-bubble"><small>${esc(b.name)}</small><span class="bot-t"></span></div><button class="bot-chatbtn" aria-label="Chat avec ${esc(b.name)}">💬<i hidden></i></button></div>
      <div class="bot-log" hidden><div class="bot-msgs"></div><form class="bot-in"><input type="text" maxlength="160" placeholder="Écris à ${esc(b.name)}…" enterkeyhint="send" autocomplete="off"><button type="submit" aria-label="Envoyer">➤</button></form></div>`;
    host.querySelector(".bot-chatbtn").onclick = () => { const l = host.querySelector(".bot-log"); l.hidden = !l.hidden; if (!l.hidden) { S.unread = 0; badge(); scroll(); } };
    host.querySelector(".bot-in").onsubmit = (e) => { e.preventDefault(); const i = host.querySelector(".bot-in input"), t = i.value.trim(); if (t) { i.value = ""; userSays(t); } };
    host.querySelector(".bot-bubble").hidden = true;
    event("greet");
  }
  function unmount() { if (S && S.host) { S.host.innerHTML = ""; S.host.hidden = true; } S = null; }

  const badge = () => { if (!S) return; const i = S.host.querySelector(".bot-chatbtn i"); i.hidden = !S.unread; i.textContent = S.unread; };
  const scroll = () => { const m = S && S.host.querySelector(".bot-msgs"); if (m) m.scrollTop = m.scrollHeight; };
  function log(who, text) {
    if (!S) return;
    S.msgs.push({ who, text });
    const m = S.host.querySelector(".bot-msgs");
    m.insertAdjacentHTML("beforeend", `<div class="bot-m ${who}">${esc(text)}</div>`);
    while (m.children.length > 40) m.firstChild.remove();
    scroll();
    if (who === "b" && S.host.querySelector(".bot-log").hidden) { S.unread++; badge(); }
  }

  /** Le bot « tape » (3 points) puis affiche sa réplique dans la bulle et l'historique. */
  async function speak(text) {
    const s = S;
    if (!s || !text) return;
    const bub = s.host.querySelector(".bot-bubble"), t = s.host.querySelector(".bot-t"), av = s.host.querySelector(".bot-av");
    bub.hidden = false; t.innerHTML = '<span class="dots"><i></i><i></i><i></i></span>'; av.classList.add("talk");
    await E.sleep(450 + Math.min(900, text.length * 14));
    if (S !== s) return;
    t.textContent = text; av.classList.remove("talk");
    log("b", text);
    s.gap = 0;
  }

  /** kind : greet, chat, good, bot_brilliant, bot_blunder, bot_mistake, h_good, h_brilliant, h_blunder, h_mistake, check, mate_win, mate_lose, draw, resign_win. d : {san}. */
  function event(kind, d) {
    if (!S) return;
    S.gap++;
    const p = PROB[kind] == null ? 0.2 : PROB[kind];
    if (!STRONG.has(kind) && S.gap <= MIN_GAP) return;
    if (STRONG.has(kind) && kind !== "greet" && S.gap < 1) return;
    if (Math.random() > p) return;
    const list = (LINES()[S.id] || {})[kind];
    if (!list || !list.length) return;
    const local = fmt(pick(list), d);
    if (llmOn() && S.llmCalls < 14 && ["bot_brilliant", "bot_blunder", "h_brilliant", "h_blunder", "mate_win", "mate_lose"].includes(kind) && Math.random() < 0.6) {
      S.llmCalls++;
      const id = S.id, s = S;
      ask(`Événement : ${LABEL[kind]}${d && d.san ? " (coup " + d.san + ")" : ""}. Réagis en UNE phrase courte.`).then((t) => { if (S === s) speak(t || local); }, () => { if (S === s) speak(local); });
      return;
    }
    speak(local);
  }
  const LABEL = { bot_brilliant: "tu viens de jouer un coup brillant", bot_blunder: "tu viens de faire une énorme gaffe", h_brilliant: "ton adversaire vient de jouer un coup brillant", h_blunder: "ton adversaire vient de faire une énorme gaffe", mate_win: "tu viens de mater ton adversaire", mate_lose: "tu viens de te faire mater" };

  async function ask(text) {
    const b = BOTS[S.id], c = (S.ctx && S.ctx()) || {};
    const sys = `${b.style} Tu joues une partie d'échecs contre ${(E.ai && E.ai.name && E.ai.name()) || "ton ami"}. Réponds en UNE ou DEUX phrases très courtes, en français, dans ce style, sans insulte, sans markdown. Contexte : ${c.summary || "début de partie"}.`;
    const t = await E.ai.chat("enos", text, () => {}, { oneShot: true, system: sys });
    return String(t || "").replace(/\s+/g, " ").trim().slice(0, 200);
  }

  async function userSays(text) {
    const s = S;
    if (!s) return;
    log("u", text);
    s.gap = 99;
    const L = LINES()[s.id] || {};
    const k = /\b(nul|nulle|mauvais|noob|ez|facile|fraude|forfait|600|joues mal)\b/i.test(text) ? "reply_insult" : /\b(gg|bravo|bien jou\w*|respect|bien vu|joli)\b/i.test(text) ? "reply_gg" : /\?/.test(text) ? "reply_q" : "reply";
    let out = null;
    if (llmOn() && s.llmCalls < 14) { s.llmCalls++; try { out = await ask(text); } catch (e) { out = null; } }
    if (S !== s) return;
    speak(out || fmt(pick(L[k] || L.reply || ["…"]), {}));
  }

  E.botChat = { has: (id) => !!BOTS[id], mount, unmount, event, bots: BOTS };
})();
