"use strict";
// CHESS EDIT STUDIO — EXPORT MP4 DÉTERMINISTE (60 FPS fixes). Le moteur canvas (chess_edit_render.js) dessine l'image exacte de chaque instant t = frame / 60 ; chaque image est encodée par
// WebCodecs (VideoEncoder H.264 → VP9 → AV1 selon ce que l'appareil sait faire) et muxée en .mp4 avec la piste audio mixée HORS LIGNE (OfflineAudioContext : musique + bruitages + voix, musique baissée sous les voix,
// AudioEncoder AAC → Opus). Aucun temps réel : ni lag ni désynchronisation, quelle que soit la vitesse du téléphone. Sans WebCodecs : MediaRecorder sur canvas.captureStream (temps réel, en secours).
(() => {
  const E = window.ENOS, SR = 48000;
  const X = (E.editExport = {});
  X.supported = () => ({ webcodecs: typeof VideoEncoder === "function" && typeof VideoFrame === "function" && typeof window.Mp4Muxer === "object", recorder: typeof MediaRecorder === "function" });
  const tick = () => new Promise((r) => setTimeout(r, 0));

  /** mixage hors ligne : musique (facultative) + sfx/voix de la timeline -> AudioBuffer stéréo 48 kHz */
  X.mix = async function (tl, musicFile) {
    const dur = tl.duration + 0.4, oc = new OfflineAudioContext(2, Math.ceil(dur * SR), SR), player = new E.editSfx.Player(oc);
    await player.load();
    const mg = oc.createGain(); mg.gain.value = 0.85; mg.connect(oc.destination);
    if (musicFile) { try { const buf = await oc.decodeAudioData(await musicFile.arrayBuffer()); const src = oc.createBufferSource(); src.buffer = buf; src.connect(mg); src.start(0); } catch (e) { /* musique illisible : on exporte sans */ } }
    const duck = [];
    player.onVoice = (when, len) => duck.push([when, len]);
    (tl.sfx || []).slice().sort((a, b) => a.t - b.t).forEach((s) => player.play(s.id, Math.max(0, s.t), s.gain, s.bus, s.wet));
    duck.sort((a, b) => a[0] - b[0]).forEach(([w, l]) => { try { mg.gain.setValueAtTime(0.85, Math.max(0, w - 0.12)); mg.gain.linearRampToValueAtTime(0.2, Math.max(0.001, w - 0.02)); mg.gain.setValueAtTime(0.2, w + l); mg.gain.linearRampToValueAtTime(0.85, w + l + 0.3); } catch (e) { /* ordre invalide : on ignore */ } });
    return oc.startRendering();
  };

  async function pickVideoCodec(W, H, fps, bitrate) {
    const list = [["avc", "avc1.640032"], ["avc", "avc1.4d0032"], ["avc", "avc1.42003e"], ["vp9", "vp09.00.50.08"], ["av1", "av01.0.12M.08"]];
    for (const [name, codec] of list) { try { const r = await VideoEncoder.isConfigSupported({ codec, width: W, height: H, bitrate, framerate: fps }); if (r && r.supported) return { name, codec }; } catch (e) { /* suivant */ } }
    return null;
  }
  async function pickAudioCodec() {
    if (typeof AudioEncoder !== "function" || typeof AudioData !== "function") return null;
    for (const [name, codec] of [["aac", "mp4a.40.2"], ["opus", "opus"]]) { try { const r = await AudioEncoder.isConfigSupported({ codec, sampleRate: SR, numberOfChannels: 2, bitrate: 128000 }); if (r && r.supported) return { name, codec }; } catch (e) { /* suivant */ } }
    return null;
  }

  /**
   * o : {width, height, fps, musicFile, rec, flip, onProgress(0..1, texte), signal:{stop}} -> {blob, mime, w, h, fps, via}
   */
  X.render = async function (tl, o) {
    o = o || {}; const W = o.width || 1080, H = o.height || 1920, fps = o.fps || 60, total = Math.ceil(tl.duration * fps), prog = o.onProgress || (() => {});
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H; const R = new E.editRender.Renderer(cv, tl, { flip: o.flip, rec: o.rec });
    prog(0, "Chargement des images…"); await R.load();
    const sup = X.supported();
    if (sup.webcodecs) {
      const bitrate = Math.round(W * H * fps * 0.09), vc = await pickVideoCodec(W, H, fps, bitrate), ac = await pickAudioCodec();
      if (vc) {
        prog(0.02, "Mixage du son…"); let mixed = null; try { mixed = await X.mix(tl, o.musicFile); } catch (e) { mixed = null; }
        const target = new Mp4Muxer.ArrayBufferTarget(), muxer = new Mp4Muxer.Muxer({ target, video: { codec: vc.name, width: W, height: H, frameRate: fps }, audio: mixed && ac ? { codec: ac.name, numberOfChannels: 2, sampleRate: SR } : undefined, fastStart: "in-memory" });
        let err = null; const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { err = e; } });
        venc.configure({ codec: vc.codec, width: W, height: H, bitrate, framerate: fps, latencyMode: "quality" });
        for (let f = 0; f < total; f++) {
          if (o.signal && o.signal.stop) { venc.close(); throw new Error("Génération annulée"); } if (err) throw err;
          R.draw(f / fps); const vf = new VideoFrame(cv, { timestamp: Math.round((f * 1e6) / fps), duration: Math.round(1e6 / fps) }); venc.encode(vf, { keyFrame: f % (fps * 2) === 0 }); vf.close();
          while (venc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 1));
          if (f % 6 === 0) { prog(0.05 + 0.85 * (f / total), `Génération de l'edit : ${Math.round((100 * f) / total)} %`); await tick(); }
        }
        await venc.flush(); venc.close(); if (err) throw err;
        if (mixed && ac) {
          prog(0.93, "Encodage du son…"); const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => { err = e; } }); aenc.configure({ codec: ac.codec, sampleRate: SR, numberOfChannels: 2, bitrate: 128000 });
          const L = mixed.getChannelData(0), Rr = mixed.numberOfChannels > 1 ? mixed.getChannelData(1) : L, N = 4096;
          for (let pos = 0; pos < L.length; pos += N) { const n = Math.min(N, L.length - pos), data = new Float32Array(n * 2); data.set(L.subarray(pos, pos + n), 0); data.set(Rr.subarray(pos, pos + n), n); const ad = new AudioData({ format: "f32-planar", sampleRate: SR, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((pos / SR) * 1e6), data }); aenc.encode(ad); ad.close(); if ((pos / N) % 40 === 0) await tick(); }
          await aenc.flush(); aenc.close(); if (err) throw err;
        }
        muxer.finalize(); prog(1, "Terminé");
        return { blob: new Blob([target.buffer], { type: "video/mp4" }), mime: "video/mp4", w: W, h: H, fps, via: `WebCodecs ${vc.name.toUpperCase()}${mixed && ac ? " + " + ac.name.toUpperCase() : ""}`, frames: total };
      }
    }
    if (sup.recorder) return X.recordRealtime(tl, o, R, cv, total, fps);
    throw new Error("Ce navigateur ne sait pas encoder de vidéo (ni WebCodecs, ni MediaRecorder). Utilise « RENDRE SUR LE PC ».");
  };

  /** secours : MediaRecorder sur le canvas, en temps réel (le canvas est léger : pas de filtre) ; l'audio du mixage est joué dans un flux dédié */
  X.recordRealtime = async function (tl, o, R, cv, total, fps) {
    const prog = o.onProgress || (() => {}), stream = cv.captureStream(0), track = stream.getVideoTracks()[0];
    let ac = null, srcNode = null; try { ac = new (window.AudioContext || window.webkitAudioContext)(); const mixed = await X.mix(tl, o.musicFile), dst = ac.createMediaStreamDestination(); srcNode = ac.createBufferSource(); srcNode.buffer = mixed; srcNode.connect(dst); dst.stream.getAudioTracks().forEach((t) => stream.addTrack(t)); } catch (e) { ac = null; }
    const mime = ["video/mp4;codecs=avc1", "video/webm;codecs=vp9", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m)) || "", rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8e6 } : {}), parts = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); }; const done = new Promise((r) => { rec.onstop = r; });
    rec.start(250); if (srcNode) srcNode.start(); const t0 = performance.now();
    await new Promise((res) => { const step = () => { if (o.signal && o.signal.stop) return res(); const t = (performance.now() - t0) / 1000; R.draw(Math.min(t, tl.duration)); if (track.requestFrame) track.requestFrame(); prog(Math.min(0.99, t / tl.duration), `Enregistrement : ${Math.round((100 * t) / tl.duration)} %`); if (t >= tl.duration) return res(); requestAnimationFrame(step); }; step(); });
    rec.stop(); await done; try { ac && ac.close(); } catch (e) { /* ok */ }
    const type = (mime || "video/webm").split(";")[0]; return { blob: new Blob(parts, { type }), mime: type, w: cv.width, h: cv.height, fps: 60, via: "MediaRecorder (temps réel)", frames: total };
  };
})();
