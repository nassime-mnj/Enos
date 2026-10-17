"use strict";
// SUITE D'OUTILS (parité avec le PC) : registre de modules + utilitaires communs. Un module = un fichier qui appelle E.suite.register({...}).
//   { id, title, sub, group: "pro" | "scan" | "sync", icon: "<chemins SVG>", build(el, api) }   — build() est appelé UNE fois, au premier affichage.
// Chaque module reçoit `el` (son conteneur) et `api` (= E.suite.api : fichiers, enregistrement, bibliothèques à la demande, toasts).
// Les bibliothèques lourdes (pdf-lib, pdf.js) sont chargées à la demande : l'application démarre aussi vite qu'avant.
(() => {
  const E = window.ENOS, $ = E.$, N = E.native;
  const S = (E.suite = { modules: [] });

  S.register = (m) => { S.modules.push(m); };

  // ------------------------------------------------------------------ utilitaires
  const A = (S.api = {});
  A.esc = E.esc;
  A.toast = (m, kind) => (E.ui ? E.ui.toast(m, kind) : console.log(m));
  A.h = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  A.bytes = E.bytes;

  // fichier choisi -> Uint8Array
  A.read = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(new Uint8Array(r.result)); r.onerror = () => rej(new Error("lecture impossible")); r.readAsArrayBuffer(file); });
  A.readText = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error("lecture impossible")); r.readAsText(file); });

  // sélecteur de fichiers : A.pick({accept, multiple, capture}) -> File[]
  A.pick = (o) => new Promise((res) => {
    const i = document.createElement("input");
    i.type = "file"; i.accept = (o && o.accept) || "*/*"; i.multiple = !!(o && o.multiple); if (o && o.capture) i.setAttribute("capture", o.capture);
    i.style.display = "none"; document.body.appendChild(i);
    let done = false;
    const end = (v) => { if (done) return; done = true; i.remove(); res(v); };
    i.onchange = () => end(Array.from(i.files || []));
    i.addEventListener("cancel", () => end([]));
    i.click();
  });

  // enregistrer : galerie (images) / Téléchargements dans l'application Android ; téléchargement classique dans un navigateur
  A.save = async (name, mime, bytes, collection) => {
    if (N.available) {
      const ok = await N.files.save(name, mime, bytes, collection || (/^image\//.test(mime) ? "images" : "downloads"));
      A.toast(ok ? "Enregistré : " + name : "Enregistrement refusé", ok ? "ok" : "err");
      return ok;
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  };

  // copier du texte (presse-papiers Android / navigateur)
  A.copy = async (text) => {
    try { await navigator.clipboard.writeText(text); A.toast("Copié.", "ok"); return true; }
    catch (e) {
      const t = document.createElement("textarea"); t.value = text; t.style.cssText = "position:fixed;opacity:0"; document.body.appendChild(t); t.select();
      let ok = false; try { ok = document.execCommand("copy"); } catch (x) { /* refusé */ }
      t.remove(); A.toast(ok ? "Copié." : "Copie impossible.", ok ? "ok" : "err"); return ok;
    }
  };

  // bibliothèques à la demande (scripts classiques : file:// interdit les modules)
  const loaded = {};
  A.lib = (name) => {
    const src = { pdflib: "vendor/pdf-lib.min.js", pdfjs: "vendor/pdf.min.js", pdfworker: "vendor/pdf.worker.min.js", codemirror: "vendor/codemirror.min.js", codelab_quests: "js/codelab_quests.js" }[name];
    if (!src) return Promise.reject(new Error("bibliothèque inconnue : " + name));
    if (!loaded[name]) loaded[name] = new Promise((res, rej) => {
      const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("chargement de " + src + " impossible")); document.head.appendChild(s);
    });
    return loaded[name];
  };
  A.pdflib = async () => { await A.lib("pdflib"); return window.PDFLib; };
  // pdf.js sans Worker (file:// interdit les Workers) : le script du worker, chargé en <script>, fournit le « faux worker » de la bibliothèque
  A.pdfjs = async () => { await A.lib("pdfjs"); await A.lib("pdfworker"); return window.pdfjsLib; };

  // ------------------------------------------------------------------ PDF (pdf.js : lecture / texte / aperçu ; pdf-lib : modification, voir A.pdflib)
  // A.pdfOpen(Uint8Array) -> document pdf.js (copie des octets : pdf.js « consomme » le tampon). Lève une Error lisible si illisible / protégé.
  A.pdfOpen = async (bytes) => {
    const lib = await A.pdfjs();
    try { return await lib.getDocument({ data: bytes.slice(), isEvalSupported: false, disableFontFace: true }).promise; }
    catch (e) { throw new Error(e && e.name === "PasswordException" ? "PDF protégé par mot de passe." : "PDF illisible ou corrompu."); }
  };
  // texte de toutes les pages : "[Page 1]\n…" (comme le PC)
  A.pdfText = async (doc, maxChars) => {
    const out = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      let line = "", y = null; const lines = [];
      tc.items.forEach((it) => { const ny = Math.round(it.transform[5]); if (y !== null && Math.abs(ny - y) > 2) { lines.push(line); line = ""; } y = ny; line += it.str + (it.hasEOL ? "\n" : " "); });
      lines.push(line);
      out.push(`[Page ${i}]\n` + lines.join("\n").replace(/[ \t]+\n/g, "\n").trim());
      if (maxChars && out.join("\n\n").length > maxChars) break;
    }
    return out.join("\n\n");
  };
  // aperçu d'une page -> canvas (scale ~0.3 pour une vignette, ~1.5 pour la lecture / l'OCR)
  A.pdfRender = async (doc, pageNo, scale) => {
    const page = await doc.getPage(pageNo), vp = page.getViewport({ scale: scale || 1 });
    const c = document.createElement("canvas"); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    return c;
  };

  // ------------------------------------------------------------------ IA (Groq via le pont natif : la clé n'est jamais lue par le JavaScript)
  // A.llm({system, user, json, maxTokens}) -> texte ; A.llmVision({system, ask, image: canvas|dataURL, maxTokens}) -> texte
  const groq = async (body) => {
    if (!E.ai.configured()) throw new Error("Clé Groq absente : Réglages → Clés d'API.");
    const r = await N.fetch({ provider: "groq", path: "/openai/v1/chat/completions", method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = r.json();
    if (r.status !== 200) throw new Error((j && j.error && j.error.message) || "Erreur du service IA (" + r.status + ")");
    if (j.usage && E.usage) E.usage.add(j.usage.total_tokens || 0);
    return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
  };
  A.llm = ({ system, user, json, maxTokens }) => groq({ model: E.ai.model(), temperature: 0.1, max_tokens: maxTokens || 2000, ...(json ? { response_format: { type: "json_object" } } : {}),
    messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: user }], ...(/gpt-oss/.test(E.ai.model()) ? { reasoning_effort: "low" } : {}) });
  A.visionModel = () => E.settings.get("visionModel", "meta-llama/llama-4-scout-17b-16e-instruct");
  A.llmVision = ({ system, ask, image, maxTokens, json }) => {
    const url = typeof image === "string" ? image : image.toDataURL("image/jpeg", 0.85);
    return groq({ model: A.visionModel(), temperature: 0.1, max_tokens: maxTokens || 1500, ...(json ? { response_format: { type: "json_object" } } : {}),
      messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: [{ type: "text", text: ask }, { type: "image_url", image_url: { url } }] }] });
  };

  A.dl = (el) => ({ on: (sel, ev, fn) => el.querySelectorAll(sel).forEach((x) => x.addEventListener(ev, fn)) });

  // ------------------------------------------------------------------ interface : sous-vues (les tuiles sont dessinées par modules.js, groupe par groupe)
  S.init = () => {
    const home = $("#tools-home"), host = home && home.parentElement;
    if (!home || !host) return;
    S.modules.forEach((m) => {
      const sub = A.h(`<div id="tool-${m.id}" class="subview" hidden><button class="back" data-back>◂ MODULES</button><div class="suite-body"></div></div>`);
      sub.querySelector("[data-back]").onclick = () => E.tools.show("");
      host.insertBefore(sub, host.querySelector(".foot-pad"));
    });
  };

  S.open = (id) => {
    const m = S.modules.find((x) => x.id === id);
    if (!m) return;
    E.tools.show(id);
    const body = $("#tool-" + id + " .suite-body");
    if (!m._built) {
      m._built = true;
      try { m.build(body, A); } catch (e) { console.error("[suite]", id, e); body.innerHTML = `<div class="card"><p class="muted">Module indisponible : ${E.esc(e.message)}</p></div>`; }
    }
    if (m.onShow) { try { m.onShow(); } catch (e) { console.error(e); } }
  };
})();
