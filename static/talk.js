"use strict";
// MODE DISCUSSION : avatar pixel art qui réagit en direct à l'état du chat (écoute / réflexion / parole / neutre).
// Aucune logique de chat dupliquée : la vue observe le terminal existant (#avatar.is-*, curseur de frappe .cur, #log)
// et pilote le formulaire, le micro et le mode live existants.
(() => {
  const $ = (id) => document.getElementById(id);
  // E.N.O.S. (PC / Eto Dev) : l'Œil rouge unique. « Eto » (version publique) garde son avatar.
  const EYE = { idle: "/static/img/enos_eye_idle.png", listening: "/static/img/enos_eye_idle.png",
                thinking: "/static/img/enos_eye_thinking.png", speaking: "/static/img/enos_eye_speaking.png" };
  const AVA = { idle: "/static/img/avatar_idle.png", listening: "/static/img/avatar_listening.png",
                thinking: "/static/img/avatar_thinking.png", speaking: "/static/img/avatar_speaking.png" };
  const isEye = () => !document.body.classList.contains("remote") || document.body.classList.contains("ed-dev");
  const IMG = new Proxy({}, { get: (_, s) => (isEye() ? EYE : AVA)[s] });
  const LABEL_EYE = { idle: "VEILLE ACTIVE", listening: "JE VOUS ENTENDS", thinking: "CALCUL EN COURS", speaking: "TRANSMISSION" };
  const LABEL = { idle: "EN VEILLE", listening: "À L'ÉCOUTE", thinking: "RÉFLEXION EN COURS", speaking: "TRANSMISSION" };
  let state = "idle", cand = "idle", candN = 0, layer = 0, timers = [], glitchT = 0;
  const isOpen = () => !$("dm").hidden;

  // ---------------------------------------------------------------- etat reel du chat
  function chatState() {
    const av = $("avatar");
    if (av.classList.contains("is-speaking") || document.querySelector("#log .cur")) return "speaking";   // voix OU texte en cours de frappe
    if (av.classList.contains("is-thinking")) return "thinking";
    if (av.classList.contains("is-listening")) return "listening";
    return "idle";
  }

  // ---------------------------------------------------------------- changement d'expression : fondu + glitch
  function setState(s, instant) {
    if (s === state && !instant) return;
    const prev = state;
    state = s;
    const stage = $("dm-stage");
    stage.dataset.state = s;
    $("dm").classList.toggle("eye", isEye());
    $("dm-chip").textContent = isEye() ? LABEL_EYE[s] : LABEL[s];
    $("dm-chip").dataset.state = s;
    const imgs = [$("dm-img-a"), $("dm-img-b")];
    const nxt = imgs[layer ^ 1], cur = imgs[layer];
    nxt.src = IMG[s];
    nxt.classList.add("on"); cur.classList.remove("on");
    layer ^= 1;
    if (!instant && prev !== s) glitch();
    $("dm-mic").classList.toggle("on", s === "listening");
  }

  function glitch(ms = 420) {
    const f = $("dm-face");
    f.classList.remove("glitch"); void f.offsetWidth;        // relance l'animation
    f.classList.add("glitch");
    clearTimeout(glitchT); glitchT = setTimeout(() => f.classList.remove("glitch"), ms);
  }

  // ---------------------------------------------------------------- recopie des dernières répliques
  function mirror() {
    const msgs = document.querySelectorAll("#log .m");
    let lastU = null, lastBot = null;
    for (let i = msgs.length - 1; i >= 0 && !(lastU && lastBot); i--) {
      const m = msgs[i];
      if (m.classList.contains("sys") || m.classList.contains("think")) continue;
      if (m.classList.contains("u")) { if (!lastU) lastU = m; }
      else if (!lastBot) lastBot = m;
    }
    const text = (m) => (m ? (m.querySelector("span") || m).textContent : "");
    $("dm-you").textContent = lastU ? text(lastU) : "";
    $("dm-you-wrap").hidden = !lastU;
    // une réplique de E.N.O.S. antérieure à la dernière question de l'utilisateur est périmée : on ne l'affiche pas
    const fresh = lastBot && (!lastU || (lastU.compareDocumentPosition(lastBot) & Node.DOCUMENT_POSITION_FOLLOWING));
    const bot = $("dm-bot");
    bot.textContent = fresh ? text(lastBot) : (state === "thinking" ? "" : lastBot && !lastU ? text(lastBot) : "");
    bot.classList.toggle("err", !!(fresh && lastBot.classList.contains("err")));
    bot.classList.toggle("typing", state === "speaking");
    bot.scrollTop = bot.scrollHeight;
  }

  // ---------------------------------------------------------------- boucle d'observation (100 ms)
  const BARS = 28;
  function tick() {
    if (!isOpen()) return;
    const s = chatState();
    if (s === cand) candN++; else { cand = s; candN = 1; }
    // stabilité 2 relevés (200 ms) pour éviter le clignotement, sauf démarrage de parole (immédiat)
    if (cand !== state && (candN >= 2 || cand === "speaking")) setState(cand);
    mirror();
    const lvl = parseFloat($("avatar").style.getPropertyValue("--lvl")) || 0;
    $("dm-stage").style.setProperty("--lvl", state === "speaking" ? lvl.toFixed(2) : "0");
    const bars = $("dm-eq").children, t = Date.now();
    for (let i = 0; i < bars.length; i++) {
      const base = state === "speaking" ? 10 + (Math.sin(t / 90 + i * 0.9) + 1) * (8 + lvl * 34) + Math.random() * 6
                 : state === "listening" ? 6 + (Math.sin(t / 160 + i * 0.5) + 1) * 9
                 : 3 + (Math.sin(t / 700 + i / 2) + 1) * 2;
      bars[i].style.height = base.toFixed(1) + "px";
    }
    $("dm-mic").classList.toggle("on", $("b-mic").classList.contains("listening") || state === "listening");
    $("dm-live").classList.toggle("on", $("b-live").classList.contains("on"));
  }

  // ---------------------------------------------------------------- ouverture / fermeture
  function open() {
    $("dm").hidden = false;
    document.body.classList.add("dm-open");
    setState(chatState(), true);
    mirror();
    clearInterval(timers[0]); timers[0] = setInterval(tick, 100);
    clearTimeout(timers[1]);
    (function idleGlitch() { timers[1] = setTimeout(() => { if (isOpen()) { if (state === "idle") glitch(260); idleGlitch(); } }, 5000 + Math.random() * 5000); })();
    setTimeout(() => $("dm-inp").focus(), 250);
  }
  function close() {
    $("dm").hidden = true;
    document.body.classList.remove("dm-open");
    clearInterval(timers[0]); clearTimeout(timers[1]);
  }

  function init() {
    if (!$("b-dm")) return;
    const eq = $("dm-eq");
    for (let i = 0; i < BARS; i++) eq.appendChild(document.createElement("i"));
    Object.values(IMG).forEach((u) => { const i = new Image(); i.src = u; });     // préchargement : pas de scintillement au changement
    $("b-dm").onclick = open;
    $("dm-close").onclick = close;
    $("dm-form").onsubmit = (e) => {
      e.preventDefault();
      const v = $("dm-inp").value.trim();
      if (!v) return;
      $("dm-inp").value = "";
      $("inp").value = v;
      $("form").requestSubmit();                       // même chemin que le terminal : historique, voix, actions
    };
    $("dm-mic").onclick = () => $("b-mic").click();
    $("dm-live").onclick = () => $("b-live").click();
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen()) close(); });
    $("dm-face").addEventListener("click", () => glitch(300));    // clic sur le visage : petit glitch interactif
  }
  init();
})();
