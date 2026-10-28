"use strict";
// Version PC des modules échecs : m_learn.js, m_advisor.js, chess_brain.js… sont les MÊMES fichiers que sur le téléphone (copiés par build_learn_data.py). Ce shim fournit la petite partie
// de l'API window.ENOS dont ils ont besoin (réglages, feuilles, registre de modules, outils de fichiers) et branche ETO sur le LLM configuré sur ce PC (/api/chess/llm, /api/chess/vision)
// quand la page est ouverte dans l'interface d'E.N.O.S. (iframe : les appels passent par la fenêtre parente, qui ajoute la clé d'API).
window.ENOS = window.ENOS || {};
(() => {
  const E = window.ENOS;
  E.esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  E.$ = (s, r) => (r || document).querySelector(s);
  E.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  E.vibrate = () => {};
  E.assetBase = "";
  const mem = {};
  const raw = { get(k) { try { return localStorage.getItem(k); } catch (e) { return mem[k] == null ? null : mem[k]; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { mem[k] = v; } } };
  const store = { get(k, d) { try { const v = raw.get("enos." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { raw.set("enos." + k, JSON.stringify(v)); } };
  E.settings = { get: (k, d) => store.get("s." + k, d), set: (k, v) => store.set("s." + k, v) };

  let onClose = null;
  const $ = (s) => document.querySelector(s);
  const ui = (E.ui = {});
  ui.sheet = (o) => {
    ui.closeSheet(true);
    const s = $("#sheet");
    s.innerHTML = `${o.title ? `<h2>${E.esc(o.title)}</h2>` : ""}${o.html || ""}${(o.options || []).map((x, i) => `<button class="opt ${x.cls || ""}" data-i="${i}">${E.esc(x.label)}</button>`).join("")}`;
    s.hidden = false; $("#scrim").hidden = false; onClose = o.onClose || null;
    s.querySelectorAll(".opt").forEach((b) => (b.onclick = () => { const x = o.options[+b.dataset.i]; ui.closeSheet(); if (x.fn) x.fn(); }));
    $("#scrim").onclick = () => ui.closeSheet();
    if (o.onOpen) o.onOpen(s);
    return s;
  };
  ui.closeSheet = (instant) => {
    const s = $("#sheet");
    if (s.hidden) return false;
    s.hidden = true; s.innerHTML = ""; $("#scrim").hidden = true;
    if (onClose) { const f = onClose; onClose = null; setTimeout(f, 0); }          // après le fn de l'option choisie (voir ui.js du téléphone)
    return true;
  };
  ui.toast = (m) => { const t = $("#toast"); if (!t) return console.log(m); t.textContent = m; t.hidden = false; clearTimeout(ui._t); ui._t = setTimeout(() => (t.hidden = true), 3500); };
  ui.confirm = (title, text, okLabel) => new Promise((res) => {
    let answered = false;
    ui.sheet({ title, html: `<p class="muted">${E.esc(text)}</p>`, options: [{ label: okLabel || "CONFIRMER", fn: () => { answered = true; res(true); } }, { label: "ANNULER", fn: () => { answered = true; res(false); } }], onClose: () => { if (!answered) res(false); } });
  });

  // ---- LLM de ce PC (via la fenêtre parente : sec.js y ajoute « Authorization: Bearer »)
  const par = (() => { try { return window.parent && window.parent !== window && window.parent.fetch ? window.parent : null; } catch (e) { return null; } })();
  let llmOk = false;
  const post = async (path, body) => {
    if (!par) throw new Error("Ouvre cette page depuis l'interface d'E.N.O.S. pour utiliser ETO.");
    const r = await par.fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || r.statusText);
    return j;
  };
  if (par) par.fetch("/api/status").then((r) => r.json()).then((j) => { llmOk = !!j.llm; }).catch(() => {});
  const SYS = {
    eto: "Tu es ETO, coach d'échecs : tu parles français, ton exubérant et bienveillant de joueur passionné, tu tutoies.",
    enos: "Tu es E.N.O.S., assistant analytique et sobre : français, tutoiement, précis.",
  };
  E.ai = {
    configured: () => llmOk,
    name: () => "ETO",
    PERSONAS: { eto: { system: () => SYS.eto }, enos: { system: () => SYS.enos } },
    chat: async (persona, text, onDelta, opts) => (await post("/api/chess/llm", { system: (opts && opts.system) || SYS[persona] || "", user: text, max_tokens: 260 })).text,
    speak(persona, text) { try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(String(text || "").replace(/<[^>]+>/g, " ")); u.lang = "fr-FR"; u.rate = 1.05; speechSynthesis.speak(u); } catch (e) { /* pas de synthèse vocale */ } },
    stopVoice() { try { speechSynthesis.cancel(); } catch (e) { /* rien à couper */ } },
  };

  // ---- registre de modules + outils communs (fichiers, presse-papiers) comme suite.js du téléphone
  const A = {
    esc: E.esc, toast: (m) => ui.toast(m),
    pick: (o) => new Promise((res) => {
      const i = document.createElement("input"); i.type = "file"; i.accept = (o && o.accept) || "*/*"; i.multiple = !!(o && o.multiple); i.style.display = "none"; document.body.appendChild(i);
      let done = false; const end = (v) => { if (done) return; done = true; i.remove(); res(v); };
      i.onchange = () => end(Array.from(i.files || [])); i.addEventListener("cancel", () => end([])); i.click();
    }),
    copy: async (t) => { try { await navigator.clipboard.writeText(t); ui.toast("Copié."); return true; } catch (e) { ui.toast("Copie impossible."); return false; } },
    read: (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(new Uint8Array(r.result)); r.onerror = () => rej(new Error("lecture impossible")); r.readAsArrayBuffer(file); }),
    llm: async ({ system, user, json, maxTokens }) => (await post("/api/chess/llm", { system: system || "", user, max_tokens: maxTokens || 400, json_mode: !!json })).text,
    llmVision: async ({ system, ask, image, maxTokens }) => (await post("/api/chess/vision", { system: system || "", ask, image: typeof image === "string" ? image : image.toDataURL("image/jpeg", 0.85), max_tokens: maxTokens || 400 })).text,
  };
  E.suite = { modules: [], api: A, register(m) { E.suite.modules.push(m); } };
})();
