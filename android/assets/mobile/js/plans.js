"use strict";
// ABONNEMENTS ET ÉDITIONS
//   Grand public (module « Abonnement ») : ETO Free (vert) · ETO Pro (bleu) · ETO MAX (jaune) · ETO Ultra (violet), de 0 € à 119,99 € par mois.
//   Éditions privées (module « Espace CEO », jamais montrées au grand public) : E.N.O.S. Standard Edition (amis) · E.N.O.S. Dev (employés) · E.N.O.S. CEO.
// La version ACTIVE nomme l'application dans l'en-tête (« E.T.O. · AUTONOME » ou « E.N.O.S. · AUTONOME »), donne sa couleur d'accent et porte le badge « Actif ».
// Version réelle : CEO dans l'app de test (la tienne) ou si le paquet CEO a été importé sur ce téléphone, sinon ETO Free (aucun paiement n'est encore branché : les boutons « Choisir » le disent).
// Application de TEST (Eto TEST) : toutes les versions peuvent être simulées (bandeau « Mode test »), la vraie version reste mémorisée et se rétablit d'un geste.
(() => {
  const E = window.ENOS, esc = E.esc;
  const ic = (n, c) => (E.hubIcon ? E.hubIcon(n, c) : "");
  // ------------------------------------------------------------------ catalogue (prix TTC ; annuel = 2 mois offerts environ)
  const PUBLIC = [
    { id: "eto_free", brand: "E.T.O.", name: "ETO", tier: "Free", color: "#34d399", hue: 152, month: 0, year: 0, pitch: "Pour découvrir ETO et jouer tous les jours.", icon: "smile",
      feats: [["knight", "Stockfish 19 sur le téléphone, partie contre E.N.O.S."], ["swords", "Bots E.N.O.S. + 20 adversaires de l'échelle"], ["puzzle", "5 puzzles et 1 revue de partie par jour"], ["chat", "Chat ETO avec ta propre clé (mode autonome)"], ["grid", "Outils : PDF, scanner, photos, dossiers, agenda"]] },
    { id: "eto_pro", brand: "E.T.O.", name: "ETO", tier: "Pro", color: "#3b82f6", hue: 217, month: 9.99, year: 95.9, pitch: "Les échecs sans limite et ETO dans la poche.", icon: "zap", badge: "Le plus choisi",
      feats: [["check", "Tout ETO Free"], ["swords", "Les 142 bots : légendes, joueurs pro, streamers, moteurs natifs"], ["puzzle", "Puzzles, leçons et revues illimités"], ["bulb", "Conseiller « !! » sur capture d'écran"], ["chat", "500 messages ETO par mois, sans clé", 1], ["cloud", "Sauvegarde cloud et synchro téléphone ⇄ PC"]] },
    { id: "eto_max", brand: "E.T.O.", name: "ETO", tier: "MAX", color: "#facc15", hue: 48, month: 29.99, year: 287.9, pitch: "Le créateur : edits, coach à la voix, tous les modes.", icon: "flame", badge: "Meilleure valeur",
      feats: [["check", "Tout ETO Pro"], ["clapper", "Chess Edit Studio complet : 1080p 60 i/s, effets pro, sans filigrane"], ["crown", "Royale ×4, Variantes, 5D, Fog, ChatGPT Prime, Game Clips"], ["radio", "Coach ETO à la voix : 2 h par mois", 1], ["chat", "3 000 messages ETO par mois + vision", 1], ["code", "Codelab, Studio audio, CinePulse"]] },
    { id: "eto_ultra", brand: "E.T.O.", name: "ETO", tier: "Ultra", color: "#a78bfa", hue: 262, month: 119.99, year: 1151.9, pitch: "Tout ETO, au maximum, sur le téléphone et le PC.", icon: "sparkles",
      feats: [["check", "Tout ETO MAX"], ["monitor", "ETO sur le PC : copilote de jeu, Smart AFK, Auto-Clipper IA", 1], ["brain", "Ton bot personnel, entraîné sur tes parties"], ["chat", "Messages et voix sans compter (usage raisonnable)", 1], ["clapper", "Exports 4K, accès anticipé aux nouveautés"], ["users", "Partage famille jusqu'à 6 personnes", 1]] },
  ];
  const PRIVATE = [
    { id: "enos_std", brand: "E.N.O.S.", name: "E.N.O.S.", tier: "Standard Edition", who: "Amis", color: "#cbd5e1", hue: 352, icon: "users", role: "friends",
      feats: [["calendar", "Agenda, Éditeur PDF, Studio média, Outils rapides"], ["chat", "Assistant IA E.N.O.S."], ["code", "Dépôt Intranet et Dev Manager"], ["shield", "Ni pilotage du PC, ni Google, ni loisirs"]] },
    { id: "enos_dev", brand: "E.N.O.S.", name: "E.N.O.S.", tier: "Dev", who: "Employés", color: "#fb7185", hue: 352, icon: "code", role: "dev",
      feats: [["check", "Tous les modules d'E.N.O.S."], ["monitor", "Pilotage du PC, Godot, Tests F6, Hub équipe"], ["shield", "Sauf API Control Panel et Notes de frais"]] },
    { id: "enos_ceo", brand: "E.N.O.S.", name: "E.N.O.S.", tier: "CEO", who: "Toi et ton associé", color: "#ef1748", hue: 352, icon: "crown", role: "ceo",
      feats: [["check", "Accès total, sans aucune limite"], ["scan", "Tous les éléments de test : versions TEST, Tests F6, journal de plantages"], ["gauge", "API Control Panel, Notes de frais, droits complets sur le PC"], ["crown", "Espace CEO : éditions privées et simulateur d'abonnement"]] },
  ];
  const ALL = PUBLIC.concat(PRIVATE), BY = Object.fromEntries(ALL.map((p) => [p.id, p]));
  const eur = (v) => (v === 0 ? "0" : v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  // ------------------------------------------------------------------ état
  const P = (E.plans = { PUBLIC, PRIVATE, BY, eur });
  P.isTest = () => !!(E.native && E.native.isTestBuild && E.native.isTestBuild());
  P.real = () => (P.isTest() || (E.store && E.store.get("ceo.done", "")) ? "enos_ceo" : (E.settings.get("plan.owned", "") in BY ? E.settings.get("plan.owned") : "eto_free"));
  P.current = () => { const t = P.isTest() ? E.settings.get("plan.test", "") : ""; return t && BY[t] ? t : P.real(); };
  P.plan = () => BY[P.current()];
  P.isPrivate = (id) => PRIVATE.some((p) => p.id === (id || P.current()));
  P.ceoSpace = () => P.current() === "enos_ceo" || P.isTest();                 // l'app de test garde toujours l'accès (sinon on ne pourrait plus revenir en arrière)
  /** simuler une version (application de TEST uniquement) ; "" = revenir à la vraie */
  P.simulate = (id) => {
    if (!P.isTest()) return false;
    E.settings.set("plan.test", id && BY[id] ? id : "");
    apply(true); E.emit && E.emit("plan", P.current());
    return true;
  };
  // en-tête, couleur, classes : la marque change (E.T.O. / E.N.O.S.) avec un léger effet de bascule
  function apply(anim) {
    const p = P.plan(), b = document.querySelector("#top .brand > span");
    document.body.dataset.plan = p.id; document.body.classList.toggle("plan-eto", !P.isPrivate()); document.body.classList.toggle("plan-enos", P.isPrivate());
    document.documentElement.style.setProperty("--plan", p.color); document.documentElement.style.setProperty("--plan-rot", ((p.hue - 352 + 540) % 360 - 180) + "deg");
    if (b && b.firstChild && b.firstChild.nodeType === 3 && b.firstChild.textContent !== p.brand) {
      b.firstChild.textContent = p.brand;
      if (anim) { const br = b.parentNode; br.classList.remove("flip"); void br.offsetWidth; br.classList.add("flip"); }
    }
    if (E.settings.get("plan.hue_for", "") !== p.id) { E.settings.set("plan.hue_for", p.id); if (E.theme) E.theme.apply(p.hue); }     // la couleur suit la version quand elle change (Thèmes reste libre ensuite)
  }
  P.apply = apply;
  // célébration d'activation : rideau de couleur + nom de la version
  function celebrate(p) {
    if (document.documentElement.classList.contains("no-anim")) return;
    const o = document.createElement("div"); o.className = "pl-burst"; o.style.setProperty("--c", p.color);
    o.innerHTML = `<i></i><div><span>${ic(p.icon)}</span><b>${esc(p.name)} <em>${esc(p.tier)}</em></b><small>Activé</small></div>`;
    document.body.appendChild(o); setTimeout(() => o.classList.add("out"), 1300); setTimeout(() => o.remove(), 1800);
  }
  P.celebrate = celebrate;

  // ------------------------------------------------------------------ carte d'une offre
  function card(p, i, annual) {
    const act = P.current() === p.id, price = annual ? p.year / 12 : p.month;
    return `<article class="pl-card${act ? " on" : ""}${p.badge ? " pop" : ""}" data-p="${p.id}" style="--c:${p.color};--i:${i}">
      ${p.badge ? `<span class="pl-rib">${esc(p.badge)}</span>` : ""}${act ? `<span class="pl-act"><i></i>Actif</span>` : ""}
      <div class="pl-h"><span class="pl-ic">${ic(p.icon)}</span><div><b>${esc(p.name)} <em>${esc(p.tier)}</em></b>${p.pitch ? `<small>${esc(p.pitch)}</small>` : ""}</div></div>
      ${p.month != null ? `<div class="pl-price"><b data-v="${price}">${eur(price)}</b><span>€<br><small>/ mois</small></span></div>
        <div class="pl-bill">${p.month === 0 ? "Gratuit pour toujours" : annual ? `${eur(p.year)} € facturés par an · 2 mois offerts` : `ou ${eur(p.year)} € par an`}</div>` : `<div class="pl-who">${ic("users")}${esc(p.who)}</div>`}
      <ul>${p.feats.map(([n, t, soon]) => `<li>${ic(n)}<span>${esc(t)}${soon ? ' <i class="pl-soon">bientôt</i>' : ""}</span></li>`).join("")}</ul>
      ${p.month != null ? `<button class="btn${act ? "" : " pri"} pl-go">${act ? "Ton offre actuelle" : p.month === 0 ? "Revenir à Free" : "Choisir " + esc(p.name + " " + p.tier)}</button>` : ""}
    </article>`;
  }
  // bandeau « Mode test » (app de test) : toutes les versions, publiques et privées
  const testBar = (priv) => !P.isTest() ? "" : `<div class="card pl-test"><h3>Mode test<span class="sp">app Eto TEST</span></h3>
      <p class="muted">${priv ? "Simule n'importe quelle version, publique ou privée, pour voir l'application comme ses utilisateurs." : "Simule une offre pour voir l'application comme ses abonnés (les éditions privées se simulent dans l'Espace CEO)."}</p>
      <div class="pl-sw">${(priv ? ALL : PUBLIC).map((p) => `<button class="pl-chip${P.current() === p.id ? " on" : ""}" data-sim="${p.id}" style="--c:${p.color}">${ic(p.icon)}${esc((p.name === "ETO" ? "ETO " : "") + p.tier)}</button>`).join("")}</div>
      ${E.settings.get("plan.test", "") ? `<button class="btn wide pl-reset" data-sim="">Revenir à ma vraie version</button>` : ""}</div>`;

  // ------------------------------------------------------------------ module « Abonnement » (grand public uniquement)
  E.suite.register({
    id: "plans", group: "sync", title: "Abonnement", sub: "ETO Free, Pro, MAX, Ultra",
    icon: '<path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/><path d="M5 21h14"/>',
    onShow() { if (this._paint) this._paint(); },
    build(el, A) {
      let annual = E.settings.get("plan.annual", false);
      const paint = () => {
        const cur = P.plan();
        el.innerHTML = `<div class="pl-hero" style="--c:${cur.color}"><div class="pl-orbs"><i></i><i></i><i></i></div>
            <small>${P.isPrivate() ? "Ta version" : "Ton abonnement"}</small><h2>${esc(cur.name)} <em>${esc(cur.tier)}</em></h2>
            <p>${P.isPrivate() ? "Édition privée : elle n'apparaît pas dans les offres publiques (voir l'Espace CEO)." : "Passe à l'offre supérieure quand tu veux, sans engagement."}</p></div>
          ${testBar()}
          <div class="pl-period" role="tablist"><button data-a="0" class="${annual ? "" : "on"}">Mensuel</button><button data-a="1" class="${annual ? "on" : ""}">Annuel <i>−20 %</i></button><span class="pl-pind"></span></div>
          <div class="pl-list">${PUBLIC.map((p, i) => card(p, i, annual)).join("")}</div>
          <div class="card pl-cmp"><h3>Comparer</h3><table><thead><tr><th></th>${PUBLIC.map((p) => `<th style="--c:${p.color}">${esc(p.tier)}</th>`).join("")}</tr></thead><tbody>
            ${[["Bots", "29", "142", "142", "142"], ["Puzzles / jour", "5", "∞", "∞", "∞"], ["Revues / jour", "1", "∞", "∞", "∞"], ["Messages ETO / mois", "ta clé", "500", "3 000", "∞"], ["Coach à la voix", "—", "—", "2 h", "∞"], ["Chess Edit", "720p", "1080p", "1080p 60", "4K"], ["ETO sur le PC", "—", "—", "—", "✓"], ["Famille", "—", "—", "—", "6"]]
              .map((r) => `<tr><td>${r[0]}</td>${r.slice(1).map((v) => `<td>${v}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
          <p class="pl-legal">Prix TTC. Résiliable à tout moment depuis Google Play. Les mentions « bientôt » signalent ce qui arrive avec les comptes ETO en ligne.</p>`;
        el.querySelectorAll(".pl-period button").forEach((b) => (b.onclick = () => { annual = b.dataset.a === "1"; E.settings.set("plan.annual", annual); roll(); el.querySelectorAll(".pl-period button").forEach((x) => x.classList.toggle("on", x === b)); el.querySelector(".pl-period").dataset.a = annual ? "1" : "0"; }));
        el.querySelector(".pl-period").dataset.a = annual ? "1" : "0";
        wire(el, () => paint());
      };
      // les prix défilent vers leur nouvelle valeur
      function roll() {
        el.querySelectorAll(".pl-card").forEach((c) => {
          const p = BY[c.dataset.p], b = c.querySelector(".pl-price b"), bill = c.querySelector(".pl-bill"); if (!b) return;
          const from = +b.dataset.v, to = annual ? p.year / 12 : p.month, t0 = performance.now();
          b.dataset.v = to; if (bill && p.month) bill.textContent = annual ? `${eur(p.year)} € facturés par an · 2 mois offerts` : `ou ${eur(p.year)} € par an`;
          const st = (t) => { const k = Math.min(1, (t - t0) / 520), e = 1 - Math.pow(1 - k, 3); b.textContent = eur(Math.round((from + (to - from) * e) * 100) / 100); if (k < 1) requestAnimationFrame(st); };
          requestAnimationFrame(st); b.parentNode.classList.remove("tick"); void b.offsetWidth; b.parentNode.classList.add("tick");
        });
      }
      this._paint = paint; paint();
    },
  });

  // clics communs : choisir une offre, simuler une version
  function wire(el, repaint) {
    el._repaint = repaint; if (el._wired) return; el._wired = true;
    el.addEventListener("click", (e) => {
      repaint = el._repaint;
      const sim = e.target.closest("[data-sim]");
      if (sim) { const id = sim.dataset.sim; P.simulate(id); if (id) celebrate(BY[id]); E.vibrate && E.vibrate(12); repaint(); return; }
      const go = e.target.closest(".pl-go"); if (!go) return;
      const p = BY[go.closest(".pl-card").dataset.p]; if (!p || P.current() === p.id) return;
      E.ui.sheet({ title: `${p.name} ${p.tier}`, html: `<p class="muted" style="line-height:1.55">${p.month ? `<b>${eur(p.month)} € par mois</b> ou ${eur(p.year)} € par an.<br><br>` : ""}Le paiement arrive avec la publication d'ETO sur le Play Store (abonnements Google Play). Aucun montant n'est prélevé aujourd'hui.${P.isTest() ? "<br><br>Dans l'application de test, tu peux simuler cette offre pour voir l'application comme ses abonnés." : ""}</p>`,
        options: (P.isTest() ? [{ label: "Simuler " + p.name + " " + p.tier, cls: "pri", fn: () => { P.simulate(p.id); celebrate(p); repaint(); } }] : []).concat([{ label: "Fermer" }]) });
    });
  }

  // ------------------------------------------------------------------ module « Espace CEO » (éditions privées) — visible pour le CEO et dans l'app de test
  E.suite.register({
    id: "ceo", group: "sync", title: "Espace CEO", sub: "Éditions privées, simulateur",
    icon: '<path d="M2 18h20M4 18l-1-9 5 4 4-7 4 7 5-4-1 9"/>',
    onShow() { if (this._paint) this._paint(); },
    build(el) {
      const paint = () => {
        if (!P.ceoSpace()) { el.innerHTML = `<div class="card"><p class="muted">Espace réservé aux CEO.</p></div>`; return; }
        el.innerHTML = `<div class="pl-hero ceo" style="--c:#ef1748"><div class="pl-orbs"><i></i><i></i><i></i></div><small>Espace CEO</small><h2>Éditions <em>privées</em></h2>
            <p>Les versions d'E.N.O.S. réservées à ton entourage. Elles n'apparaissent jamais dans les offres publiques.</p></div>
          ${testBar(true)}
          <div class="pl-list">${PRIVATE.map((p, i) => card(p, i, false)).join("")}</div>
          <div class="card pl-pub"><h3>Offres publiques<span class="sp">aperçu</span></h3>${PUBLIC.map((p) => `<div class="pl-row" style="--c:${p.color}">${ic(p.icon)}<b>${esc(p.name)} ${esc(p.tier)}</b><span>${p.month ? eur(p.month) + " € / mois" : "Gratuit"}</span>${P.current() === p.id ? '<i class="pl-act sm"><i></i>Actif</i>' : ""}</div>`).join("")}</div>`;
        wire(el, () => paint());
      };
      this._paint = paint; paint();
    },
  });

  // démarrage : la marque et la couleur de la version active
  const start = () => { try { apply(false); } catch (e) { /* en-tête pas encore prêt */ } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else setTimeout(start, 0);
})();
