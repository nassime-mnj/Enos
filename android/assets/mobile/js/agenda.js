"use strict";
// AGENDA HORS LIGNE D'ABORD : le téléphone lit lui-même les .ics (Zeus, Moodle) et garde ses tâches ; quand le PC est en ligne, une synchro bidirectionnelle
// fusionne les TÂCHES (les cours/échéances n'ont pas besoin d'être synchronisés : les deux appareils lisent la même source).
//
// Protocole de synchro (POST /api/agenda/sync) :
//   téléphone → PC : {since, tasks:[tâches modifiées localement depuis la dernière synchro, horodatage corrigé de l'écart d'horloge]}
//   PC → téléphone : {tasks:[tâches modifiées côté PC], now}  — « la dernière modification gagne », par tâche ; suppression = pierre tombale {deleted:true}.
(() => {
  const E = window.ENOS, N = E.native;
  const G = (E.agenda = { events: { zeus: [], moodle: [] }, tasks: [] });
  const TTL = 10 * 60 * 1000;

  // ------------------------------------------------------------------ ICS (portage de nasko_epita.parse_ics)
  const EXAM = /\b(contr[oô]le|partiel|examen|exam|soutenance|DS|QCM|rattrapage)\b/i;
  const DUE = /(rendu|d[ée]p[oô]t|due|deadline|remise|[ée]ch[ée]ance|auto-?[ée]valuation|ferme|closes|devoir)/i;
  const unesc = (v) => v.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
  const fmtParis = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

  function dt(value, params) {
    value = value.trim();
    let m;
    if (params.VALUE === "DATE" || /^\d{8}$/.test(value)) return { s: `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00`, allDay: true };
    if ((m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/))) {                 // UTC -> heure murale de Paris (fuseaux du téléphone indépendants)
      const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
      return { s: fmtParis.format(d).replace(" ", "T"), allDay: false };
    }
    if ((m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/))) return { s: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`, allDay: false };     // flottante / Europe/Paris
    return null;
  }

  const addMs = (s, ms) => { const d = new Date(s); d.setTime(d.getTime() + ms); return `${d.getFullYear()}-${E.pad(d.getMonth() + 1)}-${E.pad(d.getDate())}T${E.pad(d.getHours())}:${E.pad(d.getMinutes())}`; };

  G.parseICS = (text) => {
    const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
    const out = [];
    let cur = null;
    for (const line of lines) {
      if (line === "BEGIN:VEVENT") cur = {};
      else if (line === "END:VEVENT") { if (cur && cur.DTSTART) out.push(cur); cur = null; }
      else if (cur && line.includes(":")) {
        const i = line.indexOf(":");
        const [name, ...pl] = line.slice(0, i).split(";");
        const params = {};
        pl.forEach((p) => { const k = p.split("="); if (k[1]) params[k[0]] = k[1]; });
        cur[name.toUpperCase()] = { v: line.slice(i + 1), p: params };
      }
    }
    return out.map((ev) => {
      const st = dt(ev.DTSTART.v, ev.DTSTART.p);
      if (!st) return null;
      const en = ev.DTEND ? dt(ev.DTEND.v, ev.DTEND.p) : null;
      const title = unesc((ev.SUMMARY && ev.SUMMARY.v) || "").trim() || "(sans titre)";
      const desc = unesc((ev.DESCRIPTION && ev.DESCRIPTION.v) || "").trim().slice(0, 300);
      const end = en ? en.s : addMs(st.s, st.allDay ? 86400000 : 3600000);                       // fin par défaut : +1 h (heure murale)
      return { uid: (ev.UID && ev.UID.v) || title + st.s, title, start: st.s, end, allDay: st.allDay, location: unesc((ev.LOCATION && ev.LOCATION.v) || "").trim(),
        kind: EXAM.test(title) ? "exam" : DUE.test(title) || DUE.test(desc.slice(0, 200)) ? "deadline" : "class" };
    }).filter(Boolean).sort((a, b) => (a.start < b.start ? -1 : 1));
  };

  // ------------------------------------------------------------------ sources (liens dans le coffre ; téléchargés par Java)
  G.loadCache = () => { G.events.zeus = E.store.get("ev.zeus", []); G.events.moodle = E.store.get("ev.moodle", []); G.tasks = E.store.get("tasks", []); };
  G.refresh = async (force) => {
    const res = {};
    for (const src of ["zeus", "moodle"]) {
      if (!N.vault.has("ics_" + src)) { res[src] = "none"; continue; }
      const last = E.store.get("ev.t." + src, 0);
      if (!force && Date.now() - last < TTL && G.events[src].length) { res[src] = "cache"; continue; }
      try {
        const r = await N.fetch({ provider: src, path: "/" });
        if (r.status !== 200 || !/BEGIN:VCALENDAR/.test(r.text.slice(0, 500))) throw new Error("HTTP " + r.status);
        G.events[src] = G.parseICS(r.text);
        E.store.set("ev." + src, G.events[src]);
        E.store.set("ev.t." + src, Date.now());
        res[src] = "ok";
      } catch (e) { res[src] = "error"; }                                   // hors ligne / lien expiré : on garde le cache
    }
    E.emit("agenda", res);
    return res;
  };

  // ------------------------------------------------------------------ tâches locales
  const save = () => { E.store.set("tasks", G.tasks); E.emit("agenda", {}); };
  const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(5))).map((b) => b.toString(16).padStart(2, "0")).join("");
  G.addTask = (title, due) => { G.tasks.push({ id: rid(), title: title.trim().slice(0, 200), due: due || "", notes: "", done: false, created: new Date().toISOString().slice(0, 19), updated: Date.now() / 1000, dirty: true }); save(); G.syncSoon(); };
  G.toggleTask = (id) => { const t = G.tasks.find((x) => x.id === id); if (t) { t.done = !t.done; t.updated = Date.now() / 1000; t.dirty = true; save(); G.syncSoon(); } };
  G.deleteTask = (id) => { const t = G.tasks.find((x) => x.id === id); if (t) { Object.assign(t, { deleted: true, title: "", notes: "", updated: Date.now() / 1000, dirty: true }); save(); G.syncSoon(); } };
  G.liveTasks = () => G.tasks.filter((t) => !t.deleted);

  // ------------------------------------------------------------------ vue unifiée (jour / à rendre)
  G.items = (fromStr, toStr) => {
    const out = [];
    G.events.zeus.forEach((e) => out.push({ ...e, source: "zeus" }));
    G.events.moodle.forEach((e) => out.push({ ...e, source: "moodle", kind: "deadline" }));
    G.liveTasks().filter((t) => t.due).forEach((t) => out.push({ uid: t.id, id: t.id, title: t.title, start: t.due, end: t.due, allDay: false, location: "", source: "manual", kind: "task", done: t.done }));
    return out.filter((i) => i.start >= fromStr && i.start < toStr).sort((a, b) => (a.start < b.start ? -1 : 1));
  };

  // ------------------------------------------------------------------ synchro avec le PC
  let syncing = false, soon = 0;
  G.syncSoon = () => { clearTimeout(soon); soon = setTimeout(G.sync, 1500); };
  G.sync = async () => {
    if (syncing || E.link.state !== "online") return { skipped: true };
    syncing = true;
    try {
      const since = E.store.get("sync.since", 0);                       // horloge du PC au dernier échange
      const off = E.link.offset || 0;
      const outgoing = G.tasks.filter((t) => t.dirty).map((t) => ({ ...t, dirty: undefined, updated: t.updated + off }));
      const r = await E.link.api("/api/agenda/sync", { method: "POST", body: { since, tasks: outgoing } });
      if (r.status !== 200) throw new Error("HTTP " + r.status);
      const j = r.json();
      const sentIds = new Set(outgoing.map((t) => t.id));
      G.tasks.forEach((t) => { if (sentIds.has(t.id)) delete t.dirty; });
      for (const c of j.tasks || []) {                                  // changements du PC : appliqués s'ils sont plus récents que la copie locale
        const cur = G.tasks.find((t) => t.id === c.id);
        const cu = (c.updated || 0) - off;
        if (!cur) G.tasks.push({ ...c, updated: cu });
        else if (cu > cur.updated) Object.assign(cur, c, { updated: cu });
      }
      G.tasks = G.tasks.filter((t) => !(t.deleted && !t.dirty && Date.now() / 1000 - t.updated > 30 * 86400));
      E.store.set("sync.since", j.now);
      save();
      return { sent: outgoing.length, received: (j.tasks || []).length };
    } catch (e) { return { error: e.message }; } finally { syncing = false; }
  };
  E.on("link", (l) => { if (l.state === "online") G.sync(); });
})();
