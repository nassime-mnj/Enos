"use strict";
// MOTEURS D'ÉCHECS NATIFS (téléphone uniquement) : exécutables ARM64 livrés dans l'APK (android/tools/build_engines.sh) et pilotés par
// le pont Java window.EnosEngine (EngineBridge.java) : Stockfish 19 COMPLET (réseau entier, tous les cœurs), Obsidian, PlentyChess, Caissa, Viridithas.
// E.nativeEngine.worker(id) imite un Worker (postMessage / addEventListener("message")) : chess_local.js s'en sert comme du Worker WASM.
// Sans le pont (navigateur, PC, tests) : has() répond false et tout retombe sur Stockfish 19 WASM.
(() => {
  const E = (window.ENOS = window.ENOS || {});
  const B = () => window.EnosEngine || null;
  const subs = {};                                                                  // id -> Set(fonction(ligne))
  let info = null;
  const N = (E.nativeEngine = {
    NAMES: { sf19: "Stockfish 19", obsidian: "Obsidian", plenty: "PlentyChess", caissa: "Caissa", viridithas: "Viridithas" },
    info() { if (info) return info; try { info = B() ? JSON.parse(B().list()) : { engines: [], cores: 1 }; } catch (e) { info = { engines: [], cores: 1 }; } return info; },
    has(id) { return !!B() && N.info().engines.includes(id); },
    list() { return N.info().engines.slice(); },
    threads() { return Math.max(1, Math.min(6, (N.info().cores || 2) - 2)); },      // S23+ : 8 cœurs -> 6 fils de recherche, l'interface reste fluide
    _recv(id, lines) { const s = subs[id]; if (!s) return; for (const l of lines) for (const f of [...s]) { try { f(String(l)); } catch (e) { /* abonné fautif */ } } },
    on(id, f) { (subs[id] = subs[id] || new Set()).add(f); return () => subs[id] && subs[id].delete(f); },
    /** objet façon Worker pour le moteur `id` (null si absent) */
    worker(id) {
      if (!N.has(id) || !B().start(id)) return null;
      const ls = new Set(), w = {
        onerror: null, id,
        postMessage(cmd) { if (!B().send(id, String(cmd))) { const err = { message: "moteur " + id + " arrêté" }; if (w.onerror) w.onerror(err); } },
        addEventListener(type, f) { if (type === "message") ls.add(f); },
        removeEventListener(type, f) { ls.delete(f); },
        terminate() { off(); try { B().stop(id); } catch (e) { /* déjà arrêté */ } },
      };
      const off = N.on(id, (line) => { if (line === "info string ENOS engine-exit") { if (w.onerror) w.onerror({ message: "moteur " + id + " arrêté" }); return; } for (const f of [...ls]) f({ data: line }); });
      return w;
    },
    /** coup du moteur `id` (UCI) : un moteur = une file de recherches ; prêt en ~1 s au premier appel */
    _q: {}, _w: {},
    async best(id, fen, o) {
      o = o || {};
      const job = (N._q[id] || Promise.resolve()).then(async () => {
        let w = N._w[id];
        if (!w) {
          w = N.worker(id); if (!w) throw new Error(id + " indisponible");
          await new Promise((res, rej) => { const to = setTimeout(() => rej(new Error(id + " : pas de réponse")), 15000); const f = (e) => { if (String(e.data).trim() === "readyok") { clearTimeout(to); w.removeEventListener("message", f); res(); } }; w.addEventListener("message", f); w.postMessage("uci"); w.postMessage("setoption name Threads value " + N.threads()); w.postMessage("setoption name Hash value 128"); w.postMessage("isready"); });
          N._w[id] = w; w.onerror = () => { delete N._w[id]; };
        }
        return new Promise((res) => {
          let last = null; const f = (e) => { const l = String(e.data); if (l.startsWith("info") && / pv /.test(l)) last = l; if (l.startsWith("bestmove")) { w.removeEventListener("message", f); const u = l.split(" ")[1]; res({ uci: u && u !== "(none)" ? u : "", info: last }); } };
          w.addEventListener("message", f); w.postMessage("position fen " + fen); w.postMessage("go movetime " + Math.max(50, Math.round(o.movetime || 800)));
        });
      });
      N._q[id] = job.catch(() => {});
      return job;
    },
  });
})();
