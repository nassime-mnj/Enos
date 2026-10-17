"""Options du widget de bureau : voix de l'IA, bulle de texte, saisie au clic sur la tête — côté Python (le GDScript n'est pas exécutable ici)."""
import asyncio
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import subprocess  # noqa: E402
for _n in ("DETACHED_PROCESS", "CREATE_NEW_PROCESS_GROUP", "CREATE_NO_WINDOW"):
    if not hasattr(subprocess, _n):
        setattr(subprocess, _n, 0)
import nasko_core  # noqa: E402
import nasko_pet  # noqa: E402


class FakeWS:
    def __init__(self):
        self.sent = []

    async def send_text(self, t):
        self.sent.append(json.loads(t))


class PetOptions(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self._dd, self._cp = nasko_core.data_dir, nasko_core.config_path
        nasko_core.data_dir = lambda: self.tmp
        nasko_core.config_path = lambda: os.path.join(self.tmp, "nasko_config.json")
        self.loop = asyncio.new_event_loop()
        import threading
        threading.Thread(target=self.loop.run_forever, daemon=True).start()
        self.ws = FakeWS()
        nasko_pet._conn["ws"], nasko_pet._conn["loop"] = self.ws, self.loop

    def tearDown(self):
        nasko_pet._conn["ws"] = None
        self.loop.call_soon_threadsafe(self.loop.stop)
        nasko_core.data_dir, nasko_core.config_path = self._dd, self._cp

    def flush(self):
        asyncio.run_coroutine_threadsafe(asyncio.sleep(0.05), self.loop).result(2)

    def test_defaults_and_push(self):
        self.assertEqual(nasko_pet.options(), {"pet_voice": True, "pet_bubble": True, "pet_typing": False})
        r = nasko_pet.set_options({"pet_voice": False, "pet_typing": True, "junk": 1})
        self.assertEqual(r, {"pet_voice": False, "pet_bubble": True, "pet_typing": True})
        self.flush()
        self.assertIn({"t": "opts", "voice": False, "bubble": True, "typing": True}, self.ws.sent)
        self.assertFalse(nasko_core.load_config()["pet_voice"])

    def test_comment_text_only_when_voice_off(self):
        nasko_pet.set_options({"pet_voice": False})
        self.assertTrue(nasko_pet.comment("Respire un coup.", persona="enos", cfg=nasko_core.load_config()))
        self.flush()
        say = [m for m in self.ws.sent if m["t"] == "say"][-1]
        self.assertEqual(say["text"], "Respire un coup.")
        self.assertEqual(say["audio_path"], "")

    def test_comment_without_widget(self):
        nasko_pet._conn["ws"] = None
        self.assertFalse(nasko_pet.comment("x"))

    def test_typed_session_skips_microphone(self):
        got = {}

        def llm(cfg, text, shot):
            got["text"] = text
            return "Bien reçu."
        nasko_pet.set_options({"pet_voice": False})
        nasko_pet.session(grab=lambda: b"jpg", llm=llm, typed="bonjour")
        self.flush()
        self.assertEqual(got["text"], "bonjour")
        types = [m["t"] for m in self.ws.sent]
        self.assertNotIn("listening", types)
        self.assertIn("thinking", types)
        self.assertEqual([m for m in self.ws.sent if m["t"] == "say"][-1]["text"], "Bien reçu.")

    def test_ws_text_message_starts_typed_session(self):
        calls = []
        orig = nasko_pet.session
        nasko_pet.session = lambda **kw: calls.append(kw)

        class In:
            def __init__(s):
                s.q = [json.dumps({"t": "text", "text": "  salut  "}), json.dumps({"t": "text", "text": "  "}), json.dumps({"t": "close"})]

            async def accept(s):
                pass

            async def receive_text(s):
                if not s.q:
                    raise RuntimeError
                return s.q.pop(0)

            async def send_text(s, t):
                pass
        stopped = []
        o2, nasko_pet.stop = nasko_pet.stop, lambda: stopped.append(1)
        try:
            asyncio.run(nasko_pet.handle(In()))
            import time
            time.sleep(0.2)
        finally:
            nasko_pet.session, nasko_pet.stop = orig, o2
        self.assertEqual(calls, [{"typed": "salut"}])


if __name__ == "__main__":
    unittest.main()
