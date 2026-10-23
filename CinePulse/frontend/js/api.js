async function json(url, opts) {
  const r = await fetch(url, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

export const api = {
  status: () => json("/api/status"),
  assets: () => json("/api/assets"),
  // Corps brut = fichier (pas de multipart) ; le nom d'origine passe en paramètre.
  importFile: (file) => json(`/api/import?name=${encodeURIComponent(file.name)}`, { method: "POST", body: file }),
  importPath: (path) => json("/api/import_path", { method: "POST", body: JSON.stringify({ path }) }),
  remove: (id) => json(`/api/assets/${id}`, { method: "DELETE" }),
  waveform: (id, buckets) => json(`/api/waveform/${id}?buckets=${buckets}`),
};
