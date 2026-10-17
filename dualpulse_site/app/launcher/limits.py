"""Limiteur de débit en mémoire (par clé), identique à celui du site."""
import threading
import time
from collections import defaultdict, deque

_hits = defaultdict(deque)
_lock = threading.Lock()


def ok(bucket, key, limit, per=60):
    now = time.time()
    with _lock:
        q = _hits[(bucket, str(key))]
        while q and q[0] < now - per:
            q.popleft()
        if len(q) >= limit:
            return False
        q.append(now)
        return True


def reset():
    with _lock:
        _hits.clear()
