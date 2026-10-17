"use strict";
// ENVIRONNEMENT : sous-menu de session de travail (outils au choix, écran de destination, lancement échelonné).
(() => {
  const $ = (id) => document.getElementById(id);
  const TOKEN = document.querySelector('meta[name="nasko-token"]').content;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function api(path, opts = {}) {
    const r = await fetch(path, { ...opts, headers: { "X-Nasko-Token": TOKEN, "Content-Type": "application/json" } });
    if (!r.ok) {
      let d = r.statusText;
      try { d = (await r.json()).detail || d; } catch (e) {}
      throw new Error(typeof d === "string" ? d : "requête refusée");
    }
    return r.json();
  }
  const GLYPH = { powershell: ">_", claude: "✳", godot: "◈", aseprite: "▦" };
  const STATE = { pending: ["·", "EN ATTENTE"], launching: ["◌", "LANCEMENT"], waiting: ["◌", "PLACEMENT"], launched: ["✔", "LANCÉ"], already: ["✔", "DÉJÀ OUVERT"], failed: ["✕", "ÉCHEC"], skipped: ["–", "IGNORÉ"] };
  const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };

  let data = null, sel = new Set(), screen = 1, running = false;
  const isOpen = () => !$("ev").hidden;
  const view = (v) => { $("ev-pick").hidden = v !== "pick"; $("ev-run").hidden = v !== "run"; $("ev-load").hidden = v !== "load"; };

  // ---------------------------------------------------------------- ouverture : détection (rien n'est lancé)
  async function open() {
    if (running) { $("ev").hidden = false; view("run"); return; }
    $("ev").hidden = false; view("load");
    const proj = typeof current !== "undefined" ? current : null;
    try { data = await api("/api/env/info" + (proj ? "?path=" + encodeURIComponent(proj) : "")); }
    catch (e) { close(); return say("Environnement : " + e.message, { kind: "err" }); }
    if (!data.ok) {                                          // aucun projet / dossier absent : même parcours qu'avant
      close();
      if (data.code === "missing_dir" || data.code === "no_project") {
        if (data.say) await sayRef(data.say, { kind: "err" });
        offerProjectFix(data.path, data.message, true);
      } else say(data.message, { kind: "err" });
      return;
    }
    const saved = store.get("nasko_env_sel", null);
    sel = new Set(data.tools.filter((t) => t.ready && (saved ? saved.includes(t.id) : t.default)).map((t) => t.id));
    const savedScreen = store.get("nasko_env_screen", 1);
    screen = data.screens.some((s) => s.index === savedScreen) ? savedScreen : 1;
    render(); view("pick");
  }
  function close() { $("ev").hidden = true; }

  // ---------------------------------------------------------------- rendu du sous-menu
  function render() {
    $("ev-proj").textContent = data.name;
    $("ev-proj").title = data.path;
    const g = $("ev-tools");
    g.innerHTML = "";
    data.tools.forEach((t, i) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "ev-tool" + (sel.has(t.id) ? " on" : "") + (t.ready ? "" : " off"); b.dataset.id = t.id;
      b.style.animationDelay = i * 60 + "ms"; b.disabled = !t.ready;
      b.setAttribute("role", "checkbox"); b.setAttribute("aria-checked", sel.has(t.id));
      b.innerHTML = `<span class="chk"><i></i></span><span class="gl">${GLYPH[t.id]}</span><span class="tx"><b>${esc(t.label)}</b><small>${esc(t.sub)}</small></span>
        <em class="${t.ready ? (t.open ? "open" : "ok") : "no"}">${t.ready ? (t.open ? "DÉJÀ OUVERT" : "PRÊT") : "INTROUVABLE"}</em>`;
      b.onclick = () => { sel.has(t.id) ? sel.delete(t.id) : sel.add(t.id); store.set("nasko_env_sel", [...sel]); render(); };
      g.appendChild(b);
    });
    renderScreens();
    const n = sel.size;
    $("ev-go").disabled = n === 0;
    $("ev-go-n").textContent = n ? `${n} outil${n > 1 ? "s" : ""}` : "aucun outil coché";
    const ready = data.tools.filter((t) => t.ready).length;
    $("ev-all").disabled = ready === 0;
    $("ev-note").textContent = `Lancement échelonné : ${data.stagger.toLocaleString("fr-FR")} s entre chaque outil pour ne pas saturer le PC.`;
  }

  function renderScreens() {                                // visible UNIQUEMENT s'il y a plus d'un écran
    const box = $("ev-screens");
    box.hidden = data.screens.length < 2;
    if (box.hidden) return;
    const S = data.screens;
    const minX = Math.min(...S.map((s) => s.x)), minY = Math.min(...S.map((s) => s.y));
    const W = Math.max(...S.map((s) => s.x + s.width)) - minX, H = Math.max(...S.map((s) => s.y + s.height)) - minY;
    const map = $("ev-map");
    map.style.aspectRatio = `${W} / ${H}`;
    map.innerHTML = "";
    S.forEach((s) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "ev-mon" + (s.index === screen ? " on" : ""); b.dataset.i = s.index;
      b.style.cssText = `left:${(s.x - minX) / W * 100}%;top:${(s.y - minY) / H * 100}%;width:${s.width / W * 100}%;height:${s.height / H * 100}%`;
      b.innerHTML = `<span class="mn">${s.index}</span><span class="ml">${esc(s.label.toUpperCase())}</span><small>${s.width}×${s.height}${s.primary ? " · principal" : ""}</small>`;
      b.onclick = () => { screen = s.index; store.set("nasko_env_screen", screen); renderScreens(); };
      map.appendChild(b);
    });
    $("ev-screen-v").textContent = S.find((s) => s.index === screen).label;
  }

  // ---------------------------------------------------------------- lancement + suivi
  async function launch(tools) {
    if (!tools.length) return;
    const body = { tools, screen: data.screens.length > 1 ? screen : null, path: data.path };
    try { await api("/api/env/launch", { method: "POST", body: JSON.stringify(body) }); }
    catch (e) { return say("Environnement : " + e.message, { kind: "err" }); }
    running = true;
    $("ev-bar").style.width = "0%"; $("ev-fin").hidden = true; $("ev-close2").hidden = true;
    $("ev-run-t").textContent = "SESSION EN COURS"; $("ev-run-s").textContent = `Lancement échelonné · ${data.stagger.toLocaleString("fr-FR")} s entre chaque outil` + (body.screen ? ` · destination : Écran ${body.screen}` : "");
    view("run");
    if (data.voice) sayRef(data.voice.intro).catch(() => {});
    const said = new Set();
    let st;
    for (;;) {
      try { st = await api("/api/env/status"); } catch (e) { await wait(500); continue; }
      renderRun(st);
      st.items.forEach((it) => {                            // narration : l'étape est annoncée à l'instant où l'outil démarre
        const v = data.voice && data.voice[it.id];
        if (!v || said.has(it.id)) return;
        if (it.state === "launching" || it.state === "waiting") { said.add(it.id); if (v.say) sayRef(v.say).catch(() => {}); }
        else if (it.state === "failed") { said.add(it.id); if (v.fail) sayRef(v.fail, { kind: "err" }).catch(() => {}); }
      });
      if (!st.running && st.done) break;
      await wait(400);
    }
    running = false;
    const bad = st.items.filter((i) => i.state === "failed" || i.state === "skipped").length;
    $("ev-run-t").textContent = bad ? "SESSION TERMINÉE AVEC AVERTISSEMENTS" : "SESSION PRÊTE";
    $("ev-fin").hidden = false; $("ev-fin").className = "ev-fin " + (bad ? "warn" : "ok");
    $("ev-fin").textContent = bad ? `${bad} outil(s) non lancé(s) — voir le détail ci-dessus.` : `Tous les outils sont lancés. Bon travail, ${window.enosUser || "l'équipe"}.`;
    $("ev-close2").hidden = false;
    if (!bad && data.voice) sayRef(data.voice.done).catch(() => {});
  }

  function renderRun(st) {
    const list = $("ev-items");
    if (list.children.length !== st.items.length) {
      list.innerHTML = st.items.map((it) => `<div class="ev-it" data-id="${it.id}"><span class="g">${GLYPH[it.id]}</span><div class="m"><b>${esc(it.label)}</b><small></small></div><span class="s"></span></div>`).join("");
    }
    let done = 0;
    st.items.forEach((it) => {
      const row = list.querySelector(`[data-id="${it.id}"]`);
      const [ic, tx] = STATE[it.state] || ["·", it.state];
      row.className = "ev-it " + it.state;
      row.querySelector("small").textContent = it.msg;
      row.querySelector(".s").innerHTML = `<i>${ic}</i>${tx}`;
      if (!["pending", "launching", "waiting"].includes(it.state)) done++;
    });
    $("ev-bar").style.width = Math.round((done / st.items.length) * 100) + "%";
  }

  function init() {
    if (!$("b-env")) return;
    // plus aucun lancement direct : le bouton ouvre le sous-menu. Sur téléphone (sous-menu réservé au PC), il garde son ancien rôle :
    // demander à E.N.O.S. de préparer l'environnement sur le PC. Testé à l'exécution, car app.js peut poser son gestionnaire avant ou après celui-ci.
    $("b-env").onclick = () => (document.body.classList.contains("remote") ? sendMessage("Prépare mon environnement de dev.") : open());
    $("ev-x").onclick = close; $("ev-close2").onclick = close;
    $("ev-go").onclick = () => launch(data.tools.map((t) => t.id).filter((id) => sel.has(id)));
    $("ev-all").onclick = () => { sel = new Set(data.tools.filter((t) => t.ready).map((t) => t.id)); store.set("nasko_env_sel", [...sel]); render(); launch([...sel]); };
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen()) close(); });
  }
  init();
})();
