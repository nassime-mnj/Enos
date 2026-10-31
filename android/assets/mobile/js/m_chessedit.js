"use strict";
// CHESS EDIT STUDIO (module MODULES > Échecs, ou 🎬 en fin de partie / dans l'historique des Défis) : une partie enregistrée + une musique -> un « chess edit » TikTok / Shorts.
//   Mode IA     : l'analyseur audio (chess_edit_audio.js) trouve intro, montée, creux, DROP, impacts ; chess_edit_map.js cale les coups clés dessus.
//   Mode MANUEL : forme d'onde éditable, marqueurs rouge = DROP, violet = BOSS, cyan = BRILLANT !!, jaune = BEAT.
//   Rendu mobile : chess_edit_fx.js (temps réel). Rendu PC : manifeste JSON -> godot_chess_edit (ChessEditDirector.gd), envoyé au PC ou exporté en fichier.
(() => {
  const E = window.ENOS, M = () => E.editMap, X = () => E.editAudio;
  const MK = { drop: ["DROP", "#ff2a2a"], boss: ["BOSS", "#a24bff"], brill: ["BRILLANT !!", "#00f2fe"], beat: ["BEAT", "#ffd21f"] };
  const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}.${String(Math.floor((s % 1) * 10))}`;
  let API = null;

  E.suite.register({
    id: "chessedit", group: "chess", title: "Chess Edit Studio", sub: "Partie + musique → edit TikTok 3D",
    icon: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 4v16M17 4v16M2 9h5M2 15h5M17 9h5M17 15h5"/>',
    build(el, A) {
      const $ = (s) => el.querySelector(s), esc = E.esc;
      const S = { rec: null, plies: null, file: null, url: "", audio: null, mode: "ia", marks: [], type: "drop", sel: -1, dropPly: 0, tl: null, stage: null };
      const hist = () => E.settings.get("defi.hist", []).filter((x) => x.mv && x.mv.length >= 2);
      const mkey = () => "chessedit.marks." + (S.rec ? S.rec.t : 0);

      el.innerHTML = `
        <div class="card"><h3>1 · La partie</h3><select id="ce-game" class="sel"></select><p class="ce-stat" id="ce-gs" style="margin-top:8px"></p></div>
        <div class="card"><h3>2 · La musique</h3>
          <div class="row" style="margin-top:0"><button class="btn" id="ce-pick">CHOISIR UN .MP3 / .WAV</button></div>
          <p class="ce-stat" id="ce-as" style="margin-top:8px">Aucune musique.</p>
          <div class="seg" id="ce-mode" style="margin-top:10px"><button data-m="ia" class="on">MODE IA</button><button data-m="manual">MODE MANUEL</button><i class="seg-ind"></i></div></div>
        <div class="card"><h3>3 · Timeline</h3>
          <div class="ce-wave"><canvas id="ce-cv"></canvas></div>
          <div class="ce-legend" id="ce-leg">${Object.entries(MK).map(([k, [n, c]]) => `<button data-t="${k}" style="--c:${c}"><i></i>${n}</button>`).join("")}</div>
          <div class="row" style="margin-top:4px"><button class="btn" id="ce-del">SUPPRIMER</button><button class="btn" id="ce-ai2m">IA → MANUEL</button></div>
          <label class="fld" style="margin-top:10px">Coup du DROP (par défaut : le plus dramatique)</label><select id="ce-drop" class="sel"></select>
          <p class="ce-stat" id="ce-sum" style="margin-top:8px"></p></div>
        <div class="card"><h3>4 · Rendu</h3>
          <div class="row" style="margin-top:0"><button class="btn pri" id="ce-play">▶ APERÇU 3D (TEMPS RÉEL)</button></div>
          <div class="row"><button class="btn" id="ce-json">EXPORTER LE MANIFESTE GODOT</button><button class="btn" id="ce-pc">RENDRE SUR LE PC</button></div>
          <p class="ce-stat" id="ce-pcs" style="margin-top:8px">Rendu PC : scène Godot (Glow HDR, particules GPU, aberration chromatique), enregistrable en .mp4 60 FPS.</p></div>`;

      // ------------------------------------------------------------ choix de la partie
      function fillGames() {
        const h = hist(), sel = $("#ce-game");
        sel.innerHTML = h.length ? h.map((x, i) => `<option value="${i}">${esc(x.title)} · ${x.plies} coups · ${new Date(x.t).toLocaleDateString("fr-FR")}</option>`).reverse().join("") : '<option value="">Aucune partie enregistrée (joue un Défi / un Combat)</option>';
        if (h.length) setRec(S.rec && h.find((x) => x.t === S.rec.t) || h[h.length - 1]);
      }
      function setRec(rec) {
        S.rec = rec; S.plies = M().gamePlies(rec);
        const i = hist().findIndex((x) => x.t === rec.t); if (i >= 0) $("#ce-game").value = String(i);
        S.marks = E.settings.get(mkey(), []); S.dropPly = 0; S.sel = -1;
        const top = S.plies.slice().sort((a, b) => b.drama - a.drama).slice(0, 8);
        $("#ce-drop").innerHTML = '<option value="0">Auto (le plus dramatique)</option>' + top.map((p) => `<option value="${p.n}">coup ${p.n} · ${esc(p.san)} · ${p.tags.join(", ") || "—"} (${p.drama})</option>`).join("");
        const t = S.plies.reduce((a, p) => { a.b += p.key === "brilliant"; a.g += p.key === "blunder" || p.loss > 300; a.c += !!p.captured; return a; }, { b: 0, g: 0, c: 0 });
        $("#ce-gs").innerHTML = `<b>${esc(rec.pw || "Blancs")}</b> – <b>${esc(rec.pb || "Noirs")}</b> · ${esc(rec.result || "")}<br>${S.plies.length} coups · ${t.c} captures · ✦ ${t.b} brillant${t.b > 1 ? "s" : ""} · ${t.g} gaffe${t.g > 1 ? "s" : ""} · ${(rec.ch || []).length} répliques de bots`;
        refresh();
      }
      $("#ce-game").onchange = (e) => { if (e.target.value !== "") setRec(hist()[+e.target.value]); };

      // ------------------------------------------------------------ musique
      $("#ce-pick").onclick = async () => {
        const f = (await A.pick({ accept: "audio/*,.mp3,.wav,.m4a,.ogg" }))[0];
        if (!f) return;
        if (S.url) URL.revokeObjectURL(S.url);
        S.file = f; S.url = URL.createObjectURL(f); S.audio = null;
        $("#ce-as").textContent = "Analyse de « " + f.name + " » (graves < 150 Hz, voix 300-3000 Hz, flux spectral)… 0 %";
        try {
          S.audio = await X().analyseFile(f, (p) => { $("#ce-as").textContent = `Analyse de « ${f.name} »… ${Math.round(p * 100)} %`; });
        } catch (e) { S.file = null; return A.toast(e.message, "err"); }
        refresh();
      };
      function audioStat() {
        const a = S.audio;
        if (!a) return;
        $("#ce-as").innerHTML = `<b>${esc(S.file.name)}</b> · ${fmtT(a.duration)}${a.truncated ? " (analysé : 6 premières minutes)" : ""}<br>Montée <b>${fmtT(a.buildUpStart)}</b> · creux <b>${fmtT(a.preDropSilence)}</b> · DROP <b style="color:#ff2a2a">${fmtT(a.mainDropTimestamp)}</b> (confiance ${Math.round(a.confidence * 100)} %)<br>${a.introBeats.length} temps d'intro · ${a.hardBeats.length} impacts de basse · ${a.vocalPeaks.length} pics de voix`;
      }
      $("#ce-mode").querySelectorAll("button").forEach((b) => (b.onclick = () => { S.mode = b.dataset.m; $("#ce-mode").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); refresh(); }));
      $("#ce-drop").onchange = (e) => { S.dropPly = +e.target.value; refresh(); };

      // ------------------------------------------------------------ timeline
      function slots() {
        const sl = S.mode === "ia" ? M().autoSlots(S.audio, S.plies) : M().manualSlots(S.marks, S.plies);
        if (S.dropPly) { const d = sl.find((s) => s.kind === "drop"); if (d) { sl.forEach((s) => { if (s !== d && s.ply === S.dropPly - 1) s.ply = null; }); d.ply = S.dropPly - 1; } }
        return sl;
      }
      function rebuild() {
        S.tl = null;
        if (!S.rec || !S.audio) return;
        if (S.mode === "manual" && !S.marks.some((m) => m.type === "drop")) return;
        S.tl = M().build(S.plies, slots(), S.audio);
      }
      function summary() {
        const el2 = $("#ce-sum");
        if (!S.audio) return (el2.textContent = "Choisis une musique pour voir la timeline.");
        if (!S.tl) return (el2.textContent = "Mode manuel : pose un marqueur rouge DROP sur la forme d'onde (touche pour ajouter, glisse pour déplacer).");
        const k = S.tl.key.length, ff = S.tl.events.length - k, ex = S.tl.events.filter((e) => e.cut).length;
        el2.innerHTML = `<b>${k}</b> coups clés calés sur la musique, <b>${ff}</b> coups passifs en accéléré ×8, ${S.plies.length - k - ff} sautés · ${ex} cutscene${ex > 1 ? "s" : ""}.<br>Drop : ${S.tl.key.filter((e) => e.kind === "drop").map((e) => `coup ${e.n} (${esc(e.san)}) à ${fmtT(e.t)}`).join("") || "—"}`;
      }
      function refresh() { audioStat(); rebuild(); summary(); drawWave(); $("#ce-ai2m").hidden = S.mode !== "ia"; $("#ce-del").hidden = S.mode !== "manual"; $("#ce-leg").hidden = S.mode !== "manual"; el.querySelectorAll("#ce-leg button").forEach((b) => b.classList.toggle("on", b.dataset.t === S.type)); }

      const cv = $("#ce-cv");
      function drawWave(head) {
        const dpr = Math.min(devicePixelRatio || 1, 2), W = (cv.width = Math.max(300, cv.clientWidth * dpr)), H = (cv.height = 120 * dpr), c = cv.getContext("2d"), a = S.audio;
        c.fillStyle = "#0a0a0c"; c.fillRect(0, 0, W, H);
        if (!a) { c.fillStyle = "#555"; c.font = `${12 * dpr}px sans-serif`; c.textAlign = "center"; c.fillText("forme d'onde", W / 2, H / 2); return; }
        const X2 = (t) => (t / a.duration) * W;
        c.fillStyle = "#3a8ea0";
        for (let x = 0; x < W; x += 2) { const v = a.wave[Math.min(a.wave.length - 1, Math.floor((x / W) * a.wave.length))]; c.fillRect(x, H / 2 - v * H * 0.42, 1.4 * dpr, Math.max(1, v * H * 0.84)); }
        const line = (t, col, w, dash) => { c.strokeStyle = col; c.lineWidth = w * dpr; c.setLineDash(dash ? [4 * dpr, 4 * dpr] : []); c.beginPath(); c.moveTo(X2(t), 0); c.lineTo(X2(t), H); c.stroke(); };
        if (S.mode === "ia") {
          a.introBeats.forEach((t) => line(t, "#ffffff55", 1)); a.hardBeats.forEach((t) => line(t, "#ffd21f99", 1)); a.vocalPeaks.forEach((t) => { c.fillStyle = "#fff"; c.fillRect(X2(t) - 2 * dpr, 2, 4 * dpr, 4 * dpr); });
          line(a.buildUpStart, "#a24bff", 2); line(a.preDropSilence, "#ffffff", 1, true); line(a.mainDropTimestamp, "#ff2a2a", 3);
        } else S.marks.forEach((m, i) => { line(m.t, MK[m.type][1], i === S.sel ? 4 : 2.5); c.fillStyle = MK[m.type][1]; c.beginPath(); c.arc(X2(m.t), 8 * dpr, 6 * dpr, 0, 6.283); c.fill(); });
        if (head != null) line(head, "#fff", 2);
      }
      const tAt = (e) => { const r = cv.getBoundingClientRect(); return Math.max(0, Math.min(S.audio.duration, ((e.clientX - r.left) / r.width) * S.audio.duration)); };
      let drag = -1;
      cv.addEventListener("pointerdown", (e) => {
        if (!S.audio || S.mode !== "manual") return;
        const t = tAt(e), tol = (14 / cv.getBoundingClientRect().width) * S.audio.duration;
        let near = -1; S.marks.forEach((m, i) => { if (Math.abs(m.t - t) < tol && (near < 0 || Math.abs(m.t - t) < Math.abs(S.marks[near].t - t))) near = i; });
        if (near >= 0) { S.sel = near; drag = near; cv.setPointerCapture(e.pointerId); }
        else {
          if (S.type === "drop") S.marks = S.marks.filter((m) => m.type !== "drop");                // un seul drop
          S.marks.push({ t: +t.toFixed(3), type: S.type }); S.sel = S.marks.length - 1; drag = S.sel; cv.setPointerCapture(e.pointerId); E.vibrate && E.vibrate(8);
        }
        refresh();
      });
      cv.addEventListener("pointermove", (e) => { if (drag >= 0 && S.marks[drag]) { S.marks[drag].t = +tAt(e).toFixed(3); drawWave(); } });
      const up = () => { if (drag >= 0) { drag = -1; E.settings.set(mkey(), S.marks); refresh(); } };
      cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
      el.querySelectorAll("#ce-leg button").forEach((b) => (b.onclick = () => { S.type = b.dataset.t; if (S.sel >= 0 && S.marks[S.sel]) { S.marks[S.sel].type = S.type; E.settings.set(mkey(), S.marks); } refresh(); }));
      $("#ce-del").onclick = () => { if (S.sel >= 0) { S.marks.splice(S.sel, 1); S.sel = -1; E.settings.set(mkey(), S.marks); refresh(); } };
      $("#ce-ai2m").onclick = () => {
        const a = S.audio; if (!a) return A.toast("Choisis d'abord une musique.", "warn");
        const hasBoss = S.plies.some((p) => p.boss);
        S.marks = [...(hasBoss ? [{ t: a.buildUpStart, type: "boss" }] : []), { t: a.mainDropTimestamp, type: "drop" }, ...a.hardBeats.slice(0, 40).map((t) => ({ t, type: "beat" }))];
        S.mode = "manual"; $("#ce-mode").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.dataset.m === "manual")); E.settings.set(mkey(), S.marks); refresh();
      };

      // ------------------------------------------------------------ aperçu temps réel
      function preview() {
        if (!S.tl) return A.toast(S.audio ? "Mode manuel : pose d'abord un marqueur DROP." : "Choisis une musique.", "warn");
        const app = document.getElementById("app") || document.body, host = document.createElement("div"), au = new Audio(S.url), evs = S.tl.events, dur = S.audio.duration;
        app.appendChild(host);
        let idx = 0, raf = 0, alive = true, ffT = 0;
        const stage = new E.editFx.Stage(host, { flip: S.rec.me === "b", title: (S.rec.pw || "") + " – " + (S.rec.pb || ""), onClose: stop, onToggle: () => { if (au.paused) au.play(); else au.pause(); stage.setPlaying(!au.paused); } });
        function fire(e) {
          const power = e.kind === "drop" ? 1 : Math.max(0.3, Math.min(1, (e.drama || 0) / 80));
          if (e.kind === "ff") {
            stage.move(e, true); stage.ff(true); clearTimeout(ffT); ffT = setTimeout(() => stage.ff(false), 400);
            stage.camTo({ rx: 26 + Math.random() * 8, rz: (Math.random() - 0.5) * 6, s: 1.0 }, 260);
            return;
          }
          stage.ff(false); stage.move(e); stage.hit(e, power);
          if (e.cut) setTimeout(() => alive && stage.cutscene(e.cut, e.tone), Math.max(0, ((e.cutT != null ? e.cutT : e.t) - e.t) * 1000) + 200);
          (e.lines || []).slice(0, 2).forEach((l, i) => setTimeout(() => alive && stage.say(l.bot, l.text), 350 + i * 2600 + (e.cut ? 900 : 0)));
        }
        function tick() {
          if (!alive) return;
          const t = au.currentTime;
          while (idx < evs.length && evs[idx].t <= t) fire(evs[idx++]);
          stage.setProgress(t / dur);
          if (au.ended) return stop();
          raf = requestAnimationFrame(tick);
        }
        function stop() { if (!alive) return; alive = false; cancelAnimationFrame(raf); au.pause(); stage.destroy(); host.remove(); S.stage = null; }
        S.stage = { stop };
        stage.setPlaying(true);
        au.play().then(() => { raf = requestAnimationFrame(tick); }).catch(() => { A.toast("Lecture audio refusée.", "err"); stop(); });
      }
      $("#ce-play").onclick = preview;

      // ------------------------------------------------------------ pont PC (Godot)
      function manifest() { return M().manifest(S.rec, S.tl, S.audio, { audioName: S.file ? S.file.name : "", audioPath: S.file ? S.file.name : "" }); }
      $("#ce-json").onclick = async () => {
        if (!S.tl) return A.toast("Rien à exporter : choisis une musique (et un DROP en manuel).", "warn");
        await A.save("edit_timeline_manifest.json", "application/json", new TextEncoder().encode(JSON.stringify(manifest(), null, 1)), "downloads");
        A.toast("Copie aussi la musique « " + S.file.name + " » dans le même dossier que le manifeste.", "ok");
      };
      $("#ce-pc").onclick = async () => {
        if (!S.tl) return A.toast("Rien à rendre : choisis une musique (et un DROP en manuel).", "warn");
        if (!E.link || E.link.state !== "online") return A.toast("Le PC doit être allumé et appairé (même Wi-Fi ou Tailscale).", "warn");
        const st = $("#ce-pcs");
        st.textContent = "Envoi au PC…";
        try {
          const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = rej; r.readAsDataURL(S.file); });
          const r = await E.link.api("/api/chessedit/lancer", { method: "POST", body: { manifest: manifest(), audio_b64: b64, audio_name: S.file.name, render: false } });
          const j = r.json ? r.json() : r;
          if (r.status && r.status >= 400) throw new Error((j && j.detail) || "refusé (" + r.status + ")");
          st.textContent = "Scène Godot lancée sur le PC (" + ((j && j.dossier) || "") + ").";
        } catch (e) { st.textContent = "Échec : " + e.message + " (ce module demande les droits complets du téléphone, ou ENOS.exe à jour sur le PC)."; }
      };

      API = { setRec, S };
      fillGames();
      drawWave();
      window.addEventListener("resize", () => drawWave());
    },
    onShow() { /* la liste des parties est rafraîchie par open() */ },
  });

  /** Ouvre le studio sur une partie de l'historique des Défis (bouton 🎬 de la fin de partie / de l'historique). */
  E.chessEdit = {
    open(rec) {
      if (!rec || !rec.mv || rec.mv.length < 2) return E.ui.toast("Partie trop courte pour un edit.", "warn");
      E.suite.open("chessedit");
      if (API) API.setRec(rec);
    },
  };
})();
