"use strict";
// Assistant de premier démarrage : une étape par réglage manquant, « Valider » (test réel côté serveur) ou « Passer » (à faire plus tard dans les réglages).
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  async function api(path, body, method) {
    const r = await fetch(path, { method: method || (body !== undefined ? "POST" : "GET"), headers: body !== undefined ? { "Content-Type": "application/json" } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error((j && j.detail) || "Erreur " + r.status);
    return j;
  }
  const secret = (id, label, ph) => `<div class="ob-f"><label for="${id}">${label}</label><div class="ob-in"><input id="${id}" type="password" placeholder="${ph || ""}" autocomplete="off" spellcheck="false"><button type="button" class="ob-b sm ghost" data-eye="${id}">VOIR</button></div></div>`;

  // Chaque étape : id (= clé de /api/onboarding/state), titre, rendu HTML, hooks. `validate()` retourne un message de réussite ou lève une Error.
  const STEPS = [
    { id: "welcome", title: "Initialisation", kicker: "Bienvenue", html: () => `<h2>Salut, on configure ton E.N.O.S.</h2><p class="ob-p">Cet assistant va <b>tester et enregistrer</b> tes clés et tes liens, étape par étape. Rien ne part ailleurs que vers les services concernés : tout reste sur <b>ce PC</b>. Chaque étape est facultative : <b>PASSER</b> et tu la retrouveras plus tard.</p>
        <div class="ob-f"><label for="ob-name">Comment dois-je t'appeler ?</label><div class="ob-in"><input id="ob-name" type="text" maxlength="30" placeholder="Ton prénom" autocomplete="off"></div></div>`, primary: "COMMENCER",
      async validate() { await api("/api/onboarding/name", { name: $("ob-name").value }); return { msg: "Enchanté." }; } },
    ...["enos", "eto"].map((p) => ({
      id: "eleven_" + p, title: p === "enos" ? "Voix E.N.O.S." : "Voix ETO", kicker: "ElevenLabs",
      html: () => `<h2>Clé ElevenLabs · voix ${p === "enos" ? "E.N.O.S." : "ETO"}</h2><p class="ob-p">${p === "enos" ? "C'est la voix principale de l'assistant." : "ETO est la personnalité zen : <b>sa propre clé et sa propre voix</b> (tu peux réutiliser la même clé)."}</p>
        <div class="ob-note">Crée-la sur <code>elevenlabs.io</code> → ton profil → <b>API Keys</b>. Une voix doit exister dans ton compte (onglet <b>Voices</b>).</div>
        ${secret("ob-key", "Clé API ElevenLabs", "sk_…")}<div class="ob-f" id="ob-voicebox" hidden><label for="ob-voice">Voix à utiliser</label><select id="ob-voice"></select></div>`,
      primary: "TESTER LA CLÉ",
      async validate(ctx) {
        const key = $("ob-key").value.trim();
        if (!ctx.voicesFor || ctx.voicesFor !== key) {                      // phase 1 : tester la clé et lister les voix
          const r = await api("/api/onboarding/eleven/voices", { key });
          $("ob-voice").innerHTML = r.voices.map((v) => `<option value="${esc(v.id)}">${esc(v.name)}${v.cat ? " · " + esc(v.cat) : ""}</option>`).join("");
          $("ob-voicebox").hidden = false; ctx.voicesFor = key; $("ob-go").textContent = "ENREGISTRER";
          return { stay: true, msg: `Clé valide · ${r.voices.length} voix trouvée(s). Choisis-en une puis enregistre.` };
        }
        const r = await api("/api/onboarding/eleven/save", { key, persona: p, voice_id: $("ob-voice").value });
        return { msg: `Voix « ${r.voice} » enregistrée.` };
      },
    })),
    { id: "groq", title: "Cerveau IA", kicker: "Groq", html: () => `<h2>Clé API Groq</h2><p class="ob-p">Le cerveau d'E.N.O.S. : réponses du chat, alertes de l'IA proactive, dictée vocale. Gratuit à l'usage normal.</p>
        <div class="ob-note">Crée-la sur <code>console.groq.com</code> → <b>API Keys</b> (elle commence par <code>gsk_</code>).</div>${secret("ob-key", "Clé API Groq", "gsk_…")}`,
      primary: "VALIDER", async validate() { const r = await api("/api/onboarding/groq", { key: $("ob-key").value.trim() }); return { msg: "Groq connecté · modèle " + r.model }; } },
    { id: "agenda", title: "Agenda", kicker: "Zeus · Moodle", html: () => `<h2>Liens d'export de l'agenda</h2><p class="ob-p">E.N.O.S. lira ton emploi du temps et tes rendus pour te prévenir <b>avant</b> les échéances.</p>
        <div class="ob-note"><b>Zeus</b> : Mon planning → Exporter (lien .ics). <b>Moodle</b> : Calendrier → Importer ou exporter → Exporter → copier l'URL. Un seul des deux suffit.</div>
        ${secret("ob-zeus", "Lien Zeus (.ics)", "https://…")}${secret("ob-moodle", "Lien Moodle (.ics)", "https://…")}`,
      primary: "VALIDER", async validate() { const r = await api("/api/onboarding/agenda", { zeus: $("ob-zeus").value, moodle: $("ob-moodle").value }); return { msg: Object.entries(r).map(([k, n]) => `${k} : ${n} événements lus`).join(" · ") }; } },
    { id: "godot", title: "Projet Godot", kicker: "Synchronisation", html: () => `<h2>Dossier du projet Godot</h2><p class="ob-p">Le dossier cible pour la synchronisation du projet (celui qui contient <b>project.godot</b>). Il pourra être vide : le projet s'y clonera.</p>
        <div class="ob-f"><label for="ob-dir">Dossier</label><div class="ob-in"><input id="ob-dir" type="text" placeholder="C:\\Projets_Godot\\MonJeu" spellcheck="false"><button type="button" class="ob-b sm" id="ob-browse">PARCOURIR</button></div></div>`,
      primary: "VALIDER", hook() { $("ob-browse").onclick = async () => { try { const r = await api("/api/projects/browse", {}); if (r.path) $("ob-dir").value = r.path; else if (r.error) msg(r.error, "bad"); } catch (e) { msg(e.message, "bad"); } }; },
      async validate() { const p = $("ob-dir").value.trim(); if (!p) throw new Error("Indique un dossier."); await api("/api/projects", { path: p, create: true }); return { msg: "Projet enregistré : " + p }; } },
    { id: "phone", title: "Téléphone", kicker: "Appairage QR", html: () => `<h2>Appairer ton téléphone</h2><p class="ob-p">Active l'accès réseau local, puis scanne le QR code avec ton téléphone (même Wi-Fi). Tu pourras piloter E.N.O.S. à distance.</p><div id="ob-phone"><button class="ob-b" id="ob-net">ACTIVER L'ACCÈS TÉLÉPHONE</button></div>`,
      primary: "TERMINÉ", noValidate: true,
      hook(ctx) {
        const show = async () => { const n = await api("/api/network"); if (!n.enabled) return false;
          $("ob-phone").innerHTML = `<div class="ob-qr">${n.qr ? `<img alt="QR code" src="${n.qr}">` : ""}<dl><div><dt>ADRESSE</dt><dd>${esc((n.urls || [])[0] || "")}</dd></div><div><dt>CODE D'ACCÈS</dt><dd>${esc(n.code || "")}</dd></div></dl></div><div class="ob-note">Le navigateur du téléphone affichera un avertissement de certificat (réseau local) : c'est normal, accepte-le une fois.</div>`; return true; };
        $("ob-net").onclick = async () => { try { msg("Activation…", "wait"); const r = await api("/api/network/toggle", { enabled: true }); if (!r.ok) throw new Error(r.error || "échec"); await show(); msg("Accès activé.", "good"); ctx.done = true; } catch (e) { msg(e.message, "bad"); } };
        show().catch(() => {});
      } },
    { id: "youtube", title: "YouTube", kicker: "Autorisation OAuth", html: () => `<h2>Autoriser l'upload YouTube</h2><p class="ob-p">Pour publier des vidéos depuis E.N.O.S. Google impose <b>ton propre identifiant OAuth</b> (« Application de bureau »), créé dans ta console Google Cloud.</p>
        <div class="ob-note">1) Importe le fichier <code>client_secret.json</code> téléchargé depuis Google Cloud. 2) Connecte-toi : une page Google s'ouvre, accepte l'accès.</div>
        <div class="ob-bar" style="margin:0 0 14px"><button class="ob-b" id="ob-yt-imp">IMPORTER client_secret.json</button><button class="ob-b" id="ob-yt-con">SE CONNECTER À GOOGLE</button></div>`,
      primary: "VALIDER",
      hook(ctx) {
        $("ob-yt-imp").onclick = async () => { try { const r = await api("/api/youtube/import-secret", {}); msg(r.ok ? "Identifiants importés." : "Aucun fichier choisi.", r.ok ? "good" : "wait"); } catch (e) { msg(e.message, "bad"); } };
        $("ob-yt-con").onclick = async () => { try { await api("/api/youtube/connect", {}); msg("Page Google ouverte : accepte l'accès, puis reviens ici.", "wait"); } catch (e) { msg(e.message, "bad"); } };
      },
      async validate() { const s = await api("/api/youtube/state"); if (!s.authorized) throw new Error(s.configured ? "Pas encore connecté : termine la connexion Google puis clique à nouveau." : "Importe d'abord client_secret.json."); return { msg: "YouTube autorisé." }; } },
    { id: "end", title: "Terminé", kicker: "Prêt", html: (ctx) => `<h2>Configuration terminée</h2><p class="ob-p">Récapitulatif — ce qui manque se règle plus tard dans les réglages ou en relançant l'assistant (Applications → Assistant).</p>
        <ul class="ob-sum">${STEPS.slice(1, -1).map((s) => `<li><b>${esc(s.title)}</b><span class="${ctx.status[s.id] === "ok" ? "ok" : "no"}">${ctx.status[s.id] === "ok" ? "✓ configuré" : "à faire plus tard"}</span></li>`).join("")}</ul>`, primary: "ENTRER DANS E.N.O.S.", noValidate: true, last: true },
  ];

  const ctx = { i: 0, status: {}, busy: false };
  let root, stage;
  function msg(t, cls) { const m = $("ob-msg"); if (m) { m.textContent = t || ""; m.className = "ob-msg" + (cls ? " " + cls : ""); } }

  function build() {
    root = document.createElement("div");
    root.id = "ob"; root.setAttribute("role", "dialog"); root.setAttribute("aria-label", "Assistant de configuration");
    root.innerHTML = `<aside class="ob-rail"><div class="ob-brand">E.N.O.S<small>CONFIGURATION INITIALE</small></div><ol class="ob-steps" id="ob-steps"></ol><div class="ob-prog"><b id="ob-prog"></b></div><button class="ob-skipall" id="ob-skipall">PASSER TOUT L'ASSISTANT</button></aside><section class="ob-stage" id="ob-stage"></section>`;
    document.body.appendChild(root);
    stage = $("ob-stage");
    $("ob-skipall").onclick = () => finish();
  }

  function rail() {
    $("ob-steps").innerHTML = STEPS.map((s, k) => `<li class="${k === ctx.i ? "cur" : ""} ${ctx.status[s.id] === "ok" ? "ok" : ctx.status[s.id] === "skip" ? "skip" : ""}"><i>${ctx.status[s.id] === "ok" ? "✓" : k + 1}</i>${esc(s.title)}</li>`).join("");
    $("ob-prog").style.width = Math.round((ctx.i / (STEPS.length - 1)) * 100) + "%";
  }

  function go(n, dir) {
    const old = stage.querySelector(".ob-pane");
    if (old) old.querySelectorAll("[id]").forEach((e) => e.removeAttribute("id"));        // l'ancien volet reste 450 ms à l'écran : ses id ne doivent pas masquer ceux du nouveau
    ctx.i = n;
    const s = STEPS[n];
    const pane = document.createElement("div");
    pane.className = "ob-pane pre-" + dir;
    pane.innerHTML = `<div class="ob-k">${esc(s.kicker)} · étape ${n + 1}/${STEPS.length}</div>${s.html(ctx)}<div class="ob-msg" id="ob-msg"></div>
      <div class="ob-bar">${n > 0 && !s.last ? '<button class="ob-b ghost" id="ob-back">◂ RETOUR</button>' : ""}<span class="sp"></span>${!s.noValidate || (n > 0 && !s.last) ? '<button class="ob-b ghost" id="ob-skip">PASSER</button>' : ""}<button class="ob-b pri" id="ob-go">${esc(s.primary)}</button></div>`;
    stage.appendChild(pane);
    if (old) { old.classList.add("out-" + dir); setTimeout(() => old.remove(), 450); }
    requestAnimationFrame(() => requestAnimationFrame(() => pane.classList.remove("pre-" + dir)));
    pane.querySelectorAll("[data-eye]").forEach((b) => (b.onclick = () => { const i = $(b.dataset.eye); i.type = i.type === "password" ? "text" : "password"; b.textContent = i.type === "password" ? "VOIR" : "CACHER"; }));
    if ($("ob-back")) $("ob-back").onclick = () => go(n - 1, "back");
    if ($("ob-skip")) $("ob-skip").onclick = () => { if (!ctx.status[s.id]) ctx.status[s.id] = "skip"; go(n + 1, "fwd"); };
    $("ob-go").onclick = () => act(s);
    pane.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); act(s); } });
    ctx.voicesFor = null;
    if (s.hook) s.hook(ctx);
    rail();
    const first = pane.querySelector("input"); if (first) setTimeout(() => first.focus(), 450);
  }

  async function act(s) {
    if (ctx.busy) return;
    if (s.last) return finish();
    if (s.noValidate) { if (s.id === "phone" && ctx.done) ctx.status.phone = "ok"; return go(ctx.i + 1, "fwd"); }
    ctx.busy = true; $("ob-go").disabled = true; msg("Vérification…", "wait");
    try {
      const r = await s.validate(ctx);
      msg(r.msg, "good");
      if (!r.stay) { ctx.status[s.id] = "ok"; rail(); setTimeout(() => go(ctx.i + 1, "fwd"), 900); }
    } catch (e) { msg(e.message, "bad"); }
    ctx.busy = false; $("ob-go").disabled = false;
  }

  async function finish() {
    try { await api("/api/onboarding/finish", { done: true }); } catch (e) {}
    root.classList.add("out");
    setTimeout(() => { root.remove(); root = null; }, 480);
  }

  async function open(force) {
    if (document.getElementById("ob")) return;
    let st;
    try { st = await api("/api/onboarding/state"); } catch (e) { return; }               // pas ce PC / pas authentifié : pas d'assistant
    if (st.done && !force) return;
    for (const [k, v] of Object.entries(st.steps)) if (v) ctx.status[k] = "ok";           // déjà renseigné : étape cochée
    build();
    go(0, "fwd");
  }
  window.enosOnboarding = { open: () => open(true) };
  window.addEventListener("load", () => setTimeout(() => open(false), 1200));
})();
