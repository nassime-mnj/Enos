"""STATISTIQUES : anonymes, avec accord explicite (désactivées par défaut dans l'application), et tableau de bord du CEO.

  - L'application envoie au plus un rapport par jour : identifiant d'installation ALÉATOIRE (jamais lié au compte, haché ici avec un sel du
    serveur), version, offre, nombre d'ouvertures par module. Aucune donnée personnelle, aucune adresse IP conservée.
  - GET /eto/admin/stats (CEO) : comptes par offre, inscriptions, revenu mensuel estimé, clés, équipes, IA, installations actives et modules
    les plus ouverts sur 30 jours.
"""
import hashlib
import json
import os
import re
import time

from fastapi import Depends, Request
from pydantic import BaseModel, Field

from .. import db
from . import eto, limits, service

DAY = 86400
MOD_RE = re.compile(r"^[a-z0-9@:_-]{1,40}$")


def _salt():
    return os.environ.get("DP_METRICS_SALT") or hashlib.sha256(service.signing_key().private_bytes_raw()).hexdigest()[:32]


class MetricsIn(BaseModel):
    install: str = Field(min_length=16, max_length=64)
    version: str = Field(default="", max_length=20)
    plan: str = Field(default="", max_length=20)
    modules: dict = Field(default_factory=dict)


def record(b: MetricsIn):
    day = time.strftime("%Y-%m-%d", time.gmtime())
    h = hashlib.sha256((_salt() + ":" + b.install).encode()).hexdigest()[:24]
    mods = {}
    for k, v in list((b.modules or {}).items())[:80]:
        if MOD_RE.match(str(k)) and isinstance(v, int) and 0 < v < 10000:
            mods[str(k)] = v
    plan = b.plan if b.plan in eto.PLANS or b.plan in eto.STAFF_PLAN.values() else ""
    with db._lock:
        db.conn().execute("""INSERT INTO eto_metrics(day,install,version,plan,data) VALUES(?,?,?,?,?)
                             ON CONFLICT(day,install) DO UPDATE SET version=excluded.version, plan=excluded.plan, data=excluded.data""",
                          (day, h, re.sub(r"[^0-9A-Za-z.\-]", "", b.version)[:20], plan, json.dumps(mods)))
        db.conn().commit()
    return {"ok": True}


def stats():
    now = time.time()
    with db._lock:
        c = db.conn()
        users = c.execute("SELECT role, COUNT(*) AS n FROM users GROUP BY role").fetchall()
        public = [dict(x) for x in c.execute("SELECT id, role, token_version, email, created_at FROM users WHERE role='public'").fetchall()]
        signups = [r["d"] for r in c.execute("SELECT created_at AS d FROM users WHERE role='public' AND created_at>=?", (now - 30 * DAY,)).fetchall()]
        keys = c.execute("SELECT COUNT(*) AS n, COALESCE(SUM(uses),0) AS u FROM eto_keys").fetchone()
        teams = c.execute("SELECT COUNT(*) AS n FROM eto_teams").fetchone()["n"]
        ai = c.execute("SELECT COUNT(*) AS n FROM eto_ai_keys WHERE disabled=0").fetchone()["n"]
        devices = c.execute("SELECT COUNT(*) AS n FROM eto_fleet_health WHERE t>=?", (now - 7 * DAY,)).fetchone()["n"]
        since = time.strftime("%Y-%m-%d", time.gmtime(now - 29 * DAY))
        met = [dict(x) for x in c.execute("SELECT day, install, version, plan, data FROM eto_metrics WHERE day>=?", (since,)).fetchall()]
    by_plan, mrr = {p: 0 for p in eto.PLANS}, 0.0
    for u in public:
        s = eto.subscription(dict(u, id=u["id"]))
        by_plan[s["plan"]] = by_plan.get(s["plan"], 0) + 1
        if s["source"] in ("stripe", "play") and s["plan"] in eto.PRICES:
            m, y = eto.PRICES[s["plan"]]
            mrr += y / 12 if s.get("period") == "year" else m
    days = [time.strftime("%Y-%m-%d", time.gmtime(now - (29 - i) * DAY)) for i in range(30)]
    dau = {d: set() for d in days}
    mods, versions = {}, {}
    for m in met:
        if m["day"] in dau:
            dau[m["day"]].add(m["install"])
        for k, v in json.loads(m["data"] or "{}").items():
            mods[k] = mods.get(k, 0) + v
    for m in met:
        if m["day"] == days[-1] and m["version"]:
            versions[m["version"]] = versions.get(m["version"], 0) + 1
    return {"accounts": {r["role"]: r["n"] for r in users}, "plans": by_plan, "signups_30d": len(signups),
            "signups_daily": [sum(1 for t in signups if time.strftime("%Y-%m-%d", time.gmtime(t)) == d) for d in days],
            "mrr_eur": round(mrr, 2), "keys": {"created": keys["n"], "redeemed": keys["u"]}, "teams": teams, "ai_keys": ai, "devices_7d": devices,
            "days": days, "active_installs": [len(dau[d]) for d in days], "installs_30d": len({m["install"] for m in met}),
            "top_modules": sorted(mods.items(), key=lambda x: -x[1])[:12], "versions_today": versions}


def routes(r, current_user, require, ip_of):
    V = eto.V1

    @r.post(V + "/metrics")
    def metrics_in(b: MetricsIn, request: Request):
        if not limits.ok("etometrics", ip_of(request), 30, per=3600):
            raise service.AuthError(429, "Trop de rapports.")
        return record(b)

    @r.get(V + "/admin/stats")
    def admin_stats(u=Depends(require("ceo"))):
        return stats()
