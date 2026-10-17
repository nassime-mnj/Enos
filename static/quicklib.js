"use strict";
// Fonctions pures des OUTILS RAPIDES (testées sous Node : tests/quicklib.test.js) : JSON tolérant / coloration, partage de dépenses.
(function (root) {
  // ------------------------------------------------------------------ JSON : analyse stricte, puis tolérante (commentaires, virgules finales, quotes simples, clés sans guillemets, True/False/None)
  function lineCol(text, pos) { const before = text.slice(0, pos); const lines = before.split("\n"); return { line: lines.length, col: lines[lines.length - 1].length + 1 }; }

  function strictError(text, e) {
    let pos = -1, m;
    if ((m = /position (\d+)/.exec(e.message))) pos = +m[1];
    let lc = pos >= 0 ? lineCol(text, pos) : null;
    if (!lc && (m = /line (\d+) column (\d+)/.exec(e.message))) lc = { line: +m[1], col: +m[2] };
    return { message: String(e.message).replace(/\s*\(line \d+ column \d+\)/, ""), line: lc ? lc.line : null, col: lc ? lc.col : null };
  }

  function parseLoose(text) {
    let i = 0;
    const err = (msg) => { const lc = lineCol(text, i); const e = new Error(msg); e.line = lc.line; e.col = lc.col; throw e; };
    const ws = () => {
      for (;;) {
        const c = text[i];
        if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\ufeff") i++;
        else if (c === "/" && text[i + 1] === "/") { while (i < text.length && text[i] !== "\n") i++; }
        else if (c === "/" && text[i + 1] === "*") { const j = text.indexOf("*/", i + 2); if (j < 0) { i = text.length; err("Commentaire /* non fermé"); } i = j + 2; }
        else if (c === "#" ) { while (i < text.length && text[i] !== "\n") i++; }
        else return;
      }
    };
    const str = () => {
      const q = text[i++]; let out = "";
      for (;;) {
        if (i >= text.length) err("Chaîne de caractères non fermée");
        const c = text[i++];
        if (c === q) return out;
        if (c === "\\") {
          const n = text[i++];
          const map = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", "/": "/", "\\": "\\", "'": "'", '"': '"' };
          if (n === "u") { const h = text.slice(i, i + 4); if (!/^[0-9a-fA-F]{4}$/.test(h)) err("Séquence \\u invalide"); out += String.fromCharCode(parseInt(h, 16)); i += 4; }
          else if (n in map) out += map[n]; else out += n;
        } else if (c === "\n") { i--; err("Retour à la ligne dans une chaîne (utilisez \\n)"); }
        else out += c;
      }
    };
    const value = () => {
      ws();
      const c = text[i];
      if (c === "{") return obj();
      if (c === "[") return arr();
      if (c === '"' || c === "'") return str();
      const m = /^(0[xX][0-9a-fA-F]+|-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|[+-]?Infinity|[+-]?NaN)/.exec(text.slice(i));
      if (m) { i += m[0].length; if (/Infinity|NaN/.test(m[0])) err("Infinity / NaN n'existent pas en JSON"); return m[0].toLowerCase().startsWith("0x") ? parseInt(m[0], 16) : Number(m[0]); }
      const w = /^[A-Za-z_]+/.exec(text.slice(i));
      if (w) { const lit = { true: true, false: false, null: null, True: true, False: false, None: null }; if (w[0] in lit) { i += w[0].length; return lit[w[0]]; } err(`Valeur inattendue « ${w[0]} »`); }
      if (i >= text.length) err("Fin du texte inattendue (JSON incomplet)");
      err(`Caractère inattendu « ${c} »`);
    };
    const key = () => {
      ws();
      const c = text[i];
      if (c === '"' || c === "'") return str();
      const m = /^[A-Za-z_$][\w$-]*/.exec(text.slice(i));
      if (!m) err(c === undefined ? "Fin du texte inattendue (JSON incomplet)" : `Clé attendue, trouvé « ${c} »`);
      i += m[0].length; return m[0];
    };
    const obj = () => {
      i++; const o = {};
      for (;;) {
        ws();
        if (text[i] === "}") { i++; return o; }
        const k = key(); ws();
        if (text[i] !== ":") err("« : » attendu après la clé");
        i++; o[k] = value(); ws();
        if (text[i] === ",") { i++; continue; }
        if (text[i] === "}") { i++; return o; }
        err(text[i] === undefined ? "Accolade « } » manquante" : `« , » ou « } » attendu, trouvé « ${text[i]} »`);
      }
    };
    const arr = () => {
      i++; const a = [];
      for (;;) {
        ws();
        if (text[i] === "]") { i++; return a; }
        a.push(value()); ws();
        if (text[i] === ",") { i++; continue; }
        if (text[i] === "]") { i++; return a; }
        err(text[i] === undefined ? "Crochet « ] » manquant" : `« , » ou « ] » attendu, trouvé « ${text[i]} »`);
      }
    };
    const v = value(); ws();
    if (i < text.length) err(`Texte en trop après la fin du JSON (« ${text[i]} »)`);
    return v;
  }

  // -> {ok, value, repaired, error:{message,line,col,repairable}}
  // JSON.parse ne donne pas toujours la position : l'analyseur tolérant la fournit. S'il accepte le texte, le JSON est « réparable » (commentaires, virgules finales…).
  function parseJson(text, allowRepair) {
    try { return { ok: true, value: JSON.parse(text), repaired: false }; }
    catch (e) {
      const se = strictError(text, e);
      let loose;
      try { loose = { value: parseLoose(text) }; } catch (e2) { loose = { error: { message: e2.message, line: e2.line, col: e2.col } }; }
      if (loose.error) return { ok: false, error: { ...loose.error, repairable: false } };
      if (allowRepair) return { ok: true, value: loose.value, repaired: true, strictError: se };
      return { ok: false, error: { message: "JSON non conforme (commentaire, virgule finale, guillemets simples, clé sans guillemets…) : " + se.message, line: se.line, col: se.col, repairable: true } };
    }
  }
  function sortKeys(v) {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === "object") { const o = {}; Object.keys(v).sort((a, b) => a.localeCompare(b)).forEach((k) => (o[k] = sortKeys(v[k]))); return o; }
    return v;
  }
  const escH = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  function highlightJson(s) {
    return escH(s).replace(/("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, (m, str, colon, bool) => {
      if (str) return colon ? `<span class="k">${str}</span>${colon}` : `<span class="s">${str}</span>`;
      if (bool) return `<span class="b">${m}</span>`;
      if (m === "null") return `<span class="n">${m}</span>`;
      return `<span class="d">${m}</span>`;
    });
  }

  // ------------------------------------------------------------------ dépenses partagées (tout en centimes : aucune erreur d'arrondi)
  function toCents(x) {
    const s = String(x == null ? "" : x).replace(/\s/g, "").replace(",", ".").replace(/[^0-9.\-]/g, "");
    if (!/\d/.test(s)) return NaN;                                    // « abc » -> NaN, pas 0
    const n = Number(s);
    return Number.isFinite(n) ? Math.round(n * 100) : NaN;
  }
  function fmt(c, cur) { const neg = c < 0; c = Math.abs(c); return (neg ? "-" : "") + Math.floor(c / 100).toLocaleString("fr-FR") + "," + String(c % 100).padStart(2, "0") + " " + (cur || "€"); }

  // people: [noms] ; expenses: [{label, amount (centimes), payer, split: [noms]}] -> {balance:{nom:centimes}, paid, owed, total}
  function balances(people, expenses) {
    const balance = {}, paid = {}, owed = {};
    people.forEach((p) => { balance[p] = 0; paid[p] = 0; owed[p] = 0; });
    let total = 0;
    expenses.forEach((e) => {
      const who = people.filter((p) => (e.split || []).includes(p));
      if (!who.length || !(e.amount > 0) || !(e.payer in balance)) return;
      total += e.amount;
      const base = Math.floor(e.amount / who.length); let rest = e.amount - base * who.length;
      balance[e.payer] += e.amount; paid[e.payer] += e.amount;
      who.forEach((p) => { const part = base + (rest-- > 0 ? 1 : 0); balance[p] -= part; owed[p] += part; });
    });
    return { balance, paid, owed, total };
  }

  // Remboursements : d'abord les paires exactes (dette = créance), puis glouton plus grosse dette -> plus grosse créance. Au plus n-1 virements.
  function settle(balance) {
    const deb = [], cre = [], out = [];
    Object.keys(balance).forEach((p) => { if (balance[p] < 0) deb.push({ p, v: -balance[p] }); else if (balance[p] > 0) cre.push({ p, v: balance[p] }); });
    for (const d of deb) {
      const c = cre.find((x) => x.v === d.v && x.v > 0);
      if (c && d.v > 0) { out.push({ from: d.p, to: c.p, amount: d.v }); d.v = 0; c.v = 0; }
    }
    for (;;) {
      const d = deb.filter((x) => x.v > 0).sort((a, b) => b.v - a.v)[0], c = cre.filter((x) => x.v > 0).sort((a, b) => b.v - a.v)[0];
      if (!d || !c) break;
      const a = Math.min(d.v, c.v);
      out.push({ from: d.p, to: c.p, amount: a }); d.v -= a; c.v -= a;
    }
    return out;
  }
  function summary(title, people, expenses, cur) {
    const b = balances(people, expenses), t = settle(b.balance);
    const lines = [`💸 ${title || "Dépenses partagées"} — total ${fmt(b.total, cur)}`];
    if (people.length && b.total) lines.push(`Part moyenne : ${fmt(Math.round(b.total / people.length), cur)} par personne`);
    lines.push("");
    if (!t.length) lines.push("✅ Les comptes sont équilibrés, personne ne doit rien.");
    else t.forEach((x) => lines.push(`➡️ ${x.from} doit ${fmt(x.amount, cur)} à ${x.to}`));
    return lines.join("\n");
  }

  const api = { parseLoose, parseJson, sortKeys, highlightJson, lineCol, toCents, fmt, balances, settle, summary };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.QL = api;
})(typeof window !== "undefined" ? window : globalThis);
