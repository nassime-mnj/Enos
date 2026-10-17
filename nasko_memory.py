"""Memoire d'apprentissage : archive silencieusement chaque echange reussi (dataset pour un futur fine-tuning)."""
import json
import logging
import os
import sqlite3
from contextlib import closing
from datetime import datetime

from nasko_core import data_dir

log = logging.getLogger("nasko.memory")


def db_path():
    return os.path.join(data_dir(), "nasko_memory.db")


def init_db():
    with closing(sqlite3.connect(db_path(), timeout=10)) as con, con:
        con.execute("""CREATE TABLE IF NOT EXISTS conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            ip_address TEXT,
            user_prompt TEXT NOT NULL,
            llm_response TEXT NOT NULL,
            actions TEXT)""")


def log_interaction(ip, user_prompt, llm_response, actions=None):
    """Ne leve jamais d'exception : l'archivage ne doit pas perturber la conversation."""
    try:
        with closing(sqlite3.connect(db_path(), timeout=10)) as con, con:
            con.execute(
                "INSERT INTO conversations (timestamp, ip_address, user_prompt, llm_response, actions) VALUES (?,?,?,?,?)",
                (datetime.now().isoformat(timespec="seconds"), ip, user_prompt, llm_response,
                 json.dumps([a["action"] for a in actions]) if actions else None))
    except Exception as e:
        log.warning("Archivage impossible : %s", e)
