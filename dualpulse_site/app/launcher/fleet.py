"""ETO FLEET (ETO Ultra) : une équipe, ses places, la santé de ses appareils et des commandes à distance SÛRES.

  - Équipe : créée par un compte ETO Ultra (propriétaire) ; 10 places (propriétaire compris), 25 appareils. Les membres profitent d'ETO Ultra
    tant que le propriétaire est abonné (eto.subscription -> source « team »).
  - Invitations : code ETO-TEAM-XXXX-XXXX-XXXX (empreinte SHA-256 seulement, nombre d'utilisations, expiration), révocables.
  - Santé : chaque application connectée envoie un « pouls » (batterie, charge, stockage, version, plantages récents, réseau) ; la console
    calcule l'état (en ligne < 20 min) et des alertes (stockage < 10 %, batterie faible hors charge, version en retard, plantages).
  - Commandes : liste FERMÉE et sans danger (ping, relire la licence, message, chercher une mise à jour, lancer une préparation du Mobile
    Improver) ; l'appareil les récupère avec son pouls, les exécute et rend compte ; elles expirent au bout de 24 h. Aucune commande ne lit
    de fichier, ne supprime quoi que ce soit ni n'exécute de code.
"""
import hashlib
import json
import secrets
import time

from fastapi import Depends
from pydantic import BaseModel, Field

from .. import db
from . import eto, limits, service

ONLINE_S = 20 * 60
MAX_DEVICES = 25
CMDS = {"ping": "Ping", "sync_license": "Relire la licence", "message": "Message", "update_check": "Chercher une mise à jour", "improver_run": "Préparer le Mobile Improver"}
CMD_TTL = 24 * 3600


def _c():
    return db.conn()


def now():
    return time.time()


def _team_of(uid):
    with db._lock:
        r = _c().execute("SELECT t.*, m.role AS my_role FROM eto_team_members m JOIN eto_teams t ON t.id=m.team_id WHERE m.user_id=?", (uid,)).fetchone()
    return dict(r) if r else None


def team_plan(uid):
    """Offre apportée par l'équipe : ETO Ultra si le propriétaire l'est (abonnement PROPRE, sans passer par une équipe). Sinon None."""
    t = _team_of(uid)
    if not t or t["owner_id"] == uid:
        return None
    owner = service.get_user(t["owner_id"])
    if not owner:
        return None
    s = eto.subscription(owner, team=False)
    return s if s["plan"] == "eto_ultra" or owner["role"] in eto.STAFF_PLAN else None


def _require_admin(u):
    t = _team_of(u["id"])
    if not t:
        raise service.AuthError(404, "Tu n'as pas d'équipe.")
    if t["my_role"] not in ("owner", "admin"):
        raise service.AuthError(403, "Réservé au propriétaire et aux administrateurs de l'équipe.")
    return t


def create_team(u, name):
    if "fleet" not in eto.features_of(eto.subscription(u)["plan"]) or eto.subscription(u)["source"] == "team":
        raise service.AuthError(403, "Créer une équipe demande ETO Ultra.")
    if _team_of(u["id"]):
        raise service.AuthError(409, "Tu fais déjà partie d'une équipe.")
    with db._lock:
        cur = _c().execute("INSERT INTO eto_teams(owner_id,name,seats,created) VALUES(?,?,?,?)", (u["id"], (name or "Mon équipe").strip()[:60], eto.SEATS["eto_ultra"], now()))
        tid = cur.lastrowid
        _c().execute("INSERT INTO eto_team_members(team_id,user_id,role,joined) VALUES(?,?,?,?)", (tid, u["id"], "owner", now()))
        _c().commit()
    eto.log(u["id"], "team_created", {"team": tid})
    return console(u)


def _code_hash(c):
    return hashlib.sha256(("eto-team:" + c).encode()).hexdigest()


def _norm(code):
    c = "".join(ch for ch in str(code or "").upper() if ch.isalnum())
    return c[7:] if c.startswith("ETOTEAM") else c


def invite(u, max_uses=1, days=7):
    t = _require_admin(u)
    body = "".join(secrets.choice(eto.ALPHA) for _ in range(12))
    with db._lock:
        _c().execute("INSERT INTO eto_team_invites(code_hash,team_id,created,expires,uses,max_uses,revoked) VALUES(?,?,?,?,0,?,0)",
                     (_code_hash(body), t["id"], now(), now() + days * 86400, max_uses))
        _c().commit()
    return {"code": "ETO-TEAM-" + "-".join(body[i:i + 4] for i in range(0, 12, 4)), "max_uses": max_uses, "expires": int(now() + days * 86400)}


def join(u, code):
    if _team_of(u["id"]):
        raise service.AuthError(409, "Tu fais déjà partie d'une équipe : quitte-la d'abord.")
    h = _code_hash(_norm(code))
    with db._lock:
        c = _c()
        inv = c.execute("SELECT * FROM eto_team_invites WHERE code_hash=?", (h,)).fetchone()
        if not inv or inv["revoked"] or inv["expires"] < now():
            raise service.AuthError(404, "Invitation inconnue ou expirée.")
        t = c.execute("SELECT * FROM eto_teams WHERE id=?", (inv["team_id"],)).fetchone()
        n = c.execute("SELECT COUNT(*) AS n FROM eto_team_members WHERE team_id=?", (t["id"],)).fetchone()["n"]
        if n >= t["seats"]:
            raise service.AuthError(409, "L'équipe est complète (%d places)." % t["seats"])
        if c.execute("UPDATE eto_team_invites SET uses=uses+1 WHERE code_hash=? AND uses<max_uses", (h,)).rowcount != 1:
            raise service.AuthError(410, "Cette invitation a déjà servi.")
        c.execute("INSERT INTO eto_team_members(team_id,user_id,role,joined) VALUES(?,?,?,?)", (t["id"], u["id"], "member", now()))
        c.commit()
    eto.log(u["id"], "team_joined", {"team": t["id"]})
    return {"team": t["name"], "subscription": eto.subscription(service.get_user(u["id"]))}


def leave(u):
    t = _team_of(u["id"])
    if not t:
        raise service.AuthError(404, "Tu n'as pas d'équipe.")
    if t["my_role"] == "owner":
        raise service.AuthError(409, "Le propriétaire ne quitte pas son équipe : il peut la supprimer.")
    with db._lock:
        _c().execute("DELETE FROM eto_team_members WHERE user_id=?", (u["id"],))
        _c().commit()
    return {"left": True}


def remove_member(u, email):
    t = _require_admin(u)
    m = service.user_by_email(email)
    if not m:
        raise service.AuthError(404, "Membre introuvable.")
    with db._lock:
        r = _c().execute("SELECT role FROM eto_team_members WHERE team_id=? AND user_id=?", (t["id"], m["id"])).fetchone()
        if not r:
            raise service.AuthError(404, "Membre introuvable.")
        if r["role"] == "owner":
            raise service.AuthError(409, "Le propriétaire ne peut pas être retiré.")
        _c().execute("DELETE FROM eto_team_members WHERE team_id=? AND user_id=?", (t["id"], m["id"]))
        _c().commit()
    eto.log(u["id"], "team_member_removed", {"team": t["id"], "member": m["id"]})
    return console(u)


def set_role(u, email, role):
    t = _team_of(u["id"])
    if not t or t["my_role"] != "owner":
        raise service.AuthError(403, "Réservé au propriétaire de l'équipe.")
    if role not in ("admin", "member"):
        raise service.AuthError(400, "Rôle inconnu.")
    m = service.user_by_email(email)
    with db._lock:
        n = _c().execute("UPDATE eto_team_members SET role=? WHERE team_id=? AND user_id=? AND role<>'owner'", (role, t["id"], m["id"] if m else -1)).rowcount
        _c().commit()
    if not n:
        raise service.AuthError(404, "Membre introuvable.")
    return console(u)


def delete_team(u):
    t = _team_of(u["id"])
    if not t or t["my_role"] != "owner":
        raise service.AuthError(403, "Réservé au propriétaire de l'équipe.")
    with db._lock:
        for tbl in ("eto_team_members", "eto_team_invites", "eto_fleet_cmds"):
            _c().execute("DELETE FROM %s WHERE team_id=?" % tbl, (t["id"],))
        _c().execute("DELETE FROM eto_teams WHERE id=?", (t["id"],))
        _c().commit()
    return {"deleted": True}


# ---------------------------------------------------------------- santé + commandes
def beat(u, b):
    """Pouls d'un appareil (tout compte ETO connecté) ; renvoie les commandes en attente pour lui."""
    did = str(b.get("device_id") or "")[:64]
    if not did:
        raise service.AuthError(400, "Appareil inconnu.")
    keep = {k: b.get(k) for k in ("name", "platform", "app_version", "battery", "charging", "storage_free", "storage_total", "net", "os", "crashes_24h", "model", "improver_saved")}
    keep["name"] = str(keep.get("name") or "Téléphone")[:40]
    with db._lock:
        c = _c()
        known = c.execute("SELECT 1 FROM eto_fleet_health WHERE user_id=? AND device_id=?", (u["id"], did)).fetchone()
        t = _team_of(u["id"])
        if not known and t:
            n = c.execute("SELECT COUNT(*) AS n FROM eto_fleet_health h JOIN eto_team_members m ON m.user_id=h.user_id WHERE m.team_id=?", (t["id"],)).fetchone()["n"]
            if n >= MAX_DEVICES:
                raise service.AuthError(409, "Limite de %d appareils atteinte pour l'équipe." % MAX_DEVICES)
        c.execute("""INSERT INTO eto_fleet_health(user_id,device_id,t,data) VALUES(?,?,?,?)
                     ON CONFLICT(user_id,device_id) DO UPDATE SET t=excluded.t, data=excluded.data""", (u["id"], did, now(), json.dumps(keep)[:4000]))
        c.execute("UPDATE eto_fleet_cmds SET status='expired' WHERE status='pending' AND created<?", (now() - CMD_TTL,))
        cmds = [dict(x) for x in c.execute("SELECT id,cmd,args FROM eto_fleet_cmds WHERE target_user=? AND target_device=? AND status='pending' ORDER BY id", (u["id"], did)).fetchall()]
        c.commit()
    for x in cmds:
        x["args"] = json.loads(x["args"] or "{}")
    return {"ok": True, "commands": cmds}


def cmd_done(u, cid, ok, result):
    with db._lock:
        n = _c().execute("UPDATE eto_fleet_cmds SET status=?, result=?, done_t=? WHERE id=? AND target_user=? AND status='pending'",
                         ("done" if ok else "failed", str(result or "")[:300], now(), cid, u["id"])).rowcount
        _c().commit()
    return {"ok": bool(n)}


def send_cmd(u, email, device_id, cmd, args):
    t = _require_admin(u)
    if cmd not in CMDS:
        raise service.AuthError(400, "Commande non autorisée.")
    m = service.user_by_email(email)
    with db._lock:
        c = _c()
        if not m or not c.execute("SELECT 1 FROM eto_team_members WHERE team_id=? AND user_id=?", (t["id"], m["id"])).fetchone():
            raise service.AuthError(404, "Cet appareil n'appartient pas à l'équipe.")
        if not c.execute("SELECT 1 FROM eto_fleet_health WHERE user_id=? AND device_id=?", (m["id"], device_id)).fetchone():
            raise service.AuthError(404, "Appareil inconnu.")
        a = {"text": str((args or {}).get("text") or "")[:280]} if cmd == "message" else {}
        cur = c.execute("INSERT INTO eto_fleet_cmds(team_id,target_user,target_device,cmd,args,created_by,created,status,result) VALUES(?,?,?,?,?,?,?,'pending','')",
                        (t["id"], m["id"], device_id, cmd, json.dumps(a), u["id"], now()))
        c.commit()
    eto.log(u["id"], "fleet_cmd", {"cmd": cmd, "device": device_id})
    return {"id": cur.lastrowid, "status": "pending"}


def _alerts(d, latest):
    out = []
    tot, free = d.get("storage_total") or 0, d.get("storage_free") or 0
    if tot and free / tot < 0.10:
        out.append(("storage", "Stockage presque plein (%d %% libre)" % round(free / tot * 100)))
    if isinstance(d.get("battery"), (int, float)) and d["battery"] < 0.15 and not d.get("charging"):
        out.append(("battery", "Batterie faible (%d %%)" % round(d["battery"] * 100)))
    if (d.get("crashes_24h") or 0) > 0:
        out.append(("crash", "%d plantage(s) en 24 h" % d["crashes_24h"]))
    if latest and d.get("app_version") and str(d["app_version"]) != latest:
        out.append(("version", "Version %s (dernière : %s)" % (d["app_version"], latest)))
    return [{"kind": k, "text": t} for k, t in out]


def console(u):
    t = _team_of(u["id"])
    if not t:
        return {"team": None, "can_create": "fleet" in eto.features_of(eto.subscription(u)["plan"]) and eto.subscription(u)["source"] != "team"}
    admin = t["my_role"] in ("owner", "admin")
    with db._lock:
        c = _c()
        mem = [dict(x) for x in c.execute("SELECT u.id, u.email, u.name, m.role, m.joined FROM eto_team_members m JOIN users u ON u.id=m.user_id WHERE m.team_id=? ORDER BY m.joined", (t["id"],)).fetchall()]
        ids = [m["id"] for m in mem] if admin else [u["id"]]
        q = "SELECT * FROM eto_fleet_health WHERE user_id IN (%s) ORDER BY t DESC" % ",".join("?" * len(ids))
        devs = [dict(x) for x in c.execute(q, ids).fetchall()]
        cmds = [dict(x) for x in c.execute("SELECT id,target_user,target_device,cmd,status,result,created,done_t FROM eto_fleet_cmds WHERE team_id=? ORDER BY id DESC LIMIT 30", (t["id"],)).fetchall()] if admin else []
    versions = sorted({json.loads(d["data"]).get("app_version") or "" for d in devs} - {""}, key=lambda v: [int(x) if x.isdigit() else 0 for x in str(v).split(".")])
    latest = versions[-1] if versions else ""
    by = {m["id"]: m["email"] for m in mem}
    out_devs = []
    for d in devs:
        data = json.loads(d["data"])
        out_devs.append({"email": by.get(d["user_id"], ""), "device_id": d["device_id"], "seen": int(d["t"]), "online": now() - d["t"] < ONLINE_S, "data": data, "alerts": _alerts(data, latest)})
    owner = service.get_user(t["owner_id"])
    return {"team": {"name": t["name"], "seats": t["seats"], "used": len(mem), "role": t["my_role"], "owner": owner["email"] if owner else "",
                     "active": bool(owner and (eto.subscription(owner, team=False)["plan"] == "eto_ultra" or owner["role"] in eto.STAFF_PLAN))},
            "members": [{"email": m["email"], "name": m["name"], "role": m["role"], "joined": int(m["joined"])} for m in mem] if admin else [],
            "devices": out_devs, "commands": [dict(x, target=by.get(x["target_user"], "")) for x in cmds], "catalog": CMDS, "max_devices": MAX_DEVICES}


# ---------------------------------------------------------------- routes
class TeamIn(BaseModel):
    name: str = Field(default="Mon équipe", max_length=60)


class InviteIn(BaseModel):
    max_uses: int = Field(default=1, ge=1, le=50)
    days: int = Field(default=7, ge=1, le=90)


class JoinIn(BaseModel):
    code: str = Field(max_length=40)


class MemberIn(BaseModel):
    email: str = Field(max_length=254)
    role: str = Field(default="member", max_length=10)


class BeatIn(BaseModel):
    device_id: str = Field(max_length=64)
    name: str = Field(default="", max_length=40)
    platform: str = Field(default="android", max_length=20)
    app_version: str = Field(default="", max_length=20)
    battery: float | None = None
    charging: bool | None = None
    storage_free: int | None = None
    storage_total: int | None = None
    net: str = Field(default="", max_length=20)
    os: str = Field(default="", max_length=40)
    model: str = Field(default="", max_length=60)
    crashes_24h: int = Field(default=0, ge=0, le=10000)
    improver_saved: int = Field(default=0, ge=0)


class CmdIn(BaseModel):
    email: str = Field(max_length=254)
    device_id: str = Field(max_length=64)
    cmd: str = Field(max_length=20)
    args: dict = Field(default_factory=dict)


class DoneIn(BaseModel):
    ok: bool = True
    result: str = Field(default="", max_length=300)


def routes(r, current_user, require, ip_of):
    V = eto.V1 + "/fleet"

    @r.get(V)
    def fleet_console(u=Depends(current_user)):
        return console(u)

    @r.post(V + "/team")
    def fleet_create(b: TeamIn, u=Depends(current_user)):
        return create_team(u, b.name)

    @r.delete(V + "/team")
    def fleet_delete(u=Depends(current_user)):
        return delete_team(u)

    @r.post(V + "/invite")
    def fleet_invite(b: InviteIn, u=Depends(current_user)):
        return invite(u, b.max_uses, b.days)

    @r.post(V + "/join")
    def fleet_join(b: JoinIn, u=Depends(current_user)):
        if not limits.ok("etoteam", u["id"], 10, per=3600):
            raise service.AuthError(429, "Trop d'essais : réessaie dans une heure.")
        return join(u, b.code)

    @r.post(V + "/leave")
    def fleet_leave(u=Depends(current_user)):
        return leave(u)

    @r.post(V + "/member/remove")
    def fleet_remove(b: MemberIn, u=Depends(current_user)):
        return remove_member(u, b.email)

    @r.post(V + "/member/role")
    def fleet_role(b: MemberIn, u=Depends(current_user)):
        return set_role(u, b.email, b.role)

    @r.post(V + "/beat")
    def fleet_beat(b: BeatIn, u=Depends(current_user)):
        if not limits.ok("etobeat", u["id"], 120, per=3600):
            raise service.AuthError(429, "Trop de pouls.")
        return beat(u, b.model_dump())

    @r.post(V + "/cmd")
    def fleet_cmd(b: CmdIn, u=Depends(current_user)):
        return send_cmd(u, b.email, b.device_id, b.cmd, b.args)

    @r.post(V + "/cmd/{cid}/done")
    def fleet_done(cid: int, b: DoneIn, u=Depends(current_user)):
        return cmd_done(u, cid, b.ok, b.result)
