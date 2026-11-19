"use strict";
// ETO GATEWAY (ETO MAX / Ultra) : la clé d'IA du client, créée par le serveur ETO avec l'API officielle de gestion des clés d'OpenRouter.
//   « Obtenir ma clé » : le serveur crée une clé sk-or-v1-… plafonnée par mois selon l'offre ; si une clé existe déjà, elle est supprimée et
//   recréée (rotation). La clé est montrée UNE fois (pour tes propres projets) et rangée dans le coffre du téléphone (Android Keystore) :
//   le chat ETO l'utilise ensuite via le pont natif, le JavaScript ne la relit jamais. Consommation du mois lue chez OpenRouter par le serveur.
(() => {
  const E = window.ENOS, esc = E.esc, N = E.native;
  const usd = (v) => (v == null ? "—" : (Math.round(v * 100) / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $");
  const dfr = (t) => (t ? new Date(t * 1000).toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) : "");
  async function copyText(t) { try { await navigator.clipboard.writeText(t); } catch (e) { const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (x) { /* rien */ } ta.remove(); } E.ui.toast("Copié.", "ok"); }

  E.suite.register({
    id: "gateway", group: "sync", title: "ETO Gateway", sub: "Ta clé d'IA gérée par ETO",
    icon: '<path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8"/><circle cx="12" cy="12" r="3.2"/>',
    onShow() { if (this._load) this._load(); },
    build(el) {
      let st = null, fresh = null, busy = false;
      const logged = () => E.cloud && E.cloud.loggedIn();
      const hero = (sub) => `<div class="pl-hero gw-hero" style="--c:#facc15"><div class="pl-orbs"><i></i><i></i><i></i></div><small>ETO MAX · Ultra</small><h2>ETO <em>Gateway</em></h2><p>${sub}</p></div>`;
      const srcCard = () => {
        const A = E.ai, s = A.source();
        return `<div class="card gw-src"><h3>Source de l'IA d'ETO<span class="sp">chat, analyse, scanner…</span></h3>
          <div class="gw-seg">${[["eto", "ETO Gateway", A.hasEto()], ["groq", "Ma clé Groq", A.hasGroq()]].map(([id, n, ok]) => `<button data-src="${id}" class="${s === id ? "on" : ""}"${ok ? "" : " disabled"}>${n}${ok ? "" : "<small>aucune clé</small>"}</button>`).join("")}</div></div>`;
      };
      const paint = () => {
        if (!logged()) {
          el.innerHTML = hero("Une clé d'IA à ton nom, payée par ton abonnement, plafonnée chaque mois. Aucune carte chez un fournisseur, aucun compte à créer ailleurs.") +
            `<div class="card"><h3>Compte ETO requis</h3><p class="muted">La clé est créée par le serveur ETO pour ton compte.</p><button class="btn pri wide" data-gw="acc">Me connecter</button></div>`;
          return;
        }
        if (!st) { el.innerHTML = hero("Chargement…") + `<div class="card"><div class="gw-skel"></div></div>`; return; }
        if (st.error) { el.innerHTML = hero("Serveur injoignable") + `<div class="card"><p class="pl-err">${esc(st.error)}</p><button class="btn wide" data-gw="reload">Réessayer</button></div>` + srcCard(); return; }
        const k = st.key, lim = (k && k.limit_usd) || st.limit_usd, used = k && k.usage_usd != null ? k.usage_usd : null, pct = used != null && lim ? Math.min(100, (used / lim) * 100) : 0;
        el.innerHTML = hero(st.allowed ? `Plafond de ton offre : <b>${usd(st.limit_usd)} d'IA par mois</b>, remis à zéro chaque mois. Modèles ouverts (GPT-OSS, Llama, DeepSeek, Gemini, Mistral…).` : "La passerelle d'IA fait partie d'ETO MAX et d'ETO Ultra.") +
          (!st.configured ? `<div class="card gw-warn"><p class="muted">La passerelle n'est pas encore ouverte sur le serveur ETO (clé de gestion OpenRouter à installer par DualPulse). Rien n'est facturé.</p></div>` : "") +
          (fresh ? `<div class="card gw-fresh"><h3>Ta clé${fresh.rotated ? " (nouvelle)" : ""}<span class="sp">montrée une seule fois</span></h3>
              <button class="gw-key" data-gw="copy">${esc(fresh.key.slice(0, 14))}••••••••${esc(fresh.key.slice(-6))}<small>copier</small></button>
              <p class="muted">Déjà rangée dans le coffre du téléphone pour le chat ETO. Pour tes projets : compatible OpenAI.</p>
              <pre class="gw-code">base_url = "${esc(fresh.base_url)}"\napi_key  = "sk-or-v1-…"\nmodel    = "${esc(fresh.models[0])}"</pre>
              ${fresh.rotated ? `<p class="gw-note">L'ancienne clé a été supprimée : elle ne fonctionne plus.</p>` : ""}</div>` : "") +
          (k ? `<div class="card gw-use"><h3>Ce mois-ci${k.disabled ? '<span class="sp bad">désactivée</span>' : ""}</h3>
              <div class="gw-bar"><i style="width:${pct.toFixed(1)}%"></i></div>
              <div class="gw-nums"><b>${usd(used)}</b><span>sur ${usd(lim)}</span><span>reste ${usd(k.remaining_usd)}</span></div>
              <p class="muted" style="font-size:12.5px">Clé créée le ${dfr(k.created)}${k.rotated !== k.created ? " · recréée le " + dfr(k.rotated) : ""}.</p>
              <div class="row"><button class="btn" data-gw="new">Recréer la clé</button><button class="btn" data-gw="del">Supprimer</button></div></div>`
            : st.allowed ? `<div class="card"><h3>Pas encore de clé</h3><p class="muted">Le serveur ETO crée ta clé à ton nom et l'installe sur ce téléphone.</p><button class="btn pri wide" data-gw="new"${st.configured ? "" : " disabled"}>Obtenir ma clé</button></div>`
            : `<div class="card"><button class="btn pri wide" data-gw="plans">Voir ETO MAX</button></div>`) +
          srcCard() +
          `<p class="pl-legal">Les requêtes partent directement du téléphone vers OpenRouter avec ta clé ; le serveur ETO ne voit pas tes conversations. Au-delà du plafond, l'IA s'arrête jusqu'au mois suivant : jamais de dépassement facturé.</p>`;
      };
      const load = async () => {
        if (!logged()) { st = null; return paint(); }
        try { const r = await E.cloud.req("/eto/ai"); st = r.status === 200 ? r.json : { error: r.json.detail || "Erreur " + r.status }; } catch (e) { st = { error: e.message }; }
        paint();
      };
      const create = async () => {
        if (busy) return; busy = true;
        try {
          const r = await E.cloud.req("/eto/ai/key", { method: "POST" });
          if (r.status !== 200) throw new Error(r.json.detail || "Refusé (" + r.status + ").");
          if (!N.vault.set("openrouter", r.json.key)) throw new Error("Impossible de ranger la clé dans le coffre.");
          E.settings.set("ai.source", "eto"); fresh = r.json;
          E.ui.toast(r.json.rotated ? "Nouvelle clé installée, l'ancienne est supprimée." : "Clé ETO installée.", "ok"); E.vibrate && E.vibrate(14);
          await load();
        } catch (e) { E.ui.toast(e.message, "warn"); } finally { busy = false; }
      };
      el.addEventListener("click", async (e) => {
        const s = e.target.closest("[data-src]"); if (s && !s.disabled) { E.settings.set("ai.source", s.dataset.src); E.ui.toast(s.dataset.src === "eto" ? "Le chat utilise ETO Gateway." : "Le chat utilise ta clé Groq.", "ok"); return paint(); }
        const b = e.target.closest("[data-gw]"); if (!b) return;
        const a = b.dataset.gw;
        if (a === "acc") return E.plans && E.plans.accountSheet ? E.plans.accountSheet("login") : E.modules.open("plans");
        if (a === "plans") { E.ui.go("tools"); return E.modules.open("plans"); }
        if (a === "reload") return load();
        if (a === "copy" && fresh) return copyText(fresh.key);
        if (a === "new") {
          if (st && st.key) { if (!(await E.ui.confirm("Recréer la clé ?", "L'ancienne clé sera supprimée chez OpenRouter et ne fonctionnera plus (tes projets devront utiliser la nouvelle).", "RECRÉER", true))) return; }
          return create();
        }
        if (a === "del") {
          if (!(await E.ui.confirm("Supprimer la clé ?", "Le chat ETO repassera sur ta clé Groq si tu en as une.", "SUPPRIMER", true))) return;
          const r = await E.cloud.req("/eto/ai/key", { method: "DELETE" });
          if (r.status === 200) { N.vault.del("openrouter"); fresh = null; E.ui.toast("Clé supprimée.", "ok"); } else E.ui.toast(r.json.detail || "Échec.", "warn");
          return load();
        }
      });
      this._load = load; paint(); load();
    },
  });
})();
