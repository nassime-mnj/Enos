"use strict";
// ETO — SA PENSÉE VISIBLE et LE « POURQUOI ? » DES GAFFES.
//   1. Pensée d'ETO (sous son portrait, pendant une partie contre lui) : à chaque coup, ses idées apparaissent (ses meilleurs candidats, analyse réelle) ;
//      une main hologramme bleue attrape chaque idée écartée et la jette dans une corbeille numérique (qui se remplit au fil de la partie),
//      jusqu'à ne garder que le coup joué.
//   2. « Pourquoi ? » sur une gaffe : de petites mains hologrammes (taille d'une pièce) attrapent la pièce jouée et refont ton coup sur le plateau,
//      puis jouent la meilleure réponse et la suite, pour montrer où ça mène ; puis elles ramènent la partie juste avant la gaffe et s'en vont.
(() => {
  const E = window.ENOS, esc = E.esc || ((s) => String(s));
  const FR = { K: "R", Q: "D", R: "T", B: "F", N: "C" }, fr = (san) => String(san || "").replace(/^[KQRBN]/, (x) => FR[x]).replace(/=([QRBN])/, (x, y) => "=" + FR[y]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }, NAME = { p: "un pion", n: "un cavalier", b: "un fou", r: "une tour", q: "ta dame", k: "ton roi" };
  // main hologramme (ouverte / fermée) : contour cyan, intérieur translucide
  const HAND = `<svg viewBox="0 0 64 64" class="eh-svg"><g class="open"><path d="M20 58c-6-5-10-12-10-20V26c0-2 2-4 4-4s4 2 4 4v8V12c0-2 2-4 4-4s4 2 4 4v18V8c0-2 2-4 4-4s4 2 4 4v22V12c0-2 2-4 4-4s4 2 4 4v26 0-10c0-2 2-4 4-4s4 2 4 4v14c0 10-6 18-14 20z"/></g>
    <g class="shut"><path d="M18 58c-6-4-9-11-9-18v-6c0-3 2-5 5-5h2v-5c0-3 2-5 5-5s5 2 5 5v-2c0-3 2-5 5-5s5 2 5 5v1c0-3 2-5 5-5s5 2 5 5v14c0 12-7 21-17 21z"/></g></svg>`;
  const mkHand = (host, size) => { const h = document.createElement("div"); h.className = "eh-hand"; h.style.width = h.style.height = size + "px"; h.innerHTML = HAND; host.appendChild(h); return h; };
  const moveTo = (h, x, y, ms) => h.animate([{ transform: getComputedStyle(h).transform === "none" ? `translate(${x}px,${y}px)` : getComputedStyle(h).transform }, { transform: `translate(${x}px,${y}px)` }], { duration: ms, easing: "cubic-bezier(.3,.7,.2,1)", fill: "forwards" }).finished.catch(() => {});

  // ================================================================== 1. PENSÉE D'ETO
  const M = (E.etoMind = { thrown: 0 });
  M.mount = (after) => {
    M.unmount(); if (!after) return null;
    const p = document.createElement("div"); p.className = "eto-mind"; p.id = "eto-mind";
    p.innerHTML = `<div class="em2-h"><b>PENSÉE D'ETO</b><span class="em2-st">En attente…</span><div class="em2-bin" title="Idées écartées"><i></i><span>0</span></div></div><div class="em2-ideas"></div>`;
    after.insertAdjacentElement("afterend", p); M.el = p; M.thrown = 0; return p;
  };
  M.unmount = () => { if (M.el) M.el.remove(); M.el = null; };
  /** ses idées sur la position (lignes MultiPV, du point de vue d'ETO) */
  M.show = (fen, lines) => {
    const p = M.el; if (!p) return; const box = p.querySelector(".em2-ideas"); box.innerHTML = ""; p.querySelector(".em2-st").textContent = "Il réfléchit…";
    const ch = new Chess(fen);
    (lines || []).slice(0, 5).forEach((l, i) => { let san = l.uci; try { const m = new Chess(fen).move({ from: l.uci.slice(0, 2), to: l.uci.slice(2, 4), promotion: l.uci[4] || "q" }); if (m) san = fr(m.san); } catch (e) { /* coup spécial */ }
      const ev = l.mate != null ? (l.mate > 0 ? "mat en " + l.mate : "mat contre lui") : ((l.cp || 0) / 100 > 0 ? "+" : "") + ((l.cp || 0) / 100).toFixed(1);
      const c = document.createElement("div"); c.className = "em2-idea"; c.dataset.u = l.uci.slice(0, 4); c.style.animationDelay = i * 90 + "ms"; c.innerHTML = `<b>${esc(san)}</b><small>${esc(ev)}</small>`; box.appendChild(c); });
    void ch;
  };
  /** il retient `uci` : la main jette toutes les autres idées à la corbeille, une par une */
  M.decide = async (fen, uci) => {
    const p = M.el; if (!p) return; const box = p.querySelector(".em2-ideas"), bin = p.querySelector(".em2-bin");
    let keep = [...box.children].find((c) => c.dataset.u === uci.slice(0, 4));
    if (!keep) { let san = uci; try { const m = new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || "q" }); if (m) san = fr(m.san); } catch (e) { /* rien */ }
      keep = document.createElement("div"); keep.className = "em2-idea new"; keep.dataset.u = uci.slice(0, 4); keep.innerHTML = `<b>${esc(san)}</b><small>intuition</small>`; box.prepend(keep); }
    const others = [...box.children].filter((c) => c !== keep); if (!others.length) { keep.classList.add("keep"); p.querySelector(".em2-st").textContent = "Décidé."; return; }
    const pr = p.getBoundingClientRect(), hand = mkHand(p, 34), rel = (el) => { const r = el.getBoundingClientRect(); return { x: r.left - pr.left + r.width / 2 - 17, y: r.top - pr.top + r.height / 2 - 17 }; };
    const start = rel(bin); hand.style.transform = `translate(${start.x}px,${start.y - 20}px)`; hand.classList.add("on");
    for (const c of others.reverse()) {
      if (!M.el) return; const a = rel(c); await moveTo(hand, a.x, a.y, 230); hand.classList.add("grab"); c.classList.add("held");
      const b = rel(bin), r0 = c.getBoundingClientRect(), dx = b.x + 17 - (r0.left - pr.left + r0.width / 2), dy = b.y + 17 - (r0.top - pr.top + r0.height / 2);
      c.animate([{ transform: "none", opacity: 1 }, { transform: `translate(${dx * 0.6}px,${dy * 0.6 - 18}px) rotate(-8deg) scale(.8)`, opacity: 1, offset: 0.6 }, { transform: `translate(${dx}px,${dy}px) scale(.15)`, opacity: 0 }], { duration: 380, easing: "ease-in", fill: "forwards" });
      await moveTo(hand, b.x, b.y - 6, 380); hand.classList.remove("grab"); c.remove(); M.thrown++;
      bin.classList.remove("eat"); void bin.offsetWidth; bin.classList.add("eat"); bin.querySelector("span").textContent = M.thrown;
    }
    keep.classList.add("keep"); p.querySelector(".em2-st").textContent = "Décidé."; hand.classList.remove("on"); setTimeout(() => hand.remove(), 300);
  };

  // ================================================================== 2. « POURQUOI ? »
  /**
   * o : { board (élément #df-board), render(fen, last) (affiche une position), before (FEN avant la gaffe), uci (la gaffe), after (FEN après),
   *       mover ('w'|'b' : le joueur qui a gaffé), say(texte) (légende) }  -> rejoue la gaffe, la réponse et la suite, puis revient avant la gaffe.
   */
  E.etoWhy = async (o) => {
    const board = o.board, host = document.createElement("div"); host.className = "eh-layer"; board.appendChild(host);
    const cap = document.createElement("div"); cap.className = "eh-cap"; board.appendChild(cap);
    const say = (t) => { cap.textContent = t; cap.classList.remove("on"); void cap.offsetWidth; cap.classList.add("on"); };
    const cell = board.getBoundingClientRect().width / 8, br = () => board.getBoundingClientRect();
    const at = (sq) => { const q = board.querySelector(`[data-sq="${sq}"]`), r = q.getBoundingClientRect(), b = br(); return { x: r.left - b.left, y: r.top - b.top }; };
    const hand = mkHand(host, cell * 1.05), hand2 = mkHand(host, cell * 1.05);
    hand.classList.add("on"); hand2.classList.add("on", "foe");
    hand.style.transform = `translate(${-cell}px,${cell * 8}px)`; hand2.style.transform = `translate(${cell * 8}px,${-cell}px)`;
    // la suite : la meilleure réponse et ce qui suit (analyse réelle de la position après la gaffe)
    let pv = []; try { const r = await E.chessLocal.analyse(o.after, { multipv: 1, movetime: 1100 }); pv = (r.lines[0] && r.lines[0].pv) || []; } catch (e) { pv = []; }
    const seq = [o.uci].concat(pv.slice(0, 5)), ch = new Chess(o.before), sanSeq = [];
    o.render(o.before, null); say("Regarde ce que fait ton coup…"); await sleep(700);
    const startMat = matOf(ch, o.mover);
    for (let i = 0; i < seq.length; i++) {
      const u = seq[i], mine = i % 2 === 0, H = mine ? hand : hand2, a = at(u.slice(0, 2)), b = at(u.slice(2, 4));
      await moveTo(H, a.x, a.y - cell * 0.15, i ? 340 : 520); H.classList.add("grab"); await sleep(120);
      const m = ch.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || "q" }); if (!m) break; sanSeq.push(fr(m.san));
      o.render(ch.fen(), [m.from, m.to]); await moveTo(H, b.x, b.y - cell * 0.15, 420); H.classList.remove("grab");
      say(i === 0 ? `Tu joues ${fr(m.san)}…` : i === 1 ? `Réponse : ${fr(m.san)}${m.captured ? ", qui prend " + NAME[m.captured] : ""}` : `puis ${fr(m.san)}`);
      if (ch.in_checkmate()) { say(`… et c'est mat (${sanSeq.join(" ")}).`); await sleep(1200); break; }
      await sleep(i === 0 ? 650 : 520);
    }
    const lost = startMat - matOf(ch, o.mover);
    if (!ch.in_checkmate()) say(lost >= 3 ? `Bilan : tu perds ${lostTxt(new Chess(o.before), ch, o.mover)}.` : "Bilan : ta position s'effondre."); await sleep(1500);
    // retour juste avant la gaffe ; les mains s'en vont
    say("On revient juste avant ton coup."); o.render(o.before, null); await sleep(500);
    [hand, hand2].forEach((h, k) => { h.classList.remove("grab"); moveTo(h, k ? cell * 9 : -cell * 2, -cell * 2, 600); h.classList.add("bye"); });
    await sleep(650); host.remove(); cap.classList.add("out"); setTimeout(() => cap.remove(), 400);
  };
  function matOf(ch, col) { let s = 0; ch.board().forEach((r) => r.forEach((p) => { if (p && p.color === col) s += VAL[p.type]; })); return s; }
  function lostTxt(a, b, col) {
    const cnt = (ch) => { const o = {}; ch.board().forEach((r) => r.forEach((p) => { if (p && p.color === col) o[p.type] = (o[p.type] || 0) + 1; })); return o; };
    const A = cnt(a), Bc = cnt(b), out = []; for (const t of ["q", "r", "b", "n", "p"]) { const d = (A[t] || 0) - (Bc[t] || 0); if (d > 0) out.push(d > 1 && t === "p" ? d + " pions" : NAME[t].replace("ta ", "ta ")); }
    return out.join(", ") || "du matériel";
  }
})();
