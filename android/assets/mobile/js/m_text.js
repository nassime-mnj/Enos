"use strict";
// FORMATEUR JSON / XML (même moteur que les Outils rapides du PC : quicklib.js). Tout se passe sur le téléphone.
(() => {
  const E = window.ENOS;
  const QL = window.QL;

  // ---- XML : analyse (DOMParser) puis mise en forme / minification sans bibliothèque
  function parseXml(text) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const err = doc.getElementsByTagName("parsererror")[0];
    if (err) {
      const msg = (err.textContent || "XML invalide").replace(/\s+/g, " ").trim();
      const m = /line (?:number )?(\d+)(?:,? (?:at )?column (?:number )?(\d+))?/i.exec(msg);
      return { ok: false, error: { message: msg.replace(/^.*?error[^:]*:\s*/i, "").slice(0, 160), line: m ? +m[1] : null, col: m && m[2] ? +m[2] : null } };
    }
    return { ok: true, doc };
  }
  const escX = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const escA = (s) => escX(s).replace(/"/g, "&quot;");
  function xmlOut(node, ind, depth, pretty) {
    const pad = pretty ? ind.repeat(depth) : "", nl = pretty ? "\n" : "";
    switch (node.nodeType) {
      case 1: {
        const attrs = Array.from(node.attributes).map((a) => ` ${a.name}="${escA(a.value)}"`).join("");
        const kids = Array.from(node.childNodes).filter((c) => !(c.nodeType === 3 && !c.nodeValue.trim()));
        if (!kids.length) return `${pad}<${node.nodeName}${attrs}/>${nl}`;
        if (kids.length === 1 && kids[0].nodeType === 3) return `${pad}<${node.nodeName}${attrs}>${escX(kids[0].nodeValue.trim())}</${node.nodeName}>${nl}`;
        return `${pad}<${node.nodeName}${attrs}>${nl}${kids.map((k) => xmlOut(k, ind, depth + 1, pretty)).join("")}${pad}</${node.nodeName}>${nl}`;
      }
      case 3: return node.nodeValue.trim() ? `${pad}${escX(node.nodeValue.trim())}${nl}` : "";
      case 4: return `${pad}<![CDATA[${node.nodeValue}]]>${nl}`;
      case 8: return `${pad}<!--${node.nodeValue}-->${nl}`;
      default: return "";
    }
  }
  function xmlFormat(text, ind, pretty) {
    const r = parseXml(text);
    if (!r.ok) return r;
    const decl = /^\s*<\?xml[^>]*\?>/.exec(text);
    const body = Array.from(r.doc.childNodes).map((n) => xmlOut(n, ind, 0, pretty)).join("");
    return { ok: true, text: (decl ? decl[0].trim() + (pretty ? "\n" : "") : "") + body.trimEnd() };
  }

  const kindOf = (t) => (/^\s*</.test(t) ? "xml" : "json");

  E.suite.register({
    id: "text", group: "pro", title: "JSON / XML", sub: "Formater, valider, réparer",
    icon: '<path d="M8 3H6a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h2M16 3h2a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-2"/>',
    build(el, A) {
      el.innerHTML = `<div class="card"><h3>Formateur JSON / XML<span class="sp" id="tx-kind">auto</span></h3>
        <textarea id="tx-in" placeholder="Colle du JSON ou du XML ici…" spellcheck="false" aria-label="Texte à formater"></textarea>
        <div class="row" style="margin-top:8px"><label class="fld" style="flex:1">Indentation <select id="tx-ind"><option value="2">2 espaces</option><option value="4">4 espaces</option><option value="tab">Tabulation</option></select></label></div>
        <div class="row" style="margin-top:8px"><button class="btn pri" id="tx-fmt">FORMATER</button><button class="btn" id="tx-min">MINIFIER</button><button class="btn" id="tx-sort">TRIER LES CLÉS</button></div>
        <div class="row" style="margin-top:8px"><button class="btn" id="tx-paste">COLLER</button><button class="btn" id="tx-copy">COPIER</button><button class="btn" id="tx-clear">VIDER</button></div>
        <p class="err" id="tx-err" hidden role="alert"></p><p class="ok" id="tx-ok" hidden></p><button class="btn" id="tx-fix" hidden>RÉPARER ET FORMATER</button>
        <pre class="out" id="tx-out" hidden></pre></div>`;
      const $ = (s) => el.querySelector(s);
      let last = "";
      const ind = () => ({ 2: "  ", 4: "    ", tab: "\t" })[$("#tx-ind").value];
      const indNum = () => ($("#tx-ind").value === "tab" ? "\t" : +$("#tx-ind").value);
      const msg = (err, ok) => { $("#tx-err").hidden = !err; $("#tx-err").textContent = err || ""; $("#tx-ok").hidden = !ok; $("#tx-ok").textContent = ok || ""; $("#tx-fix").hidden = true; };
      const show = (text, kind) => { last = text; const o = $("#tx-out"); o.hidden = false; if (kind === "json") o.innerHTML = QL.highlightJson(text); else o.textContent = text; };
      const where = (e) => (e.line ? ` (ligne ${e.line}${e.col ? ", col. " + e.col : ""})` : "");

      function run(mode, repair) {
        const t = $("#tx-in").value;
        if (!t.trim()) { msg("Colle d'abord du texte."); return; }
        const kind = kindOf(t); $("#tx-kind").textContent = kind.toUpperCase();
        if (kind === "xml") {
          const r = xmlFormat(t, ind(), mode !== "min");
          if (!r.ok) { $("#tx-out").hidden = true; return msg("XML invalide : " + r.error.message + where(r.error)); }
          show(r.text, "xml"); return msg("", mode === "min" ? "XML minifié." : "XML valide et mis en forme.");
        }
        const p = QL.parseJson(t, !!repair);
        if (!p.ok) {
          $("#tx-out").hidden = true; msg("JSON invalide : " + p.error.message + where(p.error));
          if (p.error.repairable) $("#tx-fix").hidden = false;
          return;
        }
        let v = p.value; if (mode === "sort") v = QL.sortKeys(v);
        show(mode === "min" ? JSON.stringify(v) : JSON.stringify(v, null, indNum()), "json");
        msg("", p.repaired ? "JSON réparé (commentaires, virgules finales ou guillemets corrigés)." : mode === "min" ? "JSON minifié." : "JSON valide.");
      }
      $("#tx-fmt").onclick = () => run("fmt"); $("#tx-min").onclick = () => run("min"); $("#tx-sort").onclick = () => run("sort");
      $("#tx-fix").onclick = () => run("fmt", true);
      $("#tx-copy").onclick = () => (last ? A.copy(last) : A.toast("Rien à copier.", "warn"));
      $("#tx-clear").onclick = () => { $("#tx-in").value = ""; $("#tx-out").hidden = true; last = ""; msg(""); $("#tx-kind").textContent = "auto"; };
      $("#tx-paste").onclick = async () => { try { $("#tx-in").value = await navigator.clipboard.readText(); } catch (e) { A.toast("Le presse-papiers n'est pas accessible : colle avec un appui long.", "warn"); } };
    },
  });
})();
