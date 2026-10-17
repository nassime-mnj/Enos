"""Interface de `git clone` (Dépôt + Dev Manager) : AUCUNE fenêtre et AUCUN choix de dossier de destination. Le backend clone toujours dans l'espace de travail WSL.
Contrôle statique des fichiers JS/HTML ; le comportement réel (clic, barre de progression, échec) a été vérifié dans un navigateur."""
import re, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
read = lambda p: (ROOT / "static" / p).read_text(encoding="utf-8")


class CloneUi(unittest.TestCase):
    def test_depot_clone_has_no_dialog_and_no_destination(self):
        js = read("depot.js")
        self.assertNotIn("cloneDlg", js)                                             # plus de fenêtre modale
        self.assertNotIn("Dossier de destination", js)
        m = re.search(r"async function startClone\(\) \{(.*?)\n  \}\n", js, re.S)
        self.assertTrue(m, "startClone introuvable")
        body = m.group(1)
        self.assertNotRegex(body, r"modal\(|prompt\(|confirm\(|showDirectoryPicker|type: \"file\"")
        self.assertIn('post("/api/depot/clone", { url })', body)                       # l'adresse seule : pas de nom ni de dossier
        self.assertNotIn("name:", body)
        self.assertIn("j.rc !== 0", body)                                              # l'ancien code testait `j.code` (inexistant) : un clone échoué passait pour réussi
        self.assertNotIn("j.code", js)
        self.assertIn("startClone()", js.split("cloneB = btn(")[1][:80])

    def test_devmanager_clone_is_instant_with_progress(self):
        js = read("devmanager.js")
        self.assertIn('post("/api/dev/clone", { url })', js)
        self.assertNotRegex(js, r"showDirectoryPicker|type=\"file\" webkitdirectory")
        self.assertIn('id="dv-cprog"', read("index.html"))
        self.assertIn("j.rc !== 0", js)

    def test_no_folder_picker_anywhere_in_clone_ui(self):
        for f in ("depot.js", "devmanager.js"):
            self.assertNotIn("showDirectoryPicker", read(f))
            self.assertNotIn("webkitdirectory", read(f))
        self.assertNotIn("webkitdirectory", read("index.html"))

    def test_backend_ignores_any_client_supplied_destination_in_wsl(self):
        src = (ROOT / "nasko_depot.py").read_text(encoding="utf-8")
        self.assertIn("dm.clone(url, cfg)", src)                                       # en WSL, `name` n'est pas transmis : destination imposée par nasko_wsl


if __name__ == "__main__":
    unittest.main()
