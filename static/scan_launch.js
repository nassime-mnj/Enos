"use strict";
// CAPTURE D'ÉCRAN -> POSITION (PC) : dans « Mise en condition », le bouton 📷 (ou Ctrl+V d'une image) lit un échiquier collé en capture : chaque pièce est reconnue et posée sur le plateau
// libre ; il ne reste qu'à vérifier puis interroger ETO. Même moteur de reconnaissance que le téléphone (static/learn/board_scan.js + réseau data/piece_model.js), tout en local.
(() => {
  const $ = (id) => document.getElementById(id);
  const btn = $("cd-shot");
  if (!btn || !window.enosCD) return;
  const base = "/static/learn/";
  let ready = null, last = null;
  const script = (src) => new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error(src + " introuvable")); document.head.appendChild(s); });
  const ensure = () => ready || (ready = (async () => {
    const E = (window.ENOS = window.ENOS || {});
    if (!E.settings) {                                              // mémoire des formes de pièces : localStorage
      E.settings = { get: (k, d) => { try { const v = localStorage.getItem("enos.s." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem("enos.s." + k, JSON.stringify(v)); } catch (e) { /* plein */ } } };
    }
    await script(base + "board_scan.js"); await script(base + "data/piece_model.js");
  })().catch((e) => { ready = null; throw e; }));

  async function scan(src) {
    const msg = (t, err) => window.enosCD.message(t, err);
    try {
      await ensure();
      const S = window.ENOS.boardScan;
      msg("Lecture de la capture…");
      const canvas = await S.toCanvas(src), rect = S.detect(canvas);
      if (!rect) return msg("Aucun échiquier repéré dans cette capture : recadre-la autour du plateau.", true);
      const rd = S.read(canvas, rect, {});
      last = rd;
      const fen = S.fenOf(rd.map, rd.turn), castling = fen.split(" ")[2].replace("-", "");
      window.enosCD.apply(rd.map, rd.turn, rd.flipped, castling);
      const low = rd.squares.filter((q) => q.pc && q.conf < 0.6).length, n = Object.keys(rd.map).length;
      msg(`Capture lue : ${n} pièces${low ? `, ${low} incertaine${low > 1 ? "s" : ""} (vérifie-les)` : ""}${rd.flipped ? " · Noirs en bas" : ""}. Corrige si besoin, puis « ✓ MÉMORISER MES PIÈCES ».`, false);
      $("cd-mem").hidden = false;
    } catch (e) { msg("Capture illisible : " + e.message, true); }
  }
  btn.onclick = async () => {
    try {
      const items = await navigator.clipboard.read();                // presse-papiers (image copiée) d'abord, sinon sélecteur de fichier
      for (const it of items) { const t = it.types.find((x) => x.startsWith("image/")); if (t) return scan(await it.getType(t)); }
    } catch (e) { /* refusé ou vide : on propose un fichier */ }
    $("cd-shotf").click();
  };
  $("cd-shotf").onchange = (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) scan(f); };
  document.addEventListener("paste", (e) => {                       // Ctrl+V d'une capture, tant qu'un écran d'échecs est ouvert
    if (["cd", "cs", "df"].every((id) => !$(id) || $(id).hidden)) return;
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    const it = [...(e.clipboardData ? e.clipboardData.items : [])].find((x) => x.type.startsWith("image/"));
    if (it) { e.preventDefault(); scan(it.getAsFile()); }
  });
  $("cd-mem").onclick = () => {
    if (!last) return;
    const n = window.ENOS.boardScan.learn(last, window.enosCD.board);
    window.enosCD.message(n ? `${n} forme${n > 1 ? "s" : ""} mémorisée${n > 1 ? "s" : ""} : ton jeu de pièces sera reconnu sans erreur.` : "Formes déjà connues.", false);
  };
})();
