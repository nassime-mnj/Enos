"use strict";
// LOUP-GAROU : village en cercle autour du feu du conseil, nuit (lune, lucioles) et jour, cartes de rôle qui se retournent,
// débat où les bots parlent, accusent, se défendent et se dévoilent (vraie voyante ou loup qui bluffe), vote, potions de la sorcière, balle du chasseur.
// Salon mixte : joueurs humains et bots. Un seul humain : il voit ses infos en continu. Plusieurs humains : le téléphone passe de main en main la nuit (écran de passage) ; les bots parlent quand même au débat.
// Règles et cerveau des bots : js/games/loup_rules.js.
(() => {
  const E = window.ENOS, W = E.loup, esc = E.esc;
  if (!E.jeux || !W) return;
  const IMG = "img/games/loup/";
  const RULES = `<p>Les <b>loups-garous</b> se cachent parmi les villageois. Chaque nuit, ils dévorent quelqu'un. Chaque jour, le village débat puis vote pour éliminer un suspect.</p>
    <p><b>Voyante</b> : découvre un rôle chaque nuit. <b>Sorcière</b> : une potion de vie, une potion de mort. <b>Chasseur</b> : en mourant, il emporte quelqu'un.</p>
    <p>Le village gagne quand tous les loups sont morts. Les loups gagnent quand ils sont aussi nombreux que les autres.</p>`;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  E.jeux.register({
    id: "loup", title: "Loup-garou", sub: "Démasque les loups avant qu'il ne soit trop tard", hero: "img/games/common/card_loup.webp", min: 5, max: 10, rules: RULES,
    icon: '<path d="M5 20l2-9-3-6 5 3h6l5-3-3 6 2 9"/><path d="M9.5 13h.01M14.5 13h.01M10 17l2 1 2-1"/>',
    async start(host, setup, api) {
      const local = setup.players.filter((p) => p.human).length > 1;      // plusieurs humains sur le même téléphone
      // noms en double (même bot choisi deux fois) : on numérote
      const seen = {}; const players = setup.players.map((p) => { const k = p.name; seen[k] = (seen[k] || 0) + 1; return Object.assign({}, p, { name: seen[k] > 1 ? k + " " + seen[k] : k }); });
      const st = W.newGame(players), n = st.ps.length, me = local ? -1 : st.ps.findIndex((p) => p.human);
      if (me >= 0) st.ps.forEach((p) => { if (p.i !== me) p.sus[me] = 0.25 + st.rnd() * 0.2; });   // les bots ne savent pas qui est humain : on évite juste l'acharnement du 1er jour
      let alive = true, fast = false, view = me;            // view : joueur dont on montre les infos secrètes (bots : toi ; local : personne entre deux passages)
      const D = (ms) => wait(fast ? ms / 3 : ms);
      host.innerHTML = `<div class="lg-scene night" id="lg-scene"><div class="lg-bg"></div><div class="lg-flies">${Array.from({ length: 18 }, () => `<i style="--x:${Math.random() * 100}%;--y:${30 + Math.random() * 60}%;--d:${(4 + Math.random() * 6).toFixed(1)}s;--o:${(Math.random() * 4).toFixed(1)}s"></i>`).join("")}</div>
        <div class="lg-phase" id="lg-phase"><small></small><b></b></div>
        <div class="lg-ring" id="lg-ring"><div class="lg-fire"><i class="glow"></i><i class="log a"></i><i class="log b"></i><i class="fl f1"></i><i class="fl f2"></i><i class="fl f3"></i><i class="sp s1"></i><i class="sp s2"></i><i class="sp s3"></i></div></div>
        <div class="lg-timer" id="lg-timer" hidden><i></i><b></b></div><div class="lg-log" id="lg-log"></div><div class="lg-typing" id="lg-typing" hidden></div><div class="lg-act" id="lg-act"></div><button class="lg-fast" id="lg-fast">Vite</button><div class="lg-fx" id="lg-fx" hidden></div></div>`;
      const $ = (s) => host.querySelector(s), scene = $("#lg-scene"), ring = $("#lg-ring"), log = $("#lg-log"), act = $("#lg-act");
      $("#lg-fast").onclick = () => { fast = !fast; $("#lg-fast").classList.toggle("on", fast); };
      // ---------------------------------------------------------------- joueurs en cercle
      const pos = (i) => { const k = ((i - Math.max(0, me) + n) % n) / n, a = Math.PI / 2 + k * Math.PI * 2; return [50 + Math.cos(a) * 40, 46 + Math.sin(a) * 30]; };
      ring.insertAdjacentHTML("beforeend", st.ps.map((p) => { const [x, y] = pos(p.i); return `<button class="lg-p${p.i === me ? " me" : ""}" data-i="${p.i}" style="left:${x}%;top:${y}%">${p.img ? `<img src="${esc(p.img)}" alt="">` : `<span class="ph">${esc(p.name.slice(0, 2))}</span>`}<b>${esc(p.name)}</b><em></em></button>`; }).join(""));
      const tile = (i) => ring.querySelector(`.lg-p[data-i="${i}"]`);
      const paint = () => st.ps.forEach((p) => { const t = tile(p.i), v = view >= 0 ? st.ps[view] : null; t.classList.toggle("dead", !p.alive);
        const known = !p.alive || st.over || (v && (p.i === v.i || v.known[p.i])) ? (p.alive && v && v.known[p.i] === "good" && p.i !== v.i ? "good" : p.role) : null;
        t.classList.toggle("wolfmate", !!(v && v.role === "wolf" && p.role === "wolf" && p.i !== v.i && p.alive));
        t.querySelector("em").textContent = known === "good" ? "Innocent" : known ? W.ROLES[known].name : p.claim === "seer" ? "« voyante »" : ""; t.querySelector("em").className = known === "wolf" ? "w" : known ? "v" : p.claim ? "c" : ""; });
      const phase = (small, big, night) => { $("#lg-phase small").textContent = small; $("#lg-phase b").textContent = big; scene.classList.toggle("night", !!night); scene.classList.toggle("day", !night); };
      const bubble = (i, txt) => { const p = st.ps[i]; log.insertAdjacentHTML("beforeend", `<div class="lg-msg">${p.img ? `<img src="${esc(p.img)}" alt="">` : `<span class="ph">${esc(p.name.slice(0, 2))}</span>`}<p><b>${esc(p.name)}</b>${esc(txt)}</p></div>`); log.scrollTop = 1e6;
        const t = tile(i); if (t) { t.classList.add("talk"); setTimeout(() => t.classList.remove("talk"), 1400); } api.sfx("ui.click", { vol: 0.25, rate: 0.8 + Math.random() * 0.4 }); };
      // minuteur (débat, vote, actions de nuit)
      let timerStop = null, debating = false, curPick = null, speakQ = Promise.resolve();
      const stopTimer = () => { if (timerStop) timerStop(); };
      const countdown = (secs, label, onEnd) => { stopTimer(); const el = $("#lg-timer"), total = fast ? secs / 2 : secs, t0 = performance.now(); el.hidden = false;
        const tick = () => { const rem = Math.max(0, total - (performance.now() - t0) / 1000); el.querySelector("b").textContent = label + " · " + Math.ceil(rem) + " s"; el.querySelector("i").style.width = (rem / total) * 100 + "%"; el.classList.toggle("hot", rem < 10);
          if (rem <= 0) { stopTimer(); if (onEnd) onEnd(); } };
        const iv = setInterval(tick, 250); tick(); timerStop = () => { clearInterval(iv); el.hidden = true; timerStop = null; }; };
      const av = (p) => (p.img ? `<img src="${esc(p.img)}" alt="">` : `<span class="ph">${esc(p.name.slice(0, 2))}</span>`);
      /** un bot prend la parole : « X est en train d'écrire… » puis le message, et le temps de le lire. Une seule personne parle à la fois. */
      const say = (i, txt, o) => (speakQ = speakQ.then(async () => { o = o || {}; if (!alive || (!debating && !o.force)) return; const p = st.ps[i], ty = $("#lg-typing"), t = tile(i);
        if (!o.instant) { ty.hidden = false; ty.innerHTML = `${av(p)}<span><b>${esc(p.name)}</b> est en train d'écrire</span><i class="dots"><u></u><u></u><u></u></i>`; if (t) t.classList.add("typing");
          await D(Math.min(4200, 1200 + txt.length * 40)); ty.hidden = true; if (t) t.classList.remove("typing"); if (!alive || (!debating && !o.force)) return; }
        bubble(i, txt); await D(o.instant ? 600 : Math.min(5200, 1800 + txt.length * 30)); }));
      const narr = (txt) => { log.insertAdjacentHTML("beforeend", `<div class="lg-narr">${esc(txt)}</div>`); log.scrollTop = 1e6; };
      const fx = async (img, big, small, ms) => { const f = $("#lg-fx"); f.hidden = false; f.innerHTML = `<img src="${IMG}${img}.webp" alt=""><b>${esc(big)}</b>${small ? `<small>${esc(small)}</small>` : ""}`; f.classList.remove("in"); void f.offsetWidth; f.classList.add("in"); await D(ms || 1700); f.hidden = true; };
      /** carte de rôle qui se retourne ; resolve au bouton */
      const card = (role, title, btn) => new Promise((res) => { const R = W.ROLES[role], f = $("#lg-fx"); f.hidden = false; f.classList.remove("in");
        f.innerHTML = `<div class="lg-card"><div class="lg-flip"><div class="lg-back" style="background-image:url('${IMG}card_back.webp')"></div><div class="lg-front ${R.team}" style="background-image:url('${IMG}${R.img}.webp')"><small>${esc(title || "Ton rôle")}</small><b>${esc(R.name)}</b><p>${esc(R.desc)}</p></div></div></div><button class="btn pri" id="lg-ok">${esc(btn || "Compris")}</button>`;
        const flip = f.querySelector(".lg-flip"); setTimeout(() => flip.classList.add("on"), 250); api.sfx("card.fan", { vol: 0.6 }); f.querySelector("#lg-ok").onclick = () => { f.hidden = true; res(); }; });
      /** écran de passage (mode local) */
      const pass = (who) => new Promise((res) => { const f = $("#lg-fx"); f.hidden = false; f.classList.remove("in"); view = -1; paint();
        f.innerHTML = `<div class="lg-pass"><small>Passe le téléphone à</small><b>${esc(who)}</b><p>Les autres ferment les yeux.</p><button class="btn pri" id="lg-ok">C'est moi</button></div>`; f.querySelector("#lg-ok").onclick = () => { f.hidden = true; res(); }; });
      /** choix d'un joueur au toucher ; options : {filter, skip, title} */
      const pick = (title, filter, skip, secs) => new Promise((res) => {
        let sel = null, fin = false; const ok = st.ps.filter((p) => p.alive && filter(p)).map((p) => p.i);
        act.innerHTML = `<p>${esc(title)}</p><div class="row">${skip ? `<button class="btn" id="lg-skip">${esc(skip)}</button>` : ""}<button class="btn pri" id="lg-val" disabled>Valider</button></div>`;
        ok.forEach((i) => tile(i).classList.add("can"));
        const onTap = (e) => { const b = e.target.closest(".lg-p"); if (!b || !ok.includes(+b.dataset.i)) return; ring.querySelectorAll(".sel").forEach((x) => x.classList.remove("sel")); sel = +b.dataset.i; b.classList.add("sel"); act.querySelector("#lg-val").disabled = false; api.sfx("ui.click"); };
        ring.addEventListener("click", onTap);
        const done = (v) => { if (fin) return; fin = true; if (secs) stopTimer(); curPick = null; ring.removeEventListener("click", onTap); ring.querySelectorAll(".can,.sel").forEach((x) => x.classList.remove("can", "sel")); act.innerHTML = ""; res(v); };
        curPick = () => done(null);
        act.querySelector("#lg-val").onclick = () => done(sel); if (skip) act.querySelector("#lg-skip").onclick = () => done(null);
        if (secs) countdown(secs, "Temps", () => done(sel != null ? sel : skip || !ok.length ? null : ok[Math.floor(st.rnd() * ok.length)])); });
      const choice = (title, opts, secs, def) => new Promise((res) => { let fin = false; const end = (v) => { if (fin) return; fin = true; if (secs) stopTimer(); act.innerHTML = ""; res(v); }; if (secs) countdown(secs, "Temps", () => end(opts[def == null ? opts.length - 1 : def][0])); act.innerHTML = `<p>${esc(title)}</p><div class="lg-opts">${opts.map(([v, l, img], k) => `<button class="btn${k === 0 ? " pri" : ""}" data-k="${k}">${img ? `<img src="${IMG}${img}.webp" alt="">` : ""}${esc(l)}</button>`).join("")}</div>`;
        act.querySelectorAll("[data-k]").forEach((b) => (b.onclick = () => end(opts[+b.dataset.k][0]))); });
      const humanAlive = () => me >= 0 && st.ps[me].alive;
      const isHuman = (p) => !!p && !!p.human;
      // ---------------------------------------------------------------- nuit
      const kill = async (dead, why) => { for (const i of dead) { const p = st.ps[i]; paint(); tile(i).classList.add("die"); api.sfx("fx.stinger", { vol: 0.5 });
          await fx("fx_death", p.name + (why === "vote" ? " est éliminé" : " est mort"), W.ROLES[p.role].name, 1900); narr(`${p.name} était ${W.ROLES[p.role].name.toLowerCase()}.`);
          if (p.role === "hunter") await hunter(p); } paint(); };
      const hunter = async (h) => { let t;
        if (isHuman(h)) { if (local) await pass(h.name); view = h.i; paint(); t = await pick("Chasseur : sur qui tires-tu ta dernière balle ?", (q) => q.i !== h.i, null, 30); }
        else { await D(700); t = W.botHunter(st, h); }
        if (t == null) return; narr(`${h.name} tire sur ${st.ps[t].name} !`); api.sfx("flick.post", { vol: 0.9, rate: 0.5 }); st.ps[t].alive = false; await kill([t], "hunter"); };
      const night = async () => {
        st.day++; phase("Nuit " + st.day, "Le village s'endort", true); await fx("fx_moon_rise", "Nuit " + st.day, "Le village s'endort…", 1800); narr(`Nuit ${st.day}. Tout le monde ferme les yeux.`);
        // voyante
        const seer = W.alive(st).find((p) => p.role === "seer");
        if (seer) { if (isHuman(seer)) { if (local) await pass(seer.name); view = seer.i; paint(); const t = await pick("Voyante : choisis un joueur à sonder.", (q) => q.i !== seer.i && !seer.known[q.i], null, 40);
            if (t != null) { const role = W.see(st, seer.i, t); paint(); await card(role, st.ps[t].name + " est…", "Fermer les yeux"); } }
          else { const t = W.botSeer(st, seer); if (t) W.see(st, seer.i, t.i); await D(500); } }
        // loups
        const wolves = W.wolves(st); let victim = null;
        if (wolves.some(isHuman)) { const hw = wolves.find(isHuman); if (local) await pass(wolves.filter(isHuman).map((w) => w.name).join(" et ")); view = hw.i; paint();
          const mates = wolves.filter((w) => !isHuman(w)); if (mates.length) { const sug = W.botWolfTarget(st); narr(`${mates.map((w) => w.name).join(", ")} propose${mates.length > 1 ? "nt" : ""} : ${sug.name}.`); }
          victim = await pick("Loups : qui dévorez-vous cette nuit ?", (q) => q.role !== "wolf", null, 40); }
        else { victim = W.botWolfTarget(st).i; await D(600); }
        // sorcière
        const witch = W.alive(st).find((p) => p.role === "witch"); let wd = {};
        if (witch && (st.potions.life || st.potions.death)) {
          if (isHuman(witch)) { if (local) await pass(witch.name); view = witch.i; paint(); narr(`Les loups ont attaqué ${st.ps[victim].name}.`);
            if (st.potions.life) wd.save = (await choice(`Les loups ont attaqué ${st.ps[victim].name}. Tu le sauves ?`, [[true, "Potion de vie", "potion_life"], [false, "Non"]], 30));
            if (st.potions.death) { const k = await choice("Utiliser la potion de mort ?", [[false, "Pas cette nuit"], [true, "Empoisonner…", "potion_death"]], 30, 0); if (k) wd.kill = await pick("Qui empoisonnes-tu ?", (q) => q.i !== witch.i, "Annuler", 30); } }
          else { wd = W.botWitch(st, witch, victim); await D(500); } }
        if (local) view = -1;
        else view = me;
        // aube
        const dead = W.dawn(st, victim, wd);
        phase("Jour " + st.day, "Le village se réveille", false); await fx("fx_sun_rise", "Jour " + st.day, "Le village se réveille", 1600);
        if (!dead.length) narr(W.line(st, "dawnNone")); else await kill(dead, "night");
      };
      // ---------------------------------------------------------------- jour
      const talkBots = async () => {
        for (let round = 0; round < 2 && debating; round++) {
          const order = W.alive(st).filter((p) => !isHuman(p)).sort(() => st.rnd() - 0.5);
          for (const p of order) { if (!alive || !debating) return; if (!p.alive || (round && st.rnd() < 0.45)) continue;
            for (const a of W.botTalk(st, p)) { if (!debating) return;
              if (a.type === "accuse") { await say(p.i, W.line(st, "accuse", st.ps[a.to].name)); if (debating) W.accuse(st, p.i, a.to); if (debating && !isHuman(st.ps[a.to]) && st.rnd() < 0.5) await say(a.to, W.line(st, "accused")); }
              else if (a.type === "claim") { if (round && p.claim === "seer") continue; await say(p.i, W.line(st, a.wolf ? "claimWolf" : "claimGood", st.ps[a.to].name)); if (debating) { W.seerClaim(st, p.i, a.to, a.wolf); paint(); } }
              else if (a.type === "doubt") await say(p.i, W.line(st, "doubt", a.to != null ? st.ps[a.to].name : "quelqu'un"));
              else await say(p.i, W.line(st, a.type)); } } } };
      /** boutons de parole du joueur pendant le débat (en même temps que les bots) ; « Passer au vote » termine le débat */
      const humanTalk = (endDeb) => { let left = 2;
        const draw = () => { if (!debating) return; act.innerHTML = `<p>Débat : prends la parole ou passe au vote.</p><div class="lg-opts"><button class="btn" data-a="acc">Accuser…</button><button class="btn" data-a="vil">Je suis villageois</button><button class="btn" data-a="see">Je suis voyante…</button></div><button class="btn pri wide" data-a="vote">Passer au vote</button>`;
          act.querySelectorAll("[data-a]").forEach((b) => (b.onclick = async () => { const a = b.dataset.a; if (a === "vote") { act.innerHTML = ""; return endDeb(); }
            if (left <= 0) { api.toast("Tu as assez parlé pour aujourd'hui."); return; } left--;
            if (a === "acc") { const t = await pick("Qui accuses-tu ?", (q) => q.i !== me, "Annuler"); if (t != null && debating) { say(me, W.line(st, "accuse", st.ps[t].name), { instant: true }); W.accuse(st, me, t, 0.14); if (!isHuman(st.ps[t])) say(t, W.line(st, "accused")); } }
            else if (a === "vil") { say(me, W.line(st, "defend"), { instant: true }); W.alive(st).forEach((p) => { if (p.i !== me && p.role !== "wolf") p.sus[me] = Math.max(0.05, p.sus[me] - 0.06); }); }
            else { const t = await pick("Sur qui donnes-tu ton info ?", (q) => q.i !== me, "Annuler"); if (t != null && debating) { const wolf = await choice(`${st.ps[t].name} est…`, [[true, "Loup"], [false, "Innocent"]]); say(me, W.line(st, wolf ? "claimWolf" : "claimGood", st.ps[t].name), { instant: true }); W.seerClaim(st, me, t, wolf); paint();
                const real = W.alive(st).find((p) => p.role === "seer" && p.i !== me); if (real && real.alive && st.rnd() < 0.8) { say(real.i, "Menteur, c'est moi la voyante !"); W.alive(st).forEach((p) => { if (p.i !== real.i && p.role !== "wolf") p.sus[me] = Math.min(0.99, p.sus[me] + 0.25); }); } } }
            draw(); })); };
        draw(); };
      const day = async () => {
        if (W.winner(st)) return;
        narr("Le débat commence."); debating = true;
        let endDeb; const debEnd = new Promise((r) => (endDeb = r));
        const nAlive = W.alive(st).length;
        countdown(local ? 150 : Math.min(130, 50 + nAlive * 9), "Débat", () => endDeb());
        if (local) { act.innerHTML = `<p>Débattez à voix haute, puis passez au vote.</p><button class="btn pri wide" id="lg-go">Passer au vote</button>`; act.querySelector("#lg-go").onclick = () => endDeb(); talkBots(); }
        else { talkBots().then(() => { if (!humanAlive()) endDeb(); }); if (humanAlive()) humanTalk(endDeb); }
        await debEnd; debating = false; stopTimer(); if (curPick) curPick(); act.innerHTML = ""; $("#lg-typing").hidden = true;
        await speakQ; if (!alive) return;
        phase("Jour " + st.day, "Le vote", false); await fx("fx_vote", "Le vote", "Le village désigne un suspect", 1300);
        const votes = {};
        if (local) { for (const h of W.alive(st).filter(isHuman)) { const t = await pick(`Vote de ${h.name} : qui élimines-tu ?`, (q) => q.i !== h.i, "S'abstenir", 40); if (t != null) { votes[h.i] = t; narr(`${h.name} vote contre ${st.ps[t].name}.`); } }
          for (const p of W.alive(st).filter((q) => !isHuman(q))) { votes[p.i] = W.botVote(st, p); await D(800); narr(`${p.name} vote contre ${st.ps[votes[p.i]].name}.`); } }
        else { if (humanAlive()) votes[me] = await pick("Ton vote : qui élimines-tu ?", (q) => q.i !== me, "Je m'abstiens", 30);
          for (const p of W.alive(st).filter((q) => q.i !== me)) { votes[p.i] = W.botVote(st, p); await D(800); narr(`${p.name} vote contre ${st.ps[votes[p.i]].name}.`); } }
        const t = W.tally(votes);
        if (t.top == null) { narr("Égalité : personne n'est éliminé aujourd'hui."); await D(1500); return; }
        await say(t.top, W.line(st, "lastWords"), { force: true });
        st.ps[t.top].alive = false; W.learnFromVote(st, votes, t.top); await kill([t.top], "vote");
      };
      // ---------------------------------------------------------------- partie
      const run = async () => {
        phase("Préparation", "Distribution des rôles", true); await D(500);
        if (local) { for (const p of st.ps.filter(isHuman)) { await pass(p.name); view = p.i; paint(); await card(p.role, p.name + ", ton rôle", "Cacher ma carte"); view = -1; paint(); } }
        else { view = me; paint(); await card(st.ps[me].role, "Ton rôle"); const mates = W.wolves(st).filter((w) => w.i !== me); if (st.ps[me].role === "wolf" && mates.length) narr(`Ton complice : ${mates.map((w) => w.name).join(", ")}.`); }
        while (alive && !W.winner(st) && st.day < 30) { await night(); if (!alive || W.winner(st)) break; await day(); }
        if (!alive) return;
        const win = W.winner(st) || "wolf"; st.over = win; view = me; paint();
        phase("Fin", win === "village" ? "Le village a gagné" : "Les loups ont gagné", win !== "village");
        await fx(win === "village" ? "fx_sun_rise" : "fx_moon_rise", win === "village" ? "Le village gagne" : "Les loups gagnent", st.ps.filter((p) => p.role === "wolf").map((p) => p.name).join(", ") + (W.deck(n).filter((r) => r === "wolf").length > 1 ? " étaient les loups" : " était le loup"), 2200);
        const team = (p) => (p.role === "wolf" ? "wolf" : "village"), winner = !local && me >= 0 && team(st.ps[me]) === win ? me : st.ps.findIndex((p) => team(p) === win);
        api.end(winner, (win === "village" ? "Le village gagne. " : "Les loups gagnent. ") + "Rôles : " + st.ps.map((p) => p.name + " " + W.ROLES[p.role].name.toLowerCase()).join(", ") + ".");
      };
      run().catch((e) => { if (alive) host.insertAdjacentHTML("beforeend", `<p class="pl-err">${esc(e.message || String(e))}</p>`); });
      return { destroy: () => { alive = false; stopTimer(); }, _st: () => st, _me: () => me, _fast: () => { fast = true; } };
    },
  });
})();
