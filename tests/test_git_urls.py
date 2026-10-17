"""Adresses Git : format SCP « utilisateur@hôte:chemin » accepté pour N'IMPORTE QUEL utilisateur (forges d'école : prenom.nom@git.forge.epita.fr:…), pas seulement git@.
Les quatre validations du projet (Dev Manager, Dépôt, synchro Godot, branchement Git) sont soumises à la même batterie. Lancer : python3 tests/test_git_urls.py"""
import sys, unittest
from pathlib import Path
from unittest import mock
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import nasko_depot_git as G  # noqa: E402
import nasko_devmanager as D  # noqa: E402
import nasko_git  # noqa: E402
import nasko_godotsync as GS  # noqa: E402

ACCEPT = [
    "prenom.nom@git.forge.epita.fr:p/2026/piscine/ex00",             # forge d'école : l'utilisateur n'est pas « git »
    "prenom.nom@git.forge.epita.fr:p/2026/piscine/ex00.git",
    "git@github.com:user/repo.git",                                   # cas historique
    "first_last@host.example:repo.git",
    "user-1@gitlab.school.edu:grp/sub/repo",
    "u123@10.0.0.5:srv/repo.git",
    "A@b.c:~/repo",
]
REJECT = [
    "", "   ", "-oProxyCommand=touch@h:p", "@host:path", "user@:path", "user@host", "user@host:", "user@-host:path", "-user@host:path",
    "user name@host:path", "user@host:pa th", "us;er@host:path", "user@host:path;rm -rf /", "us$er@host:path", "user@host:$(id)", "user@host:`id`",
    "user@host:path|x", "ext::sh -c id", "file:///etc/passwd", "/srv/repo", "host:path", "user@@host:path", "u" * 65 + "@host:path",
    "user@host:path\nrm", "user@host:path\x00",
]


class Validators(unittest.TestCase):
    def test_every_validator_accepts_any_username(self):
        for u in ACCEPT:
            self.assertTrue(D.URL_RE.match(u), "devmanager: " + u)
            self.assertEqual(D.normalize_url(u), u)
            self.assertEqual(G.validate_url(u), u, "depot_git: " + u)
            self.assertTrue(nasko_git.REMOTE_OK.match(u), "nasko_git: " + u)
            if "~" not in u and "%" not in u:
                self.assertEqual(GS.safe_url(u), u, "godotsync: " + u)

    def test_every_validator_still_refuses_dangerous_or_malformed_addresses(self):
        for u in REJECT:
            self.assertFalse(D.URL_RE.match(u), "devmanager: " + repr(u))
            with self.assertRaises(D.DevError, msg="normalize " + repr(u)):
                D.normalize_url(u)
            with self.assertRaises(G.GitError, msg="depot_git " + repr(u)):
                G.validate_url(u)
            self.assertEqual(GS.safe_url(u), "", "godotsync: " + repr(u))
            if u.strip() == u and " " not in u and not any(c in u for c in "$`;|\n\x00"):
                self.assertFalse(nasko_git.REMOTE_OK.match(u), "nasko_git: " + repr(u))

    def test_ssh_and_https_forms_unchanged(self):
        for u in ("https://github.com/a/b.git", "ssh://git@host/x/y", "ssh://prenom.nom@git.forge.epita.fr/p/repo"):
            self.assertEqual(D.normalize_url(u), u); self.assertEqual(G.validate_url(u), u)
        self.assertEqual(D.normalize_url("owner/repo"), "https://github.com/owner/repo.git")
        with self.assertRaises(G.GitError):
            G.validate_url("file:///x")
        self.assertEqual(G.validate_url("/srv/r", allow_local=True), "/srv/r")                # option locale inchangée

    def test_the_two_copies_of_the_regex_stay_identical(self):
        self.assertEqual(D.URL_RE.pattern, G.URL_RE.pattern)

    def test_clone_of_a_school_forge_url_lands_in_the_workspace(self):
        jobs = []
        with mock.patch.object(D, "start_job", lambda kind, repo, cmd, cfg=None: jobs.append((kind, repo, cmd)) or "j1"):
            for url, name in (("prenom.nom@git.forge.epita.fr:p/2026/piscine/ex00", "ex00"), ("prenom.nom@git.forge.epita.fr:p/2026/piscine/ex00.git", "ex00"),
                              ("user@host:repo.git", "repo")):
                jobs.clear()
                _, got = D.clone(url)
                self.assertEqual(got, name)
                kind, repo, cmd = jobs[0]
                self.assertEqual((kind, repo), ("clone", ""))
                self.assertIn(url, cmd); self.assertTrue(cmd.endswith(" /home/nasko/" + name), cmd)
        self.assertEqual(G.clone_argv("prenom.nom@git.forge.epita.fr:p/x/ex00", "ex00")[-3:], ["--", "prenom.nom@git.forge.epita.fr:p/x/ex00", "ex00"])

    def test_no_url_regex_on_the_frontend(self):
        # le frontend n'a AUCUNE validation d'adresse : il poste l'adresse telle quelle, le backend tranche (un seul endroit à tenir à jour)
        for f in ("depot.js", "devmanager.js"):
            src = (ROOT / "static" / f).read_text(encoding="utf-8")
            self.assertNotIn("git@", src, f)
        self.assertIn("utilisateur@hôte:chemin", (ROOT / "static" / "depot.js").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
