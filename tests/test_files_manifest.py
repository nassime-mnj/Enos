"""Manifeste « files » (mise à jour par le Launcher) : construction, signature, validation serveur, chemins protégés. Lancer : python3 tests/test_files_manifest.py"""
import base64, json, os, sys, tempfile, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT)); sys.path.insert(0, str(ROOT / "dualpulse_site"))
import build_release as B  # noqa: E402
from app.launcher import manifests, tokens  # noqa: E402


class T(unittest.TestCase):
    def dist(self, extra=()):
        d = Path(tempfile.mkdtemp())
        for rel, data in (("ENOS.exe", b"MZ" * 50), ("logo.ico", b"ico"), ("godot_eye/pet.gd", b"extends Node"), ("godot_eye/.godot/cache.bin", b"x"), ("data/secret.json", b"{}"),
                          ("nasko_config.json", b"{}"), ("DATA/x.txt", b"d"), ("x.pyc", b"p")) + tuple(extra):
            p = d / rel; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(data)
        return d

    def test_entries_exclude_user_data(self):
        e = B.files_manifest_entries(self.dist(), "stable", "3.2.0")
        paths = [x["path"] for x in e]
        self.assertEqual(paths, ["ENOS.exe", "godot_eye/pet.gd", "logo.ico"])
        self.assertEqual(e[0]["key"], "enos/stable/3.2.0/files/ENOS.exe"); self.assertEqual(e[0]["size"], 100)

    def test_signed_manifest_accepted_by_server_rules(self):
        priv = tokens.new_private(); out = Path(tempfile.mkdtemp())
        p = B.write_launcher_files_manifest(priv, "3.2.0", self.dist(), "notes", "dev", out=out)
        m = json.loads(p.read_text(encoding="utf-8")); sig = (out / p.name.replace(".manifest.json", ".sig")).read_text().strip()
        self.assertEqual((m["mode"], m["run"], m["channel"]), ("files", "ENOS.exe", "dev"))
        self.assertTrue(manifests.verify(tokens.public_from_b64(tokens.public_b64(priv)), m, sig))
        c = manifests.validate(m); self.assertEqual((c["mode"], c["run"]), ("files", "ENOS.exe"))

    def test_server_rejects_bad_files_manifests(self):
        base = {"product": "enos", "channel": "stable", "version": "3.2.0", "mode": "files", "run": "ENOS.exe",
                "files": [{"path": "ENOS.exe", "sha256": "0" * 64, "size": 1, "key": "enos/stable/3.2.0/files/ENOS.exe"}]}
        manifests.validate(base)
        for patch, why in (({"run": "autre.exe"}, "run hors manifeste"), ({"run": ""}, "run absent"), ({"launch": "ENOS.exe"}, "launch interdit"), ({"mode": "zip"}, "mode inconnu")):
            with self.assertRaises(ValueError, msg=why):
                manifests.validate({**base, **patch})
        for bad in ("data/x.json", "nasko_config.json", ".update-journal.json"):
            m = {**base, "files": base["files"] + [{"path": bad, "sha256": "1" * 64, "size": 1, "key": "enos/stable/3.2.0/files/" + bad.lstrip(".")}]}
            with self.assertRaises(ValueError, msg=bad):
                manifests.validate(m)
        old = {k: v for k, v in base.items() if k not in ("mode", "run")}; old["launch"] = "ENOS.exe"
        self.assertEqual(manifests.validate(old)["mode"], "installer")                 # anciens manifestes inchangés

    def test_unsafe_names_refused(self):
        with self.assertRaises(SystemExit):
            B.files_manifest_entries(self.dist(extra=(("bad(name).txt", b"x"),)), "stable", "3.2.0")


if __name__ == "__main__":
    unittest.main()
