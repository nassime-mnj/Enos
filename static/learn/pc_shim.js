"use strict";
// Version PC de « Apprendre » : m_learn.js est le MÊME fichier que sur le téléphone (copié par build_learn_data.py). Ce shim fournit la petite partie de l'API
// window.ENOS dont il a besoin (réglages, feuilles, registre de modules). ETO (LLM) n'est pas branché ici : les boutons « Demander à ETO » l'indiquent.
window.ENOS = window.ENOS || {};
(() => {
  const E = window.ENOS;
  E.esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  E.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  E.vibrate = () => {};
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
    s.innerHTML = `${o.title ? `<h2>${E.esc(o.title)}</h2>` : ""}${o.html || ""}${(o.options || []).map((x, i) => `<button class="opt" data-i="${i}">${E.esc(x.label)}</button>`).join("")}`;
    s.hidden = false; $("#scrim").hidden = false; onClose = o.onClose || null;
    s.querySelectorAll(".opt").forEach((b) => (b.onclick = () => { const x = o.options[+b.dataset.i]; ui.closeSheet(); if (x.fn) x.fn(); }));
    $("#scrim").onclick = () => ui.closeSheet();
    return s;
  };
  ui.closeSheet = () => {
    const s = $("#sheet");
    if (s.hidden) return false;
    s.hidden = true; s.innerHTML = ""; $("#scrim").hidden = true;
    if (onClose) { const f = onClose; onClose = null; f(); }
    return true;
  };
  ui.toast = (m) => console.log(m);

  E.ai = { configured: () => false, name: () => "ETO", PERSONAS: {}, chat: () => Promise.reject(new Error("ETO n'est pas branché sur cette page.")), speak() {} };

  E.suite = { modules: [], register(m) { E.suite.modules.push(m); } };
})();
