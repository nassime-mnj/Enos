"""Adaptateur PostgreSQL (Supabase) qui reproduit la petite partie de l'API sqlite3 utilisée par le site : execute / executescript / commit,
lignes accessibles par nom OU par indice, lastrowid. Le code métier (db.py, launcher/service.py) reste écrit une seule fois, avec des « ? ».

Activé par DP_DATABASE_URL (ex. l'URI « Connection pooling » de Supabase). Prévu pour le pooler en mode transaction : pas de requêtes préparées."""
import re
import threading

SERIAL_TABLES = {"downloads", "support_log", "users", "refresh_tokens", "invites", "releases", "launcher_downloads", "news", "wishlist", "clipboard", "mobile_devices", "update_tokens"}
_INSERT = re.compile(r"^\s*INSERT\s+(OR\s+IGNORE\s+)?INTO\s+([a-z_]+)", re.I)


class Row(dict):
    """Ligne : r["col"], r[0], dict(r), r.keys() — comme sqlite3.Row."""
    def __getitem__(self, k):
        return list(self.values())[k] if isinstance(k, int) else super().__getitem__(k)


def row_factory(cursor):
    from psycopg.rows import dict_row
    make = dict_row(cursor)
    return lambda values: Row(make(values))


class Cur:
    def __init__(self, cur, lastrowid=None):
        self._c, self.lastrowid = cur, lastrowid

    @property
    def rowcount(self):
        return self._c.rowcount

    def fetchone(self):
        return self._c.fetchone() if self._c.description else None

    def fetchall(self):
        return self._c.fetchall() if self._c.description else []

    def __iter__(self):
        return iter(self.fetchall())


def translate(sql):
    """SQL « sqlite » -> PostgreSQL. Retourne (sql, veut_lastrowid)."""
    want = False
    m = _INSERT.match(sql)
    out = sql.replace("?", "%s")
    if m:
        ignore, table = bool(m.group(1)), m.group(2).lower()
        if ignore:
            out = re.sub(r"^\s*INSERT\s+OR\s+IGNORE\s+INTO", "INSERT INTO", out, flags=re.I) + " ON CONFLICT DO NOTHING"
        if table in SERIAL_TABLES and "RETURNING" not in out.upper():
            out += " RETURNING id"
            want = True
    return out, want


def schema_to_pg(script):
    s = script.replace("INTEGER PRIMARY KEY AUTOINCREMENT", "BIGSERIAL PRIMARY KEY").replace("TEXT NOT NULL UNIQUE COLLATE NOCASE", "CITEXT NOT NULL UNIQUE")
    s = re.sub(r"\bREAL\b", "DOUBLE PRECISION", s)
    s = re.sub(r"\bBLOB\b", "BYTEA", s)
    return "CREATE EXTENSION IF NOT EXISTS citext;\n" + s


class PgConn:
    def __init__(self, url):
        self.url = url
        self._lock = threading.RLock()
        self._c = None
        self._open()

    def _open(self):
        import psycopg
        self._c = psycopg.connect(self.url, autocommit=False, prepare_threshold=None, connect_timeout=15)
        self._c.row_factory = row_factory

    def _run(self, fn):
        import psycopg
        try:
            return fn()
        except psycopg.OperationalError:                         # connexion coupée (pooler, veille de l'hébergeur) : une reconnexion puis on rejoue
            try:
                self._c.close()
            except Exception:                                     # noqa: BLE001
                pass
            self._open()
            return fn()

    def execute(self, sql, params=()):
        out, want = translate(sql)

        def go():
            try:
                cur = self._c.execute(out, tuple(params))
            except Exception:
                try:
                    self._c.rollback()                            # une requête en erreur ne doit pas laisser la transaction bloquée
                except Exception:                                 # noqa: BLE001
                    pass
                raise
            last = None
            if want:
                r = cur.fetchone() if cur.description else None
                last = r["id"] if r else None
            return Cur(cur, last)
        with self._lock:
            return self._run(go)

    def executescript(self, script):
        with self._lock:
            self._run(lambda: self._c.execute(schema_to_pg(script)))
            self._c.commit()

    def commit(self):
        with self._lock:
            self._run(self._c.commit)

    def close(self):
        try:
            self._c.close()
        except Exception:                                         # noqa: BLE001
            pass
