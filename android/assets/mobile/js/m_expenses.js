"use strict";
// DÉPENSES PARTAGÉES (même calcul que le PC : quicklib.js, tout en centimes). Les données restent sur le téléphone.
(() => {
  const E = window.ENOS, QL = window.QL;
  const KEY = "expenses";
  E.suite.register({
    id: "expenses", group: "pro", title: "Dépenses partagées", sub: "Qui doit quoi à qui",
    icon: '<circle cx="12" cy="12" r="9"/><path d="M14.5 9a2.5 2.5 0 0 0-2.5-1.5c-1.4 0-2.5.9-2.5 2s1 1.8 2.5 2 2.5.9 2.5 2-1.100 2-2.500 2A2.5 2.5 0 0 1 9.500 15M12 6.500v1M12 16.500v1"/>',
    build(el, A) {
      const st = Object.assign({ title: "Week-end", cur: "€", people: [], expenses: [] }, E.store.get(KEY, {}));
      const save = () => E.store.set(KEY, st);
      el.innerHTML = `<div class="card"><h3>Dépenses partagées</h3>
        <input type="text" id="ex-title" maxlength="60" placeholder="Titre (ex. Week-end à Lyon)" aria-label="Titre">
        <div class="row" style="margin-top:8px"><input type="text" id="ex-person" maxlength="30" placeholder="Ajouter une personne" aria-label="Nouvelle personne"><button class="btn" id="ex-addp" style="flex:0 0 auto">AJOUTER</button></div>
        <div class="chips" id="ex-people" style="margin-top:8px"></div></div>
        <div class="card"><h3>Nouvelle dépense</h3>
          <input type="text" id="ex-label" maxlength="60" placeholder="Libellé (ex. Courses)" aria-label="Libellé">
          <div class="row" style="margin-top:8px"><input type="text" id="ex-amount" inputmode="decimal" placeholder="Montant" aria-label="Montant"><select id="ex-payer" aria-label="Payé par"></select></div>
          <div class="chips" id="ex-split" style="margin-top:8px"></div>
          <button class="btn pri wide" id="ex-add" style="margin-top:10px">AJOUTER LA DÉPENSE</button><p class="err" id="ex-err" hidden role="alert"></p></div>
        <div class="card"><h3>Dépenses<span class="sp" id="ex-total"></span></h3><div id="ex-list" class="list"></div></div>
        <div class="card"><h3>Remboursements</h3><div id="ex-settle" class="list"></div>
          <div class="row" style="margin-top:10px"><button class="btn" id="ex-copy">COPIER LE RÉSUMÉ</button><button class="btn" id="ex-share">PARTAGER</button><button class="btn" id="ex-reset">TOUT EFFACER</button></div></div>`;
      const $ = (s) => el.querySelector(s), esc = E.esc;
      let sel = new Set();
      const render = () => {
        $("#ex-title").value = st.title;
        $("#ex-people").innerHTML = st.people.length ? st.people.map((p, i) => `<span class="chip2">${esc(p)} <button data-rp="${i}" aria-label="Retirer ${esc(p)}" style="background:none;border:0;color:var(--muted)">✕</button></span>`).join("") : '<span class="muted">Ajoute au moins deux personnes.</span>';
        $("#ex-payer").innerHTML = st.people.map((p) => `<option>${esc(p)}</option>`).join("");
        sel = new Set([...sel].filter((p) => st.people.includes(p))); if (!sel.size) st.people.forEach((p) => sel.add(p));
        $("#ex-split").innerHTML = st.people.map((p) => `<label class="chip2"><input type="checkbox" data-sp="${esc(p)}" ${sel.has(p) ? "checked" : ""}> ${esc(p)}</label>`).join("");
        const b = QL.balances(st.people, st.expenses), t = QL.settle(b.balance);
        $("#ex-total").textContent = b.total ? "Total " + QL.fmt(b.total, st.cur) : "";
        $("#ex-list").innerHTML = st.expenses.length ? st.expenses.map((x, i) => `<div class="row" style="justify-content:space-between"><span><b>${esc(x.label)}</b><br><span class="muted">${esc(x.payer)} a payé · ${x.split.length} pers.</span></span><span>${QL.fmt(x.amount, st.cur)} <button data-rx="${i}" aria-label="Supprimer" style="background:none;border:0;color:var(--muted)">✕</button></span></div>`).join("") : '<div class="muted">Aucune dépense.</div>';
        $("#ex-settle").innerHTML = !st.expenses.length ? '<div class="muted">—</div>' : t.length ? t.map((x) => `<div class="row" style="justify-content:space-between"><span>${esc(x.from)} → ${esc(x.to)}</span><b>${QL.fmt(x.amount, st.cur)}</b></div>`).join("") : '<div class="ok">✅ Les comptes sont équilibrés.</div>';
        save();
      };
      const err = (m) => { $("#ex-err").hidden = !m; $("#ex-err").textContent = m || ""; };
      $("#ex-title").oninput = (e) => { st.title = e.target.value; save(); };
      const addPerson = () => { const n = $("#ex-person").value.trim(); if (!n) return; if (st.people.includes(n)) return A.toast("Cette personne existe déjà.", "warn"); st.people.push(n); $("#ex-person").value = ""; sel.add(n); render(); };
      $("#ex-addp").onclick = addPerson; $("#ex-person").onkeydown = (e) => { if (e.key === "Enter") addPerson(); };
      el.addEventListener("click", (e) => {
        const rp = e.target.closest("[data-rp]"), rx = e.target.closest("[data-rx]");
        if (rp) { const n = st.people[+rp.dataset.rp]; st.people.splice(+rp.dataset.rp, 1); st.expenses = st.expenses.filter((x) => x.payer !== n).map((x) => ({ ...x, split: x.split.filter((p) => p !== n) })).filter((x) => x.split.length); render(); }
        if (rx) { st.expenses.splice(+rx.dataset.rx, 1); render(); }
      });
      el.addEventListener("change", (e) => { const c = e.target.closest("[data-sp]"); if (c) { c.checked ? sel.add(c.dataset.sp) : sel.delete(c.dataset.sp); } });
      $("#ex-add").onclick = () => {
        err("");
        const label = $("#ex-label").value.trim(), amount = QL.toCents($("#ex-amount").value), payer = $("#ex-payer").value;
        if (st.people.length < 2) return err("Ajoute au moins deux personnes.");
        if (!label) return err("Indique un libellé.");
        if (!(amount > 0)) return err("Montant invalide.");
        if (!sel.size) return err("Choisis au moins une personne concernée.");
        st.expenses.push({ label, amount, payer, split: [...sel] }); $("#ex-label").value = ""; $("#ex-amount").value = ""; render();
      };
      const text = () => QL.summary(st.title, st.people, st.expenses, st.cur);
      $("#ex-copy").onclick = () => A.copy(text());
      $("#ex-share").onclick = async () => { try { if (navigator.share) await navigator.share({ text: text() }); else A.copy(text()); } catch (e) { /* annulé */ } };
      $("#ex-reset").onclick = () => { if (confirm("Tout effacer ?")) { st.people = []; st.expenses = []; sel.clear(); render(); } };
      render();
    },
  });
})();
