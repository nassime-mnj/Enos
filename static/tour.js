"use strict";
// VISITE GUIDÉE du premier lancement : overlay sombre, un élément mis en lumière à la fois, bulle explicative. « Passer le tutoriel » toujours visible.
// Les étapes dont la cible n'existe pas / est masquée (profil Friends, édition…) sont sautées : chacun ne voit que SES modules.
// Relançable : Réglages > « REVOIR LE TUTORIEL » ou window.enosTour.start(true).
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  const doneKey = () => "enos_tour_done_" + (document.body.dataset.role || "x");
  const OS = () => window.enosOS || null;
  const tile = (id) => `#lx .lx-t[data-id="${id}"]`;

  // os : cible dans la fenêtre native (barre « OS » + lanceur Ctrl+K) · classic : cible dans l'interface classique (navigateur, barre latérale)
  // center : bulle au centre, sans cible · lx : l'os-cible est dans le lanceur d'applications (ouvert pour l'occasion)
  const IN_OS = () => document.documentElement.classList.contains("os") && !!window.enosOS;
  const STEPS = [
    { center: true, title: "Bienvenue dans E.N.O.S.", text: () => `Tes outils au même endroit, avec une IA qui t'aide. Cette visite dure <b>une minute</b> : on te montre où tout se trouve. Tu peux la <b>passer à tout moment</b>.`, tag: true },
    { os: '#os-nav [data-v="home"]', title: "Accueil", text: "Ton tableau de bord : l'aperçu de ta journée, les alertes de l'IA et tes accès rapides." },
    { os: '#os-nav [data-v="chat"]', classic: "#form", title: "Chat IA", text: "Écris ou parle à E.N.O.S. (le micro est dans la barre de saisie) : il répond, résume, et peut agir pour toi." },
    { os: "#os-agenda", title: "Agenda", text: "Ton planning de la semaine. Ajoute des tâches puis <b>glisse-les</b> sur la timeline : elles s'aimantent aux créneaux. La couleur indique l'urgence, du bleu (plus tard) au rouge (en retard). Tu peux y relier Zeus et Moodle pour importer tes cours." },
    { os: "#os-apps", title: "Toutes les applications", text: "Tous tes modules sont ici. Raccourci : <b>Ctrl + K</b> depuis n'importe où." },
    { mod: "b-pdf", title: "Éditeur PDF", text: "Modifier, annoter, fusionner, réorganiser et convertir tes PDF sans quitter E.N.O.S." },
    { mod: "b-sm", title: "Studio média", text: "Images, vidéos et audio : retouches, conversions et montage simples." },
    { mod: "b-qt", title: "Outils rapides", text: "De petits utilitaires prêts à l'emploi : dépenses partagées, convertisseurs JSON / XML…" },
    { mod: "b-syl", title: "Syllabus Scanner", text: "Importe un plan de cours en PDF : l'IA remplit ton agenda toute seule." },
    { mod: "b-env", title: "Développement (Terna)", text: "Hub de dev, synchronisation, scènes Godot : le module réservé à l'équipe." },
    { mod: "b-rg", title: "Réglages", text: "Thème, <b>couleur d'accent</b>, effet <b>shiny</b>, profil. Tu pourras <b>revoir cette visite</b> depuis ici." },
    { center: true, title: "C'est parti !", text: () => `Besoin d'aide ? Demande-le simplement à E.N.O.S. dans le chat.${IN_OS() ? " <b>Ctrl + K</b> ouvre tous les modules." : ""}` },
  ];

  let steps = [], i = 0, on = false, root = null, lastTarget = null;

  const visible = (el) => !!el && !!(el.offsetWidth || el.offsetHeight) && getComputedStyle(el).visibility !== "hidden";

  function build() {
    if ($("tr")) return;
    root = document.createElement("div");
    root.id = "tr"; root.hidden = true; root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true"); root.setAttribute("aria-label", "Visite guidée");
    root.innerHTML = `<div id="tr-spot" aria-hidden="true"></div><div id="tr-b" tabindex="-1"><div class="tr-top"><span id="tr-n"></span><button type="button" id="tr-skip" class="tr-skip">PASSER LE TUTORIEL</button></div>
      <h3 id="tr-h"></h3><p id="tr-p"></p><div class="tr-dots" id="tr-dots"></div>
      <div class="tr-row"><button type="button" class="tr-b ghost" id="tr-prev">PRÉCÉDENT</button><button type="button" class="tr-b" id="tr-next">SUIVANT</button></div></div>`;
    document.body.appendChild(root);
    $("tr-skip").onclick = () => finish(false);
    $("tr-prev").onclick = () => go(-1);
    $("tr-next").onclick = () => go(1);
    document.addEventListener("keydown", (e) => {
      if (!on) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); }
      else if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); go(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
    }, true);
    window.addEventListener("resize", () => on && place());
  }

  // étapes réellement affichables, calculées au lancement : chaque étape choisit sa cible (fenêtre native ou interface classique) et est sautée si elle est absente / masquée
  async function plan() {
    const out = [], os = OS(), inOs = IN_OS();
    let lxOpen = false;
    for (const st of STEPS) {
      const s = { ...st };
      if (s.center) { out.push(s); continue; }
      let sel = null, lx = false;
      if (s.mod) {
        if (inOs) {
          if (!lxOpen) { os.openLauncher(); lxOpen = true; await wait(380); }
          const t = tile(s.mod); if (visible(document.querySelector(t))) { sel = t; lx = true; }
        } else if (visible(document.querySelector("#" + s.mod))) sel = "#" + s.mod;
      } else {
        if (lxOpen) { os.closeLauncher(); lxOpen = false; await wait(120); }
        const c = inOs ? s.os : s.classic;
        if (c && visible(document.querySelector(c))) sel = c;
      }
      if (!sel) continue;
      s.sel = sel; s.lx = lx; out.push(s);
    }
    if (lxOpen && os) os.closeLauncher();
    return out;
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function ensure(s) {
    const os = OS(); if (!os || !IN_OS()) return;
    const open = !!($("lx") && !$("lx").hidden);
    if (s.lx && !open) { os.openLauncher(); await wait(380); }
    if (!s.lx && open) { os.closeLauncher(); await wait(160); }
  }

  function place() {
    const s = steps[i], spot = $("tr-spot"), b = $("tr-b");
    const target = s.center ? null : document.querySelector(s.sel);
    lastTarget = target;
    b.classList.toggle("center", !target);
    if (!target) {
      spot.style.cssText = "left:50%;top:50%;width:0;height:0;";
      b.style.cssText = "";
      return;
    }
    const r = target.getBoundingClientRect(), pad = 8;
    spot.style.cssText = `left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px;`;
    const bw = Math.min(380, innerWidth - 24), bh = b.offsetHeight || 190;
    let x = r.left + r.width / 2 - bw / 2, y = r.bottom + 18, side = "below";
    if (y + bh > innerHeight - 12) { y = r.top - bh - 18; side = "above"; }
    if (y < 12) { y = Math.min(innerHeight - bh - 12, Math.max(12, r.top + r.height / 2 - bh / 2)); x = r.right + 18; side = "right"; if (x + bw > innerWidth - 12) { x = r.left - bw - 18; side = "left"; } }
    x = Math.max(12, Math.min(innerWidth - bw - 12, x));
    b.style.cssText = `left:${x}px;top:${Math.max(12, y)}px;width:${bw}px;`;
    b.dataset.side = side;
    const ax = Math.max(18, Math.min(bw - 18, r.left + r.width / 2 - x));
    b.style.setProperty("--ax", ax + "px");
  }

  async function show() {
    const s = steps[i];
    await ensure(s);
    $("tr-n").textContent = `${i + 1} / ${steps.length}`;
    $("tr-h").textContent = s.title;
    const role = ({ ceo: "CEO", dev: "Dev", friends: "Friends" })[document.body.dataset.role] || "";
    $("tr-p").innerHTML = (typeof s.text === "function" ? s.text() : s.text) + (s.tag && role ? `<span class="tr-role">Profil : ${esc(role)}</span>` : "");
    $("tr-dots").innerHTML = steps.map((_, k) => `<i class="${k === i ? "on" : k < i ? "past" : ""}"></i>`).join("");
    $("tr-prev").hidden = i === 0;
    $("tr-next").textContent = i === steps.length - 1 ? "TERMINER" : i === 0 ? "COMMENCER" : "SUIVANT";
    place();
    requestAnimationFrame(place);
    $("tr-next").focus({ preventScroll: true });
  }

  function go(d) {
    if (!on) return;
    const n = i + d;
    if (n >= steps.length) return finish(true);
    if (n < 0) return;
    i = n; show();
  }

  async function start(force) {
    if (on) return;
    build();
    document.body.classList.add("tour-planning");
    steps = await plan();
    document.body.classList.remove("tour-planning");
    if (steps.length < 2) return;
    on = true; i = 0; root.hidden = false; document.body.classList.add("tour-on");
    if (window.enosOS) window.enosOS.closeLauncher();
    window.dispatchEvent(new CustomEvent("enos:tour", { detail: { open: true, force: !!force } }));
    show();
  }

  function finish(completed) {
    if (!on) return;
    on = false; root.hidden = true; document.body.classList.remove("tour-on");
    store.set(doneKey(), completed ? "done" : "skipped");
    if (window.enosOS) window.enosOS.closeLauncher();
    window.dispatchEvent(new CustomEvent("enos:tour", { detail: { open: false, completed } }));
  }

  // premier lancement : après le choix du profil et l'assistant de configuration, une seule fois par profil et par appareil
  function blocking() {
    return ["rl", "ob", "pr", "sy"].some((id) => { const e = $(id); return e && !e.hidden && visible(e); });
  }
  function auto() {
    if (store.get(doneKey())) return;
    if (document.body.classList.contains("remote")) return;
    let tries = 0;
    const t = setInterval(() => {
      if (++tries > 240 || store.get(doneKey())) return clearInterval(t);
      if (!document.body.dataset.role || on || blocking()) return;
      clearInterval(t);
      setTimeout(() => { if (!store.get(doneKey())) start(false); }, 500);
    }, 750);
  }

  function injectCard() {
    const p = document.querySelector('#rg [data-p="th"]');
    if (!p || $("tr-card")) return;
    const c = document.createElement("div");
    c.className = "tm-card"; c.id = "tr-card";
    c.innerHTML = `<h3>TUTORIEL <small>visite guidée des modules</small></h3><div class="tm-row"><button class="btn sm" id="tr-redo" type="button">REVOIR LE TUTORIEL</button></div>`;
    p.appendChild(c);
    $("tr-redo").onclick = () => { const rg = $("rg"); if (rg) rg.hidden = true; start(true); };
  }

  window.enosTour = { start, skip: () => finish(false), isOpen: () => on, reset: () => { try { localStorage.removeItem(doneKey()); } catch (e) {} } };
  const init = () => { injectCard(); auto(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
