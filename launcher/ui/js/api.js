// Dual Pulse API client (/launcher/v1). Session: access token in memory; refresh token in the Windows credential vault.
// An expired token is renewed automatically (one refresh request at a time), then the request is replayed once.
import { secrets } from "./native.js";
import { DEFAULT_SERVER } from "./config.js";

export class ApiError extends Error {
  constructor(message, status, extra) { super(message); this.status = status; this.extra = extra || {}; }
}

const state = { server: DEFAULT_SERVER, access: "", refresh: "", user: null, onLogout: () => {} };
let refreshing = null;

export const session = {
  get server() { return state.server; },
  get user() { return state.user; },
  get role() { return state.user ? state.user.role : "public"; },
  get token() { return state.access; },
  onLogout(fn) { state.onLogout = fn; },
};

export async function loadServer() {
  try { const s = localStorage.getItem("dp_server"); if (s) state.server = s; } catch (e) {}
  return state.server;
}
export function setServer(url) {
  url = (url || "").trim().replace(/\/+$/, "");
  if (!/^https:\/\/[^\s/]+/i.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(url)) throw new ApiError("Adresse invalide : https:// obligatoire (http:// seulement pour 127.0.0.1).", 0);
  state.server = url;
  try { localStorage.setItem("dp_server", url); } catch (e) {}
}

async function raw(path, { method = "GET", body, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth && state.access) headers.Authorization = "Bearer " + state.access;
  let r;
  try { r = await fetch(state.server + "/launcher/v1" + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined }); }
  catch (e) { throw new ApiError("Cannot reach the server. Check your connection and the server address.", 0); }
  let data = null; try { data = await r.json(); } catch (e) {}
  if (!r.ok) throw new ApiError((data && (typeof data.detail === "string" ? data.detail : "Request refused")) || "Error " + r.status, r.status, data || {});
  return data;
}

function adopt(s) {
  state.access = s.access_token; state.refresh = s.refresh_token; state.user = s.user;
  return secrets.set("refresh", s.refresh_token);
}

async function renew() {
  if (!state.refresh) throw new ApiError("Session expired.", 401);
  if (!refreshing) {
    refreshing = raw("/auth/refresh", { method: "POST", body: { refresh_token: state.refresh }, auth: false })
      .then(adopt).finally(() => { refreshing = null; });
  }
  return refreshing;
}

export async function call(path, opts) {
  try { return await raw(path, opts); }
  catch (e) {
    if (e.status === 401 && (opts || {}).auth !== false && state.refresh) {
      try { await renew(); } catch (x) { await logoutLocal(); throw new ApiError("Session expired: please sign in again.", 401); }
      return raw(path, opts);
    }
    throw e;
  }
}

export async function ensureFreshToken() { await renew(); return state.access; }

// ------------------------------------------------------------------ comptes
export async function login(email, password, totp, device) {
  const s = await raw("/auth/login", { method: "POST", body: { email, password, totp: totp || "", device: device || "Launcher" }, auth: false });
  await adopt(s); return s;
}
export async function register(invite, email, password, name) {
  const s = await raw("/auth/register", { method: "POST", body: { invite, email, password, name: name || "" }, auth: false });
  await adopt(s); return s;
}
export async function restore() {
  const rt = await secrets.get("refresh");
  if (!rt) return false;
  state.refresh = rt;
  try { await renew(); return true; } catch (e) { if (e.status === 401) await secrets.del("refresh"); state.refresh = ""; return false; }
}
async function logoutLocal() {
  state.access = ""; state.refresh = ""; state.user = null;
  await secrets.del("refresh"); state.onLogout();
}
export async function logout() {
  const rt = state.refresh;
  if (rt) { try { await raw("/auth/logout", { method: "POST", body: { refresh_token: rt }, auth: false }); } catch (e) {} }
  await logoutLocal();
}

// ------------------------------------------------------------------ data
export const catalog = () => call("/catalog");
export const news = () => call("/news");
export const manifest = (product, channel) => call(`/manifest/${product}/${channel}`);
export const wishlist = (email) => call("/wishlist", { method: "POST", body: { email }, auth: false });
export const invites = {
  list: () => call("/invites"),
  create: (role, days, note, code) => call("/invites", { method: "POST", body: { role, days, note, ...(code ? { code } : {}) } }),
  revoke: (id) => call("/invites/" + id, { method: "DELETE" }),
};
export const users = {
  list: () => call("/users"),
  patch: (id, body) => call("/users/" + id, { method: "PATCH", body }),
  revokeSessions: (id) => call(`/users/${id}/revoke-sessions`, { method: "POST" }),
};
export const admin = {
  news: () => call("/news/all"),
  createNews: (b) => call("/news", { method: "POST", body: b }),
  deleteNews: (id) => call("/news/" + id, { method: "DELETE" }),
  wishlistCount: () => call("/wishlist/count"),
  ternaStatus: (status) => call("/products/terna/status", { method: "PUT", body: { status } }),
};
export const account = {
  totpSetup: () => call("/auth/totp/setup", { method: "POST" }),
  totpEnable: (code) => call("/auth/totp/enable", { method: "POST", body: { code } }),
  password: (old, nw) => call("/auth/password", { method: "POST", body: { old, new: nw } }),
  logoutAll: () => call("/auth/logout-all", { method: "POST" }),
};
