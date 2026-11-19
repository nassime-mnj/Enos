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
  // Positionnement : les échecs sont un divertissement, donc ENTIÈREMENT gratuits. Les offres payantes se vendent sur ce qu'elles font gagner
  // (stockage, temps, outils remplacés) et tournent sur le téléphone ou le PC de l'utilisateur : presque aucun coût de serveur (voir docs/STRATEGIE_OFFRES.md).
  const PUBLIC = [
    { id: "eto_free", brand: "E.T.O.", name: "ETO", tier: "Free", color: "#34d399", hue: 152, month: 0, year: 0, pitch: "Tous les échecs, gratuits pour toujours.", icon: "smile",
      feats: [["knight", "Tous les échecs : 142 bots, Stockfish 19 et moteurs natifs, Arène, Royale ×4, Variantes, 5D, Fog"], ["clapper", "Chess Edit Studio et Game Clips, sans filigrane"], ["puzzle", "Puzzles, leçons, revues et Conseiller « !! » illimités"], ["grid", "Outils : PDF, scanner, agenda, compression et nettoyage à la main"], ["chat", "Chat ETO avec ta propre clé d'API"]],
      roi: "Gratuit, sans publicité, et ça le restera." },
    { id: "eto_pro", brand: "E.T.O.", name: "ETO", tier: "Pro", color: "#3b82f6", hue: 217, month: 2.99, year: 28.7, pitch: "Mobile Improver : un téléphone plus léger, tout seul.", icon: "zap", badge: "Le plus choisi",
      feats: [["zap", "Mobile Improver automatique : grosses photos allégées quand le téléphone charge, qualité vérifiée photo par photo (vidéos : bientôt)", 1], ["scan", "Doublons, photos floues et vieilles captures repérés chaque semaine", 1], ["shield", "Originaux gardés 30 jours : rien n'est supprimé sans ton accord", 1], ["chart", "Rapport mensuel : gigaoctets libérés, mémoire, batterie", 1], ["cloud", "Sauvegarde vers ton propre PC, sans abonnement cloud"]],
      roi: "Rentable dès qu'il t'évite un forfait de stockage : Google One 100 Go coûte 1,99 € par mois, iCloud+ 200 Go 2,99 €." },
    { id: "eto_max", brand: "E.T.O.", name: "ETO", tier: "MAX", color: "#facc15", hue: 48, month: 9.99, year: 95.9, pitch: "Ton PC et ton téléphone ne font plus qu'un.", icon: "flame", badge: "Meilleure valeur",
      feats: [["check", "Tout ETO Pro"], ["monitor", "Pilotage du PC depuis le téléphone : allumer, veille, tests, fichiers"], ["clapper", "Auto-Clipper IA : tes meilleurs moments de jeu en clips verticaux"], ["eye", "Copilote de jeu et Smart AFK sur le PC"], ["chat", "Passerelle d'API : tes clés réunies, quotas et bascule automatique", 1], ["code", "Codelab, Studio média, CinePulse"]],
      roi: "Remplace un clipper de jeu, un outil de contrôle à distance et un compresseur vidéo payants." },
    { id: "eto_ultra", brand: "E.T.O.", name: "ETO", tier: "Ultra", color: "#a78bfa", hue: 262, month: 119.99, year: 1151.9, pitch: "Équipes et entreprises : 10 personnes, 25 appareils.", icon: "sparkles",
      feats: [["users", "10 comptes, 25 appareils (téléphones et PC)", 1], ["shield", "Flotte : inventaire, santé, mises à jour et versions privées déployées à distance", 1], ["code", "Dépôt intranet : Git, éditeur, terminal, sujets et entraînement"], ["history", "Journal de plantages centralisé, applications et jeux Godot", 1], ["monitor", "Tests F6 Godot lancés depuis le téléphone, Hub équipe"], ["crown", "Édition à ta marque : logo, couleurs, modules choisis", 1]],
      roi: "Moins de 12 € par personne : la gestion d'appareils, le suivi des plantages et l'accès à distance coûtent chacun déjà ce prix ailleurs." },
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
  // ------------------------------------------------------------------ licence du compte ETO (serveur Dual Pulse) : jeton Ed25519 signé, vérifié ICI hors ligne
  // Droits par offre : chaque offre contient les précédentes ; les échecs sont toujours gratuits (même table que le serveur, eto.py).
  const FEAT = { eto_free: ["chess", "tools", "chat_byok"], eto_pro: ["improver_auto", "cleaner_auto", "backup_pc", "report"], eto_max: ["pc_control", "clipper", "copilot", "gateway", "studio", "codelab"], eto_ultra: ["team", "fleet", "depot", "qa", "white_label", "chess_engine"] };
  const ORDER = ["eto_free", "eto_pro", "eto_max", "eto_ultra"];
  P.features = (plan) => { plan = PRIVATE.some((p) => p.id === plan) ? "eto_ultra" : plan; const out = []; for (const p of ORDER) { out.push(...FEAT[p]); if (p === plan) break; } return out; };
  P.minPlan = (f) => ORDER.find((p) => FEAT[p].includes(f)) || "eto_free";
  const b64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
  async function verifyLicense(tok, pubB64) {
    const [h, b, sg] = String(tok).split("."); if (!sg) return null;
    const claims = JSON.parse(new TextDecoder().decode(b64u(b)));
    if (claims.typ !== "license" || claims.iss !== "dualpulse") return null;
    try {
      const key = await crypto.subtle.importKey("raw", b64u(pubB64), { name: "Ed25519" }, false, ["verify"]);
      if (!(await crypto.subtle.verify({ name: "Ed25519" }, key, b64u(sg), new TextEncoder().encode(h + "." + b)))) return null;
    } catch (e) { if (!/Ed25519|not supported|Unrecognized/i.test(String(e && (e.message || e.name)))) return null; }    // WebView trop ancienne sans Ed25519 : on garde la licence (elle arrive en HTTPS du serveur)
    return claims;
  }
  P._verify = verifyLicense;                                                         // (tests)
  P.license = () => { const l = E.store.get("eto.license", null); return l && l.claims && l.claims.exp * 1000 + 7 * 86400000 > Date.now() ? l.claims : null; };   // 7 jours de grâce hors ligne après l'expiration
  /** relit la licence auprès du serveur (connexion ETO requise) ; la clé publique est épinglée à la première lecture */
  P.refreshLicense = async () => {
    if (!E.cloud || !E.cloud.loggedIn()) return null;
    const r = await E.cloud.req("/eto/license", { method: "POST" }); if (r.status !== 200) return null;
    const pin = E.store.get("eto.pubkey", "") || r.json.public_key; if (r.json.public_key !== pin) return null;
    const claims = await verifyLicense(r.json.license, pin); if (!claims) return null;
    E.store.set("eto.pubkey", pin); E.store.set("eto.license", { token: r.json.license, claims }); apply(true); E.emit && E.emit("plan", P.current());
    return claims;
  };
  P.real = () => {
    if (P.isTest() || (E.store && E.store.get("ceo.done", ""))) return "enos_ceo";
    const l = P.license(); if (l && BY[l.plan]) return l.plan;
    return "eto_free";
  };
  P.current = () => { const t = P.isTest() ? E.settings.get("plan.test", "") : ""; return t && BY[t] ? t : P.real(); };
  P.plan = () => BY[P.current()];
  P.isPrivate = (id) => PRIVATE.some((p) => p.id === (id || P.current()));
  P.can = (f) => P.features(P.current()).includes(f);
  // modules soumis à une offre ; tout le reste (échecs compris) est libre
  const MOD = { pc: "pc_control", "b-sy": "pc_control", "b-rg": "pc_control", colis: "pc_control", codelab: "codelab", cinepulse: "studio", audiolab: "studio", "b-hb": "team", fleet: "fleet", improver: "tools", gateway: "gateway", improver_auto_gate: "improver_auto" };
  P.featureOf = (id) => MOD[id] || "";
  /** true si le module est ouvert pour l'offre active ; sinon feuille « Disponible avec ETO … » et false */
  P.gate = (id) => {
    const f = MOD[id]; if (!f || P.can(f)) return true;
    const need = BY[P.minPlan(f)];
    E.ui.sheet({ title: `Avec ${need.name} ${need.tier}`, html: `<p class="muted" style="line-height:1.55">Ce module fait partie de l'offre <b style="color:${need.color}">${esc(need.name + " " + need.tier)}</b>${need.month ? ` (${eur(need.month)} € par mois)` : ""}. Les échecs, eux, restent gratuits.</p>`,
      options: [{ label: "Voir les offres", cls: "pri", fn: () => { E.ui.go("tools"); E.modules.open("plans"); } }, { label: "Fermer" }] });
    return false;
  };
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
    const pcOk = P.can("pc_control"), pcv = document.querySelector('.view[data-v="pc"] .scroll');
    document.body.classList.toggle("no-pc", !pcOk);
    if (pcv && !pcOk && !document.getElementById("pc-gate")) {
      const need = BY[P.minPlan("pc_control")];
      pcv.insertAdjacentHTML("afterbegin", `<div class="card pl-gate" id="pc-gate" style="--c:${need.color}"><span class="pl-ic">${ic("monitor")}</span><h2>Ton PC, depuis ton téléphone</h2><p class="muted">Allumer, mettre en veille, lancer tes tests, transférer des fichiers : le pilotage du PC fait partie de <b>${esc(need.name + " " + need.tier)}</b>.</p><button class="btn pri wide" data-plans>Voir les offres</button></div>`);
      document.getElementById("pc-gate").querySelector("[data-plans]").onclick = () => { E.ui.go("tools"); E.modules.open("plans"); };
    }
    if (pcOk && document.getElementById("pc-gate")) document.getElementById("pc-gate").remove();
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
      ${p.roi ? `<div class="pl-roi">${ic("chart")}<span>${esc(p.roi)}</span></div>` : ""}
      <ul>${p.feats.map(([n, t, soon]) => `<li>${ic(n)}<span>${esc(t)}${soon ? ' <i class="pl-soon">bientôt</i>' : ""}</span></li>`).join("")}</ul>
      ${p.month != null ? `<button class="btn${act ? "" : " pri"} pl-go">${act ? "Ton offre actuelle" : p.month === 0 ? "Revenir à Free" : "Choisir " + esc(p.name + " " + p.tier)}</button>` : ""}
    </article>`;
  }
  // carte « Compte ETO » : connexion, offre de la licence, gestion du paiement
  function account() {
    const u = E.cloud && E.cloud.loggedIn() ? E.cloud.user() : null, l = P.license();
    if (!u) return `<div class="card pl-acc"><h3>Compte ETO</h3><p class="muted">Crée ton compte pour t'abonner et retrouver ton offre sur tous tes appareils. Les échecs restent gratuits sans compte.</p>
      <div class="row"><button class="btn pri" data-acc="signup">Créer un compte</button><button class="btn" data-acc="login">Se connecter</button></div>
      <button class="btn wide pl-keybtn" data-acc="key">${KEYIC}J'ai une clé d'activation</button></div>`;
    const p = l ? BY[l.plan] : null;
    return `<div class="card pl-acc"><h3>Compte ETO<span class="sp">${esc(u.email || "")}</span></h3>
      <p class="muted">${p ? `Offre <b style="color:${p.color}">${esc(p.name + " " + p.tier)}</b>${l.period_end ? " · renouvellement le " + new Date(l.period_end * 1000).toLocaleDateString("fr-FR") : ""}` : "Licence pas encore lue : touche « Actualiser »."}</p>
      <div class="row"><button class="btn" data-acc="refresh">Actualiser</button><button class="btn" data-acc="portal">Gérer le paiement</button><button class="btn" data-acc="logout">Déconnexion</button></div>
      <button class="btn wide pl-keybtn" data-acc="key">${KEYIC}Activer une clé</button></div>`;
  }
  function accountSheet(mode) {
    const signup = mode === "signup", needUrl = !E.cloud.url();
    const s = E.ui.sheet({ title: signup ? "Créer ton compte ETO" : "Connexion ETO", html: `<div class="pl-form">
        ${needUrl ? `<label>Adresse du serveur ETO<input id="pa-url" type="url" placeholder="https://…" autocomplete="off"></label>` : ""}
        ${signup ? `<label>Prénom<input id="pa-name" type="text" autocomplete="given-name" maxlength="60"></label>` : ""}
        <label>E-mail<input id="pa-mail" type="email" autocomplete="email" maxlength="254"></label>
        <label>Mot de passe<input id="pa-pw" type="password" autocomplete="${signup ? "new-password" : "current-password"}" maxlength="200"></label>
        ${signup ? `<p class="muted" style="font-size:12px">10 caractères minimum. En créant un compte, tu acceptes les conditions d'utilisation d'ETO.</p>` : ""}
        <p class="pl-err" id="pa-err"></p><button class="btn pri wide" id="pa-go">${signup ? "Créer mon compte" : "Me connecter"}</button>
        <button class="pl-link" id="pa-sw" type="button">${signup ? "J'ai déjà un compte : me connecter" : "Pas encore de compte : en créer un"}</button></div>` });
    s.querySelector("#pa-sw").onclick = () => { E.ui.closeSheet(true); setTimeout(() => accountSheet(signup ? "login" : "signup"), 60); };
    s.querySelector("#pa-go").onclick = async () => {
      const err = s.querySelector("#pa-err"), b = s.querySelector("#pa-go"); err.textContent = ""; b.disabled = true;
      try {
        if (needUrl) E.cloud.setUrl(s.querySelector("#pa-url").value);
        const mail = s.querySelector("#pa-mail").value.trim(), pw = s.querySelector("#pa-pw").value;
        if (signup) await E.cloud.signup(mail, pw, (s.querySelector("#pa-name") || {}).value || ""); else await E.cloud.login(mail, pw);
        await P.refreshLicense(); E.ui.closeSheet(); E.ui.toast(signup ? "Bienvenue sur ETO." : "Connecté.", "ok");
        const pend = E.settings.get("plan.pending", null); E.settings.set("plan.pending", null); if (pend) buy(BY[pend.plan], pend.annual);
        const pk = E.settings.get("plan.pendingKey", ""); E.settings.set("plan.pendingKey", ""); if (pk) setTimeout(() => keySheet(pk), 350);
      } catch (e) { err.textContent = e.message || "Échec."; } finally { b.disabled = false; }
    };
  }
  // achat : Stripe Checkout dans le navigateur ; le droit arrive par le webhook, la licence est relue au retour dans l'application
  async function buy(p, annual) {
    if (!E.cloud || !E.cloud.loggedIn()) { E.settings.set("plan.pending", { plan: p.id, annual }); return accountSheet("signup"); }
    try {
      const r = await E.cloud.req("/eto/billing/checkout", { method: "POST", body: { plan: p.id, period: annual ? "year" : "month" } });
      if (r.status === 503) return E.ui.sheet({ title: `${p.name} ${p.tier}`, html: `<p class="muted" style="line-height:1.55">${esc(r.json.detail || "Le paiement n'est pas encore ouvert.")} Aucun montant n'est prélevé.</p>`, options: [{ label: "Fermer" }] });
      if (r.status !== 200 || !r.json.url) throw new Error(r.json.detail || "Paiement indisponible.");
      if (!E.native.openCheckout(r.json.url)) throw new Error("Impossible d'ouvrir la page de paiement.");
      E.settings.set("plan.await", Date.now());
    } catch (e) { E.ui.toast(e.message, "warn"); }
  }
  // ------------------------------------------------------------------ clés d'activation (format ETO-XXXX-XXXX-XXXX-XXXX, même contrôle que le serveur)
  const KEYIC = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3M17 6l3 3M14 9l2 2"/></svg>';
  const KA = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const keyNorm = (v) => { let c = String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); if (c.startsWith("ETO") && c.length === 19) c = c.slice(3); return c.replace(/O/g, "0").replace(/[IL]/g, "1").replace(/U/g, "V"); };
  const keyOk = (c) => c.length === 16 && [...c].every((x) => KA.includes(x)) && KA[[...c.slice(0, 15)].reduce((a, x, i) => a + (2 * i + 1) * KA.indexOf(x), 0) % 32] === c[15];
  const keyFmt = (c) => "ETO-" + (c.match(/.{1,4}/g) || []).join("-");
  P._key = { norm: keyNorm, ok: keyOk };                                              // (tests)
  async function copyText(t) { try { await navigator.clipboard.writeText(t); } catch (e) { const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (x) { /* rien */ } ta.remove(); } E.ui.toast("Copié.", "ok"); }
  function keySheet(prefill) {
    const logged = E.cloud && E.cloud.loggedIn();
    const s = E.ui.sheet({ title: "Activer une clé", html: `<div class="pl-form pl-keyform">
        <p class="muted" style="line-height:1.5">Une clé ETO ouvre une offre pendant une durée donnée (cadeau, partenaire, presse, entreprise). Elle s'active une fois sur ton compte ETO.</p>
        <label>Clé d'activation<input id="pk-in" class="pl-keyin" type="text" inputmode="text" autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="27" placeholder="ETO-XXXX-XXXX-XXXX-XXXX" value="${esc(prefill || "")}"></label>
        <p class="pl-keyst" id="pk-st"></p>
        ${logged ? "" : `<p class="muted" style="font-size:12.5px">Il faut un compte ETO pour garder l'offre sur tous tes appareils : la clé sera activée juste après la connexion.</p>`}
        <p class="pl-err" id="pk-err"></p><button class="btn pri wide" id="pk-go" disabled>${logged ? "Activer" : "Continuer"}</button></div>` });
    const inp = s.querySelector("#pk-in"), st = s.querySelector("#pk-st"), go = s.querySelector("#pk-go"), err = s.querySelector("#pk-err");
    const check = () => {
      const c = keyNorm(inp.value), pos = inp.selectionStart === inp.value.length;
      if (c.length && pos) inp.value = keyFmt(c.slice(0, 16));
      const ok = keyOk(c); go.disabled = !ok; inp.classList.toggle("ok", ok); inp.classList.toggle("bad", c.length === 16 && !ok);
      st.textContent = !c.length ? "" : c.length < 16 ? `${c.length} / 16 caractères` : ok ? "Format valide" : "Un caractère est faux : vérifie la clé";
      st.className = "pl-keyst" + (ok ? " ok" : c.length === 16 ? " bad" : "");
    };
    inp.addEventListener("input", check); check(); setTimeout(() => inp.focus(), 250);
    go.onclick = async () => {
      const c = keyNorm(inp.value); if (!keyOk(c)) return;
      if (!(E.cloud && E.cloud.loggedIn())) { E.settings.set("plan.pendingKey", keyFmt(c)); E.ui.closeSheet(true); return accountSheet("signup"); }
      err.textContent = ""; go.disabled = true; go.textContent = "Activation…";
      try {
        const r = await E.cloud.req("/eto/redeem", { method: "POST", body: { code: keyFmt(c) } });
        if (r.status !== 200) throw new Error(r.json.detail || "Activation refusée (" + r.status + ").");
        const claims = await P.refreshLicense(); E.ui.closeSheet(true);
        const p = BY[(claims && claims.plan) || r.json.subscription.plan], end = r.json.subscription.period_end;
        celebrate(p); E.ui.toast(`${p.name} ${p.tier} activé${end ? " jusqu'au " + new Date(end * 1000).toLocaleDateString("fr-FR") : " sans limite de durée"}.`, "ok");
        E.emit && E.emit("plan", P.current());
      } catch (e) { err.textContent = e.message || "Échec."; go.disabled = false; go.textContent = "Activer"; }
    };
  }
  P.keySheet = keySheet;
  P.buy = buy; P.accountSheet = accountSheet;
  // retour du navigateur après un paiement : on relit la licence
  document.addEventListener("visibilitychange", () => { if (!document.hidden && E.settings.get("plan.await", 0) > Date.now() - 3600e3) { E.settings.set("plan.await", 0); setTimeout(() => P.refreshLicense().then((c) => c && E.ui.toast("Offre mise à jour : " + BY[c.plan].name + " " + BY[c.plan].tier, "ok")), 1500); } });

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
          ${account()}
          ${testBar()}
          <div class="pl-period" role="tablist"><button data-a="0" class="${annual ? "" : "on"}">Mensuel</button><button data-a="1" class="${annual ? "on" : ""}">Annuel <i>−20 %</i></button><span class="pl-pind"></span></div>
          <div class="pl-list">${PUBLIC.map((p, i) => card(p, i, annual)).join("")}</div>
          <div class="card pl-cmp"><h3>Comparer</h3><table><thead><tr><th></th>${PUBLIC.map((p) => `<th style="--c:${p.color}">${esc(p.tier)}</th>`).join("")}</tr></thead><tbody>
            ${[["Tous les échecs", "✓", "✓", "✓", "✓"], ["Compression et nettoyage à la main", "✓", "✓", "✓", "✓"], ["Mobile Improver automatique", "—", "✓", "✓", "✓"], ["Pilotage du PC", "—", "—", "✓", "✓"], ["Auto-Clipper IA, copilote", "—", "—", "✓", "✓"], ["Passerelle d\x27API", "—", "—", "✓", "✓"], ["Personnes / appareils", "1", "1", "1 + PC", "10 / 25"], ["Flotte, édition à ta marque", "—", "—", "—", "✓"]]
              .map((r) => `<tr><td>${r[0]}</td>${r.slice(1).map((v) => `<td>${v}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
          <p class="pl-legal">Prix TTC. Résiliable à tout moment depuis Google Play. Les mentions « bientôt » signalent ce qui est en préparation. Tout tourne sur ton téléphone et ton PC : tes photos et tes fichiers ne passent par aucun serveur.</p>`;
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
      const acc = e.target.closest("[data-acc]");
      if (acc) {
        const a = acc.dataset.acc;
        if (a === "signup" || a === "login") return accountSheet(a);
        if (a === "key") return keySheet("");
        if (a === "logout") { E.cloud.logout(); E.store.del && E.store.del("eto.license"); apply(true); return repaint(); }
        if (a === "refresh") return P.refreshLicense().then((c) => { E.ui.toast(c ? "Licence à jour." : "Licence indisponible pour l'instant.", c ? "ok" : "warn"); repaint(); });
        if (a === "portal") return E.cloud.req("/eto/billing/portal", { method: "POST" }).then((r) => { if (r.status === 200 && r.json.url) E.native.openCheckout(r.json.url); else E.ui.toast(r.json.detail || "Aucun abonnement payé en ligne.", "warn"); });
      }
      const go = e.target.closest(".pl-go"); if (!go) return;
      const p = BY[go.closest(".pl-card").dataset.p]; if (!p || P.current() === p.id) return;
      if (!P.isTest() && p.month) return buy(p, E.settings.get("plan.annual", false));
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
          <div class="card pl-pub"><h3>Offres publiques<span class="sp">aperçu</span></h3>${PUBLIC.map((p) => `<div class="pl-row" style="--c:${p.color}">${ic(p.icon)}<b>${esc(p.name)} ${esc(p.tier)}</b><span>${p.month ? eur(p.month) + " € / mois" : "Gratuit"}</span>${P.current() === p.id ? '<i class="pl-act sm"><i></i>Actif</i>' : ""}</div>`).join("")}</div>
          <div id="ceo-admin"></div>`;
        wire(el, () => paint());
        admin(el.querySelector("#ceo-admin"), paint);
      };
      this._paint = paint; paint();
    },
  });

  // ------------------------------------------------------------------ Espace CEO › générateur de clés + révocateur (compte CEO du serveur requis : c'est lui qui signe)
  const PLAB = (id) => { const p = BY[id] || BY.eto_free; return `<i class="pl-tag" style="--c:${p.color}">${esc(p.tier)}</i>`; };
  const dfr = (t) => (t ? new Date(t * 1000).toLocaleDateString("fr-FR") : "");
  const KST = { active: ["Disponible", "ok"], used: ["Utilisée", ""], expired: ["Expirée", "warn"], revoked: ["Révoquée", "bad"] };
  const SRC = (s) => (s.startsWith("key:") ? "clé n°" + s.slice(4) : ({ stripe: "Stripe", play: "Google Play", manual: "accordée", free: "", "": "" })[s] || s);
  function admin(box, repaint) {
    if (!box) return;
    const u = E.cloud && E.cloud.loggedIn() ? E.cloud.user() : null;
    if (!u || u.role !== "ceo") {
      box.innerHTML = `<div class="card pl-adm"><h3>${KEYIC}Clés et abonnements<span class="sp">serveur ETO</span></h3><p class="muted">Le générateur de clés et le révocateur parlent au serveur ETO, seul à signer les licences. Connecte ton compte CEO pour les utiliser${u ? ` (connecté en ${esc(u.email)}, rôle ${esc(u.role)})` : ""}.</p>
        <button class="btn pri wide" data-adm="login">Connecter le compte CEO</button></div>`;
      box.querySelector("[data-adm=login]").onclick = () => { if (u) E.cloud.logout(true); accountSheet("login"); const t = setInterval(() => { if (!document.querySelector("#sheet:not([hidden]) #pa-go")) { clearInterval(t); admin(box, repaint); } }, 600); };
      return;
    }
    box.innerHTML = `<div class="card pl-adm pl-gen"><h3>${KEYIC}Générateur de clés<span class="sp">licences légitimes</span></h3>
        <p class="muted">Clés signées par le serveur : seule leur empreinte y est gardée, la clé en clair n'est montrée qu'ici, une seule fois.</p>
        <div class="pl-form pl-g2">
          <label>Offre<select id="kg-plan">${PUBLIC.filter((p) => p.month).map((p) => `<option value="${p.id}"${p.id === "eto_max" ? " selected" : ""}>${esc(p.name + " " + p.tier)}</option>`).join("")}</select></label>
          <label>Durée<select id="kg-days"><option value="7">7 jours</option><option value="30" selected>1 mois</option><option value="90">3 mois</option><option value="365">1 an</option><option value="0">Sans limite</option></select></label>
          <label>Nombre de clés<input id="kg-count" type="number" min="1" max="200" value="1"></label>
          <label>Utilisations par clé<input id="kg-uses" type="number" min="1" max="1000" value="1"></label>
          <label>Valable (jours)<input id="kg-exp" type="number" min="0" max="3660" value="0" title="0 = pas de date limite d'activation"></label>
          <label>Note<input id="kg-note" type="text" maxlength="120" placeholder="presse, partenaire…"></label>
        </div>
        <p class="pl-err" id="kg-err"></p><button class="btn pri wide" id="kg-go">Générer</button>
        <div id="kg-out"></div>
        <h4 class="pl-h4">Clés créées<button class="pl-mini" id="kg-ref">Actualiser</button></h4><div id="kg-list" class="pl-klist"><p class="muted">Chargement…</p></div></div>
      <div class="card pl-adm pl-rev"><h3><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/></svg>Révocateur d'abonnement</h3>
        <p class="muted">Coupe l'offre d'un compte ETO (fraude, remboursement, fin de partenariat). L'application redescend en ETO Free dès qu'elle relit sa licence (au plus tard 7 jours hors ligne).</p>
        <div class="pl-form"><input id="rv-q" type="search" placeholder="Rechercher un e-mail…" autocomplete="off"></div>
        <div id="rv-list" class="pl-klist"><p class="muted">Chargement…</p></div></div>`;
    const $ = (q) => box.querySelector(q);
    const keys = async () => {
      const r = await E.cloud.req("/eto/admin/keys"); const L = $("#kg-list"); if (!L) return;
      if (r.status !== 200) { L.innerHTML = `<p class="pl-err">${esc(r.json.detail || "Serveur injoignable.")}</p>`; return; }
      L.innerHTML = r.json.keys.length ? r.json.keys.map((k) => `<div class="pl-krow" data-k="${k.id}">${PLAB(k.plan)}<span class="pl-kcode">••••-${esc(k.hint)}</span>
          <span class="pl-kmeta">${k.days ? k.days + " j" : "à vie"} · ${k.uses}/${k.max_uses}${k.note ? " · " + esc(k.note) : ""}${k.expires ? " · avant le " + dfr(k.expires) : ""}</span>
          <i class="pl-kst ${KST[k.status][1]}">${KST[k.status][0]}</i>${k.status === "revoked" ? "" : `<button class="pl-mini bad" data-krev="${k.id}">Révoquer</button>`}</div>`).join("") : `<p class="muted">Aucune clé pour l'instant.</p>`;
    };
    let qT = 0;
    const subs = async () => {
      const r = await E.cloud.req("/eto/admin/subs?q=" + encodeURIComponent(($("#rv-q") || {}).value || "")); const L = $("#rv-list"); if (!L) return;
      if (r.status !== 200) { L.innerHTML = `<p class="pl-err">${esc(r.json.detail || "Serveur injoignable.")}</p>`; return; }
      L.innerHTML = r.json.subscribers.length ? r.json.subscribers.map((x) => `<div class="pl-krow">${PLAB(x.plan)}<span class="pl-kcode">${esc(x.email)}</span>
          <span class="pl-kmeta">${x.plan === "eto_free" ? (x.status === "revoked" ? "révoqué" : "gratuit") : [SRC(x.source), x.period_end ? "jusqu'au " + dfr(x.period_end) : "sans limite"].filter(Boolean).join(" · ")}</span>
          ${x.plan !== "eto_free" ? `<button class="pl-mini bad" data-srev="${esc(x.email)}" data-src="${esc(x.source)}">Révoquer</button>` : ""}</div>`).join("") : `<p class="muted">Aucun compte ETO trouvé.</p>`;
    };
    $("#rv-q").addEventListener("input", () => { clearTimeout(qT); qT = setTimeout(subs, 300); });
    $("#kg-ref").onclick = () => { keys(); subs(); };
    $("#kg-go").onclick = async () => {
      const b = $("#kg-go"), err = $("#kg-err"); err.textContent = ""; b.disabled = true; b.textContent = "Génération…";
      try {
        const body = { plan: $("#kg-plan").value, days: +$("#kg-days").value, count: Math.max(1, Math.min(200, +$("#kg-count").value || 1)), max_uses: Math.max(1, Math.min(1000, +$("#kg-uses").value || 1)), expires_days: Math.max(0, +$("#kg-exp").value || 0), note: $("#kg-note").value };
        const r = await E.cloud.req("/eto/admin/keys", { method: "POST", body }); if (r.status !== 200) throw new Error(r.json.detail || "Refusé (" + r.status + ").");
        const p = BY[r.json.plan];
        $("#kg-out").innerHTML = `<div class="pl-kout" style="--c:${p.color}"><div class="pl-kohead">${PLAB(p.id)}<b>${r.json.codes.length} clé${r.json.codes.length > 1 ? "s" : ""} · ${r.json.days ? r.json.days + " jours" : "sans limite"}</b><button class="pl-mini" id="kg-all">Tout copier</button></div>
            ${r.json.codes.map((c, i) => `<button class="pl-kcodebig" data-copy="${esc(c)}" style="--i:${i}">${esc(c)}<small>copier</small></button>`).join("")}
            <p class="muted" style="font-size:12px">Note-les maintenant : elles ne seront plus affichées en clair.</p></div>`;
        $("#kg-all").onclick = () => copyText(r.json.codes.join("\n"));
        E.vibrate && E.vibrate(14); keys();
      } catch (e) { err.textContent = e.message; } finally { b.disabled = false; b.textContent = "Générer"; }
    };
    box.addEventListener("click", (e) => {
      const cp = e.target.closest("[data-copy]"); if (cp) return copyText(cp.dataset.copy);
      const kr = e.target.closest("[data-krev]");
      if (kr) {
        const s = E.ui.sheet({ title: "Révoquer la clé", html: `<p class="muted" style="line-height:1.5">Plus personne ne pourra l'activer.</p><label class="pl-chk"><input type="checkbox" id="kr-subs"> Couper aussi les abonnements ouverts avec cette clé</label>`,
          options: [{ label: "Révoquer", cls: "bad", fn: async () => { const r = await E.cloud.req("/eto/admin/keys/revoke", { method: "POST", body: { id: +kr.dataset.krev, revoke_subs: !!(s.querySelector("#kr-subs") || {}).checked } });
            E.ui.toast(r.status === 200 ? `Clé révoquée${r.json.subscriptions_stopped ? ` · ${r.json.subscriptions_stopped} abonnement(s) coupé(s)` : ""}.` : r.json.detail || "Échec.", r.status === 200 ? "ok" : "warn"); keys(); subs(); } }, { label: "Annuler" }] });
        return;
      }
      const sr = e.target.closest("[data-srev]");
      if (sr) {
        const stripe = sr.dataset.src === "stripe";
        const s = E.ui.sheet({ title: "Révoquer l'abonnement", html: `<p class="muted" style="line-height:1.5"><b>${esc(sr.dataset.srev)}</b> repasse en ETO Free.</p>
            <div class="pl-form"><label>Motif (journal interne)<input id="rv-why" type="text" maxlength="200" placeholder="remboursement, fraude…"></label></div>
            ${stripe ? `<label class="pl-chk"><input type="checkbox" id="rv-bill" checked> Annuler aussi le prélèvement Stripe</label>` : ""}`,
          options: [{ label: "Révoquer", cls: "bad", fn: async () => { const r = await E.cloud.req("/eto/admin/revoke", { method: "POST", body: { email: sr.dataset.srev, reason: (s.querySelector("#rv-why") || {}).value || "", cancel_billing: !!(s.querySelector("#rv-bill") || {}).checked } });
            E.ui.toast(r.status === 200 ? `Abonnement ${BY[r.json.previous].tier} révoqué${r.json.billing === "cancelled" ? " · prélèvement Stripe annulé" : ""}.` : r.json.detail || "Échec.", r.status === 200 ? "ok" : "warn"); subs(); } }, { label: "Annuler" }] });
      }
    });
    keys(); subs();
  }
  P._admin = admin;

  // démarrage : la marque et la couleur de la version active
  const start = () => { try { apply(false); } catch (e) { /* en-tête pas encore prêt */ } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else setTimeout(start, 0);
})();
