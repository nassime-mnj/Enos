"""Appel de vision du LLM : refactor (vision / vision_raw partagent _vision_call). Lancer : python tests/test_llm_vision.py"""
import json
import os
import sys
import types
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
for name, attrs in {"nasko_actions": {"ACTIONS_PROMPT": ""}, "nasko_voice": {"reflex_prompt": lambda *a, **k: ""},
                    "nasko_apimon": {"note_llm": lambda *a, **k: None}}.items():
    m = types.ModuleType(name)
    m.__dict__.update(attrs)
    sys.modules.setdefault(name, m)
import httpx  # noqa: E402

import nasko_llm  # noqa: E402


class Vision(unittest.TestCase):
    def setUp(self):
        self.reqs = []
        self.reply = "Un **ticket_de_caisse** # 12"
        real = httpx.Client

        def handler(request):
            self.reqs.append((str(request.url), json.loads(request.content)))
            if "/v1/messages" in str(request.url):
                return httpx.Response(200, json={"content": [{"type": "text", "text": self.reply}]})
            return httpx.Response(200, json={"choices": [{"message": {"content": self.reply}}]})
        self._real = httpx.Client
        nasko_llm.httpx.Client = lambda **kw: real(transport=httpx.MockTransport(handler))

    def tearDown(self):
        nasko_llm.httpx.Client = self._real

    def test_raw_keeps_text_untouched_openai_and_anthropic(self):
        cfg = {"llm_provider": "openai", "llm_api_key": "k", "llm_base_url": "https://x.test/v1", "llm_model": "m"}
        self.reply = '{"merchant": "Carrefour_Express", "total": 12.5}'
        self.assertEqual(nasko_llm.vision_raw(cfg, "SYS", "ASK", b"\xff\xd8jpg", 500), self.reply)            # « _ » conservé : indispensable pour du JSON
        url, body = self.reqs[-1]
        self.assertTrue(url.endswith("/chat/completions"))
        self.assertEqual((body["max_tokens"], body["messages"][0]["content"]), (500, "SYS"))
        self.assertTrue(body["messages"][1]["content"][1]["image_url"]["url"].startswith("data:image/jpeg;base64,"))
        cfg = {"llm_provider": "anthropic", "llm_api_key": "k", "llm_base_url": "https://a.test"}
        self.assertEqual(nasko_llm.vision_raw(cfg, "SYS", "ASK", b"x"), self.reply)
        self.assertEqual(self.reqs[-1][1]["messages"][0]["content"][0]["type"], "image")

    def test_original_vision_still_cleans_and_limits(self):
        cfg = {"llm_provider": "openai", "llm_api_key": "k", "llm_base_url": "https://x.test/v1"}
        out = nasko_llm.vision(cfg, "que vois-tu ?", b"x")
        self.assertEqual(out, "Un ticketdecaisse  12")                                                          # marqueurs markdown retirés comme avant
        self.assertEqual(self.reqs[-1][1]["max_tokens"], 300)

    def test_errors(self):
        with self.assertRaises(nasko_llm.LLMError):
            nasko_llm.vision_raw({"llm_provider": "openai"}, "s", "a", b"x")
        self.reply = "   "
        with self.assertRaises(nasko_llm.LLMError):
            nasko_llm.vision_raw({"llm_provider": "openai", "llm_api_key": "k"}, "s", "a", b"x")


if __name__ == "__main__":
    unittest.main()
