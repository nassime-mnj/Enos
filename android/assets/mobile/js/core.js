"use strict";
// Noyau : bus d'événements, stockage des réglages NON secrets (localStorage), petits utilitaires. Aucun secret ici : les clés vivent dans le coffre natif.
window.ENOS = window.ENOS || {};
(() => {
  const E = window.ENOS;
  const subs = {};
  E.on = (ev, fn) => { (subs[ev] = subs[ev] || []).push(fn); return () => { subs[ev] = (subs[ev] || []).filter((f) => f !== fn); }; };
  E.emit = (ev, data) => { (subs[ev] || []).slice().forEach((f) => { try { f(data); } catch (e) { console.error("[ENOS]", ev, e); } }); };

  E.$ = (s, r) => (r || document).querySelector(s);
  E.$$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  E.esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  E.pad = (n) => String(n).padStart(2, "0");
  E.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  E.ymd = (d) => d.getFullYear() + "-" + E.pad(d.getMonth() + 1) + "-" + E.pad(d.getDate());
  E.bytes = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + " Mo" : b >= 1024 ? Math.round(b / 1024) + " Ko" : b + " o");
  E.vibrate = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms || 12); } catch (e) { /* pas de vibreur */ } };

  // localStorage peut être indisponible : repli mémoire.
  const mem = {};
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return mem[k] == null ? null : mem[k]; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { mem[k] = v; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { delete mem[k]; } },
  };
  E.ls = ls;
  E.store = {
    get(k, def) { try { const v = ls.get("enos." + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
    set(k, v) { ls.set("enos." + k, JSON.stringify(v)); },
    del(k) { ls.del("enos." + k); },
  };
  E.settings = { get: (k, d) => E.store.get("s." + k, d), set: (k, v) => { E.store.set("s." + k, v); E.emit("settings", k); } };

  // État global minimal : mode (standalone|connected) piloté par link.js
  E.state = { mode: "standalone", tab: "home" };
})();
