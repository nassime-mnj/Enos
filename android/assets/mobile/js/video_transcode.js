"use strict";
// TRANSCODAGE VIDÉO À TAILLE CIBLE (téléphone, sans PC) — utilisé par le module Compression.
//   1. lecture directe du MP4 (boîtes moov/trak/stbl : échantillons, images clés, horodatages, rotation) : aucun passage par la lecture vidéo
//   2. décodage WebCodecs (matériel) plus vite que le temps réel, puis ré-encodage HEVC (H.265) si l'appareil sait, sinon H.264 High, VP9, AV1
//   3. le son AAC est recopié tel quel (aucune perte, et sa taille exacte est retirée du budget)
//   4. débit vidéo = (taille voulue − son − en-têtes) / durée ; si ce débit est trop bas pour la résolution, on réduit la résolution par paliers
//      (1080p net vaut mieux que 4K pâteux) puis le nombre d'images (60 → 30 i/s) : la qualité perçue baisse le moins possible
//   5. 2e passe automatique si le fichier dépasse la cible de plus de 4 % (ou reste très en dessous : on rend la qualité)
// Repli : MediaRecorder en temps réel (vidéos non MP4, codec non décodable).
(() => {
  const E = window.ENOS;
  const V = (E.vtx = {});
  // ------------------------------------------------------------------ lecture MP4
  const u32 = (d, o) => d.getUint32(o), u16 = (d, o) => d.getUint16(o), u64 = (d, o) => d.getUint32(o) * 4294967296 + d.getUint32(o + 4);
  const str4 = (d, o) => String.fromCharCode(d.getUint8(o), d.getUint8(o + 1), d.getUint8(o + 2), d.getUint8(o + 3));
  const readAt = async (file, off, len) => new DataView(await file.slice(off, off + len).arrayBuffer());
  /** boîtes enfants d'une plage [s, e) d'un DataView */
  const boxes = (d, s, e) => { const out = []; let o = s; while (o + 8 <= e) { let size = u32(d, o); const type = str4(d, o + 4); let hdr = 8; if (size === 1) { size = u64(d, o + 8); hdr = 16; } else if (size === 0) size = e - o; if (size < hdr || o + size > e) break; out.push({ type, s: o, h: o + hdr, e: o + size }); o += size; } return out; };
  const child = (d, b, type) => boxes(d, b.h, b.e).find((x) => x.type === type);
  const hex2 = (n) => n.toString(16).padStart(2, "0");
  /** trouve et lit la boîte moov (souvent en fin de fichier pour les vidéos de téléphone) */
  async function moovOf(file) {
    let o = 0; while (o + 8 <= file.size) { const h = await readAt(file, o, 16); let size = u32(h, 0); const type = str4(h, 4); if (size === 1) size = u64(h, 8); else if (size === 0) size = file.size - o; if (size < 8) break;
      if (type === "moov") return new DataView(await file.slice(o, o + size).arrayBuffer()); o += size; }
    return null;
  }
  function hevcCodec(prefix, d, s) {
    const b1 = d.getUint8(s + 1), ps = ["", "A", "B", "C"][b1 >> 6], tier = (b1 >> 5) & 1, idc = b1 & 31; let flags = u32(d, s + 2), rev = 0; for (let i = 0; i < 32; i++) { rev = (rev << 1) | (flags & 1); flags >>>= 1; }
    const cons = []; for (let i = 0; i < 6; i++) cons.push(d.getUint8(s + 6 + i)); while (cons.length && !cons[cons.length - 1]) cons.pop();
    return `${prefix}.${ps}${idc}.${(rev >>> 0).toString(16)}.${tier ? "H" : "L"}${d.getUint8(s + 12)}${cons.map((c) => "." + c.toString(16).toUpperCase()).join("")}`;
  }
  /** esds -> AudioSpecificConfig (décodeur AAC) */
  function ascOf(d, b) { let o = b.h + 4; const len = () => { let n = 0; for (let i = 0; i < 4; i++) { const c = d.getUint8(o++); n = (n << 7) | (c & 127); if (!(c & 128)) break; } return n; };
    while (o < b.e) { const tag = d.getUint8(o++), l = len(); if (tag === 3) { o += 2; const f = d.getUint8(o++); if (f & 128) o += 2; if (f & 64) o += d.getUint8(o) + 1; if (f & 32) o += 2; continue; } if (tag === 4) { o += 13; continue; } if (tag === 5) return new Uint8Array(d.buffer, d.byteOffset + o, l).slice(); o += l; } return null; }
  /** analyse : {duration, tracks:{video, audio}} ; chaque piste a ses échantillons [{off, size, dts, cts, dur, key}] en secondes */
  V.probe = async (file) => {
    const d = await moovOf(file); if (!d) throw new Error("Fichier MP4 illisible (boîte moov absente)");
    const root = { h: 8, e: d.byteLength }, out = { duration: 0, tracks: {} };
    const mvhd = child(d, root, "mvhd"); if (mvhd) { const v = d.getUint8(mvhd.h), ts = u32(d, mvhd.h + (v ? 20 : 12)); out.duration = (v ? u64(d, mvhd.h + 24) : u32(d, mvhd.h + 16)) / ts; }
    for (const trak of boxes(d, root.h, root.e).filter((b) => b.type === "trak")) {
      const tkhd = child(d, trak, "tkhd"), mdia = child(d, trak, "mdia"); if (!mdia) continue;
      const mdhd = child(d, mdia, "mdhd"), hdlr = child(d, mdia, "hdlr"), stbl = (() => { const mi = child(d, mdia, "minf"); return mi && child(d, mi, "stbl"); })(); if (!mdhd || !hdlr || !stbl) continue;
      const kind = str4(d, hdlr.h + 8); if (kind !== "vide" && kind !== "soun") continue;
      const mv = d.getUint8(mdhd.h), ts = u32(d, mdhd.h + (mv ? 20 : 12));
      const t = { kind, ts, samples: [] };
      if (tkhd) { const tv = d.getUint8(tkhd.h), m = tkhd.h + (tv ? 52 : 40); const a = d.getInt32(m) / 65536, b = d.getInt32(m + 4) / 65536; t.rotation = ((Math.round(Math.atan2(b, a) * 180 / Math.PI) % 360) + 360) % 360; }
      const stsd = child(d, stbl, "stsd"), ent = boxes(d, stsd.h + 8, stsd.e)[0]; if (!ent) continue; t.fourcc = ent.type;
      if (kind === "vide") { t.width = u16(d, ent.h + 24); t.height = u16(d, ent.h + 26); const subs = boxes(d, ent.h + 78, ent.e);
        const avcC = subs.find((x) => x.type === "avcC"), hvcC = subs.find((x) => x.type === "hvcC"), vpcC = subs.find((x) => x.type === "vpcC"), av1C = subs.find((x) => x.type === "av1C");
        if (avcC) { t.codec = "avc1." + hex2(d.getUint8(avcC.h + 1)) + hex2(d.getUint8(avcC.h + 2)) + hex2(d.getUint8(avcC.h + 3)); t.description = new Uint8Array(d.buffer, d.byteOffset + avcC.h, avcC.e - avcC.h).slice(); }
        else if (hvcC) { t.codec = hevcCodec(ent.type === "hev1" ? "hev1" : "hvc1", d, hvcC.h); t.description = new Uint8Array(d.buffer, d.byteOffset + hvcC.h, hvcC.e - hvcC.h).slice(); }
        else if (vpcC) { const p = d.getUint8(vpcC.h + 4), l = d.getUint8(vpcC.h + 5), bd = d.getUint8(vpcC.h + 6) >> 4; t.codec = `vp09.${hex2(p)}.${hex2(l)}.${hex2(bd)}`; }
        else if (av1C) { const b1 = d.getUint8(av1C.h + 1), b2 = d.getUint8(av1C.h + 2); t.codec = `av01.${b1 >> 5}.${hex2(b1 & 31)}${b2 & 128 ? "H" : "M"}.${b2 & 64 ? (b2 & 32 ? "12" : "10") : "08"}`; t.description = new Uint8Array(d.buffer, d.byteOffset + av1C.h, av1C.e - av1C.h).slice(); } }
      else { t.channels = u16(d, ent.h + 16); t.sampleRate = u32(d, ent.h + 24) >>> 16; const esds = boxes(d, ent.h + 28, ent.e).find((x) => x.type === "esds"); if (ent.type === "mp4a" && esds) { t.codec = "mp4a.40.2"; t.asc = ascOf(d, esds); if (t.asc) { const ot = t.asc[0] >> 3; t.codec = "mp4a.40." + ot; } } }
      // tables d'échantillons
      const tb = (n) => child(d, stbl, n);
      const stts = tb("stts"), ctts = tb("ctts"), stss = tb("stss"), stsc = tb("stsc"), stsz = tb("stsz") || tb("stz2"), stco = tb("stco"), co64 = tb("co64");
      const n = u32(d, stsz.h + 8), fixed = u32(d, stsz.h + 4), sizes = new Array(n); for (let i = 0; i < n; i++) sizes[i] = fixed || u32(d, stsz.h + 12 + i * 4);
      const chunks = []; if (stco) { const c = u32(d, stco.h + 4); for (let i = 0; i < c; i++) chunks.push(u32(d, stco.h + 8 + i * 4)); } else if (co64) { const c = u32(d, co64.h + 4); for (let i = 0; i < c; i++) chunks.push(u64(d, co64.h + 8 + i * 8)); }
      const sc = []; { const c = u32(d, stsc.h + 4); for (let i = 0; i < c; i++) sc.push([u32(d, stsc.h + 8 + i * 12), u32(d, stsc.h + 12 + i * 12)]); }
      const offs = new Array(n); { let s = 0; for (let k = 0; k < sc.length; k++) { const first = sc[k][0] - 1, last = k + 1 < sc.length ? sc[k + 1][0] - 1 : chunks.length, per = sc[k][1];
          for (let ch = first; ch < last && s < n; ch++) { let o = chunks[ch]; for (let j = 0; j < per && s < n; j++) { offs[s] = o; o += sizes[s]; s++; } } } }
      const durs = []; { const c = u32(d, stts.h + 4); for (let i = 0; i < c; i++) { const cnt = u32(d, stts.h + 8 + i * 8), del = u32(d, stts.h + 12 + i * 8); for (let j = 0; j < cnt; j++) durs.push(del); } }
      const cto = ctts ? (() => { const r = [], v = d.getUint8(ctts.h), c = u32(d, ctts.h + 4); for (let i = 0; i < c; i++) { const cnt = u32(d, ctts.h + 8 + i * 8), off = v ? d.getInt32(ctts.h + 12 + i * 8) : u32(d, ctts.h + 12 + i * 8); for (let j = 0; j < cnt; j++) r.push(off); } return r; })() : null;
      const keys = stss ? new Set(Array.from({ length: u32(d, stss.h + 4) }, (_, i) => u32(d, stss.h + 8 + i * 4) - 1)) : null;
      let dts = 0; for (let i = 0; i < n; i++) { const du = durs[i] || durs[durs.length - 1] || 0; t.samples.push({ off: offs[i], size: sizes[i], dts: dts / ts, cts: (dts + (cto ? cto[i] || 0 : 0)) / ts, dur: du / ts, key: keys ? keys.has(i) : true }); dts += du; }
      t.duration = dts / ts; t.bytes = sizes.reduce((a, b) => a + b, 0);
      if (!out.tracks[kind === "vide" ? "video" : "audio"]) out.tracks[kind === "vide" ? "video" : "audio"] = t;
    }
    const v = out.tracks.video; if (!v) throw new Error("Aucune piste vidéo");
    if (!out.duration) out.duration = v.duration;
    const minCts = Math.min(...v.samples.slice(0, 32).map((s) => s.cts)); v.samples.forEach((s) => (s.cts -= minCts));        // décalage d'édition (B-frames)
    v.fps = v.samples.length / (v.duration || 1);
    return out;
  };

  // ------------------------------------------------------------------ choix du codec et du réglage
  const CANDS = [["hevc", (w, h) => "hvc1.1.6.L" + (w * h > 2088960 ? 153 : w * h > 983040 ? 123 : 93) + ".B0"], ["avc", (w, h) => (w * h > 2088960 ? "avc1.640033" : "avc1.640028")], ["vp9", () => "vp09.00.40.08"], ["av1", () => "av01.0.08M.08"]];
  // qualité visée : bits par pixel et par image minimum avant de réduire la résolution (HEVC/AV1 ~40 % plus efficaces que H.264)
  const BPP = { hevc: 0.042, av1: 0.04, vp9: 0.05, avc: 0.07 };
  V.pickCodec = async (w, h, bitrate, fps) => { for (const [name, mk] of CANDS) { const codec = mk(w, h); try { const r = await VideoEncoder.isConfigSupported({ codec, width: w, height: h, bitrate, framerate: fps, ...(name === "avc" ? { avc: { format: "avc" } } : name === "hevc" ? { hevc: { format: "hevc" } } : {}) }); if (r && r.supported) return { name, codec }; } catch (e) { /* suivant */ } } return null; };
  V.supported = () => typeof VideoDecoder === "function" && typeof VideoEncoder === "function" && typeof VideoFrame === "function" && typeof window.Mp4Muxer === "object";
  /** plan d'encodage pour une taille cible (octets) : {width, height, fps, bitrate, codec, note} */
  V.plan = async (info, target) => {
    const v = info.tracks.video, a = info.tracks.audio, dur = info.duration || v.duration || 1;
    const audioBytes = a && a.codec && a.codec.startsWith("mp4a") ? a.bytes : 0, overhead = 8192 + v.samples.length * 12 + (a ? a.samples.length * 8 : 0);
    const budget = Math.max(dur * 30000, target - audioBytes - overhead), bitrate = Math.floor((budget * 8) / dur);
    const rot = v.rotation === 90 || v.rotation === 270, short0 = Math.min(v.width, v.height);
    let fps = v.fps; const tryCodec = await V.pickCodec(v.width, v.height, bitrate, Math.round(fps)); const cname = tryCodec ? tryCodec.name : "avc", min = BPP[cname] || 0.07;
    const steps = [short0, 1440, 1080, 720, 540, 480, 360].filter((s) => s <= short0);
    let short = steps[steps.length - 1];
    for (const s of steps) { const k = s / short0, w = v.width * k, h = v.height * k; if (bitrate / (w * h * fps) >= min) { short = s; break; } }
    if (bitrate / ((v.width * short / short0) * (v.height * short / short0) * fps) < min && fps > 31) { fps = 30; for (const s of steps) { const k = s / short0; if (bitrate / (v.width * k * v.height * k * fps) >= min) { short = Math.max(short, s); break; } } }
    const k = short / short0, W = Math.max(2, Math.round((v.width * k) / 2) * 2), H = Math.max(2, Math.round((v.height * k) / 2) * 2);
    const codec = (await V.pickCodec(W, H, bitrate, Math.round(fps))) || tryCodec;
    return { width: W, height: H, fps, srcFps: v.fps, bitrate, codec, audioBytes, rotation: v.rotation || 0, rot, label: `${Math.min(W, H)}p · ${codec ? codec.name.toUpperCase() : "?"} · ${(bitrate / 1e6).toFixed(1).replace(".", ",")} Mb/s${fps < v.fps - 1 ? " · 30 i/s" : ""}` };
  };

  // ------------------------------------------------------------------ transcodage
  /** lecteur d'échantillons par blocs (évite une lecture de fichier par image) */
  const reader = (file) => { let bs = -1, be = -1, buf = null; return async (s) => { if (s.off < bs || s.off + s.size > be) { bs = s.off; be = Math.min(file.size, s.off + Math.max(s.size, 4 << 20)); buf = new Uint8Array(await file.slice(bs, be).arrayBuffer()); } return buf.subarray(s.off - bs, s.off - bs + s.size); }; };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  /** une passe : renvoie {blob, videoBytes} */
  async function pass(file, info, p, o) {
    const v = info.tracks.video, a = info.tracks.audio, keepAudio = a && a.codec && a.codec.startsWith("mp4a") && a.asc;
    const target = new Mp4Muxer.ArrayBufferTarget();
    const muxer = new Mp4Muxer.Muxer({ target, fastStart: "in-memory", firstTimestampBehavior: "offset",
      video: { codec: p.codec.name, width: p.width, height: p.height, rotation: [0, 90, 180, 270].includes(p.rotation) ? p.rotation : 0, frameRate: Math.round(p.fps) },
      audio: keepAudio ? { codec: "aac", numberOfChannels: a.channels || 2, sampleRate: a.sampleRate || 44100 } : undefined });
    let err = null, videoBytes = 0, frames = 0, lastKept = -1;
    const enc = new VideoEncoder({ output: (c, m) => { videoBytes += c.byteLength; muxer.addVideoChunk(c, m); }, error: (e) => (err = e) });
    enc.configure({ codec: p.codec.codec, width: p.width, height: p.height, bitrate: p.bitrate, framerate: Math.round(p.fps), bitrateMode: "variable", latencyMode: "quality", hardwareAcceleration: "no-preference",
      ...(p.codec.name === "avc" ? { avc: { format: "avc" } } : p.codec.name === "hevc" ? { hevc: { format: "hevc" } } : {}) });
    const scale = p.width !== v.width || p.height !== v.height, cv = scale ? (typeof OffscreenCanvas === "function" ? new OffscreenCanvas(p.width, p.height) : Object.assign(document.createElement("canvas"), { width: p.width, height: p.height })) : null, g = cv && cv.getContext("2d");
    if (g) g.imageSmoothingQuality = "high";
    const step = 1 / p.fps, gop = Math.max(1, Math.round(p.fps * 2)), total = v.samples.length;
    const dec = new VideoDecoder({ error: (e) => (err = e), output: (f) => {
      try { const t = f.timestamp / 1e6;
        if (p.fps < p.srcFps - 1 && lastKept >= 0 && t - lastKept < step * 0.92) { f.close(); return; }       // 60 -> 30 i/s : une image sur deux
        lastKept = t; let out = f;
        if (g) { g.drawImage(f, 0, 0, p.width, p.height); out = new VideoFrame(cv, { timestamp: f.timestamp, duration: f.duration || Math.round(step * 1e6) }); f.close(); }
        enc.encode(out, { keyFrame: frames % gop === 0 }); frames++; out.close();
      } catch (e) { err = e; try { f.close(); } catch (x) { /* déjà fermée */ } } } });
    dec.configure({ codec: v.codec, codedWidth: v.width, codedHeight: v.height, description: v.description, hardwareAcceleration: "no-preference", optimizeForLatency: false });
    const rd = reader(file);
    for (let i = 0; i < total; i++) {
      if (err) throw err; if (o.signal && o.signal.stop) { try { dec.close(); enc.close(); } catch (e) { /* rien */ } throw new Error("Annulé"); }
      const s = v.samples[i], data = await rd(s);
      dec.decode(new EncodedVideoChunk({ type: s.key ? "key" : "delta", timestamp: Math.round(s.cts * 1e6), duration: Math.round(s.dur * 1e6), data }));
      while (dec.decodeQueueSize > 6 || enc.encodeQueueSize > 6) { await new Promise((r) => setTimeout(r, 2)); if (err) throw err; }
      if (i % 15 === 0) { o.onProgress && o.onProgress(i / total); await tick(); }
    }
    await dec.flush(); await enc.flush(); dec.close(); enc.close(); if (err) throw err;
    if (keepAudio) { const ra = reader(file), meta = { decoderConfig: { codec: a.codec, sampleRate: a.sampleRate, numberOfChannels: a.channels, description: a.asc } };
      for (let i = 0; i < a.samples.length; i++) { const s = a.samples[i]; muxer.addAudioChunkRaw(await ra(s), "key", Math.round(s.dts * 1e6), Math.round(s.dur * 1e6), i === 0 ? meta : undefined); if (i % 200 === 0) await tick(); } }
    muxer.finalize();
    return { blob: new Blob([target.buffer], { type: "video/mp4" }), videoBytes, frames, audio: !!keepAudio };
  }
  /** compresse `file` pour ne pas dépasser `target` octets ; o : {onProgress(k, texte), signal} -> {blob, plan, passes} */
  V.compress = async (file, target, o) => {
    o = o || {}; const info = await V.probe(file), v = info.tracks.video;
    if (!(await VideoDecoder.isConfigSupported({ codec: v.codec, codedWidth: v.width, codedHeight: v.height, description: v.description })).supported) throw new Error("Codec " + v.codec + " non décodable ici");
    let p = await V.plan(info, target); if (!p.codec) throw new Error("Aucun encodeur vidéo disponible");
    const budget = target - p.audioBytes - 8192; let r = null, passes = 0;
    for (; passes < 2; passes++) {
      const label = passes ? "2e passe (ajustement de la taille)" : "Compression";
      r = await pass(file, info, p, { signal: o.signal, onProgress: (k) => o.onProgress && o.onProgress(k, label) });
      const ratio = r.blob.size / target;
      if (ratio <= 1.04 && ratio >= 0.72) break;
      if (passes === 1) break;
      const nb = Math.floor(p.bitrate * Math.max(0.3, Math.min(1.8, (budget / Math.max(1, r.videoBytes)) * (ratio > 1 ? 0.97 : 0.95))));
      if (ratio < 0.72 && nb <= p.bitrate * 1.05) break;
      p = Object.assign({}, p, { bitrate: nb });
    }
    return { blob: r.blob, plan: p, passes: passes + 1, audio: r.audio, info };
  };
})();
