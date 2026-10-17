"""Forge Intranet par lien .ics : analyseur iCalendar, échéances absolues, statuts, récurrences, sécurité du lien. Lancer : python3 tests/test_depot_forge.py"""
import json, os, shutil, sys, tempfile, unittest
from datetime import datetime, timezone
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import nasko_core  # noqa: E402
import nasko_depot_forge as F  # noqa: E402

NOW = datetime(2026, 3, 10, 12, 0, tzinfo=timezone.utc).timestamp()
URL = "https://forge.example.fr/calendar/feed.ics?token=SECRET-TOKEN-XYZ"


def ics(*events, extra=""):
    return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//forge//FR\r\n" + extra + "".join(events) + "END:VCALENDAR\r\n"


def ev(**f):
    lines = ["BEGIN:VEVENT"]
    for k, v in f.items():
        lines.append(k.replace("_", "-") + ":" + v if not k.startswith("X") else v)
    lines.append("END:VEVENT")
    return "\r\n".join(lines) + "\r\n"


class Resp:
    def __init__(self, code=200, body="", headers=None):
        self.status_code, self.headers, self.content = code, headers or {}, body.encode() if isinstance(body, str) else body


class Fake:
    def __init__(self, *resps):
        self.resps, self.calls = list(resps), []

    def __call__(self, url, headers=None, timeout=12):
        self.calls.append(url)
        r = self.resps.pop(0) if len(self.resps) > 1 else self.resps[0]
        if isinstance(r, Exception):
            raise r
        return r


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(); self.cfg = {}
        self._o = (nasko_core.data_dir, nasko_core.load_config, nasko_core.update_config, nasko_core.config_path, F._clock)
        nasko_core.data_dir = lambda: self.tmp
        nasko_core.load_config = lambda: dict(self.cfg)
        nasko_core.update_config = lambda v: self.cfg.update(v)
        nasko_core.config_path = lambda: os.path.join(self.tmp, "cfg.json")
        self.t = [1000.0]; F._clock = lambda: self.t[0]; F._reset()

    def tearDown(self):
        nasko_core.data_dir, nasko_core.load_config, nasko_core.update_config, nasko_core.config_path, F._clock = self._o
        shutil.rmtree(self.tmp, ignore_errors=True)


def norm(*events, now=NOW):
    return F.forge_normalize(F.parse_ics(ics(*events)), now)


class Parsing(Base):
    def test_utc_tzid_floating_allday(self):
        it = norm(
            ev(UID="a", SUMMARY="Rendu Libft", DTSTART="20260310T100000Z", DTEND="20260312T220000Z"),
            ev(UID="b", SUMMARY="Rush01", **{"DTSTART;TZID=Europe/Paris": "20260312T180000", "DTEND;TZID=Europe/Paris": "20260313T180000"}),
            ev(UID="c", SUMMARY="Examen blanc", DTSTART="20260320T090000"),
            ev(UID="d", SUMMARY="Journée", **{"DTSTART;VALUE=DATE": "20260315", "DTEND;VALUE=DATE": "20260316"}))
        by = {i["id"]: i for i in it}
        self.assertEqual(by["a"]["deadline"], "2026-03-12T22:00:00+00:00")
        self.assertEqual(by["a"]["status"], "running")
        self.assertEqual(by["a"]["remaining_s"], int(datetime(2026, 3, 12, 22, tzinfo=timezone.utc).timestamp() - NOW))
        self.assertEqual(by["a"]["deadline_ts"], datetime(2026, 3, 12, 22, tzinfo=timezone.utc).timestamp())
        self.assertEqual(by["b"]["deadline_ts"], datetime(2026, 3, 13, 17, tzinfo=timezone.utc).timestamp())      # 18h Paris (CET, UTC+1) → 17h UTC
        self.assertEqual(by["b"]["status"], "upcoming")
        self.assertEqual(by["c"]["kind"], "exam")
        self.assertEqual(by["d"]["all_day"], True)
        self.assertTrue(by["d"]["deadline"].endswith("23:59:59" + by["d"]["deadline"][-6:]) or "T23:59:59" in by["d"]["deadline"])

    def test_dst_paris_summer(self):
        it = norm(ev(UID="s", SUMMARY="Rendu été", **{"DTSTART;TZID=Europe/Paris": "20260715T120000"}), now=datetime(2026, 7, 1, tzinfo=timezone.utc).timestamp())
        self.assertEqual(it[0]["deadline_ts"], datetime(2026, 7, 15, 10, tzinfo=timezone.utc).timestamp())      # CEST = UTC+2
        eu = F._EuTz()
        self.assertEqual(datetime(2026, 7, 15, 12, tzinfo=eu).timestamp(), datetime(2026, 7, 15, 10, tzinfo=timezone.utc).timestamp())
        self.assertEqual(datetime(2026, 1, 15, 12, tzinfo=eu).timestamp(), datetime(2026, 1, 15, 11, tzinfo=timezone.utc).timestamp())

    def test_folding_escapes_and_html(self):
        raw = ics("BEGIN:VEVENT\r\nUID:x\r\nSUMMARY:Pisc\r\n ine C\\, jour 1\r\nDESCRIPTION:<b>Sujet</b>\\nligne2 <script>alert(1)</script>\r\nURL:javascript:alert(1)\r\n"
                  "DTSTART:20260311T080000Z\r\nDTEND:20260311T200000Z\r\nEND:VEVENT\r\n")
        it = F.forge_normalize(F.parse_ics(raw), NOW)[0]
        self.assertEqual(it["name"], "Piscine C, jour 1"); self.assertEqual(it["kind"], "pool")
        self.assertNotIn("<", it["description"]); self.assertIsNone(it["url"])

    def test_status_progress_cancelled_todo(self):
        it = norm(
            ev(UID="run", SUMMARY="Projet long", DTSTART="20260309T120000Z", DTEND="20260311T120000Z"),
            ev(UID="old", SUMMARY="Rendu fini", DTSTART="20260309T100000Z", DTEND="20260309T120000Z"),
            ev(UID="ancient", SUMMARY="Rendu très vieux", DTSTART="20260101T100000Z", DTEND="20260101T120000Z"),
            ev(UID="can", SUMMARY="Annulé", DTSTART="20260311T100000Z", DTEND="20260312T100000Z", STATUS="CANCELLED"),
            "BEGIN:VTODO\r\nUID:t\r\nSUMMARY:Rapport\r\nDUE:20260320T230000Z\r\nSTATUS:COMPLETED\r\nEND:VTODO\r\n",
            ev(UID="pt", SUMMARY="Rendu ex00", DTSTART="20260312T215900Z"))
        by = {i["id"]: i for i in it}
        self.assertNotIn("can", by); self.assertNotIn("ancient", by)
        self.assertEqual(by["run"]["progress"], 50)
        self.assertEqual(by["old"]["status"], "closed"); self.assertTrue(by["old"]["overdue"]); self.assertEqual(by["old"]["remaining_s"], 0)
        self.assertEqual(by["t"]["status"], "submitted"); self.assertFalse(by["t"]["overdue"])
        self.assertEqual(by["pt"]["status"], "running"); self.assertIsNone(by["pt"]["start"])
        self.assertEqual([i["id"] for i in it][:2], ["run", "pt"])           # en cours d'abord, par échéance

    def test_rrule_weekly_exdate_count(self):
        it = norm(ev(UID="w", SUMMARY="Rendu hebdo", DTSTART="20260306T180000Z", DTEND="20260306T190000Z", RRULE="FREQ=WEEKLY;COUNT=4", EXDATE="20260320T180000Z"))
        ts = sorted(i["deadline_ts"] for i in it if i["status"] != "closed")
        self.assertEqual(len(it), 2)                                          # occurrences : 6 (trop ancienne), 13, [20 exclue], 27 mars
        self.assertEqual(ts[0], datetime(2026, 3, 13, 19, tzinfo=timezone.utc).timestamp())
        it2 = norm(ev(UID="d", SUMMARY="Daily", DTSTART="20260310T130000Z", RRULE="FREQ=DAILY;UNTIL=20260312T235959Z"))
        self.assertEqual(len(it2), 3)

    def test_garbage_is_ignored(self):
        with self.assertRaises(F.ForgeError):
            F.parse_ics("<html>login</html>")
        ok = F.parse_ics(ics("BEGIN:VEVENT\r\nSUMMARY:sans date\r\nEND:VEVENT\r\n", "BEGIN:VEVENT\r\nSUMMARY:date cassée\r\nDTSTART:pas-une-date\r\nEND:VEVENT\r\n",
                             ev(UID="g", SUMMARY="Bon", DTSTART="20260312T100000Z"), "BEGIN:VEVENT\r\nBEGIN:VALARM\r\nTRIGGER:-PT1H\r\nEND:VALARM\r\nUID:al\r\nSUMMARY:Avec alarme\r\nDTSTART:20260313T100000Z\r\nEND:VEVENT\r\n"))
        self.assertEqual([e["uid"] for e in ok], ["g", "al"])
        big = ics(*[ev(UID=str(i), SUMMARY="Rendu %d" % i, DTSTART="20260320T100000Z") for i in range(400)])
        self.assertLessEqual(len(F.forge_normalize(F.parse_ics(big), NOW)), F.MAX_ITEMS)


class Fetch(Base):
    def conf(self, **extra):
        F.forge_set_config({"ics": URL, **extra})

    def body(self):
        return ics(ev(UID="a", SUMMARY="Rendu Libft", DTSTART="20260310T100000Z", DTEND="20260312T220000Z"))

    def test_fetch_cache_stale_and_secret(self):
        self.conf(refresh_s=60)
        h = Fake(Resp(200, self.body()))
        r = F.forge_fetch(http=h, now=NOW)
        self.assertEqual(len(r["items"]), 1); self.assertIsNone(r["error"]); self.assertEqual(h.calls, [URL])
        F.forge_fetch(http=h, now=NOW + 5); self.assertEqual(len(h.calls), 1)                      # cache
        self.t[0] += 61
        r = F.forge_fetch(http=Fake(ConnectionError("échec https://forge.example.fr/calendar/feed.ics?token=SECRET-TOKEN-XYZ")), now=NOW + 10)
        self.assertTrue(r["stale"]); self.assertEqual(len(r["items"]), 1)
        blob = json.dumps(r) + json.dumps(F.forge_status()) + json.dumps(F.forge_config())
        self.assertNotIn("SECRET-TOKEN-XYZ", blob); self.assertNotIn("feed.ics", blob)
        self.assertEqual(F.forge_config()["host"], "forge.example.fr")

    def test_errors_are_french_and_scrubbed(self):
        self.conf()
        for resp, frag in ((Resp(401), "refusé"), (Resp(404), "introuvable"), (Resp(500), "500"), (Resp(200, "<html>Connexion</html>"), "agenda")):
            F._reset()
            r = F.forge_fetch(http=Fake(resp), now=NOW)
            self.assertIn(frag, r["error"]); self.assertEqual(r["items"], [])
        F._reset()
        r = F.forge_fetch(http=Fake(RuntimeError("boom " + URL)), now=NOW)
        self.assertNotIn("SECRET", r["error"])
        F._reset()
        self.assertIn("trop gros", F.forge_fetch(http=Fake(Resp(200, b"x" * (F.MAX_BODY + 1))), now=NOW)["error"])

    def test_redirects(self):
        self.conf()
        F._reset(); h = Fake(Resp(302, headers={"Location": "https://cdn.example.fr/f.ics"}), Resp(200, self.body()))
        self.assertEqual(len(F.forge_fetch(http=h, now=NOW)["items"]), 1); self.assertEqual(h.calls[1], "https://cdn.example.fr/f.ics")
        F._reset(); self.assertIn("Redirection", F.forge_fetch(http=Fake(Resp(302, headers={"Location": "http://evil.example.com/x"})), now=NOW)["error"])
        F._reset(); self.assertIn("Redirection", F.forge_fetch(http=Fake(Resp(302, headers={})), now=NOW)["error"])

    def test_not_configured_and_config_validation(self):
        r = F.forge_fetch(http=Fake(Resp(200, self.body())), now=NOW); self.assertEqual((r["items"], r["error"]), ([], None))
        for bad in ("http://forge.example.fr/a.ics", "ftp://x/a.ics", "https://user:pw@forge.example.fr/a.ics", "javascript:alert(1)", "https://a b.fr/x", "https://" + "x" * 2100):
            with self.assertRaises(F.ForgeError, msg=bad):
                F.forge_set_config({"ics": bad})
        F.forge_set_config({"ics": "webcal://forge.example.fr/f.ics?t=1"}); self.assertTrue(self.cfg[F.KEY_ICS].startswith("https://forge.example.fr"))
        F.forge_set_config({"ics": "http://127.0.0.1:9/f.ics"})
        for bad in (10, 99999, "x"):
            with self.assertRaises(F.ForgeError):
                F.forge_set_config({"refresh_s": bad})
        F.forge_set_config({"ics": ""}); self.assertFalse(F.forge_config()["ics_set"])
        self.conf(); F.forge_clear(); self.assertEqual(self.cfg[F.KEY_ICS], "")

    def test_real_http_client_against_local_server(self):
        import http.server, socketserver, threading
        body = self.body().encode()

        class H(http.server.BaseHTTPRequestHandler):
            def do_GET(s):
                s.send_response(200); s.send_header("Content-Type", "text/calendar"); s.send_header("Content-Length", str(len(body))); s.end_headers(); s.wfile.write(body)

            def log_message(s, *a): pass
        srv = socketserver.TCPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            F.forge_set_config({"ics": "http://127.0.0.1:%d/f.ics?t=abc" % srv.server_address[1]})
            r = F.forge_fetch(now=NOW); self.assertIsNone(r["error"], r); self.assertEqual(len(r["items"]), 1)
        finally:
            srv.shutdown(); srv.server_close()

    def test_no_files_written(self):
        self.conf(); F.forge_fetch(http=Fake(Resp(200, self.body())), now=NOW)
        self.assertEqual(os.listdir(self.tmp), [])


if __name__ == "__main__":
    unittest.main()
