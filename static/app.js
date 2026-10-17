"use strict";
const TOKEN = document.querySelector('meta[name="nasko-token"]').content;
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { "X-Nasko-Token": TOKEN, "Content-Type": "application/json", ...(opts.headers || {}) } });
  if (!r.ok) {
    let d = r.statusText;
    try { d = (await r.json()).detail || d; } catch (e) {}
    const err = new Error(d); err.status = r.status; throw err;
  }
  return r.json();
}

// ---------------------------------------------------------------- ASCII Art + glitch
const L = {
  N: ["███╗   ██╗", "████╗  ██║", "██╔██╗ ██║", "██║╚██╗██║", "██║ ╚████║", "╚═╝  ╚═══╝"],
  A: [" █████╗ ", "██╔══██╗", "███████║", "██╔══██║", "██║  ██║", "╚═╝  ╚═╝"],
  E: ["███████╗", "██╔════╝", "█████╗  ", "██╔══╝  ", "███████╗", "╚══════╝"],
  S: ["███████╗", "██╔════╝", "███████╗", "╚════██║", "███████║", "╚══════╝"],
  K: ["██╗  ██╗", "██║ ██╔╝", "█████╔╝ ", "██╔═██╗ ", "██║  ██╗", "╚═╝  ╚═╝"],
  O: [" ██████╗ ", "██╔═══██╗", "██║   ██║", "██║   ██║", "╚██████╔╝", " ╚═════╝ "],
  ".": ["   ", "   ", "   ", "   ", "██╗", "╚═╝"],
};
const ROWS = [0, 1, 2, 3, 4, 5].map((r) =>
  [..."E.N.O.S."].map((c) => { const w = Math.max(...L[c].map((x) => x.length)); return L[c][r].padEnd(w); }).join(""));
const asc = $("ascii");
asc.textContent = ROWS.join("\n");
(function glitchLoop() {
  setTimeout(() => {
    let n = 0;
    const iv = setInterval(() => {
      const rows = ROWS.map((r) => {
        if (Math.random() > 0.4) return r;
        return [...r].map((ch) => (ch !== " " && Math.random() < 0.06 ? "▓▒░#@%&01"[Math.floor(Math.random() * 9)] : ch)).join("");
      });
      asc.textContent = rows.join("\n");
      asc.classList.add("glitch");
      asc.style.setProperty("--gx", (Math.random() * 14 - 7).toFixed(1) + "px");
      if (++n > 5) { clearInterval(iv); asc.textContent = ROWS.join("\n"); asc.classList.remove("glitch"); glitchLoop(); }
    }, 45);
  }, 2200 + Math.random() * 3000);
})();

// ---------------------------------------------------------------- audio : bips synthetises + voix
let actx = null, muted = false, voice = null, skipSpeak = false;
function beep(freq, ms = 50, type = "square", vol = 0.05, delay = 0) {
  if (muted || (navigator.userActivation && !navigator.userActivation.hasBeenActive)) return;  // autoplay policy
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + delay / 1000;
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + ms / 1000);
  } catch (e) {}
}
const sfx = {
  click: () => { beep(900, 35); beep(1500, 45, "square", 0.05, 40); },
  send: () => beep(900, 80, "sine", 0.08),
  recv: () => { beep(660, 60, "sine", 0.08); beep(880, 90, "sine", 0.08, 70); },
  ok: () => { beep(700, 70); beep(950, 70, "square", 0.05, 90); beep(1300, 120, "square", 0.05, 180); },
  err: () => beep(150, 300, "sawtooth", 0.08),
  tick: () => beep(2600, 6, "square", 0.015),
};
document.addEventListener("click", (e) => { if (e.target.closest(".btn")) sfx.click(); });
$("b-audio").onclick = () => {
  muted = !muted; $("b-audio").textContent = muted ? "AUDIO : OFF" : "AUDIO : ON";
  if (muted && voice) voice.pause();
};

// ---------------------------------------------------------------- avatar : lié à l'état de lecture audio
const avatarEls = [$("avatar"), $("ascii"), $("logo")].filter(Boolean);
let analyser = null, lvlData = null;
function setSpeaking(on) {
  avatarEls.forEach((el) => el.classList.toggle("is-speaking", on));
  document.body.classList.toggle("speaking", on);
  if (!on) $("avatar").style.setProperty("--lvl", 0);
}
function hookAudio(a) {
  ["play", "playing"].forEach((ev) => a.addEventListener(ev, () => setSpeaking(true)));   // avatar + fond s'activent des le play
  ["ended", "pause", "error"].forEach((ev) => a.addEventListener(ev, () => setSpeaking(false)));
  try {   // niveau sonore réel (anime l'avatar et l'égaliseur)
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume();
    const src = actx.createMediaElementSource(a), an = actx.createAnalyser();
    an.fftSize = 64; src.connect(an); an.connect(actx.destination);
    analyser = an; lvlData = new Uint8Array(an.frequencyBinCount);
  } catch (e) { analyser = null; }
}

// ---------------------------------------------------------------- egaliseur
const bars = $("bars");
for (let i = 0; i < 32; i++) bars.appendChild(document.createElement("i"));
setInterval(() => {
  const speaking = voice && !voice.paused && !voice.ended;
  let lvl = 0;
  if (speaking && analyser) { analyser.getByteFrequencyData(lvlData); lvl = lvlData.reduce((a, b) => a + b, 0) / lvlData.length / 255; }
  if (speaking) $("avatar").style.setProperty("--lvl", analyser ? Math.min(1, lvl * 2.2).toFixed(2) : 0.5);
  [...bars.children].forEach((b, i) => {
    const real = analyser && speaking ? 4 + (lvlData[i % lvlData.length] / 255) * 44 : null;
    b.style.height = (speaking ? (real ?? 6 + Math.random() * 42) : 4 + 3 * (1 + Math.sin(Date.now() / 500 + i / 2))) + "px";
    b.style.background = speaking ? "var(--neon)" : "var(--dim)";
  });
}, 60);

// ---------------------------------------------------------------- chat : frappe synchronisee sur la voix
const log = $("log");
const queue = [];
let busy = false;
const scroll = () => { log.scrollTop = log.scrollHeight; };
function line(cls, prefix, text = "") {
  const d = document.createElement("div");
  d.className = "m " + cls;
  d.innerHTML = `<b></b> <span></span>`;
  d.firstChild.textContent = cls === "sys" ? prefix : prefix + " >";
  d.lastChild.textContent = text;
  log.appendChild(d); scroll();
  return d.lastChild;
}
function say(text, { audio = null, kind = "", onStart = null, who = "" } = {}) {
  // Retourne une promesse résolue quand le message est entièrement écrit ET prononcé.
  // onStart est appelé à l'instant où la voix et la frappe démarrent (sert à déclencher l'action commentée).
  return new Promise((resolve) => {
    queue.push({ text, audio, kind, onStart, who, resolve });
    if (!busy) next();
  });
}
async function next() {
  const item = queue.shift();
  if (!item) { busy = false; onIdle(); return; }
  busy = true;
  const span = line(item.kind === "err" ? "err" : "", "[" + (item.who || (window.enosPersona ? window.enosPersona.name() : "E.N.O.S.")) + "]");
  let dur = Math.max(0.5, item.text.length / 70), withVoice = false;
  if (item.audio && !muted) {
    try {
      let aurl = item.audio;
      try { if (aurl.startsWith("/api/") && window.naskoSec) aurl = await window.naskoSec.ticketUrl(aurl); } catch (e) {}      // les <audio> n'envoient pas d'en-tête : ticket court
      voice = new Audio(aurl);
      hookAudio(voice);
      await new Promise((res, rej) => { voice.onloadedmetadata = res; voice.onerror = rej; setTimeout(res, 2500); });
      if (isFinite(voice.duration) && voice.duration > 0) {
        await voice.play();            // la voix et la frappe démarrent au même instant
        dur = voice.duration * 0.92; withVoice = true;
      }
    } catch (e) {
      if (e && e.name === "NotAllowedError" && voice && voice.src) {        // lecture automatique refusée : la voix démarre au premier clic
        const u = voice.src;
        document.addEventListener("pointerdown", () => { const a = new Audio(u); try { hookAudio(a); } catch (x) {} a.play().catch(() => {}); }, { once: true });
      }
      voice = null;
    }
  }
  if (!withVoice) item.kind === "err" ? sfx.err() : sfx.recv();
  if (item.onStart) { try { item.onStart({ duration: withVoice && voice ? voice.duration : dur }); } catch (e) {} }    // durée réelle de la voix (en s) : sert à caler flèches et animations sur la parole
  span.classList.add("cur");
  const t0 = performance.now(); let done = 0;
  await new Promise((resolve) => {
    (function frame() {
      const n = skipSpeak ? item.text.length : Math.min(item.text.length, Math.floor(((performance.now() - t0) / 1000 / dur) * item.text.length));
      if (n > done) { span.textContent = item.text.slice(0, n); if (!withVoice && (n >> 2) !== (done >> 2)) sfx.tick(); done = n; scroll(); }
      done < item.text.length ? requestAnimationFrame(frame) : resolve();
    })();
  });
  span.classList.remove("cur");
  while (voice && !voice.paused && !voice.ended) await sleep(80);
  skipSpeak = false;
  item.resolve();
  next();
}
const userName = () => (window.enosUser === undefined ? "Nassime" : window.enosUser) || "Vous";   // profil actif (Nassime, Raf…)
function userLine(text) { line("u", "[" + userName().toUpperCase() + "]", text); }

let pending = false;   // requête envoyée, réponse pas encore terminée
function showThinking() {   // « E.N.O.S. réfléchit… » pendant les appels LLM + ElevenLabs
  const d = document.createElement("div");
  d.className = "m think";
  const nm = window.enosPersona ? window.enosPersona.name() : "E.N.O.S.";
  d.innerHTML = `<b>[${nm}] &gt;</b> <span>${nm} réfléchit<i>...</i></span>`;
  log.appendChild(d); scroll();
  $("avatar").classList.add("is-thinking");
  $("vstate").textContent = nm + " RÉFLÉCHIT…";
  return { remove() { d.remove(); $("avatar").classList.remove("is-thinking"); refreshVoiceUI(); } };
}
async function sendMessage(raw) {
  const text = raw.trim();
  if (!text) return;
  $("inp").value = ""; sfx.send(); userLine(text);
  pending = true; stopListening();   // le micro reste coupé pendant la réponse
  const wait = showThinking();
  try {
    const r = await api("/api/chat", { method: "POST", body: JSON.stringify({ text }) });
    wait.remove();
    if (r.error) say("⚠ " + r.error, { kind: "err" });
    else {
      say(r.text, { audio: r.audio });
      if (window.enosPersona) window.enosPersona.reply(r);                  // ETO : son visage joue les balises audio ([hmm], [laugh]…) de la réponse
      (r.actions || []).forEach((a) => {
        if ((a.code === "missing_dir" || a.code === "no_project") && NATIVE) offerProjectFix(a.path, a.message, true);
        else line(a.ok ? "sys" : "err", "// action " + a.action.toLowerCase(), a.message);
      });
      if (r.notice) say("⚠ " + r.notice, { kind: "err" });
    }
  } catch (err) { wait.remove(); say("Erreur serveur : " + err.message, { kind: "err" }); }
  pending = false;
  if (!busy) onIdle();
}
$("form").onsubmit = (e) => { e.preventDefault(); sendMessage($("inp").value); };

// ---------------------------------------------------------------- projets + fichiers
let projects = [], current = null, rel = "";
const same = (a, b) => (a || "").toLowerCase() === (b || "").toLowerCase();

function lineButtons(text, buttons) {   // message du terminal avec boutons d'action (ex. choisir / créer un dossier)
  const d = document.createElement("div");
  d.className = "m err";
  d.innerHTML = "<b>[E.N.O.S.] &gt;</b> <span></span><div style='margin-top:8px'></div>";
  d.querySelector("span").textContent = text;
  buttons.forEach(([label, fn]) => {
    const b = document.createElement("button"); b.className = "btn sm"; b.textContent = label;
    b.onclick = () => { d.querySelectorAll("button").forEach((x) => (x.disabled = true)); fn(); };
    d.lastChild.appendChild(b);
  });
  log.appendChild(d); scroll(); sfx.err();
}

async function loadProjects() {
  projects = await api("/api/projects");
  current = (projects.find((p) => p.active) || {}).path || null;     // projet actif mémorisé dans nasko_config.json
  const ul = $("projects"); ul.innerHTML = "";
  if (!projects.length) ul.innerHTML = '<li class="dim">aucun projet — ajoutez un dossier</li>';
  projects.forEach((p) => {
    const li = document.createElement("li");
    li.className = "row" + (p.active ? " cur2" : "");
    li.title = p.path + (p.missing ? "\n⚠ dossier introuvable" : "") + "\ndernière utilisation : " + p.last;
    li.innerHTML = "<span></span><span></span><span class='x' title='retirer de la liste'>✕</span>";
    li.children[0].textContent = p.missing ? "⚠" : p.active ? "●" : "▸";
    li.children[1].textContent = p.name;
    li.onclick = async () => { await api("/api/projects/select", { method: "POST", body: JSON.stringify({ path: p.path }) }); rel = ""; await loadProjects(); loadFiles(); };
    li.children[2].onclick = async (ev) => { ev.stopPropagation(); await api("/api/projects?path=" + encodeURIComponent(p.path), { method: "DELETE" }); rel = ""; await loadProjects(); loadFiles(); };
    ul.appendChild(li);
  });
  if (current !== sceneProject) { sceneProject = current; loadScenes(); }   // le projet actif a changé : on relit ses scènes
}

async function addProject(path, create = false) {
  try {
    await api("/api/projects", { method: "POST", body: JSON.stringify({ path, create }) });
    $("newproj").value = ""; sfx.ok(); rel = ""; await loadProjects(); loadFiles();
    return true;
  } catch (e) {
    if (e.status === 404) offerProjectFix(path, e.message); else say(e.message, { kind: "err" });
    return false;
  }
}
async function browseProject() {
  try {
    const r = await api("/api/projects/browse", { method: "POST" });
    if (r.error) { say(r.error, { kind: "err" }); return false; }
    return r.path ? addProject(r.path) : false;
  } catch (e) { say("Sélecteur : " + e.message, { kind: "err" }); return false; }
}
// dossier absent : on propose de le sélectionner ou de le créer, puis on relance l'environnement
function offerProjectFix(path, message, relaunch = false) {
  const after = async (ok) => { if (ok && relaunch) runEnv(); };
  const buttons = [["Sélectionner un dossier…", async () => after(await browseProject())]];
  if (path) buttons.push(["Créer ce dossier", async () => after(await addProject(path, true))]);
  lineButtons(message, buttons);
}
$("addproj").onclick = () => { const p = $("newproj").value.trim(); if (p) addProject(p.replace(/"/g, "")); };
$("newproj").addEventListener("keydown", (e) => { if (e.key === "Enter") $("addproj").click(); });
$("browseproj").onclick = browseProject;
async function loadFiles() {
  const ul = $("files"); ul.innerHTML = ""; $("preview").style.display = "none";
  const cur = projects.find((p) => p.active);
  if (!current) { $("crumb").textContent = "— aucun projet sélectionné —"; return; }
  if (cur && cur.missing) { $("crumb").textContent = "⚠ dossier introuvable"; return; }
  try {
    const r = await api(`/api/files?project=${encodeURIComponent(current)}&rel=${encodeURIComponent(rel)}`);
    $("crumb").textContent = "/" + r.rel;
    if (rel) { const up = document.createElement("li"); up.className = "row"; up.textContent = "↩ ..";
      up.onclick = () => { rel = rel.split("/").slice(0, -1).join("/"); loadFiles(); }; ul.appendChild(up); }
    r.entries.slice(0, 300).forEach((f) => {
      const li = document.createElement("li"); li.className = "row";
      li.textContent = (f.dir ? "▸ " : "· ") + f.name + (f.dir ? "/" : "");
      li.onclick = async () => {
        const sub = rel ? rel + "/" + f.name : f.name;
        if (f.dir) { rel = sub; loadFiles(); return; }
        try {
          const p = await api(`/api/file?project=${encodeURIComponent(current)}&rel=${encodeURIComponent(sub)}`);
          const pv = $("preview"); pv.style.display = "block"; pv.textContent = "// " + sub + "\n" + p.text;
        } catch (e) { say(e.message, { kind: "err" }); }
      };
      ul.appendChild(li);
    });
  } catch (e) { say(e.message, { kind: "err" }); }
}

// ---------------------------------------------------------------- taches
async function task(path, body) {
  try {
    const r = await api(path, { method: "POST", body: JSON.stringify(body || {}) });
    if (r.code === "missing_dir" || r.code === "no_project") { offerProjectFix(r.path, r.message, true); return; }
    say(r.message, { kind: r.ok ? "" : "err" }); r.ok ? sfx.ok() : 0;
  } catch (e) { say("Erreur : " + e.message, { kind: "err" }); }
}
// ---- commandes rapides commentées : phrases locales (fichiers audio pré-faits, 0 caractère ElevenLabs),
//      chaque action démarre à l'instant où E.N.O.S. annonce l'étape.
const sayRef = (ref, o = {}) => say(ref.text, { audio: ref.audio, ...o });
let envRunning = false, pxRunning = false;

async function runEnv() {
  if (envRunning) return;
  envRunning = true;
  try {
    const plan = await api("/api/tasks/env/start", { method: "POST", body: JSON.stringify({ path: current }) });
    if (!plan.ok) {                                         // aucun projet / dossier absent : voix + choix
      if (plan.code === "missing_dir" || plan.code === "no_project") {
        if (plan.say) await sayRef(plan.say, { kind: "err" });
        offerProjectFix(plan.path, plan.message, true);
      } else say(plan.message, { kind: "err" });
      return;
    }
    await sayRef(plan.intro);
    let failed = 0;
    for (const step of plan.steps) {
      if (!step.ready) { failed++; await sayRef(step.fail, { kind: "err" }); continue; }
      let run;
      await sayRef(step.say, { onStart: () => {             // l'outil se lance pendant l'annonce de l'étape
        run = api("/api/tasks/env/step", { method: "POST", body: JSON.stringify({ id: step.id, path: plan.path }) })
          .catch((e) => ({ ok: false, message: e.message }));
      } });
      const r = await run;
      if (!r.ok) { failed++; await sayRef(step.fail, { kind: "err" }); say(r.message, { kind: "err" }); }
      else if (r.already && !step.already) say(r.message);       // ouvert entre-temps : on le signale sans doublon
    }
    if (!failed) { await sayRef(plan.done); sfx.ok(); }
  } catch (e) { say("Environnement : " + e.message, { kind: "err" }); }
  finally { envRunning = false; }
}

async function runPixellab() {
  if (pxRunning) return;
  pxRunning = true;
  try {
    const n = await api("/api/narration/pixellab");
    if (!n.ok) { await sayRef(n.fail, { kind: "err" }); say("Chrome introuvable. Renseignez chrome_path dans nasko_config.json.", { kind: "err" }); return; }
    if (n.already) {                                        // déjà ouverte : pas de doublon, on ramène la fenêtre devant
      await sayRef(n.deja, { onStart: () => { api("/api/tasks/pixellab", { method: "POST", body: "{}" }).catch(() => {}); } });
      sfx.ok(); return;
    }
    let run;
    await sayRef(n.open, { onStart: () => {                 // Chrome s'ouvre pendant l'annonce
      run = api("/api/tasks/pixellab", { method: "POST", body: "{}" }).catch((e) => ({ ok: false, message: e.message }));
    } });
    const r = await run;
    if (!r.ok) { await sayRef(n.fail, { kind: "err" }); say(r.message, { kind: "err" }); return; }
    await sayRef(n.info); sfx.ok();                         // phrase d'explication une fois la navigation privée ouverte
  } catch (e) { say("PixelLab : " + e.message, { kind: "err" }); }
  finally { pxRunning = false; }
}
$("b-env").onclick = runEnv;
$("b-px").onclick = runPixellab;
if ($("b-el")) $("b-el").onclick = async () => {                       // fenêtre privée : ElevenLabs (inscription) + e-mail temporaire ; la suite est manuelle
  const small = $("b-el").querySelector("small"), old = small.textContent;
  try {
    const r = await api("/api/tasks/elevenlabs-prive", { method: "POST", body: "{}" });
    small.textContent = r.ok ? "✔ " + r.message : "✕ " + r.message;
    if (r.ok) sfx.ok();
  } catch (e) { small.textContent = "✕ " + e.message; }
  setTimeout(() => (small.textContent = old), 6000);
};
$("b-clear").onclick = async () => { await api("/api/history", { method: "DELETE" }); log.innerHTML = ""; };
let updArm = 0;
$("b-update").onclick = async () => {                      // confirmation en deux clics (pas de boîte confirm())
  const b = $("b-update");
  if (!b.dataset.armed) {
    b.dataset.armed = "1"; b.textContent = "CONFIRMER ?";
    updArm = setTimeout(() => { delete b.dataset.armed; b.textContent = "MISE À JOUR"; }, 4000); return;
  }
  clearTimeout(updArm);
  const hue = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--h")) || 356;
  let up;
  try { up = await api("/api/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hue }) }); } catch (e) { delete b.dataset.armed; b.textContent = "MISE À JOUR"; return alert(e.message); }
  if (up && up.managed) {                                   // installation gérée par le Dual Pulse Launcher : plus de mise à jour autonome
    delete b.dataset.armed; b.textContent = up.ready ? "MISE À JOUR PRÊTE ↑" : "GÉRÉ PAR LE LAUNCHER";
    if (window.ensureUpdateBar) window.ensureUpdateBar();
    setTimeout(() => { b.textContent = "MISE À JOUR"; }, 4000); return;
  }
  if (up && up.ota && !up.available) { delete b.dataset.armed; b.textContent = "À JOUR ✓ v" + up.current; setTimeout(() => { b.textContent = "MISE À JOUR"; }, 4000); return; }   // version installée : déjà la dernière
  if (up && up.ota) { document.body.innerHTML = '<p style="padding:20px">Mise à jour ' + up.latest + ' : téléchargement, puis autorisez la fenêtre administrateur de Windows. E.N.O.S. se relance tout seul.</p>'; return; }
  document.body.innerHTML = '<p style="padding:20px">Mise à jour en cours : E.N.O.S. se ferme, se reconstruit puis se relance tout seul (1 à 3 minutes).</p>';
};
$("b-quit").onclick = async () => { try { await api("/api/shutdown", { method: "POST" }); } catch (e) {} document.body.innerHTML = '<p style="padding:20px">E.N.O.S. arrêté. Vous pouvez fermer cet onglet.</p>'; };

// ---------------------------------------------------------------- démarrage
function typeGreeting(text) {
  const g = $("greet"); let i = 0;
  const iv = setInterval(() => { g.textContent = text.slice(0, ++i); if (i >= text.length) clearInterval(iv); }, 22);
}
setInterval(() => ($("clock").textContent = new Date().toLocaleTimeString("fr-FR")), 1000);
(async () => {
  try {
    const st = await api("/api/status");
    window.enosUser = st.user ? st.user.label : ""; window.dispatchEvent(new Event("enos-user"));
    typeGreeting(st.greeting);
    if (!st.local) {
      document.body.classList.add("remote");
      $("devname").textContent = st.device ? st.device.name + (st.device.via === "ip" ? " · IP de confiance" : " · appareil de confiance") : "";
      // raccourcis du tiroir : passent par E.N.O.S. (le LLM lance l'action sur le PC) ; les actions directes restent réservées au PC
      $("b-env").onclick = () => sendMessage("Prépare mon environnement de dev.");
      $("b-px").onclick = () => sendMessage("Prépare PixelLab.");
      $("b-env").querySelector("small").textContent = "Demandé à E.N.O.S., lancé sur le PC";
      $("b-px").querySelector("small").textContent = "Demandé à E.N.O.S., ouvert sur le PC";
      ensureDeviceBackup(st);
    }
    NATIVE = !!st.local;
    if (NATIVE && !st.mic) line("err", "// micro", "Aucun micro détecté sur ce PC : branchez-en un puis relancez E.N.O.S.");
    const hist = await api("/api/history");
    hist.slice(-40).forEach((h) => (h.role === "user" ? userLine(h.text) : line("", "[E.N.O.S.]", h.text)));
    if (!hist.length) line("sys", "//", "terminal prêt — tapez un message puis appuyez sur Entrée");
    if (!st.llm) line("sys", "//", "LLM non configuré : ajoutez llm_api_key dans nasko_config.json (voir GUIDE.md).");
    if (!st.eleven) line("sys", "//", "ElevenLabs non configuré : réponses en texte seul (voir GUIDE.md).");
    if (st.local) {
      await loadProjects(); loadFiles(); loadNetwork();
      const act = projects.find((p) => p.active);
      if (act && act.missing) offerProjectFix(act.path, "Le dossier du projet actif est introuvable : " + act.path);
    }
    sfx.recv();
    if (st.welcome) {
      say(st.welcome.text, { audio: st.welcome.audio, who: st.welcome.persona === "eto" ? "ETO" : "" });
      if (st.welcome.persona === "eto" && window.enosPersona) window.enosPersona.reply({ tags: st.welcome.tags, text: st.welcome.text });   // son visage joue l'accueil
    }        // phrase d'accueil : une fois par lancement, interface prête
  } catch (e) { say("Connexion au serveur impossible : " + e.message, { kind: "err" }); }
})();

// ---------------------------------------------------------------- transcription (Web Speech API) + mode Live
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, listening = false, live = false, micChecked = false;
let NATIVE = false;          // fenêtre native : le micro du PC est piloté par le serveur Python (sounddevice + Whisper)
let nativePoll = null, transcribing = false;

function refreshVoiceUI() {
  $("b-mic").classList.toggle("listening", listening);
  $("b-live").classList.toggle("on", live);
  $("avatar").classList.toggle("is-listening", listening);
  $("vstate").textContent = listening ? "● ÉCOUTE…" : live ? "LIVE : en attente" : "";
}
function voiceError(msg) { live = false; stopListening(); refreshVoiceUI(); say(msg, { kind: "err" }); }

async function ensureMic() {
  if (NATIVE || micChecked) return true;
  if (!SR) { voiceError("Reconnaissance vocale non prise en charge ici. Utilisez Chrome ou Edge."); return false; }
  try {   // déclenche la demande de permission du navigateur avec un message d'erreur précis
    const st = await navigator.mediaDevices.getUserMedia({ audio: true });
    st.getTracks().forEach((t) => t.stop());
    micChecked = true; return true;
  } catch (e) {
    const msgs = {
      NotAllowedError: "Accès au micro refusé. Cliquez sur l'icône à gauche de l'adresse (cadenas) → Micro → Autoriser, puis rechargez la page.",
      NotFoundError: "Aucun micro détecté. Branchez un micro puis réessayez.",
      NotReadableError: "Le micro est utilisé par une autre application.",
    };
    voiceError(msgs[e.name] || ("Micro indisponible : " + (e.message || e.name)));
    return false;
  }
}

function stopListening() {
  if (NATIVE) { if (nativePoll) { clearInterval(nativePoll); nativePoll = null; if (listening) api("/api/stt/cancel", { method: "POST" }).catch(() => {}); } listening = false; refreshVoiceUI(); return; }
  if (rec) { rec.onend = null; try { rec.abort(); } catch (e) {} rec = null; } listening = false; refreshVoiceUI(); }

function startListening() {
  if (NATIVE) return startNative();
  return startWebSpeech();
}

// ---- micro natif : enregistrement par le serveur, transcription Whisper, envoi automatique
async function startNative() {
  if (listening || transcribing || pending || busy || (voice && !voice.paused && !voice.ended)) return;
  let r;
  try { r = await api("/api/stt/start", { method: "POST" }); } catch (e) { return voiceError("Micro : " + e.message); }
  if (!r.ok) return voiceError(r.error);
  listening = true; sfx.recv(); refreshVoiceUI();
  nativePoll = setInterval(async () => {
    try {
      const s = await api("/api/stt/status");
      const bars = Math.min(5, Math.round(s.level * 8));
      $("vstate").textContent = "● ÉCOUTE " + "▮".repeat(bars) + "▯".repeat(5 - bars) + (s.heard ? " parole" : "");
      if (!s.recording) finishNative();               // fin de phrase détectée (silence) ou délai écoulé
    } catch (e) { clearInterval(nativePoll); nativePoll = null; listening = false; refreshVoiceUI(); }
  }, 120);
}

async function finishNative() {
  if (nativePoll) { clearInterval(nativePoll); nativePoll = null; }
  if (!listening) return;
  listening = false; transcribing = true;
  $("b-mic").classList.remove("listening"); $("avatar").classList.remove("is-listening");
  $("vstate").textContent = "TRANSCRIPTION…";
  try {
    const r = await api("/api/stt/stop", { method: "POST" });
    transcribing = false;
    if (!r.ok) { voiceError(r.error); return; }
    if (r.text) { $("inp").value = r.text; sendMessage(r.text); return; }   // soumis comme un clic sur « Envoyer »
    refreshVoiceUI();
    if (live) setTimeout(startListening, 300); else line("sys", "//", "aucune parole détectée");
  } catch (e) { transcribing = false; voiceError("Transcription impossible : " + e.message); }
}

function startWebSpeech() {
  if (listening || pending || busy || !SR || (voice && !voice.paused && !voice.ended)) return;
  const r = new SR();
  r.lang = window.enosLang === "en" ? "en-US" : "fr-FR"; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
  let finalText = "", fatal = false;
  r.onstart = () => { listening = true; refreshVoiceUI(); sfx.recv(); };
  r.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) finalText += res[0].transcript; else interim += res[0].transcript;
    }
    $("inp").value = (finalText + interim).trim();   // transcription affichée en direct
  };
  r.onerror = (e) => {
    const m = {
      "not-allowed": "Accès au micro refusé par le navigateur. Autorisez le micro pour cette page (cadenas dans la barre d'adresse).",
      "service-not-allowed": "Reconnaissance vocale bloquée par le navigateur ou le système.",
      "audio-capture": "Aucun micro détecté.",
      "network": "Reconnaissance vocale indisponible : Chrome envoie l'audio aux serveurs de Google, vérifiez votre connexion.",
    }[e.error];
    if (m) { fatal = true; voiceError(m); }   // no-speech / aborted : on ignore
  };
  r.onend = () => {
    listening = false; rec = null; refreshVoiceUI();
    if (fatal) return;
    const text = (finalText || $("inp").value).trim();
    if (text) sendMessage(text);                       // fin de phrase -> envoi automatique
    else if (live) setTimeout(startListening, 300);    // silence : on continue d'écouter
  };
  rec = r;
  try { r.start(); } catch (e) { rec = null; }
}

function onIdle() {   // E.N.O.S. a fini de parler (audio « ended ») : le micro se réactive en mode Live
  if (live && !pending && !busy) setTimeout(() => { if (live && !busy && !pending) startListening(); }, 350);
  refreshVoiceUI();
}

// ---- INTERROMPRE : coupe la voix et la frappe en cours, vide les phrases en attente, puis ouvre le micro tout de suite
async function stopSpeaking() {
  fetch("/api/pet/interrupt", { method: "POST" }).catch(() => {});      // l'Œil de bureau se tait aussi (sans effet s'il n'est pas lancé)
  skipSpeak = true;
  queue.splice(0).forEach((it) => it.resolve());           // les phrases en attente sont abandonnées (leurs appelants sont libérés)
  if (voice) { try { voice.pause(); voice.currentTime = 0; } catch (e) {} }
  for (let i = 0; i < 30 && (busy || (voice && !voice.paused && !voice.ended)); i++) await sleep(50);
  skipSpeak = false;
}
window.stopSpeaking = stopSpeaking;
async function interrupt() {
  await stopSpeaking();
  live = false;
  if (listening) stopListening();
  sfx.recv();
  if (await ensureMic()) startListening();                 // l'utilisateur peut parler par-dessus
}
$("b-interrupt").onclick = interrupt;
$("b-mic").onclick = async () => {
  if (live) { live = false; stopListening(); return; }
  if (NATIVE && listening) { finishNative(); return; }     // 2e clic : on arrête d'écouter et on transcrit
  if (listening) { stopListening(); return; }
  if (await ensureMic()) startListening();
};
$("b-live").onclick = async () => {
  if (live) { live = false; stopListening(); sfx.err(); return; }
  if (!(await ensureMic())) return;
  live = true; sfx.ok(); refreshVoiceUI();
  say("Mode Live activé. Je vous écoute, " + userName() + ".");
};

// ---------------------------------------------------------------- fenêtre bureau / accès réseau
async function loadNetwork() {
  let n;
  try { n = await api("/api/network"); } catch (e) { return; }          // réservé au PC : le téléphone n'a pas ce panneau
  $("neth").style.display = $("netsec").style.display = "block";
  const box = $("netinfo"); box.textContent = "";
  const add = (txt, css) => { const d = document.createElement("div"); d.textContent = txt; if (css) d.style.cssText = css; box.appendChild(d); return d; };
  $("b-net").textContent = n.enabled ? "DÉSACTIVER" : "ACTIVER L'ACCÈS TÉLÉPHONE";
  $("devh").style.display = $("devsec").style.display = n.enabled ? "block" : "none";
  if (n.enabled) loadDevices();
  $("b-awake").textContent = n.keep_awake ? "PC ÉVEILLÉ : OUI" : "PC ÉVEILLÉ : NON";
  if (!n.enabled) { add("Désactivé : seul ce PC peut utiliser E.N.O.S."); return; }
  if (n.qr) { const img = document.createElement("img"); img.className = "qr"; img.src = n.qr; img.alt = "QR code"; box.appendChild(img); }
  add("Scannez avec le téléphone (même Wi-Fi) :");
  (n.urls.length ? n.urls : ["(IP introuvable : lancez ipconfig)"]).forEach((u) => add(u, "color:var(--neon)"));
  const c = add("Code : "); const b = document.createElement("b"); b.textContent = n.code; c.appendChild(b);
  add("Certificat à installer une fois sur le téléphone : ouvrez l'adresse ci-dessus + " + n.ca + " (voir GUIDE.md).", "margin-top:6px");
  if (n.fingerprint) add("Empreinte du certificat (à comparer dans l'application Android) :\n" + n.fingerprint, "margin-top:8px;font-size:11px;word-break:break-all;white-space:pre-wrap;opacity:.85");
  if (n.apk && n.urls.length) { const a = document.createElement("a"); a.href = n.urls[0].replace(/\/$/, "") + "/nasko.apk"; a.textContent = "⬇ Application Android (APK) : " + a.href; a.style.cssText = "display:block;margin-top:8px;color:var(--neon);word-break:break-all"; box.appendChild(a); }
  else if (!n.apk) add("Application Android : lancez « py construire_apk.py » pour fabriquer l'APK.", "margin-top:8px;opacity:.7");
  const ad = n.adapter;
  if (ad && ad.name) {
    add("Carte : " + ad.name + (ad.wired ? " (Ethernet)" : " (Wi-Fi)") + (ad.mac ? " · MAC " + ad.mac : ""), "margin-top:6px;opacity:.8");
    if (!ad.wired) add("⚠ En Wi-Fi, l'allumage à distance du PC éteint est en pratique impossible : branchez un câble Ethernet, ou activez « PC ÉVEILLÉ » (voir GUIDE.md).", "color:#ffb000");
  }
  if (n.vpn_ips && n.vpn_ips.length && !n.vpn_enabled) add("VPN détecté (" + n.vpn_ips[0] + ") : pour l'accès hors de chez vous, mettez « allow_vpn_ranges » à true dans nasko_config.json puis réinstallez le certificat sur le téléphone.", "color:#ffb000");
  if (!n.keep_awake) add("Astuce : « PC ÉVEILLÉ : NON » → le PC se met en veille et devient injoignable depuis l'extérieur.", "opacity:.7");
}
if (window.NaskoApp) {                                       // dans l'application Android : bouton de réglages (adresse du PC, relais de réveil)
  document.body.classList.add("app");
  const bs = $("b-appset"); if (bs) { bs.hidden = false; bs.onclick = () => window.NaskoApp.settings(); }
}
$("b-awake").onclick = async () => {
  try {
    const cur = await api("/api/network");
    const r = await api("/api/power/keep-awake", { method: "POST", body: JSON.stringify({ enabled: !cur.keep_awake }) });
    say(r.active ? "PC maintenu éveillé : je reste joignable à distance." : "Mise en veille automatique rétablie.");
    sfx.ok(); loadNetwork();
  } catch (e) { say("PC éveillé : " + e.message, { kind: "err" }); }
};
$("b-net").onclick = async () => {
  try {
    const cur = await api("/api/network");
    const r = await api("/api/network/toggle", { method: "POST", body: JSON.stringify({ enabled: !cur.enabled }) });
    if (!r.ok) { say(r.error, { kind: "err" }); return; }
    say(r.enabled ? "Accès téléphone activé. Scannez le QR code avec votre S23+ (même Wi-Fi) et entrez le code." : "Accès téléphone désactivé. Les téléphones connectés ont été déconnectés.");
    sfx.ok(); loadNetwork();
  } catch (e) { say("Accès téléphone : " + e.message, { kind: "err" }); }
};

// ---------------------------------------------------------------- appareil de confiance (téléphone)
const DKEY = "nasko_device";   // jeton permanent de l'appareil (le même nom est utilisé par la page de connexion)
function storageOk() { try { localStorage.setItem("nasko_t", "1"); localStorage.removeItem("nasko_t"); return true; } catch (e) { return false; } }
async function ensureDeviceBackup(st) {
  // Connecté par cookie mais sans jeton dans le localStorage : on en range un (filet de sécurité si le cookie disparaît).
  if (!st.device || st.device.via !== "token" || !storageOk()) return;
  if (localStorage.getItem(DKEY)) return;
  try { const r = await api("/api/device/backup", { method: "POST" }); localStorage.setItem(DKEY, r.token); } catch (e) {}
}
$("b-forget").onclick = async () => {
  try { await api("/api/device/forget", { method: "POST" }); } catch (e) {}
  try { localStorage.removeItem(DKEY); } catch (e) {}
  location.replace("/");        // retour à l'écran du code : l'appareil est oublié
};

// ---------------------------------------------------------------- tiroir ☰ (mobile) : panneau latéral en surimpression
const menuOpen = () => document.body.classList.contains("menu-open");
function openMenu() { if (menuOpen()) return; document.body.classList.add("menu-open"); history.pushState({ menu: 1 }, ""); }
function closeMenu(fromPop) {
  if (!menuOpen()) return;
  document.body.classList.remove("menu-open");
  if (!fromPop && history.state && history.state.menu) history.back();     // garde l'historique propre
}
$("b-menu").onclick = openMenu;
$("b-menu-close").onclick = () => closeMenu();
$("scrim").onclick = () => closeMenu();
window.addEventListener("popstate", () => closeMenu(true));                 // bouton « retour » d'Android : ferme le tiroir
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
$("side").addEventListener("click", (e) => { if (e.target.closest("#b-env,#b-px,#b-clear")) setTimeout(() => closeMenu(), 180); });

// ---------------------------------------------------------------- appareils de confiance (PC)
function ago(iso) {
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  if (sec < 90) return "à l'instant";
  if (sec < 3600) return Math.round(sec / 60) + " min";
  if (sec < 86400) return Math.round(sec / 3600) + " h";
  return Math.round(sec / 86400) + " j";
}
async function loadDevices() {
  let d;
  try { d = await api("/api/devices"); } catch (e) { return; }
  const ul = $("devices"); ul.innerHTML = "";
  if (!d.devices.length) { const li = document.createElement("li"); li.className = "dim"; li.textContent = "aucun appareil enregistré"; ul.appendChild(li); }
  d.devices.forEach((dev) => {
    const li = document.createElement("li"); li.className = "dev";
    li.innerHTML = "<div class='dn'></div><div class='di dim'></div><div class='da'></div>";
    li.querySelector(".dn").textContent = dev.name;
    li.querySelector(".di").textContent = dev.ip + " · vu il y a " + ago(dev.last_seen);
    const act = li.querySelector(".da");
    const trust = document.createElement("button"); trust.className = "btn sm";
    trust.textContent = dev.ip_trusted ? "IP DE CONFIANCE ✓" : "FAIRE CONFIANCE À L'IP";
    trust.title = "Accès sans code ni jeton depuis cette adresse IP locale (trusted_ips)";
    trust.onclick = async () => { await api("/api/trusted-ips", { method: "POST", body: JSON.stringify({ ip: dev.ip, trusted: !dev.ip_trusted }) }); loadDevices(); };
    const rev = document.createElement("button"); rev.className = "btn sm"; rev.textContent = "RÉVOQUER";
    rev.onclick = async () => { await api("/api/devices/" + dev.id, { method: "DELETE" }); sfx.ok(); loadDevices(); };
    act.append(trust, rev); ul.appendChild(li);
  });
  $("devnote").textContent = d.trusted_ips.length ? "IP de confiance : " + d.trusted_ips.join(", ") : "Aucune IP de confiance (trusted_ips).";
}
$("b-revoke-all").onclick = async () => { await api("/api/devices/revoke-all", { method: "POST" }); sfx.err(); say("Tous les appareils de confiance ont été révoqués : le code sera redemandé."); loadDevices(); };

// ---------------------------------------------------------------- [ SCÈNES GODOT ] : liste + lancement (équivalent F6)
let scenes = [], sceneProject = null, sceneBusy = false;
const sceneOpen = new Set();                      // dossiers dépliés (la racine l'est toujours)
const SCENES_KEY = "nasko_scenes_open";
function applySceneSection(open) { $("scenessec").style.display = open ? "" : "none"; $("scenesh").classList.toggle("closed", !open); }
$("scenesh").onclick = () => {
  const open = $("scenessec").style.display === "none";
  try { localStorage.setItem(SCENES_KEY, open ? "1" : "0"); } catch (e) {}
  applySceneSection(open);
};
try { applySceneSection(localStorage.getItem(SCENES_KEY) !== "0"); } catch (e) {}

async function loadScenes() {
  $("scenenote").textContent = "analyse du projet…";
  try {
    const r = await api("/api/godot/scenes" + (current ? "?project=" + encodeURIComponent(current) : ""));
    if (!r.ok) { scenes = []; $("scenenote").textContent = r.message || ""; renderScenes(); return; }
    scenes = r.scenes;
    $("scenenote").textContent = (r.godot ? "" : "⚠ Godot introuvable (godot_path). ") + (r.truncated ? "Liste tronquée (3000 scènes max). " : "") +
      (scenes.length ? "" : "Aucune scène .tscn dans ce projet.");
    renderScenes();
  } catch (e) { scenes = []; $("scenenote").textContent = e.message; renderScenes(); }
}

function renderScenes() {
  const box = $("scenelist"); box.textContent = "";
  const q = $("scenefilter").value.trim().toLowerCase();
  const list = q ? scenes.filter((s) => (s.name + " " + s.dir).toLowerCase().includes(q)) : scenes;
  $("scenecount").textContent = scenes.length ? "(" + (q ? list.length + "/" : "") + scenes.length + ")" : "";
  const dup = {}; scenes.forEach((s) => { dup[s.name] = (dup[s.name] || 0) + 1; });
  const groups = new Map();
  list.forEach((s) => { if (!groups.has(s.dir)) groups.set(s.dir, []); groups.get(s.dir).push(s); });
  if (q && !list.length) { const d = document.createElement("div"); d.className = "dim"; d.textContent = "Aucune scène ne correspond."; box.appendChild(d); }
  groups.forEach((items, dir) => {
    const open = q !== "" || dir === "" || sceneOpen.has(dir);      // filtre actif : tout est déplié
    const g = document.createElement("div"); g.className = "sg";
    const head = document.createElement("div"); head.className = "sgh";
    head.innerHTML = "<span></span><span></span><span class='n'></span>";
    head.children[0].textContent = open ? "▾" : "▸";
    head.children[1].textContent = dir === "" ? "(racine)" : dir + "/";
    head.children[2].textContent = items.length;
    head.onclick = () => { if (q) return; sceneOpen.has(dir) ? sceneOpen.delete(dir) : sceneOpen.add(dir); renderScenes(); };
    g.appendChild(head);
    if (open) items.forEach((sc) => {
      const b = document.createElement("button"); b.className = "btn scene"; b.title = "res://" + sc.rel + "\nClic : lancer cette scène (équivalent F6)";
      b.append(sc.name.replace(/\.tscn$/i, ""));                     // seulement le nom du fichier, sans le chemin
      const ext = document.createElement("span"); ext.className = "ext"; ext.textContent = ".tscn"; b.appendChild(ext);
      if (dup[sc.name] > 1 && sc.dir) { const dd = document.createElement("span"); dd.className = "dd"; dd.textContent = "· " + sc.dir; b.appendChild(dd); }
      b.onclick = () => runScene(sc, b);
      g.appendChild(b);
    });
    box.appendChild(g);
  });
}
$("scenefilter").addEventListener("input", renderScenes);
$("scenerefresh").onclick = () => loadScenes();

async function runScene(sc, btn) {
  if (sceneBusy) return;                           // un clic à la fois : évite d'ouvrir la scène en double
  sceneBusy = true; btn.classList.add("busy");
  try {
    const n = await api("/api/narration/godot");
    let run;
    line("sys", "// scène", (sc.dir ? sc.dir + "/" : "") + sc.name);
    await sayRef(n.run, { onStart: () => {          // la scène démarre à l'instant où E.N.O.S. l'annonce
      run = api("/api/godot/run", { method: "POST", body: JSON.stringify({ rel: sc.rel, project: current }) })
        .catch((e) => ({ ok: false, message: e.message }));
    } });
    const r = await run;
    if (!r.ok) { await sayRef(r.code === "no_godot" ? n.notfound : n.fail, { kind: "err" }); say(r.message, { kind: "err" }); }
  } catch (e) { say("Scène : " + e.message, { kind: "err" }); }
  finally { sceneBusy = false; btn.classList.remove("busy"); }
}
