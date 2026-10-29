"use strict";
// Réglages > GAMING : options de l'Œil (voix / bulle / saisie), Auto-Clipper, Babel Voice, Anti-Tilt Coach, bouton BRB.
// Tout est désactivé par défaut et ne tourne qu'après activation ici. Aucun texte venant du serveur n'est injecté en HTML (textContent / valeurs).
(() => {
  const $ = (id) => document.getElementById(id);
  async function api(path, body, method) {
    const r = await fetch(path, { method: method || (body !== undefined ? "POST" : "GET"), headers: body !== undefined ? { "Content-Type": "application/json" } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch (e) {}
    if (!r.ok) { const d = j && j.detail; throw new Error(typeof d === "string" ? d : "Erreur " + r.status); }
    return j;
  }
  const el = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    for (const k in (attrs || {})) { if (k === "text") e.textContent = attrs[k]; else if (k.startsWith("on")) e[k] = attrs[k]; else if (k in e) e[k] = attrs[k]; else e.setAttribute(k, attrs[k]); }
    kids.forEach((c) => c != null && e.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
    return e;
  };
  const toggle = (label, checked, onchange, id) => { const i = el("input", { type: "checkbox", checked: !!checked, onchange: () => onchange(i.checked) }); if (id) i.id = id; return el("label", { className: "ac-toggle" }, i, el("span", { text: label })); };
  const btn = (t, f) => el("button", { className: "btn sm", type: "button", text: t, onclick: f });
  const note = () => el("div", { className: "tm-note" });
  const say = (n, m) => { n.textContent = m; };
  const guard = (n, f) => async (...a) => { try { await f(...a); } catch (e) { say(n, e.message); } };

  function section(title, sub) { const c = el("div", { className: "tm-card friends-ok gm-card" }, el("h3", {}, title + " ", el("small", { text: sub }))); return c; }

  function petCard() {
    const c = section("ŒIL / ETO : ACCESSIBILITÉ", "voix · bulle · saisie"), n = note();
    api("/api/pet/options").then((o) => {
      const set = (k) => (v) => api("/api/pet/options", { [k]: v }).catch((e) => say(n, e.message));
      c.append(toggle("Voix de l'IA (désactivée : texte seul)", o.pet_voice, set("pet_voice")),
        toggle("Bulle de texte au-dessus de la tête quand l'IA commente (utile aux sourds et malentendants)", o.pet_bubble, set("pet_bubble")),
        toggle("Cliquer sur la tête ouvre une zone de saisie au lieu du micro (utile aux muets)", o.pet_typing, set("pet_typing")), n);
      say(n, "Ces options s'appliquent à l'Œil de bureau (Réglages > widget) dès qu'il est affiché.");
    }).catch(() => c.append(el("div", { className: "tm-note", text: "Indisponible dans cette édition." })));
    return c;
  }

  function lolCard() {
    const c = section("ASSISTANT LEAGUE OF LEGENDS", "lecture d'écran seule · conseils de l'Œil"), n = note(), st = el("div", { className: "tm-note" });
    api("/api/lol/status").then((o) => {
      const save = (k) => (v) => api("/api/lol/config", { [k]: v }).then((s) => paint(s)).catch((e) => say(n, e.message));
      const mode = el("select", { onchange: () => save("mode")(mode.value) }, el("option", { value: "text", text: "Conseils textuels silencieux (bulle au-dessus de l'Œil)" }), el("option", { value: "voice", text: "Conseils vocaux (voix + bulle)" }));
      mode.value = o.mode;
      const every = el("input", { type: "number", min: 10, max: 120, value: o.interval, style: "width:80px", onchange: () => save("interval")(+every.value) });
      const paint = (s) => say(st, (s.running ? (s.waiting ? "En attente de la partie…" : "Actif") : "Inactif") + " · " + s.frames + " captures, " + s.calls + " analyses" + (s.last_advice ? " · dernier conseil : " + s.last_advice : "") + (s.error ? " · " + s.error : ""));
      c.append(el("div", { className: "tm-note", text: "100 % lecture seule, comme Blitz ou Porofessor : l'Œil regarde uniquement les pixels de l'écran. Aucune lecture de la mémoire du jeu, aucune injection, aucun clic ni touche envoyés : c'est toi qui joues. Rien n'est capturé tant que la partie n'est pas lancée." }),
        toggle("Activer l'assistant (une capture réduite toutes les N secondes est envoyée à ton LLM de vision)", o.enabled, save("enabled")),
        el("div", { className: "tm-row" }, el("span", { text: "Mode des conseils" }), mode, el("span", { text: "Toutes les (s)" }), every),
        toggle("Attendre que League of Legends soit lancé avant de capturer", o.need_game, save("need_game")),
        el("div", { className: "tm-row" }, btn("ANALYSER MAINTENANT", guard(n, async () => { say(n, "Analyse en cours…"); const r = await api("/api/lol/analyse", {}); say(n, r.context && r.context.advice ? "Conseil : " + r.context.advice : "Rien à signaler."); paint(r); }))), st, n);
      paint(o); setInterval(() => { if (!document.hidden && $("rg") && !$("rg").hidden) api("/api/lol/status").then(paint).catch(() => {}); }, 5000);
    }).catch(() => c.append(el("div", { className: "tm-note", text: "Indisponible dans cette édition." })));
    return c;
  }

  function clipperCard() {
    const c = section("AUTO-CLIPPER IA", "moments forts → vertical 9:16"), n = note(), list = el("div"), st = el("div", { className: "tm-note" });
    const save = (k) => (v) => api("/api/clipper/config", { values: { [k]: v } }).then(refresh).catch((e) => say(n, e.message));
    async function refresh() {
      const s = await api("/api/clipper/status"); say(st, (s.running ? "Actif" : "Inactif") + (s.running ? " · score " + Math.round(s.score || 0) : "") + (s.queue ? " · " + s.queue + " en rendu" : "") + (s.errors && s.errors.length ? " · " + s.errors[s.errors.length - 1] : ""));
      const l = await api("/api/clipper/clips"); list.replaceChildren(...l.items.slice(0, 8).map((k) => el("div", { className: "tm-row" }, el("a", { href: "/api/clipper/file/" + encodeURIComponent(k.name), target: "_blank", text: k.name }), btn("SUPPRIMER", async () => { await api("/api/clipper/clips/" + encodeURIComponent(k.name), undefined, "DELETE"); refresh(); }))));
    }
    api("/api/clipper/config").then((o) => {
      const sens = el("input", { type: "range", min: 0, max: 100, value: o.clipper_sensitivity, onchange: () => save("clipper_sensitivity")(+sens.value) });
      const secs = el("input", { type: "number", min: 10, max: 60, value: o.clipper_seconds, style: "width:80px", onchange: () => save("clipper_seconds")(+secs.value) });
      const mode = el("select", { onchange: () => save("clipper_mode")(mode.value) }, el("option", { value: "fps", text: "Réticule au centre (FPS)" }), el("option", { value: "cursor", text: "Suivre le curseur" })); mode.value = o.clipper_mode;
      c.append(toggle("Activer l'Auto-Clipper (tampon de 40 s en mémoire : écran + audio, rien sur disque tant qu'un moment fort n'est pas détecté)", o.clipper_enabled, save("clipper_enabled")),
        el("div", { className: "tm-row" }, el("span", { text: "Sensibilité" }), sens, el("span", { text: "Durée (s)" }), secs, mode),
        toggle("Confirmer par vision IA (envoie jusqu'à 3 images au fournisseur LLM, 1 appel / 30 s)", o.clipper_vision_confirm, save("clipper_vision_confirm")),
        toggle("Incruster la webcam (une image) en bas du clip", o.clipper_webcam, save("clipper_webcam")),
        el("div", { className: "tm-row" }, btn("CLIPPER MAINTENANT", guard(n, async () => { const r = await api("/api/clipper/trigger", {}); say(n, r.ok ? "Clip en préparation…" : r.error || "Impossible."); refresh(); }))), st, n, list);
      refresh(); setInterval(() => { if (!document.hidden && $("rg") && !$("rg").hidden) refresh().catch(() => {}); }, 5000);
    }).catch(() => c.append(el("div", { className: "tm-note", text: "Indisponible dans cette édition." })));
    return c;
  }

  function babelCard() {
    const c = section("BABEL VOICE", "traduction vocale temps réel avec ta propre voix"), n = note(), st = el("div", { className: "tm-note" });
    const save = (k) => (v) => api("/api/babel/config", { values: { [k]: v } }).catch((e) => say(n, e.message));
    const poll = async () => { const s = await api("/api/babel/status"); say(st, (s.running ? "En marche" : "Arrêté") + (s.last_source ? " · « " + s.last_source + " » → « " + s.last_translated + " »" : "") + (s.latency_avg && s.latency_avg.total_ms ? " · latence moy. " + Math.round(s.latency_avg.total_ms) + " ms" : "") + (s.error ? " · " + s.error : "")); };
    Promise.all([api("/api/babel/config"), api("/api/babel/devices")]).then(([o, d]) => {
      const sel = (opts, val, key, lab) => { const s = el("select", { onchange: () => save(key)(s.value) }, ...opts.map(([v, t]) => el("option", { value: v, text: t }))); s.value = String(val == null ? "" : val); s.title = lab; return s; };
      const langs = (o.languages || []).map((l) => (Array.isArray(l) ? l : [l, l]));
      const outs = [["", "(sortie par défaut)"]].concat((d.outputs || []).map((x) => [x.name, x.name]));
      const voice = el("input", { type: "text", placeholder: "voice_id ElevenLabs de TON clone", value: o.babel_voice_id || "", style: "flex:2;min-width:200px", onchange: () => save("babel_voice_id")(voice.value.trim()) });
      const consent = el("input", { type: "checkbox" });
      const txt = el("input", { type: "text", placeholder: "Taper une phrase à dire (utile sans micro)", style: "flex:2;min-width:220px" });
      c.append(el("div", { className: "tm-row" }, el("span", { text: "Je parle" }), sel(langs.length ? langs : [["fr", "fr"]], o.babel_src, "babel_src"), el("span", { text: "→" }), sel(langs.length ? langs : [["en", "en"]], o.babel_dst, "babel_dst")),
        el("div", { className: "tm-row" }, el("span", { text: "Sortie (câble audio virtuel, ex. VB-Cable)" }), sel(outs, o.babel_out_device, "babel_out_device")),
        toggle("M'entendre aussi dans mon casque", o.babel_monitor, save("babel_monitor")),
        el("div", { className: "tm-row" }, voice, btn("MES VOIX", guard(n, async () => { const v = await api("/api/babel/voices"); say(n, v.items.map((x) => x.name + " : " + x.voice_id).join(" · ") || "Aucune voix."); }))),
        el("label", { className: "ac-toggle" }, consent, el("span", { text: "J'atteste que la voix clonée est la MIENNE (seule ma propre voix peut être clonée)" })),
        el("div", { className: "tm-row" }, btn("CRÉER MON CLONE (parle 45 s)", guard(n, async () => { say(n, "Enregistrement 45 s : parle naturellement…"); const r = await api("/api/babel/clone", { name: "Ma voix", seconds: 45, consent: consent.checked }); voice.value = r.voice_id; say(n, "Clone créé."); })),
          btn("DÉMARRER", guard(n, async () => { await api("/api/babel/start", {}); poll(); })), btn("ARRÊTER", guard(n, async () => { await api("/api/babel/stop", {}); poll(); }))),
        el("div", { className: "tm-row" }, txt, btn("DIRE", guard(n, async () => { const r = await api("/api/babel/say", { text: txt.value }); say(n, "→ " + r.translated); txt.value = ""; }))), st, n,
        el("div", { className: "tm-note", text: "Ton micro part vers Groq (transcription), le LLM (traduction) et ElevenLabs (voix). Rien n'est enregistré sur disque. Le jeu / Discord doit utiliser le câble virtuel comme micro." }));
      poll(); setInterval(() => { if (!document.hidden && $("rg") && !$("rg").hidden) poll().catch(() => {}); }, 4000);
    }).catch(() => c.append(el("div", { className: "tm-note", text: "Indisponible dans cette édition." })));
    return c;
  }

  function tiltCard() {
    const c = section("ANTI-TILT COACH", "souris · frappe · souffle"), n = note(), st = el("div", { className: "tm-note" }), rp = el("div");
    const save = (k) => (v) => api("/api/tilt/config", { values: { [k]: v } }).then(poll).catch((e) => say(n, e.message));
    async function poll() {
      const s = await api("/api/tilt/status"); say(st, (s.running ? "Actif" : "Inactif") + " · score " + s.score + " · étalonnage " + Math.round(s.calibration) + " %" + (s.last_intervention ? " · dernière : " + s.last_intervention.text : "") + (s.error ? " · " + s.error : ""));
      const r = await api("/api/tilt/replays"); rp.replaceChildren(...r.items.slice(0, 6).map((x) => el("div", { className: "tm-row" }, el("a", { href: "/api/tilt/replay/" + encodeURIComponent(x.name), target: "_blank", text: x.name }))));
    }
    api("/api/tilt/config").then((o) => {
      const thr = el("input", { type: "range", min: 30, max: 95, value: o.tilt_threshold, onchange: () => save("tilt_threshold")(+thr.value) });
      c.append(toggle("Activer (mesure des agrégats de souris / frappe / souffle EN LOCAL ; jamais quelles touches, jamais d'enregistrement audio, aucun hook système)", o.tilt_enabled, save("tilt_enabled")),
        el("div", { className: "tm-row" }, el("span", { text: "Seuil d'intervention" }), thr),
        toggle("Voix d'ETO (désactivée : texte seul / bulle)", o.tilt_voice, save("tilt_voice")), toggle("Afficher dans la bulle de l'Œil", o.tilt_bubble, save("tilt_bubble")),
        toggle("Micro : détecter soupirs et éclats", o.tilt_mic, save("tilt_mic")),
        toggle("Vision IA : expliquer la mort à partir d'UNE image du replay (envoyée au fournisseur LLM)", o.tilt_replay_vision, save("tilt_replay_vision")),
        toggle("Détecter automatiquement la mort (écran qui se désature / rougit)", o.tilt_death_detect, save("tilt_death_detect")),
        el("div", { className: "tm-row" }, btn("TESTER L'INTERVENTION", guard(n, async () => { const r = await api("/api/tilt/test", {}); say(n, r.text || "OK"); poll(); })),
          btn("JE VIENS DE MOURIR (REPLAY 5 s)", guard(n, async () => { const r = await api("/api/tilt/death", {}); say(n, r.ok ? "Replay en préparation…" : r.error || "Impossible (l'Auto-Clipper ou Anti-Tilt doit être actif)."); setTimeout(poll, 4000); })),
          btn("RÉINITIALISER L'ÉTALONNAGE", guard(n, async () => { await api("/api/tilt/reset", {}); poll(); }))), st, n, rp);
      poll(); setInterval(() => { if (!document.hidden && $("rg") && !$("rg").hidden) poll().catch(() => {}); }, 5000);
    }).catch(() => c.append(el("div", { className: "tm-note", text: "Indisponible dans cette édition." })));
    return c;
  }

  function brbCard() {
    const c = section("BOUTON BRB", "urgence : le livreur sonne"), n = note(), msg = el("input", { type: "text", placeholder: "Message pour tes coéquipiers (facultatif)", style: "flex:2;min-width:220px", maxLength: 200 });
    const mins = el("input", { type: "number", min: 0, max: 120, value: 5, style: "width:80px" });
    const poll = async () => { const s = await api("/api/brb/status"); say(n, s.active ? "BRB actif depuis " + Math.floor(s.elapsed / 60) + " min " + (s.elapsed % 60) + " s" : "Inactif."); };
    c.append(el("div", { className: "tm-row" }, msg, el("span", { text: "rappel (min)" }), mins),
      el("div", { className: "tm-row" }, btn("BRB !", guard(n, async () => { await api("/api/brb/start", { message: msg.value, minutes: +mins.value || 0 }); poll(); })), btn("JE SUIS DE RETOUR", guard(n, async () => { await api("/api/brb/back", {}); poll(); }))), n,
      el("div", { className: "tm-note", text: "Annonce ton absence (avec ta voix traduite si Babel Voice est actif) et lance un chrono. E.N.O.S. ne simule jamais le clavier ni la souris : ça contournerait la détection d'inactivité du jeu et risque le bannissement." }));
    poll().catch(() => {}); return c;
  }

  function build() {
    const p = document.querySelector('#rg [data-p="th"]');
    if (!p || $("gm-root")) return;
    const root = el("div", { id: "gm-root" }, el("h2", { text: "GAMING" }), petCard(), lolCard(), clipperCard(), babelCard(), tiltCard(), brbCard());
    p.appendChild(root);
  }
  function init() {
    const rg = $("rg"); if (!rg) return;
    const watch = () => { if (!rg.hidden) build(); };
    new MutationObserver(watch).observe(rg, { attributes: true, attributeFilter: ["hidden"] });
    watch();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
