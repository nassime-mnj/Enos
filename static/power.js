// Arrêt / veille du PC en sécurité : confirmation, code d'accès (à distance), compte à rebours ANNULABLE.
(() => {
  "use strict";
  const M = $("pw"), isRemote = () => document.body.classList.contains("remote");
  const S = { action: null, step: "confirm", timer: null, fails: 0 };
  const LABEL = { shutdown: "ÉTEINDRE LE PC", sleep: "METTRE LE PC EN VEILLE" };
  const WHAT = {
    shutdown: "Le PC va s'éteindre complètement. Pour le rallumer à distance il faudra le relais de réveil (voir GUIDE.md).",
    sleep: "Le PC se met en veille (écran et programmes conservés). C'est l'option idéale pour le rallumer ensuite à distance.",
  };

  function view(step) {
    S.step = step;
    $("pw-confirm").hidden = step !== "confirm";
    $("pw-count").hidden = step !== "count";
    $("pw-done").hidden = step !== "done";
  }
  function open(action) {
    if (!M.hidden) return;
    S.action = action; S.fails = 0;
    $("pw-title").textContent = LABEL[action] + " ?";
    $("pw-msg").textContent = WHAT[action] + " Les scènes de test en cours seront arrêtées. Un programme avec un travail non enregistré peut bloquer l'arrêt.";
    $("pw-pin").hidden = !isRemote(); $("pw-pin").value = ""; $("pw-err").textContent = "";
    $("pw-go").disabled = false; $("pw-go").classList.toggle("danger", action === "shutdown");
    view("confirm"); M.hidden = false; M.classList.add("on");
    if (typeof sfx !== "undefined" && sfx.err) sfx.err();
    setTimeout(() => (isRemote() ? $("pw-pin") : $("pw-no")).focus(), 60);
  }
  function close() { M.classList.remove("on"); M.hidden = true; clearInterval(S.timer); S.timer = null; }

  async function confirm() {
    $("pw-go").disabled = true; $("pw-err").textContent = "";
    try {
      const r = await api("/api/power/request", { method: "POST", body: JSON.stringify({ action: S.action, pin: $("pw-pin").value }) });
      showCount(r);
    } catch (e) {
      $("pw-err").textContent = e.status === 403 ? "⛔ " + e.message : e.message;
      $("pw-go").disabled = false; $("pw-pin").value = "";
      if (typeof sfx !== "undefined" && sfx.err) sfx.err();
    }
  }
  function showCount(info) {
    S.action = info.action; S.until = info.at * 1000 - (info.now * 1000 - Date.now()); S.total = info.delay;
    $("pw-count-title").textContent = (info.label || LABEL[info.action]).toUpperCase() + " DANS";
    $("pw-by").textContent = info.by && info.by !== "PC" ? "demandé par " + info.by : "";
    view("count"); M.hidden = false; M.classList.add("on");
    clearInterval(S.timer); S.timer = setInterval(tick, 250); tick();
  }
  function tick() {
    const left = Math.max(0, (S.until - Date.now()) / 1000);
    $("pw-sec").textContent = Math.ceil(left);
    $("pw-fill").style.width = (100 * left / (S.total || 20)) + "%";
    if (left <= 0) {
      clearInterval(S.timer); S.timer = null; view("done");
      $("pw-done-msg").textContent = S.action === "sleep" ? "Mise en veille en cours… la connexion va se couper." : "Arrêt en cours… la connexion va se couper.";
    }
  }
  async function cancel() {
    try { await api("/api/power/cancel", { method: "POST", body: "{}" }); } catch (e) {}
    close(); if (typeof sfx !== "undefined" && sfx.ok) sfx.ok();
    const t = $("f6-toast"); if (t) { t.textContent = "ARRÊT ANNULÉ"; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 2200); }
  }

  // un compte à rebours lancé depuis un autre appareil s'affiche aussi ici (et peut y être annulé)
  async function sync() {
    if (document.hidden || S.step === "done") return;
    try {
      const st = await api("/api/power/state"); S.fails = 0;
      if (st.pending && (M.hidden || S.step !== "count")) showCount({ ...st.pending, now: st.now, label: null });
      else if (!st.pending && S.step === "count") close();
    } catch (e) { S.fails++; }
  }

  $("b-off").onclick = () => open("shutdown");
  $("b-sleep").onclick = () => open("sleep");
  const fb = $("f6-power"); if (fb) fb.onclick = () => open("shutdown");
  $("pw-go").onclick = confirm;
  $("pw-no").onclick = close;
  $("pw-cancel").onclick = cancel;
  $("pw-pin").addEventListener("keydown", (e) => { if (e.key === "Enter") confirm(); });
  document.addEventListener("keydown", (e) => {
    if (M.hidden || e.key !== "Escape") return;
    e.stopPropagation(); e.preventDefault();
    S.step === "count" ? cancel() : S.step === "confirm" ? close() : null;
  }, true);
  setTimeout(sync, 2500); setInterval(sync, 4000);
})();
