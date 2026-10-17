"""Client LLM : API Anthropic ou tout serveur compatible OpenAI (cle et modele choisis dans nasko_config.json)."""
import logging
import os
import re

import httpx

from nasko_actions import ACTIONS_PROMPT
from nasko_core import ssl_context
from nasko_voice import reflex_prompt
from nasko_core import language
import nasko_apimon                                           # API Control Panel : comptage local des tokens à chaque réponse
import nasko_safe                                            # filtre « sans religion » : consigne dans les prompts + nettoyage de chaque réponse

log = logging.getLogger("nasko.llm")

DEFAULTS = {
    "anthropic": {"base": "https://api.anthropic.com", "model": "claude-haiku-4-5-20251001", "env": "ANTHROPIC_API_KEY"},
    "openai": {"base": "https://api.openai.com/v1", "model": "gpt-4o-mini", "env": "OPENAI_API_KEY"},
}


class LLMError(Exception):
    """Erreur lisible, affichable telle quelle dans le chat."""


def _provider(cfg):
    p = (cfg.get("llm_provider") or "anthropic").strip().lower()
    if p not in DEFAULTS:
        raise LLMError(f"llm_provider « {p} » inconnu : utilisez « anthropic » ou « openai ».")
    return p


def _key(cfg):
    p = _provider(cfg)
    return (cfg.get("llm_api_key") or os.environ.get(DEFAULTS[p]["env"], "")).strip()


def configured(cfg):
    try:
        return bool(_key(cfg))
    except LLMError:
        return False


_OLD_NAME = re.compile(r"n\.?\s?a\.?\s?s\.?\s?k\.?\s?o", re.I)


def _messages(history, user_text, limit):
    """Historique -> messages alternes user/assistant, commençant par 'user'."""
    msgs = []
    for h in history[-limit:]:
        role = "user" if h.get("role") == "user" else "assistant"
        if role == "assistant" and _OLD_NAME.search(h.get("text", "")):      # réponse d'avant la refonte (« Je suis NASKO ») : jamais renvoyée au modèle
            continue
        if msgs and msgs[-1]["role"] == role:
            msgs[-1]["content"] += "\n" + h["text"]
        else:
            msgs.append({"role": role, "content": h["text"]})
    while msgs and msgs[0]["role"] != "user":
        msgs.pop(0)
    if msgs and msgs[-1]["role"] == "user":
        msgs[-1]["content"] += "\n" + user_text
    else:
        msgs.append({"role": "user", "content": user_text})
    return msgs


def _explain(resp, model):
    try:
        err = resp.json().get("error", {})
        detail = err.get("message", "") if isinstance(err, dict) else str(err)
    except ValueError:
        detail = ""
    c = resp.status_code
    if c in (401, 403):
        return "LLM : clé API refusée (invalide, révoquée ou sans accès à ce modèle). Vérifiez llm_api_key."
    if c == 404:
        return f"LLM : modèle ou URL introuvable (modèle « {model} »). Vérifiez llm_model / llm_base_url."
    if c == 429:
        return f"LLM : limite de débit ou quota dépassé. {detail}".strip()
    if c in (500, 502, 503, 529):
        return "LLM : service temporairement surchargé ou indisponible, réessayez dans un instant."
    return f"LLM : erreur {c}. {detail}".strip()


def generate(cfg, history, user_text, persona="enos"):
    """Retourne la reponse texte de E.N.O.S. (ou d'ETO, avec ses Audio Tags). Leve LLMError (message pret a afficher)."""
    p = _provider(cfg)
    key = _key(cfg)
    if not key:
        raise LLMError("LLM non configuré : ajoutez llm_api_key dans nasko_config.json (voir GUIDE.md).")
    d = DEFAULTS[p]
    model = (cfg.get("llm_model") or d["model"]).strip()
    base = (cfg.get("llm_base_url") or d["base"]).rstrip("/")
    max_tokens = int(cfg.get("llm_max_tokens", 400))
    if persona == "eto":                                       # ETO : prompt zen + Audio Tags ; pas de réflexes (leurs fichiers audio sont la voix d'E.N.O.S.)
        import nasko_persona
        system = (nasko_persona.chat_prompt(cfg) + "\n\n" + ACTIONS_PROMPT).strip()
    else:
        system = ((cfg.get("system_prompt") or "") + "\n\n" + ACTIONS_PROMPT + "\n\n" + reflex_prompt()).strip()   # actions + reflexes toujours actifs
    if persona != "eto" and language(cfg) == "en":
        system += ("\n\nLANGUAGE: the user has switched you to ENGLISH. Reply ONLY in English (this overrides the instruction to answer in French), "
                   "same style: concise, plain text, read aloud. The [ACTION: ...] and [REFLEX: ...] tags keep their exact syntax.")
    system += "\n\n" + (nasko_safe.RULE_EN if language(cfg) == "en" else nasko_safe.RULE_FR)
    msgs = _messages(history, user_text, int(cfg.get("llm_history_messages", 12)))
    log.info("LLM %s/%s : %d messages", p, model, len(msgs))
    try:
        with httpx.Client(timeout=60, verify=ssl_context()) as client:
            if p == "anthropic":
                resp = client.post(f"{base}/v1/messages",
                                   headers={"x-api-key": key, "anthropic-version": "2023-06-01"},
                                   json={"model": model, "max_tokens": max_tokens, "system": system, "messages": msgs})
            else:
                body = {"model": model, "messages": [{"role": "system", "content": system}] + msgs}
                if "gpt-oss" in model:
                    body["reasoning_effort"] = "low"
                resp = client.post(f"{base}/chat/completions", headers={"Authorization": f"Bearer {key}"},
                                   json={**body, "max_tokens": max_tokens})
                if resp.status_code == 400 and "max_completion_tokens" in resp.text:  # modeles OpenAI recents
                    resp = client.post(f"{base}/chat/completions", headers={"Authorization": f"Bearer {key}"},
                                       json={**body, "max_completion_tokens": max_tokens})
                # Erreur ponctuelle de certains modeles (gpt-oss sur Groq) : « model called a tool » sans outil declare.
                # Non deterministe -> on rejoue la requete (jusqu'a 2 fois) avant de signaler une erreur.
                for _ in range(2):
                    if resp.status_code == 400 and "called a tool" in resp.text:
                        log.info("Erreur ponctuelle du fournisseur (appel d'outil), nouvelle tentative")
                        resp = client.post(f"{base}/chat/completions", headers={"Authorization": f"Bearer {key}"},
                                           json={**body, "max_tokens": max_tokens})
    except httpx.HTTPError as e:
        raise LLMError(f"LLM injoignable ({e.__class__.__name__}). Vérifiez la connexion internet / llm_base_url.") from e
    if resp.status_code != 200:
        log.warning("LLM HTTP %s : %s", resp.status_code, resp.text[:300])
        raise LLMError(_explain(resp, model))
    try:
        data = resp.json()
        if p == "anthropic":
            text = "".join(b.get("text", "") for b in data["content"] if b.get("type") == "text")
        else:
            text = data["choices"][0]["message"]["content"] or ""
    except (ValueError, KeyError, IndexError, TypeError) as e:
        raise LLMError("LLM : réponse illisible du serveur.") from e
    nasko_apimon.note_llm(cfg, data, resp.headers)
    text = text.strip()
    if not text:
        raise LLMError("LLM : réponse vide.")
    filtered = nasko_safe.no_religion(text, language(cfg))
    return filtered if filtered.strip() else nasko_safe.neutral(language(cfg))


# ----------------------------------------------------------------------------- vision (Widget Œil : commente la capture d'écran)
def vision_model(cfg):
    """Modèle capable de lire une image : `vision_model` si renseigné ; sinon automatique (Groq : Qwen 3.8 ; autres : le modèle du chat)."""
    m = (cfg.get("vision_model") or "").strip()
    if m:
        return m
    p = _provider(cfg)
    base = (cfg.get("llm_base_url") or DEFAULTS[p]["base"]).lower()
    if p == "openai" and "groq" in base:
        return "qwen/qwen3.8-27b"                                   # testé : lit les images (openai/gpt-oss-20b ne le peut pas ; Llama 4 n'est plus proposé)
    return (cfg.get("llm_model") or DEFAULTS[p]["model"]).strip()


def _vision_call(cfg, system, ask, jpeg_bytes, max_tokens):
    """Appel brut d'un modèle de vision (image JPEG + texte) -> (texte, données JSON de la réponse, en-têtes). Lève LLMError."""
    import base64
    p = _provider(cfg)
    key = _key(cfg)
    if not key:
        raise LLMError("LLM non configuré : ajoutez llm_api_key dans nasko_config.json (voir GUIDE.md).")
    d = DEFAULTS[p]
    model = vision_model(cfg)
    base = (cfg.get("llm_base_url") or d["base"]).rstrip("/")
    b64 = base64.b64encode(jpeg_bytes).decode()
    log.info("LLM vision %s/%s : image %d Ko", p, model, len(jpeg_bytes) // 1024)
    try:
        with httpx.Client(timeout=90, verify=ssl_context()) as client:
            if p == "anthropic":
                resp = client.post(f"{base}/v1/messages", headers={"x-api-key": key, "anthropic-version": "2023-06-01"},
                                   json={"model": model, "max_tokens": max_tokens, "system": system, "messages": [{"role": "user", "content": [
                                       {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}},
                                       {"type": "text", "text": ask}]}]})
            else:
                resp = client.post(f"{base}/chat/completions", headers={"Authorization": f"Bearer {key}"},
                                   json={"model": model, "max_tokens": max_tokens, "messages": [
                                       {"role": "system", "content": system},
                                       {"role": "user", "content": [{"type": "text", "text": ask},
                                                                    {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + b64}}]}]})
    except httpx.HTTPError as e:
        raise LLMError(f"LLM injoignable ({e.__class__.__name__}). Vérifiez la connexion internet.") from e
    if resp.status_code != 200:
        log.warning("LLM vision HTTP %s : %s", resp.status_code, resp.text[:300])
        raise LLMError(_explain(resp, model) + (" (le modèle de vision est réglable : vision_model)" if resp.status_code in (400, 404) else ""))
    try:
        data = resp.json()
        text = ("".join(b.get("text", "") for b in data["content"] if b.get("type") == "text") if p == "anthropic"
                else data["choices"][0]["message"]["content"] or "")
    except (ValueError, KeyError, IndexError, TypeError) as e:
        raise LLMError("LLM : réponse illisible du serveur.") from e
    return text, data, resp.headers


def vision_raw(cfg, system, ask, jpeg_bytes, max_tokens=600):
    """Lecture d'une image par le modèle de vision, texte BRUT non filtré (pour extraire du JSON : tickets, factures…). Lève LLMError."""
    text, data, headers = _vision_call(cfg, system, ask, jpeg_bytes, max_tokens)
    try:
        nasko_apimon.note_llm(cfg, data, headers)
    except Exception:                                                                    # noqa: BLE001
        pass
    if not text.strip():
        raise LLMError("LLM : réponse vide.")
    return text.strip()


def vision(cfg, user_text, jpeg_bytes, persona="enos"):
    """Question vocale + capture d'écran (JPEG) -> commentaire d'E.N.O.S. (texte brut, lu à voix haute). Lève LLMError."""
    en = language(cfg) == "en"
    system = ((cfg.get("system_prompt") or "") + "\n\n" +
              ("The user shows you a screenshot of their PC while talking to you. Comment on what they are doing, answer their question, "
               "in at most three short sentences, plain text, no markdown, no lists. Reply in English." if en else
               "L'utilisateur te montre la capture d'écran de son PC en te parlant. Commente ce qu'il est en train de faire et réponds à sa question, "
               "en trois phrases courtes maximum, en texte brut, sans markdown ni liste. Réponds en français.")).strip()
    if persona == "eto":
        import nasko_persona
        system = nasko_persona.vision_prompt("en" if en else "fr")
    system += "\n\n" + (nasko_safe.RULE_EN if en else nasko_safe.RULE_FR)
    ask = user_text.strip() or ("Comment on what I am doing." if en else "Commente ce que je suis en train de faire.")
    text, data, headers = _vision_call(cfg, system, ask, jpeg_bytes, 300)
    text = re.sub(r"[*_`#>~]+", "", text).strip()
    if not text:
        raise LLMError("LLM : réponse vide.")
    nasko_apimon.note_llm(cfg, data, headers)
    filtered = nasko_safe.no_religion(text, "en" if en else "fr")
    return filtered if filtered.strip() else nasko_safe.neutral("en" if en else "fr")


def complete(cfg, system, user_text, max_tokens=160, clean=True):
    """Comme _complete_once, avec relance automatique quand un palier gratuit signale « limite de débit » (le fournisseur indique l'attente : quelques centaines de ms).
    clean=False : texte brut non filtré (indispensable pour du JSON : le filtre markdown retire « _ » et « # »)."""
    import time
    for attempt in range(4):
        try:
            return _complete_once(cfg, system, user_text, max_tokens + attempt * 300, clean)           # réponse vide (réflexion trop longue) : on relance avec plus de budget
        except LLMError as e:
            m = re.search(r"try again in ([\d.]+)\s*(ms|s)", str(e))
            if "réponse vide" in str(e) and attempt < 2:
                continue
            if "limite de débit" not in str(e) or attempt == 3:
                raise
            wait = float(m.group(1)) / (1000.0 if m and m.group(2) == "ms" else 1.0) if m else 1.0
            log.info("LLM : limite de débit, nouvel essai dans %.1f s", wait)
            time.sleep(min(wait + 0.25, 5.0))


def _complete_once(cfg, system, user_text, max_tokens=160, clean=True):
    """Un échange unique (sans historique ni balises d'actions) : sert au Trash Talk des échecs. Retourne du texte brut ; lève LLMError."""
    p = _provider(cfg)
    key = _key(cfg)
    if not key:
        raise LLMError("LLM non configuré : ajoutez llm_api_key dans nasko_config.json (voir GUIDE.md).")
    d = DEFAULTS[p]
    model = (cfg.get("llm_model") or d["model"]).strip()
    base = (cfg.get("llm_base_url") or d["base"]).rstrip("/")
    if clean:                                                  # texte parlé (pas de JSON) : consigne « sans religion »
        system = system + "\n\n" + (nasko_safe.RULE_EN if language(cfg) == "en" else nasko_safe.RULE_FR)
    if p == "openai" and re.search(r"gpt-oss|o1|o3|deepseek-r1|qwen3|reason", model, re.I):
        max_tokens = max(max_tokens, 650 if "gpt-oss" in model else 700)       # modèles à raisonnement : la réflexion consomme le budget, sinon la réponse visible est vide (les autres modèles gardent un petit budget : limite de tokens/minute des paliers gratuits)
    try:
        with httpx.Client(timeout=45, verify=ssl_context()) as client:
            if p == "anthropic":
                resp = client.post(f"{base}/v1/messages", headers={"x-api-key": key, "anthropic-version": "2023-06-01"},
                                   json={"model": model, "max_tokens": max_tokens, "system": system, "messages": [{"role": "user", "content": user_text}]})
            else:
                body = {"model": model, "messages": [{"role": "system", "content": system}, {"role": "user", "content": user_text}]}
                if "gpt-oss" in model:
                    body["reasoning_effort"] = str(cfg.get("llm_reasoning_effort") or "low")   # réflexion cachée (low|medium|high) : low = réponse en < 1 s ; medium épuise le budget de tokens (réponse vide) : réponses rapides et petit budget de tokens (paliers gratuits limités par minute)
                resp = client.post(f"{base}/chat/completions", headers={"Authorization": f"Bearer {key}"}, json={**body, "max_tokens": max_tokens})
                if resp.status_code == 400 and "max_completion_tokens" in resp.text:
                    resp = client.post(f"{base}/chat/completions", headers={"Authorization": f"Bearer {key}"}, json={**body, "max_completion_tokens": max_tokens})
    except httpx.HTTPError as e:
        raise LLMError(f"LLM injoignable ({e.__class__.__name__}).") from e
    if resp.status_code != 200:
        raise LLMError(_explain(resp, model))
    try:
        data = resp.json()
        text = ("".join(b.get("text", "") for b in data["content"] if b.get("type") == "text") if p == "anthropic"
                else data["choices"][0]["message"]["content"] or "")
    except (ValueError, KeyError, IndexError, TypeError) as e:
        raise LLMError("LLM : réponse illisible.") from e
    nasko_apimon.note_llm(cfg, data, resp.headers)
    text = (re.sub(r"[*_`#>~]+", "", text) if clean else text).strip()
    if not text:
        raise LLMError("LLM : réponse vide.")
    if clean:
        text = nasko_safe.no_religion(text, language(cfg))
        if not text.strip():
            raise LLMError("LLM : réponse écartée (allusion religieuse) : réplique de secours utilisée.")
    return text
