"""Ecrit les parametres du LLM et de la voix ElevenLabs dans nasko_config.json (sans toucher aux autres cles).

Exemples :
    py configurer_llm.py --provider openai --base-url https://api.groq.com/openai/v1 --model openai/gpt-oss-20b --key gsk_...
    py configurer_llm.py --eleven-key sk_... --voice-name "A.I. E.N.O.S."
    py configurer_llm.py --eleven-key sk_... --voice-id <ID_DE_LA_VOIX>

Les cles peuvent aussi venir des variables d'environnement NASKO_LLM_KEY / NASKO_ELEVEN_KEY. Elles ne sont jamais
affichees en entier et ne sont ecrites que dans nasko_config.json (jamais dans le code ni dans ENOS.exe).
"""
import argparse
import os
import sys

from nasko_core import config_path, load_config, update_config


def mask(key):
    return f"{key[:4]}...{key[-4:]} ({len(key)} caracteres)" if key else "(vide)"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--provider", choices=["anthropic", "openai"], help='"openai" = OpenAI et tout serveur compatible (Groq...)')
    ap.add_argument("--base-url", help="ex. https://api.groq.com/openai/v1")
    ap.add_argument("--model")
    ap.add_argument("--key", default=os.environ.get("NASKO_LLM_KEY"), help="cle API du LLM")
    ap.add_argument("--eleven-key", default=os.environ.get("NASKO_ELEVEN_KEY"), help="cle API ElevenLabs")
    ap.add_argument("--voice-id", help="ID de la voix ElevenLabs")
    ap.add_argument("--voice-name", help='nom de la voix (ex. "A.I. E.N.O.S.")')
    ap.add_argument("--tts", choices=["on", "off"], help="active/desactive la synthese vocale des reponses")
    a = ap.parse_args()
    values = {"llm_provider": a.provider, "llm_base_url": a.base_url, "llm_model": a.model, "llm_api_key": a.key,
              "elevenlabs_api_key": a.eleven_key, "elevenlabs_voice_id": a.voice_id, "elevenlabs_voice_name": a.voice_name}
    values = {k: v for k, v in values.items() if v}
    if a.tts:
        values["tts_dynamic"] = a.tts == "on"
    if not values:
        ap.print_help()
        sys.exit(1)
    update_config(values)
    cfg = load_config()
    print(f"Config mise a jour : {config_path()}")
    print(f"  llm_provider          : {cfg.get('llm_provider')}")
    print(f"  llm_base_url          : {cfg.get('llm_base_url')}")
    print(f"  llm_model             : {cfg.get('llm_model')}")
    print(f"  llm_api_key           : {mask(cfg.get('llm_api_key', ''))}")
    print(f"  elevenlabs_api_key    : {mask(cfg.get('elevenlabs_api_key', ''))}")
    print(f"  elevenlabs_voice_id   : {cfg.get('elevenlabs_voice_id') or '(vide : recherche par nom)'}")
    print(f"  elevenlabs_voice_name : {cfg.get('elevenlabs_voice_name')}")
    print(f"  tts_dynamic           : {cfg.get('tts_dynamic')}")


if __name__ == "__main__":
    main()
