"use strict";
// CERVEAU AUTONOME : le téléphone parle DIRECTEMENT à Groq (chat, en flux) et ElevenLabs (voix) via le pont natif — le PC n'intervient pas.
// Les clés sont dans le coffre Keystore ; ce fichier ne les voit jamais. Historique des conversations : localStorage (texte seul).
(() => {
  const E = window.ENOS, N = E.native;
  const A = (E.ai = { busy: false, current: null });
  const KEEP = 30;                                     // messages gardés par personnalité
  const MAX_CTX = 12;                                  // messages envoyés au modèle

  A.PERSONAS = {
    enos: {
      label: "E.N.O.S.", vault: "eleven_enos", model: "eleven_multilingual_v2",
      system: (n) => `Tu es E.N.O.S. A.I., un assistant cybernétique et développeur système. Ton fondateur est Nassime. Tu parles avec ${n}. Réponses concises, professionnelles, froides mais loyales, vocabulaire technique. Réponds en français, en texte brut sans markdown ni listes à puces : tes réponses sont lues à voix haute. Ton nom est E.N.O.S. et rien d'autre.`,
      voice: { stability: 0.5, similarity_boost: 0.75, style: 0.2, speed: 1 },
    },
    eto: {
      label: "ETO", vault: "eleven_eto", model: "eleven_v3",
      system: (n) => `Tu es ETO, une présence zen, vive et chaleureuse, l'autre visage d'E.N.O.S. Tu parles avec ${n}. Réponses courtes et expressives, en français, texte brut sans markdown ni listes : elles sont lues à voix haute. Pas de religion.`,
      voice: { stability: 0.35, similarity_boost: 0.75, style: 0.4, speed: 1.15 },
    },
  };

  // ------------------------------------------------------------------ historique
  A.history = (p) => E.store.get("chat." + p, []);
  A.saveHistory = (p, h) => E.store.set("chat." + p, h.slice(-KEEP));
  A.clear = (p) => E.store.del("chat." + p);
  A.name = () => E.settings.get("name", "Nassime");
  // deux sources : la clé Groq personnelle, ou la clé ETO Gateway (OpenRouter, créée par le serveur ETO, plafonnée par l'offre). Choix : Réglages / module ETO Gateway.
  A.hasGroq = () => N.vault.has("groq");
  A.hasEto = () => N.vault.has("openrouter");
  A.source = () => { const s = E.settings.get("ai.source", ""); return s === "groq" && A.hasGroq() ? "groq" : s === "eto" && A.hasEto() ? "eto" : A.hasGroq() ? "groq" : A.hasEto() ? "eto" : ""; };
  A.configured = () => !!A.source();
  // identifiants Groq -> OpenRouter (mêmes modèles, noms différents) ; un identifiant inconnu passe tel quel
  const OR_MAP = { "llama-3.3-70b-versatile": "meta-llama/llama-3.3-70b-instruct", "llama-3.1-8b-instant": "meta-llama/llama-3.1-8b-instruct",
    "meta-llama/llama-4-scout-17b-16e-instruct": "meta-llama/llama-4-scout", "meta-llama/llama-4-maverick-17b-128e-instruct": "meta-llama/llama-4-maverick",
    "moonshotai/kimi-k2-instruct": "moonshotai/kimi-k2", "deepseek-r1-distill-llama-70b": "deepseek/deepseek-r1-distill-llama-70b", "gemma2-9b-it": "google/gemma-2-9b-it" };
  /** requête de chat prête pour le pont natif, selon la source active : {provider, path, body} */
  A.endpoint = (body) => {
    const b = Object.assign({}, body);
    if (A.source() !== "eto") return { provider: "groq", path: "/openai/v1/chat/completions", body: b };
    b.model = OR_MAP[b.model] || b.model;
    if (b.reasoning_effort) { b.reasoning = { effort: b.reasoning_effort }; delete b.reasoning_effort; }
    if (b.stream_options) { delete b.stream_options; b.usage = { include: true }; }
    return { provider: "openrouter", path: "/api/v1/chat/completions", body: b };
  };
  A._orModel = (m) => OR_MAP[m] || m;
  A.model = () => E.settings.get("model", "openai/gpt-oss-120b");

  // ------------------------------------------------------------------ chat en flux (SSE de Groq). onDelta(texte) à chaque morceau ; résout avec le texte final.
  A.chat = (persona, text, onDelta, opts) => new Promise((resolve, reject) => {
    if (!A.configured()) return reject(new Error("Aucune clé d'IA : ajoute ta clé Groq (Réglages → Clés d'API) ou active ETO Gateway (ETO MAX)."));
    const P = A.PERSONAS[persona];
    const hist = opts && opts.oneShot ? [] : A.history(persona);       // oneShot : question isolée (commentaire d'échecs), hors historique
    hist.push({ role: "user", content: text });
    const body = { model: A.model(), stream: true, stream_options: { include_usage: true }, max_tokens: 500, temperature: 0.7,
      messages: [{ role: "system", content: (opts && opts.system) || P.system(A.name()) }, ...hist.slice(-MAX_CTX)] };
    if (/gpt-oss/.test(body.model)) body.reasoning_effort = "low";             // réflexion courte : première syllabe en < 1 s
    let buf = "", out = "", status = 0, errBody = "";
    const ep = A.endpoint(body);
    A.current = N.request({ provider: ep.provider, path: ep.path, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ep.body) }, {
      head: (s) => { status = s; },
      chunk: (c) => {
        if (status !== 200) { errBody += c; return; }
        buf += c;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line.startsWith("data:")) continue;
          const d = line.slice(5).trim();
          if (d === "[DONE]") continue;
          try {
            const j = JSON.parse(d);
            if (j.usage && E.usage) E.usage.add(j.usage.total_tokens || 0);                   // compteurs du Contrôle API
            const t = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
            if (t) { out += t; onDelta(out); }
          } catch (e) { /* ligne partielle ou sans texte */ }
        }
      },
      end: () => {
        A.current = null;
        if (status !== 200) {
          let m = "Erreur Groq " + status;
          try { m = JSON.parse(errBody).error.message || m; } catch (e) { /* corps non JSON */ }
          return reject(new Error(A.source() === "eto" ? (status === 401 || status === 403 ? "Clé ETO Gateway refusée ou désactivée (offre terminée ?) : Modules › ETO Gateway." : status === 402 ? "Plafond d'IA du mois atteint : il repart le mois prochain (Modules › ETO Gateway)." : status === 429 ? "IA très demandée : réessaie dans un instant." : m)
            : status === 401 ? "Clé Groq refusée (Réglages)." : status === 429 ? "Groq : limite de débit, réessaie dans un instant." : m));
        }
        out = out.trim();
        if (!out) return reject(new Error("Réponse vide."));
        hist.push({ role: "assistant", content: out });
        if (!(opts && opts.oneShot)) A.saveHistory(persona, hist);
        resolve(out);
      },
      error: (m) => { A.current = null; reject(new Error(m)); },
    });
  });
  A.stop = () => { if (A.current) { A.current.cancel(); A.current = null; } };

  // ------------------------------------------------------------------ voix : ElevenLabs via Java, repli sur la synthèse d'Android
  let audio = null;
  A.stopVoice = () => { if (audio) { audio.pause(); audio = null; } try { speechSynthesis.cancel(); } catch (e) { /* pas de synthèse */ } E.emit("speak", false); };
  A.voiceOn = () => E.settings.get("voice", true);
  A.speak = async (persona, text) => {
    A.stopVoice();
    const P = A.PERSONAS[persona];
    const clean = text.replace(/[*_#`>]/g, "").slice(0, 900);
    const voiceId = E.settings.get("voice_" + persona, "");
    if (N.vault.has(P.vault) && voiceId) {
      try {
        const r = await N.fetch({ provider: P.vault, path: `/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, method: "POST", bin: true,
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: clean, model_id: P.model, voice_settings: P.voice }) });
        if (r.status === 200 && r.bytes.length > 500) {
          const url = URL.createObjectURL(new Blob([r.bytes], { type: "audio/mpeg" }));
          audio = new Audio(url);
          audio.onended = () => { URL.revokeObjectURL(url); audio = null; E.emit("speak", false); };
          audio.onplay = () => E.emit("speak", true);
          await audio.play();
          return "eleven";
        }
        if (r.status === 401 || r.status === 402) E.ui && E.ui.toast("ElevenLabs : crédits épuisés ou clé refusée — voix du téléphone.", "warn");
      } catch (e) { /* réseau : repli */ }
    }
    try { const u = new SpeechSynthesisUtterance(clean); u.onstart = () => E.emit("speak", true); u.onend = u.onerror = () => E.emit("speak", false); u.lang = "fr-FR"; u.rate = persona === "eto" ? 1.1 : 0.95; u.pitch = persona === "eto" ? 1.1 : 0.7; speechSynthesis.speak(u); return "device"; } catch (e) { return ""; }
  };
})();
