"use strict";
// PRESSE-PAPIERS UNIVERSEL : un texte ou une image copiés sur le téléphone sont disponibles sur le PC (et inversement), via ton compte cloud.
(() => {
  const E = window.ENOS, esc = E.esc;
  E.suite.register({
    id: "clip", group: "sync", title: "Presse-papiers", sub: "Téléphone ⇄ PC",
    icon: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
    build(el, A) {
      const C = E.cloud, $ = (s) => el.querySelector(s);
      let since = 0, timer = 0, seen = new Set();
      el.innerHTML = `<div class="card" id="cp-login" hidden><h3>Presse-papiers universel</h3><p class="muted">Connecte-toi d'abord au cloud (module « Compte cloud »).</p></div>
        <div id="cp-main"><div class="card"><h3>Envoyer vers le PC</h3>
          <textarea id="cp-text" placeholder="Colle ou écris du texte…" style="min-height:90px" aria-label="Texte à envoyer"></textarea>
          <div class="row" style="margin-top:8px"><button class="btn pri" id="cp-send">ENVOYER LE TEXTE</button><button class="btn" id="cp-paste">COLLER</button><button class="btn" id="cp-img">UNE IMAGE…</button></div>
          <label class="chip2" style="margin-top:10px;display:inline-flex;gap:8px"><input type="checkbox" id="cp-auto" ${E.settings.get("clipAuto", false) ? "checked" : ""}> Copier automatiquement ce qui vient du PC</label>
          <p class="err" id="cp-err" hidden role="alert"></p></div>
          <div class="card"><h3>Récents<span class="sp" id="cp-n"></span></h3><div id="cp-list" class="list"></div></div></div>`;
      const err = (m) => { $("#cp-err").hidden = !m; $("#cp-err").textContent = m || ""; };
      const visible = () => { const s = el.closest(".subview"); return s && !s.hidden && !document.hidden; };
      const fit = async (file) => {                                       // image -> JPEG ≤ 1600 px, ≤ ~1,4 Mo (limite serveur : 2 Mo en base64)
        const bmp = await createImageBitmap(file);
        let side = 1600, q = 0.82, out;
        for (let i = 0; i < 6; i++) {
          const k = Math.min(1, side / Math.max(bmp.width, bmp.height)), c = document.createElement("canvas");
          c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
          const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp, 0, 0, c.width, c.height);
          out = c.toDataURL("image/jpeg", q).split(",")[1];
          if (out.length <= 1_900_000) return out;
          side = Math.round(side * 0.75); q = Math.max(0.55, q - 0.07);
        }
        throw new Error("Image trop lourde.");
      };
      const send = async (kind, content, mime) => {
        err("");
        try { await C.clip.send(kind, content, mime); A.toast("Envoyé au PC.", "ok"); await poll(true); } catch (x) { err(x.message); }
      };
      $("#cp-send").onclick = () => { const t = $("#cp-text").value; if (!t.trim()) return err("Rien à envoyer."); send("text", t).then(() => { $("#cp-text").value = ""; }); };
      $("#cp-paste").onclick = async () => { try { $("#cp-text").value = await navigator.clipboard.readText(); } catch (e) { A.toast("Presse-papiers inaccessible : colle avec un appui long.", "warn"); } };
      $("#cp-img").onclick = async () => { const f = (await A.pick({ accept: "image/*" }))[0]; if (!f) return; try { await send("image", await fit(f), "image/jpeg"); } catch (x) { err(x.message); } };
      $("#cp-auto").onchange = (e) => E.settings.set("clipAuto", e.target.checked);

      const when = (t) => new Date(t * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
      let items = [];
      const render = () => {
        $("#cp-n").textContent = items.length ? items.length + " élément" + (items.length > 1 ? "s" : "") : "";
        $("#cp-list").innerHTML = items.length ? items.map((it) => `<div class="cp-it" data-id="${it.id}" style="padding:8px 0;border-top:1px solid var(--line)">
          <div class="row" style="justify-content:space-between"><span class="chip2">${it.device === "pc" ? "💻 PC" : it.device === "phone" ? "📱 Téléphone" : esc(it.device || "?")}</span><span class="muted">${when(it.created_at)}</span></div>
          ${it.kind === "image" ? `<img alt="Image du presse-papiers" style="max-width:100%;max-height:200px;border-radius:10px;margin-top:6px" src="data:${esc(it.mime)};base64,${esc(it.content)}">` : `<div style="margin-top:6px;white-space:pre-wrap;word-break:break-word;max-height:7.5em;overflow:hidden">${esc(it.content.slice(0, 600))}</div>`}
          <div class="row" style="margin-top:6px"><button class="btn" data-cp="${it.id}">${it.kind === "image" ? "ENREGISTRER" : "COPIER"}</button><button class="btn" data-rm="${it.id}">SUPPRIMER</button></div></div>`).join("") : '<div class="muted">Rien pour l\'instant.</div>';
      };
      $("#cp-list").addEventListener("click", async (e) => {
        const cp = e.target.closest("[data-cp]"), rm = e.target.closest("[data-rm]");
        if (cp) { const it = items.find((x) => x.id === +cp.dataset.cp); if (!it) return; if (it.kind === "text") A.copy(it.content); else { const b = Uint8Array.from(atob(it.content), (c) => c.charCodeAt(0)); A.save("presse-papiers-" + it.id + ".jpg", it.mime, b, "images"); } }
        if (rm) { try { await C.clip.remove(+rm.dataset.rm); items = items.filter((x) => x.id !== +rm.dataset.rm); render(); } catch (x) { err(x.message); } }
      });
      async function poll(all) {
        if (!C.loggedIn()) { $("#cp-login").hidden = false; $("#cp-main").hidden = true; return; }
        $("#cp-login").hidden = true; $("#cp-main").hidden = false;
        try {
          const got = await C.clip.list(all ? 0 : since);
          if (all) items = []; 
          got.slice().reverse().forEach((it) => { if (!items.find((x) => x.id === it.id)) { items.unshift(it); if (!seen.has(it.id) && seen.size && it.device !== "phone" && E.settings.get("clipAuto", false) && it.kind === "text") A.copy(it.content); } seen.add(it.id); since = Math.max(since, it.id); });
          items.sort((a, b) => b.id - a.id); render();
        } catch (x) { err(x.message); }
      }
      const tick = () => { if (visible()) poll(false); else if (!el.closest(".subview") || el.closest(".subview").hidden) { clearInterval(timer); timer = 0; } };
      el._start = () => { clearInterval(timer); poll(true); timer = setInterval(tick, 4000); };
      el._start();
    },
    onShow() { const b = document.querySelector("#tool-clip .suite-body"); if (b && b._start) b._start(); },
  });
})();
