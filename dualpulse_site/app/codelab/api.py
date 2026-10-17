"""Routes /launcher/v1/codelab (FastAPI) : langages et exécution. Tout compte connecté (friends, dev, ceo) peut exécuter."""
import logging
import os
import threading
import time

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ..launcher import api as launcher_api
from ..launcher import limits, service
from . import runner, sandbox

PREFIX = launcher_api.V1 + "/codelab"
log = logging.getLogger("dualpulse.codelab")

router = APIRouter(prefix=PREFIX)
_active = set()                      # utilisateurs ayant une exécution en cours
_active_lock = threading.Lock()
_slots = {"n": None, "sem": None}


class RunIn(BaseModel):
    language: str = Field(default="", max_length=30)
    code: str = ""
    stdin: str = ""


def _json(payload, status=200):
    return JSONResponse(payload, status_code=status, headers={"Cache-Control": "no-store"})


def _concurrency():
    try:
        n = max(1, min(16, int(os.environ.get("DP_CODELAB_CONCURRENCY", "3"))))
    except ValueError:
        n = 3
    if _slots["n"] != n:
        _slots["n"], _slots["sem"] = n, threading.BoundedSemaphore(n)
    return _slots["sem"]


def _rate():
    try:
        return max(1, int(os.environ.get("DP_CODELAB_RATE", "20")))
    except ValueError:
        return 20


@router.get("/languages")
def get_languages(u=Depends(launcher_api.current_user)):
    b = sandbox.detect()
    return _json({"languages": runner.languages(b), "sandbox": sandbox.describe(b), "limits": runner.limits()})


@router.post("/run")
def post_run(body: RunIn, u=Depends(launcher_api.current_user)):
    b = sandbox.detect()
    try:
        runner.validate(body.language, body.code, body.stdin, b)
    except runner.RunnerError as e:
        return _json({"detail": e.detail}, e.status)
    if not b.usable:
        return _json({"detail": "Bac à sable indisponible sur ce serveur : exécution refusée."}, 503)
    uid = u["id"]
    if not limits.ok("codelab", uid, _rate(), 60):
        return _json({"detail": "Trop d'exécutions, réessayez dans une minute."}, 429)
    sem = _concurrency()
    with _active_lock:
        if uid in _active:
            return _json({"detail": "Une exécution est déjà en cours pour votre compte."}, 429)
        if not sem.acquire(blocking=False):
            return _json({"detail": "Le serveur est occupé, réessayez dans un instant."}, 429)
        _active.add(uid)
    t0 = time.monotonic()
    outcome = "error"
    try:
        res = runner.execute(body.language, body.code, body.stdin, b)
        outcome = "timeout" if res["timed_out"] else ("ok" if res["ok"] else res["phase"] + "_fail")
        return _json(res)
    except runner.RunnerError as e:
        outcome = "refused_%d" % e.status
        return _json({"detail": e.detail}, e.status)
    except Exception:
        log.exception("codelab: erreur interne user=%s lang=%s", uid, body.language)
        return _json({"detail": "Erreur interne du bac à sable."}, 500)
    finally:
        with _active_lock:
            _active.discard(uid)
        sem.release()
        log.info("codelab user=%s lang=%s ms=%d outcome=%s", uid, body.language, int((time.monotonic() - t0) * 1000), outcome)


def install(app):
    """Branche le routeur CodeLab (idempotent) et s'assure que AuthError est traduit en JSON."""
    if getattr(app.state, "codelab_installed", False):
        return
    if service.AuthError not in app.exception_handlers:
        @app.exception_handler(service.AuthError)
        async def _auth_error(request, exc):
            return launcher_api._err(exc)
    app.include_router(router)
    app.state.codelab_installed = True
