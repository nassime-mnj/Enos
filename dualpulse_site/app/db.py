"""Base SQLite : liste blanche des IP développeur, journal des téléchargements, questions posées à l'assistant."""
import os
import sqlite3
import threading
import time

from . import whitelist

_lock = threading.RLock()
_conn = None


def path():
    return os.environ.get("DP_DB") or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "dualpulse.db")


def database_url():
    """DP_DATABASE_URL (PostgreSQL / Supabase) : base hébergée, indispensable sur un hébergeur au disque éphémère (Render, Railway). Sinon : fichier SQLite local."""
    return os.environ.get("DP_DATABASE_URL", "").strip()


def conn():
    global _conn
    with _lock:
        if _conn is None:
            if database_url():
                from . import dbcompat
                _conn = dbcompat.PgConn(database_url())
            else:
                os.makedirs(os.path.dirname(path()), exist_ok=True)
                _conn = sqlite3.connect(path(), check_same_thread=False)
                _conn.row_factory = sqlite3.Row
            _conn.executescript("""
              CREATE TABLE IF NOT EXISTS dev_ips(entry TEXT PRIMARY KEY, label TEXT NOT NULL, added_at REAL NOT NULL, expires_at REAL, last_seen REAL);
              CREATE TABLE IF NOT EXISTS downloads(id INTEGER PRIMARY KEY AUTOINCREMENT, t REAL NOT NULL, entry TEXT, ip TEXT, ok INTEGER NOT NULL);
              CREATE TABLE IF NOT EXISTS support_log(id INTEGER PRIMARY KEY AUTOINCREMENT, t REAL NOT NULL, question TEXT NOT NULL, matched TEXT);
              CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL DEFAULT '', pw_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('friends','dev','ceo')), active INTEGER NOT NULL DEFAULT 1, created_at REAL NOT NULL, last_login REAL,
                token_version INTEGER NOT NULL DEFAULT 0, fails INTEGER NOT NULL DEFAULT 0, locked_until REAL NOT NULL DEFAULT 0,
                totp_secret TEXT, totp_enabled INTEGER NOT NULL DEFAULT 0, totp_last INTEGER NOT NULL DEFAULT 0, invited_by INTEGER);
              CREATE TABLE IF NOT EXISTS refresh_tokens(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, token_hash TEXT NOT NULL UNIQUE, family TEXT NOT NULL,
                created_at REAL NOT NULL, expires_at REAL NOT NULL, used INTEGER NOT NULL DEFAULT 0, revoked INTEGER NOT NULL DEFAULT 0, device TEXT NOT NULL DEFAULT '', ip TEXT);
              CREATE TABLE IF NOT EXISTS invites(id INTEGER PRIMARY KEY AUTOINCREMENT, code_hash TEXT NOT NULL UNIQUE, role TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_by INTEGER NOT NULL,
                created_at REAL NOT NULL, expires_at REAL NOT NULL, used_by INTEGER, used_at REAL, revoked INTEGER NOT NULL DEFAULT 0);
              CREATE TABLE IF NOT EXISTS releases(id INTEGER PRIMARY KEY AUTOINCREMENT, product TEXT NOT NULL, channel TEXT NOT NULL, version TEXT NOT NULL, manifest TEXT NOT NULL,
                signature TEXT NOT NULL, published_at REAL NOT NULL, yanked INTEGER NOT NULL DEFAULT 0, UNIQUE(product, channel, version));
              CREATE TABLE IF NOT EXISTS launcher_downloads(id INTEGER PRIMARY KEY AUTOINCREMENT, t REAL NOT NULL, user_id INTEGER, product TEXT, channel TEXT, version TEXT, file TEXT, ip TEXT);
              CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS news(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', image TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '',
                kind TEXT NOT NULL DEFAULT 'news', min_role TEXT NOT NULL DEFAULT 'public', priority INTEGER NOT NULL DEFAULT 0, starts_at REAL, ends_at REAL, created_at REAL NOT NULL, active INTEGER NOT NULL DEFAULT 1);
              CREATE TABLE IF NOT EXISTS wishlist(id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE COLLATE NOCASE, created_at REAL NOT NULL, ip TEXT);
              CREATE TABLE IF NOT EXISTS clipboard(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, device TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL, mime TEXT NOT NULL DEFAULT '',
                content TEXT NOT NULL, created_at REAL NOT NULL);
              CREATE INDEX IF NOT EXISTS clipboard_user ON clipboard(user_id, id);
              CREATE TABLE IF NOT EXISTS agenda_tasks(user_id INTEGER NOT NULL, task_id TEXT NOT NULL, data TEXT NOT NULL, updated REAL NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id, task_id));
              CREATE TABLE IF NOT EXISTS update_tokens(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, token_hash TEXT NOT NULL UNIQUE, device TEXT NOT NULL DEFAULT '',
                created_at REAL NOT NULL, expires_at REAL NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, last_used REAL);
              CREATE TABLE IF NOT EXISTS mobile_devices(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, device_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', platform TEXT NOT NULL DEFAULT '',
                lan_ips TEXT NOT NULL DEFAULT '[]', adb_port INTEGER NOT NULL DEFAULT 0, app_version TEXT NOT NULL DEFAULT '', last_seen REAL NOT NULL, UNIQUE(user_id, device_id));
            """)
            _conn.commit()
            seed()
        return _conn


def reset():
    """Pour les tests : referme la connexion (le prochain accès rouvre DP_DB)."""
    global _conn
    with _lock:
        if _conn:
            _conn.close()
        _conn = None


def seed():
    """DP_SEED_IPS='1.2.3.4=Nassime,5.6.7.8=Raf' : IP ajoutées au premier démarrage (ensuite, tout se gère dans l'administration)."""
    for part in os.environ.get("DP_SEED_IPS", "").split(","):
        if "=" in part:
            ip, label = part.split("=", 1)
            try:
                add_ip(ip, label, None, _seed=True)
            except ValueError:
                pass


def add_ip(value, label, days=None, _seed=False):
    entry = whitelist.parse_entry(value)
    if not entry:
        raise ValueError("Adresse IP ou réseau CIDR invalide (réseaux plus larges que /16 refusés).")
    label = (label or "").strip()[:60] or "Sans nom"
    exp = time.time() + days * 86400 if days else None
    c = _conn if _seed else conn()
    with _lock:
        if _seed and c.execute("SELECT 1 FROM dev_ips WHERE entry=?", (entry,)).fetchone():
            return entry
        c.execute("INSERT INTO dev_ips(entry,label,added_at,expires_at) VALUES(?,?,?,?) ON CONFLICT(entry) DO UPDATE SET label=excluded.label, expires_at=excluded.expires_at",
                  (entry, label, time.time(), exp))
        c.commit()
    return entry


def remove_ip(entry):
    with _lock:
        n = conn().execute("DELETE FROM dev_ips WHERE entry=?", (entry,)).rowcount
        conn().commit()
        return n > 0


def list_ips():
    with _lock:
        return [dict(r) for r in conn().execute("SELECT entry,label,added_at,expires_at,last_seen FROM dev_ips ORDER BY added_at")]


def match_dev(ip):
    """Entrée de liste blanche correspondant à cette IP (non expirée), sinon None."""
    if ip is None:
        return None
    now = time.time()
    with _lock:
        rows = conn().execute("SELECT entry,expires_at FROM dev_ips").fetchall()
        for r in rows:
            if r["expires_at"] and r["expires_at"] < now:
                continue
            if whitelist.matches(r["entry"], ip):
                conn().execute("UPDATE dev_ips SET last_seen=? WHERE entry=? AND (last_seen IS NULL OR last_seen<?)", (now, r["entry"], now - 60))
                conn().commit()
                return r["entry"]
    return None


def purge_expired():
    with _lock:
        conn().execute("DELETE FROM dev_ips WHERE expires_at IS NOT NULL AND expires_at<?", (time.time(),))
        conn().commit()


def log_download(entry, ip, ok):
    with _lock:
        conn().execute("INSERT INTO downloads(t,entry,ip,ok) VALUES(?,?,?,?)", (time.time(), entry, str(ip), 1 if ok else 0))
        conn().commit()


def downloads(limit=50):
    with _lock:
        return [dict(r) for r in conn().execute("SELECT t,entry,ip,ok FROM downloads ORDER BY id DESC LIMIT ?", (limit,))]


def log_question(q, matched):
    with _lock:
        conn().execute("INSERT INTO support_log(t,question,matched) VALUES(?,?,?)", (time.time(), q[:500], matched))
        conn().commit()
