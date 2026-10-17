// Pont vers la couche native (Tauri). Dans un navigateur (développement, tests) : repli « aperçu » — secrets en sessionStorage, téléchargement réel
// du lien signé + vérification SHA-256 (WebCrypto), mais AUCUNE exécution d'installeur ni lancement.
const T = window.__TAURI__ || null;
export const isNative = !!(T && T.core);

export async function invoke(cmd, args) {
  if (!isNative) throw new Error("native command unavailable in preview mode: " + cmd);
  return T.core.invoke(cmd, args);
}
export async function listen(event, cb) {
  if (isNative) return T.event.listen(event, (e) => cb(e.payload));
  const h = (e) => cb(e.detail);
  window.addEventListener("dp:" + event, h);
  return () => window.removeEventListener("dp:" + event, h);
}
const emitLocal = (event, payload) => window.dispatchEvent(new CustomEvent("dp:" + event, { detail: payload }));

// ------------------------------------------------------------------ coffre d'identifiants (Windows : Gestionnaire d'identifiants)
export const secrets = {
  async get(k) { if (isNative) return invoke("secret_get", { key: k }); try { return sessionStorage.getItem("dp_secret_" + k); } catch (e) { return null; } },
  async set(k, v) { if (isNative) return invoke("secret_set", { key: k, value: v }); try { sessionStorage.setItem("dp_secret_" + k, v); } catch (e) {} },
  async del(k) { if (isNative) return invoke("secret_delete", { key: k }); try { sessionStorage.removeItem("dp_secret_" + k); } catch (e) {} },
};

// ------------------------------------------------------------------ fenêtre
export const win = {
  minimize: () => isNative && T.window.getCurrentWindow().minimize(),
  maximize: () => isNative && T.window.getCurrentWindow().toggleMaximize(),
  close: () => (isNative ? T.window.getCurrentWindow().close() : window.close()),
  drag: () => isNative && T.window.getCurrentWindow().startDragging(),
};
export async function openExternal(url) {
  if (!/^https:\/\//.test(url)) return;                                    // jamais autre chose que https
  if (isNative && T.opener) return T.opener.openUrl(url);
  window.open(url, "_blank", "noopener");
}

// ------------------------------------------------------------------ produits
const LS = "dp_preview_installed";
const previewInstalled = () => { try { return JSON.parse(localStorage.getItem(LS) || "{}"); } catch (e) { return {}; } };

export async function productState(product, appId) {
  if (isNative) return invoke("product_state", { product, appId });
  const i = previewInstalled()[product];
  return { installed: i ? { version: i.version, dir: "", source: "preview" } : null };
}

let previewCancel = false;
// aperçu (navigateur) : vraie chaîne de téléchargement + vérification SHA-256 (WebCrypto) ; `evt` = préfixe des événements (« install » ou « stage »)
async function previewDownload(req, evt) {
  const m = req.manifest;
  let total = m.files.reduce((a, f) => a + f.size, 0), before = 0;
  emitLocal(evt + "-progress", { product: req.product, phase: "verify", done: 0, total });
  for (let i = 0; i < m.files.length; i++) {
    const f = m.files[i];
    const r = await fetch(`${req.server.replace(/\/$/, "")}/launcher/v1/download/${m.product}/${m.channel}/${m.version}/${i}`, { headers: { Authorization: "Bearer " + req.token } });
    if (r.status === 401) throw Object.assign(new Error("Your session has expired. Reconnecting…"), { expired: true });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "Download refused (" + r.status + ")");
    const link = (await r.json()).url;
    const resp = await fetch(link);
    if (!resp.ok) throw new Error("The file is not available (" + resp.status + ").");
    const buf = await resp.arrayBuffer();
    if (previewCancel) throw Object.assign(new Error("Operation cancelled."), { cancelled: true });
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].map((b) => b.toString(16).padStart(2, "0")).join("");
    if (hash !== f.sha256 || buf.byteLength !== f.size) throw new Error("SHA-256 checksum mismatch for " + f.path + ": the file is corrupted or has been modified.");
    before += f.size;
    emitLocal(evt + "-progress", { product: req.product, phase: "download", done: before, total });
  }
  return m;
}
export async function installProduct(req) {
  if (isNative) return invoke("install_product", { req });
  previewCancel = false;
  (async () => {
    try {
      const m = await previewDownload(req, "install");
      emitLocal("install-progress", { product: req.product, phase: "install", done: 0, total: 0 });
      await new Promise((r) => setTimeout(r, 400));
      const all = previewInstalled(); all[req.product] = { version: m.version, channel: m.channel }; localStorage.setItem(LS, JSON.stringify(all));
      emitLocal("install-done", { product: req.product, version: m.version, dir: "" });
    } catch (e) {
      emitLocal("install-error", { product: req.product, message: e.message, token_expired: !!e.expired, cancelled: !!e.cancelled });
    }
  })();
}

// ------------------------------------------------------------------ mises à jour en arrière-plan (staging) — le Launcher ne ferme jamais l'application de force
const LSS = "dp_preview_staged", LSP = "dp_preview_settings";
const jget = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || "null") || d; } catch (e) { return d; } };
export const settings = {
  async get() { if (isNative) return invoke("settings_get"); return { auto_update: false, check_interval_min: 30, ...jget(LSP, {}) }; },
  async set(patch) { if (isNative) return invoke("settings_set", { ...patch }); const v = { ...(await settings.get()), ...patch }; localStorage.setItem(LSP, JSON.stringify(v)); return v; },
};
// req : { server, token, product, channel, manifest, signature } — téléchargement silencieux dans le dossier de staging ; événements stage-progress / stage-ready / stage-error
export async function stageUpdate(req) {
  if (isNative) return invoke("stage_update", { req });
  previewCancel = false;
  (async () => {
    try {
      const m = await previewDownload(req, "stage");
      const all = jget(LSS, {}); all[req.product] = { version: m.version, notes: m.notes || "", staged_at: Math.floor(Date.now() / 1000) }; localStorage.setItem(LSS, JSON.stringify(all));
      emitLocal("stage-ready", { product: req.product, version: m.version, notes: m.notes || "" });
    } catch (e) {
      emitLocal("stage-error", { product: req.product, message: e.message, token_expired: !!e.expired, cancelled: !!e.cancelled });
    }
  })();
}
export async function stagedInfo(product) { if (isNative) return invoke("staged_info", { product }); return jget(LSS, {})[product] || null; }
export async function discardStaged(product) { if (isNative) return invoke("discard_staged", { product }); const all = jget(LSS, {}); delete all[product]; localStorage.setItem(LSS, JSON.stringify(all)); }
export async function applyUpdate(product) {
  if (isNative) return invoke("apply_update", { product });
  throw new Error("Applying updates is unavailable in preview mode (native app required).");
}
export async function cancelInstall() { if (isNative) return invoke("cancel_install"); previewCancel = true; }
export async function launchProduct(product, appId, run) {
  if (isNative) return invoke("launch_product", { product, appId, run });
  throw new Error("Launching is unavailable in preview mode (native app required).");
}
