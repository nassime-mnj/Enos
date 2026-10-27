"use strict";
// ABONNEMENTS (téléphone, sans PC) : liste de tes abonnements, total mensuel / annuel, compte à rebours avant chaque prélèvement, lien « Gérer / Annuler » et modèle d'e-mail
// de résiliation. Saisie à la main (catalogue de services courants) ou IMPORT par l'IA (Groq) depuis un relevé bancaire : texte, PDF, capture ou CSV — les prélèvements
// récurrents sont repérés pour toi. Les données restent sur le téléphone.
(() => {
  const E = window.ENOS, esc = E.esc;
  const PER_MONTH = { monthly: 1, yearly: 1 / 12, weekly: 52 / 12, quarterly: 1 / 3 };
  const FREQ = { monthly: "/ mois", yearly: "/ an", weekly: "/ semaine", quarterly: "/ trimestre" };
  const CATALOG = [
    ["Netflix", "https://www.netflix.com/youraccount"], ["Spotify", "https://www.spotify.com/account/subscription/"], ["Disney+", "https://www.disneyplus.com/account"],
    ["Amazon Prime", "https://www.amazon.fr/mc"], ["YouTube Premium", "https://www.youtube.com/paid_memberships"], ["Canal+", "https://www.canalplus.com/espace-client/"],
    ["Apple (iCloud, Music, TV+)", "https://support.apple.com/fr-fr/118428"], ["Google One", "https://one.google.com/settings"], ["ChatGPT Plus", "https://chatgpt.com/#settings/Subscription"],
    ["Xbox Game Pass", "https://account.microsoft.com/services"], ["PlayStation Plus", "https://www.playstation.com/fr-fr/support/store/cancel-ps-plus/"], ["Adobe Creative Cloud", "https://account.adobe.com/plans"],
    ["Salle de sport", ""], ["Téléphone / box internet", ""],
  ];
  const today = () => new Date(new Date().toDateString());
  const parse = (s) => (s ? new Date(s + "T00:00:00") : null);
  const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

  /** Prochaine date de prélèvement à partir d'une date de référence (avance de période en période jusqu'à aujourd'hui). */
  const nextDate = (s) => {
    let d = parse(s.next); if (!d) return null;
    const t = today(); let guard = 0;
    while (d < t && s.freq !== "once" && guard++ < 600) {
      if (s.freq === "yearly") d.setFullYear(d.getFullYear() + 1); else if (s.freq === "weekly") d.setDate(d.getDate() + 7); else if (s.freq === "quarterly") d.setMonth(d.getMonth() + 3); else d.setMonth(d.getMonth() + 1);
    }
    return d;
  };
  const daysTo = (d) => (d ? Math.round((d - today()) / 86400000) : null);
  const totals = (list) => {
    const live = list.filter((s) => s.status !== "cancelled" && s.status !== "trial");
    const month = live.reduce((t, s) => t + s.price * (PER_MONTH[s.freq] || 1), 0);
    return { month, year: month * 12, n: live.length };
  };
  E.subs = { nextDate, daysTo, totals };

  E.suite.register({
    id: "subs", group: "pro", title: "Abonnements", sub: "Coût mensuel · résilier en un geste",
    icon: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
    build(el, A) {
      const $ = (s) => el.querySelector(s);
      let list = E.settings.get("subs.list", []), filter = "live";
      const save = () => { E.settings.set("subs.list", list); render(); };
      const money = (v, cur) => { try { return new Intl.NumberFormat("fr-FR", { style: "currency", currency: cur || "EUR" }).format(v); } catch (e) { return v.toFixed(2) + " €"; } };
      el.innerHTML = `
        <div class="card"><div class="df-sum" style="border:0"><div style="flex:1"><small class="muted">PAR MOIS</small><div id="sb-m" style="font:800 24px var(--ui)"></div></div><div style="flex:1"><small class="muted">PAR AN</small><div id="sb-y" style="font:800 24px var(--ui)"></div></div></div>
          <div class="muted" id="sb-n" style="font-size:13px"></div>
          <div class="row" style="margin-top:10px"><button class="btn pri" id="sb-add">AJOUTER</button><button class="btn" id="sb-imp">IMPORTER (IA)</button></div></div>
        <div class="lrn-chips" id="sb-f">${[["live", "Actifs"], ["trial", "Essais"], ["cancelled", "Résiliés"], ["all", "Tous"]].map(([k, n]) => `<button data-f="${k}" class="${k === filter ? "on" : ""}">${n}</button>`).join("")}</div>
        <div id="sb-list"></div>`;

      function render() {
        const t = totals(list);
        $("#sb-m").textContent = money(t.month); $("#sb-y").textContent = money(t.year);
        const soon = list.filter((s) => s.status !== "cancelled").map((s) => ({ s, d: daysTo(nextDate(s)) })).filter((x) => x.d != null).sort((a, b) => a.d - b.d)[0];
        $("#sb-n").textContent = t.n + " abonnement" + (t.n > 1 ? "s" : "") + " actif" + (t.n > 1 ? "s" : "") + (soon ? ` · prochain : ${soon.s.name} ${soon.d === 0 ? "aujourd'hui" : soon.d === 1 ? "demain" : "dans " + soon.d + " j"}` : "");
        const shown = list.filter((s) => filter === "all" || (filter === "live" ? s.status === "active" : s.status === filter));
        $("#sb-list").innerHTML = shown.length ? shown.map((s) => {
          const d = nextDate(s), dd = daysTo(d), st = s.status === "trial" ? ["ESSAI", "#f5c542"] : s.status === "cancelled" ? ["RÉSILIÉ", "#6d6d77"] : ["ACTIF", "#7bd64d"];
          return `<div class="card sb-c" data-id="${s.id}"><div class="df-pl" style="gap:10px"><b style="flex:1;font-size:16px">${esc(s.name)}</b><span class="kchip" style="--c:${st[1]}">${st[0]}</span></div>
            <div style="font:800 20px var(--ui)">${money(s.price, s.cur)} <small class="muted" style="font:600 13px var(--ui)">${FREQ[s.freq] || ""}</small></div>
            <div class="muted" style="font-size:13.5px;margin:2px 0 8px">${s.status === "cancelled" ? "Résilié" : dd == null ? "Date de prélèvement inconnue" : dd === 0 ? "Prélèvement aujourd'hui" : dd === 1 ? "Prélèvement demain" : "Prélèvement dans " + dd + " j (" + d.toLocaleDateString("fr-FR") + ")"}${s.status === "trial" ? " · fin d'essai" : ""}</div>
            <div class="row">${/^https?:\/\//.test(s.url || "") ? `<a class="btn" href="${esc(s.url)}" target="_blank" rel="noopener">GÉRER / ANNULER</a>` : ""}<button class="btn" data-a="mail">MODÈLE D'E-MAIL</button><button class="btn" data-a="edit">MODIFIER</button></div></div>`;
        }).join("") : '<div class="card"><p class="muted">Aucun abonnement ici. Touche AJOUTER, ou IMPORTER pour que l\'IA les trouve dans ton relevé.</p></div>';
      }
      $("#sb-f").onclick = (e) => { const b = e.target.closest("[data-f]"); if (!b) return; filter = b.dataset.f; $("#sb-f").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); render(); };
      $("#sb-list").onclick = (e) => {
        const b = e.target.closest("[data-a]"), c = e.target.closest(".sb-c"); if (!b || !c) return;
        const s = list.find((x) => x.id === c.dataset.id); if (!s) return;
        if (b.dataset.a === "edit") form(s);
        if (b.dataset.a === "mail") A.copy(`Objet : Résiliation de mon abonnement ${s.name}\n\nBonjour,\n\nJe souhaite résilier mon abonnement ${s.name} (${money(s.price, s.cur)} ${FREQ[s.freq] || ""}) avec effet à la prochaine échéance, et vous demande de m'en confirmer la bonne réception ainsi que la date de fin.\n\nMerci de ne plus effectuer aucun prélèvement après cette date.\n\nCordialement`);
      };

      function form(s) {
        const n = s || { id: "s" + Date.now().toString(36), name: "", price: 0, cur: "EUR", freq: "monthly", next: iso(today()), status: "active", url: "" };
        const sh = E.ui.sheet({ title: s ? "Modifier" : "Nouvel abonnement", html: `
          ${s ? "" : `<label class="fld">Service courant</label><select id="sf-cat" class="sel"><option value="">— autre —</option>${CATALOG.map(([nm], i) => `<option value="${i}">${esc(nm)}</option>`).join("")}</select>`}
          <label class="fld">Nom</label><input type="text" id="sf-n" class="sel" value="${esc(n.name)}" style="padding:0 12px">
          <label class="fld">Prix (€)</label><input type="number" id="sf-p" class="sel" step="0.01" min="0" value="${n.price || ""}" style="padding:0 12px">
          <label class="fld">Fréquence</label><select id="sf-f" class="sel">${Object.keys(FREQ).map((k) => `<option value="${k}" ${k === n.freq ? "selected" : ""}>${FREQ[k]}</option>`).join("")}</select>
          <label class="fld">Prochain prélèvement</label><input type="date" id="sf-d" class="sel" value="${n.next || ""}" style="padding:0 12px">
          <label class="fld">Statut</label><select id="sf-s" class="sel"><option value="active" ${n.status === "active" ? "selected" : ""}>Actif</option><option value="trial" ${n.status === "trial" ? "selected" : ""}>Période d'essai</option><option value="cancelled" ${n.status === "cancelled" ? "selected" : ""}>Résilié</option></select>
          <label class="fld">Lien de gestion (facultatif)</label><input type="url" id="sf-u" class="sel" value="${esc(n.url || "")}" placeholder="https://…" style="padding:0 12px">`,
          options: [{ label: "ENREGISTRER", cls: "pri", fn: () => {
            n.name = sh.querySelector("#sf-n").value.trim(); n.price = Math.max(0, parseFloat(sh.querySelector("#sf-p").value) || 0); n.freq = sh.querySelector("#sf-f").value; n.next = sh.querySelector("#sf-d").value; n.status = sh.querySelector("#sf-s").value; n.url = sh.querySelector("#sf-u").value.trim();
            if (!n.name) return A.toast("Donne un nom à l'abonnement.", "warn");
            if (!s) list.push(n); save();
          } }, ...(s ? [{ label: "SUPPRIMER", cls: "bad", fn: () => { list = list.filter((x) => x.id !== n.id); save(); } }] : []), { label: "ANNULER" }] });
        const cat = sh.querySelector("#sf-cat");
        if (cat) cat.onchange = () => { const c = CATALOG[+cat.value]; if (c) { sh.querySelector("#sf-n").value = c[0]; sh.querySelector("#sf-u").value = c[1]; } };
      }
      $("#sb-add").onclick = () => form(null);

      // ---- import par l'IA : relevé (texte, PDF, capture, CSV) -> prélèvements récurrents
      const PROMPT = `Voici le contenu d'un relevé bancaire ou d'une liste de paiements. Repère uniquement les abonnements / prélèvements RÉCURRENTS (même libellé revenant chaque mois, an ou semaine : streaming, musique, cloud, sport, téléphonie, assurance, logiciels). Ignore les achats ponctuels. Réponds UNIQUEMENT par un JSON : {"subs":[{"name":"Netflix","price":13.49,"freq":"monthly|yearly|weekly|quarterly","last":"AAAA-MM-JJ"}]} (last = date du dernier prélèvement si connue).`;
      $("#sb-imp").onclick = async () => {
        if (!E.ai || !E.ai.configured()) return A.toast("Clé Groq absente : Réglages → Clés d'API.", "warn");
        const f = (await A.pick({ accept: ".pdf,.csv,.txt,image/*" }))[0]; if (!f) return;
        A.toast("L'IA lit ton relevé…", "ok");
        try {
          let out;
          if (/^image\//.test(f.type)) { const url = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); }); out = await A.llmVision({ ask: PROMPT, image: url, json: true, maxTokens: 1500 }); }
          else {
            let text;
            if (/pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)) text = await A.pdfText(await A.pdfOpen(await A.read(f)), 24000); else text = (await A.readText(f)).slice(0, 24000);
            out = await A.llm({ system: "Tu extrais des abonnements d'un relevé. Tu réponds en JSON valide uniquement.", user: PROMPT + "\n\n" + text, json: true, maxTokens: 1500 });
          }
          const found = (JSON.parse(out.replace(/^[^{]*/, "").replace(/[^}]*$/, "")).subs || []).filter((x) => x && x.name && +x.price > 0);
          if (!found.length) return A.toast("Aucun abonnement repéré dans ce document.", "warn");
          review(found);
        } catch (e) { A.toast("Import impossible : " + e.message, "err"); }
      };
      function review(found) {
        const sh = E.ui.sheet({ title: found.length + " abonnement" + (found.length > 1 ? "s" : "") + " repéré" + (found.length > 1 ? "s" : ""), html: found.map((x, i) => `<label class="chip2" style="display:flex;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)"><input type="checkbox" data-i="${i}" checked><span style="flex:1"><b>${esc(x.name)}</b><br><small class="muted">${money(+x.price)} ${FREQ[x.freq] || FREQ.monthly}</small></span></label>`).join(""),
          options: [{ label: "AJOUTER LA SÉLECTION", cls: "pri", fn: () => {
            sh.querySelectorAll("[data-i]").forEach((c) => {
              if (!c.checked) return; const x = found[+c.dataset.i], freq = FREQ[x.freq] ? x.freq : "monthly";
              if (list.some((s) => s.name.toLowerCase() === String(x.name).toLowerCase())) return;
              const cat = CATALOG.find(([nm]) => nm.toLowerCase().split(" ")[0] === String(x.name).toLowerCase().split(" ")[0]);
              list.push({ id: "s" + Math.random().toString(36).slice(2, 8), name: String(x.name).slice(0, 60), price: +x.price, cur: "EUR", freq, next: /^\d{4}-\d{2}-\d{2}$/.test(x.last || "") ? x.last : iso(today()), status: "active", url: cat ? cat[1] : "" });
            }); save();
          } }, { label: "ANNULER" }] });
      }
      el._api = { get list() { return list; }, form, render };
      render();
    },
  });
})();
