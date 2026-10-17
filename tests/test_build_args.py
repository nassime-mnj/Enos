"""build_release : un --add-data dont le dossier est absent de l'édition (ex. openings pour Friends) est retiré au lieu de faire échouer PyInstaller."""
import os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import build_release as B  # noqa: E402


class T(unittest.TestCase):
    def test_drop_missing(self):
        d = tempfile.mkdtemp(); os.makedirs(os.path.join(d, "static"))
        args = ["--onefile", "--add-data", os.path.join(d, "static") + ";static", "--add-data", os.path.join(d, "openings") + ";openings", "--add-data", os.path.join(d, "cascades") + ";cascades", "nasko_server.py"]
        out = B.drop_missing_data(args)
        self.assertEqual(out, ["--onefile", "--add-data", os.path.join(d, "static") + ";static", "nasko_server.py"])

    def test_cascades_shipped(self):
        self.assertIn("cascades", B.TREES)


if __name__ == "__main__":
    unittest.main()
