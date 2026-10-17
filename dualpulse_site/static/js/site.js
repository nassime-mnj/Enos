"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  document.documentElement.classList.remove("nojs");

  // ---- menu mobile
  const burger = $("burger"), nav = $("nav");
  burger.addEventListener("click", () => { const o = nav.classList.toggle("open"); burger.setAttribute("aria-expanded", o); });
  nav.addEventListener("click", (e) => { if (e.target.tagName === "A") { nav.classList.remove("open"); burger.setAttribute("aria-expanded", "false"); } });

  // ---- apparition au défilement
  const els = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0.12 });
    els.forEach((el) => io.observe(el));
  } else els.forEach((el) => el.classList.add("in"));

  // ---- galerie : vidéos en boucle, sauf si l'utilisateur demande moins d'animations
  if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) document.querySelectorAll(".shot video").forEach((v) => { v.removeAttribute("autoplay"); v.pause(); });

  // ---- Assistant Support
  const chat = $("chat"), log = $("chat-log"), input = $("chat-in"), sug = $("chat-sug"), fab = $("chat-fab");
  let greeted = false, busy = false;
  const add = (cls, text) => { const d = document.createElement("div"); d.className = "msg " + cls; d.textContent = text; log.appendChild(d); log.scrollTop = log.scrollHeight; return d; };
  function openChat() {
    chat.hidden = false; fab.hidden = true; fab.setAttribute("aria-expanded", "true");
    if (!greeted) { greeted = true; add("bot", "Assistant Support de Dual Pulse. Studio, jeu, sortie, tests : posez votre question."); }
    setTimeout(() => input.focus(), 50);
  }
  function closeChat() { chat.hidden = true; fab.hidden = false; fab.setAttribute("aria-expanded", "false"); fab.focus(); }
  fab.addEventListener("click", openChat); $("chat-close").addEventListener("click", closeChat);
  const o2 = $("open-chat-2"); if (o2) o2.addEventListener("click", openChat);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !chat.hidden) closeChat(); });

  async function ask(text) {
    text = text.trim(); if (!text || busy) return;
    busy = true; add("me", text); input.value = ""; sug.innerHTML = "";
    const t = add("bot typing", "…");
    try {
      const r = await fetch("/api/support", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text }) });
      const j = await r.json();
      t.className = "msg bot"; t.textContent = j.reply || "Désolé, une erreur est survenue.";
      (j.suggestions || []).forEach((s) => { const b = document.createElement("button"); b.type = "button"; b.className = "chip"; b.textContent = s; sug.appendChild(b); });
    } catch (e) { t.className = "msg bot"; t.textContent = "Connexion impossible pour le moment. Écrivez-nous par e-mail (section Contact)."; }
    busy = false; log.scrollTop = log.scrollHeight;
  }
  $("chat-form").addEventListener("submit", (e) => { e.preventDefault(); ask(input.value); });
  sug.addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (b) ask(b.textContent); });
})();
