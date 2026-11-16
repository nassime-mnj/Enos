"use strict";
// JOURNAL DE PLANTAGES (côté page) : erreurs JavaScript, promesses rejetées, derniers gestes (« fil d'Ariane ») et détection d'un arrêt anormal de la session précédente.
// Destinations : pont Android (CrashLog.java, fichier files/crash.log) ; sinon serveur PC (POST /api/crash/log -> crash.log) ; dans tous les cas une copie locale (60 entrées).
// Chargé EN PREMIER dans la page. Rien n'est envoyé hors de l'appareil / du PC. Même fichier pour l'application mobile et les pages PC.
(() => {
  if (window.EnosCrash) return;
  const KEY = "enos.crash.v1", SES = "enos.crash.session", SEEN = "enos.crash.seen", MAXN = 60;
  const ls = { get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* quota / mode privé */ } } };
  const nat = () => !!(window.Enos && typeof window.Enos.crashAdd === "function");
  const web = () => /^https?:$/.test(location.protocol) && !nat();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = (d) => { d = d || new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const crumbs = []; let lastMsg = "", lastT = 0;
  const hdr = () => { const m = document.querySelector('meta[name="nasko-token"]'); return { "content-type": "application/json", ...(m ? { "X-Nasko-Token": m.content } : {}) }; };
  const mem = () => { try { const m = performance.memory; return m ? Math.round(m.usedJSHeapSize / 1048576) + "/" + Math.round(m.jsHeapSizeLimit / 1048576) + " Mo" : ""; } catch (e) { return ""; } };
  const where = () => { try { return location.pathname.split("/").pop() + location.hash; } catch (e) { return ""; } };

  function add(kind, msg) {
    msg = String(msg == null ? "" : msg).slice(0, 4000); const now = Date.now();
    if (msg === lastMsg && now - lastT < 5000) return; lastMsg = msg; lastT = now;                                      // même erreur en boucle : une seule ligne
    const ctx = `${where()}${mem() ? " · mémoire JS " + mem() : ""}${crumbs.length ? " · derniers gestes : " + crumbs.slice(-6).join(" > ") : ""}`;
    const line = `[${stamp()}] ${kind} · ${msg}${ctx ? "\n    " + ctx : ""}`;
    const l = ls.get(KEY) || []; l.push(line); ls.set(KEY, l.slice(-MAXN));
    try {
      if (nat()) window.Enos.crashAdd(kind, msg + (ctx ? "\n    " + ctx : ""));
      else if (web()) fetch("/api/crash/log", { method: "POST", headers: hdr(), body: JSON.stringify({ kind, msg: msg + (ctx ? "\n    " + ctx : "") }), keepalive: true }).catch(() => {});
    } catch (e) { /* le journal ne doit jamais planter */ }
  }

  // ---- fil d'Ariane : derniers appuis, enregistrés (au plus 1 fois par seconde) pour survivre à un arrêt brutal
  let saveT = 0;
  const desc = (el) => { try { const t = (el.closest && el.closest("button,a,[data-id],[data-t],[id],.hub-tile,.btn")) || el; const id = t.id ? "#" + t.id : t.dataset && (t.dataset.id || t.dataset.t) ? "[" + (t.dataset.id || t.dataset.t) + "]" : ""; return ((t.tagName || "").toLowerCase() + id + " " + (t.textContent || "").trim().replace(/\s+/g, " ").slice(0, 24)).trim(); } catch (e) { return "?"; } };
  const persist = (state) => { ls.set(SES, { state, t: Date.now(), at: stamp(), where: where(), crumbs: crumbs.slice(-8) }); };
  addEventListener("click", (e) => { crumbs.push(desc(e.target)); if (crumbs.length > 20) crumbs.shift(); const n = Date.now(); if (n - saveT > 1000) { saveT = n; persist("fg"); } }, true);
  addEventListener("hashchange", () => { crumbs.push("→" + where()); persist("fg"); });
  document.addEventListener("visibilitychange", () => persist(document.hidden ? "bg" : "fg"));
  addEventListener("pagehide", () => persist("clean"));

  // ---- erreurs
  addEventListener("error", (e) => { if (e.target && e.target !== window && (e.target.src || e.target.href)) return add("RESSOURCE", "introuvable : " + (e.target.src || e.target.href)); add("JS", `${e.message} (${String(e.filename || "").split("/").pop()}:${e.lineno}:${e.colno})${e.error && e.error.stack ? "\n" + String(e.error.stack).split("\n").slice(0, 5).join("\n") : ""}`); }, true);
  addEventListener("unhandledrejection", (e) => { const r = e.reason; add("PROMESSE", r && r.stack ? String(r.stack).split("\n").slice(0, 5).join("\n") : String(r)); });

  // ---- arrêt anormal de la session précédente (la page n'a jamais reçu « pagehide »)
  const prev = ls.get(SES);
  if (prev && prev.state === "fg") add("ARRÊT", `session précédente interrompue au premier plan (${prev.at}) sur ${prev.where || "?"} · derniers gestes : ${(prev.crumbs || []).join(" > ") || "aucun"}`);
  persist("fg");

  const read = () => {
    if (nat()) { try { return String(window.Enos.crashLog() || ""); } catch (e) { /* repli local */ } }
    return (ls.get(KEY) || []).join("\n");
  };
  const readAsync = async () => { if (web()) { try { const r = await fetch("/api/crash/log", { headers: hdr() }); if (r.ok) return (await r.json()).text || ""; } catch (e) { /* repli local */ } } return read(); };
  const clear = () => { ls.set(KEY, []); try { if (nat()) window.Enos.crashClear(); else if (web()) fetch("/api/crash/clear", { method: "POST", headers: hdr() }).catch(() => {}); } catch (e) { /* rien */ } };
  const report = () => `E.N.O.S. — journal de plantages (${stamp()})\n${navigator.userAgent}\necran ${screen.width}x${screen.height} · ${where()}\n\n${read() || "(vide)"}`;
  const serious = (txt) => (txt || "").split("\n").filter((l) => /^\[\d{4}-/.test(l) && /(JAVA|WEBVIEW|ARRÊT)|(PLANTAGE|MÉMOIRE BASSE|ANR|NE RÉPOND)/.test(l));
  const unseen = () => { const seen = ls.get(SEEN) || ""; return serious(read()).filter((l) => l.slice(1, 20) > seen); };
  const markSeen = () => { const s = serious(read()); if (s.length) ls.set(SEEN, s.map((l) => l.slice(1, 20)).sort().pop()); };
  window.EnosCrash = { add, read, readAsync, clear, report, unseen, markSeen, crumbs: () => crumbs.slice(), stamp };

  // avertit au lancement si un plantage a été enregistré depuis la dernière consultation du journal
  setTimeout(() => { try { const u = unseen(); if (u.length && window.ENOS && ENOS.ui && ENOS.ui.toast) ENOS.ui.toast("L'application a rencontré un problème : ouvre Paramètres › Journal de plantages.", "warn"); } catch (e) { /* rien */ } }, 3500);
})();
