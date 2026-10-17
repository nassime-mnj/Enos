"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const BASE = document.body.dataset.base;
  let tok = "";
  try { tok = sessionStorage.getItem("dp_adm") || ""; } catch (e) {}
  const when = (t) => (t ? new Date(t * 1000).toLocaleString("fr-FR") : "—");
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  async function api(path, opt = {}) {
    const r = await fetch(BASE + "/api/" + path, { ...opt, headers: { "Content-Type": "application/json", "X-Admin-Token": tok } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.detail || r.statusText); e.status = r.status; throw e; }
    return j;
  }
  async function load() {
    try {
      const d = await api("ips");
      $("login").hidden = true; $("panel").hidden = false; $("me").textContent = "Votre IP : " + d.me;
      $("list").innerHTML = d.items.length ? d.items.map((i) => `<li><span><code>${esc(i.entry)}</code> — ${esc(i.label)}<br><small>ajoutée ${when(i.added_at)}${i.expires_at ? " · expire " + when(i.expires_at) : ""} · vue ${when(i.last_seen)}</small></span><button data-e="${esc(i.entry)}">Retirer</button></li>`).join("") : "<li>Aucune adresse autorisée.</li>";
      $("dl").innerHTML = d.downloads.length ? d.downloads.map((x) => `<li><span>${when(x.t)} — <code>${esc(x.ip)}</code> (${esc(x.entry)})</span><small>${x.ok ? "ok" : "échec"}</small></li>`).join("") : "<li>Aucun.</li>";
    } catch (e) {
      $("panel").hidden = true; $("login").hidden = false;
      if (tok) $("login-err").textContent = e.message; try { sessionStorage.removeItem("dp_adm"); } catch (x) {} tok = "";
    }
  }
  $("login-form").addEventListener("submit", (e) => { e.preventDefault(); tok = $("tok").value; try { sessionStorage.setItem("dp_adm", tok); } catch (x) {} $("tok").value = ""; load(); });
  $("add-form").addEventListener("submit", async (e) => {
    e.preventDefault(); $("err").textContent = "";
    try { await api("ips", { method: "POST", body: JSON.stringify({ ip: $("ip").value, label: $("label").value, days: $("days").value ? +$("days").value : null }) }); $("ip").value = $("label").value = $("days").value = ""; load(); } catch (er) { $("err").textContent = er.message; }
  });
  $("add-me").addEventListener("click", async () => { $("err").textContent = ""; try { await api("ips/me", { method: "POST", body: JSON.stringify({ ip: "", label: $("label").value || "Mon IP actuelle" }) }); load(); } catch (er) { $("err").textContent = er.message; } });
  $("list").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-e]"); if (!b) return;
    if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "Confirmer ?"; setTimeout(() => { b.classList.remove("armed"); b.textContent = "Retirer"; }, 4000); return; }
    try { await api("ips?entry=" + encodeURIComponent(b.dataset.e), { method: "DELETE" }); load(); } catch (er) { $("err").textContent = er.message; }
  });
  if (tok) load();
})();
