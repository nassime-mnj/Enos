"""Gestionnaire d'abonnements (subs_analyzer). Lancer : python tests/test_subs.py"""
import json
import os
import shutil
import sys
import tempfile
import unittest
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import subs_analyzer as S  # noqa: E402

TODAY = date(2026, 10, 24)


def entry(service, day, kind="charge", price=9.99, freq="monthly", nxt=None, url="", method="", acc="a1", sender="billing@x.com"):
    return {"acc": acc, "date": day, "from": sender, "subject": "s", "t": 0,
            "a": {"service": service, "kind": kind, "price": price, "currency": "EUR", "frequency": freq, "next": nxt, "cancel_url": url, "cancel_method": method}}


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self._dd = S.data_dir
        S.data_dir = lambda: self.tmp
        S._job.update(busy=False)

    def tearDown(self):
        S.data_dir = self._dd
        shutil.rmtree(self.tmp, ignore_errors=True)

    def cache(self, items):
        with open(os.path.join(self.tmp, "subs_cache.json"), "w", encoding="utf-8") as f:
            json.dump({str(i): e for i, e in enumerate(items)}, f)


class Clean(unittest.TestCase):
    def test_valid(self):
        r = S.clean_analysis({"is_subscription": True, "kind": "charge", "service": " Pixel  Lab ", "price": "12,50", "currency": "eur", "frequency": "monthly",
                              "next_billing_date": "2026-11-03", "cancel_url": "https://pixellab.example/cancel", "cancel_method": None})
        self.assertEqual((r["service"], r["price"], r["currency"], r["next"]), ("Pixel Lab", 12.5, "EUR", "2026-11-03"))

    def test_rejects_non_subscription_and_garbage(self):
        self.assertIsNone(S.clean_analysis({"is_subscription": False, "kind": "other", "service": "Amazon"}))
        self.assertIsNone(S.clean_analysis({"is_subscription": True, "kind": "bogus", "service": "X"}))
        self.assertIsNone(S.clean_analysis("texte"))

    def test_hostile_fields_are_dropped(self):
        r = S.clean_analysis({"is_subscription": True, "kind": "charge", "service": "Svc", "price": -5, "frequency": "whenever", "next_billing_date": "demain",
                              "cancel_url": "javascript:alert(1)", "currency": "<b>"})
        self.assertEqual((r["price"], r["frequency"], r["next"], r["cancel_url"], r["currency"]), (None, "unknown", None, "", ""))

    def test_json_extraction(self):
        self.assertEqual(S._json_obj('Voici : {"a": 1} fin'), {"a": 1})
        with self.assertRaises(ValueError):
            S._json_obj("rien")


class Dates(unittest.TestCase):
    def test_add_months_clamps(self):
        self.assertEqual(S.add_months(date(2026, 1, 31), 1), date(2026, 2, 28))
        self.assertEqual(S.add_months(date(2026, 12, 15), 1), date(2027, 1, 15))

    def test_next_charge(self):
        self.assertEqual(S.next_charge(date(2026, 8, 5), "monthly", None, TODAY), date(2026, 11, 5))
        self.assertEqual(S.next_charge(date(2025, 11, 20), "yearly", None, TODAY), date(2026, 11, 20))
        self.assertEqual(S.next_charge(date(2026, 8, 5), "monthly", date(2026, 12, 1), TODAY), date(2026, 12, 1))   # date annoncée à venir : prioritaire
        self.assertIsNone(S.next_charge(date(2026, 8, 5), "unknown", None, TODAY))

    def test_monthly_cost(self):
        self.assertEqual(S.monthly_cost(120, "yearly"), 10)
        self.assertEqual(S.monthly_cost(10, "monthly"), 10)
        self.assertEqual(S.monthly_cost(10, "one_time"), 0)


class Aggregate(Base):
    def test_grouping_totals_status(self):
        self.cache([entry("Pixel Lab", "2026-09-03"), entry("Pixel Lab", "2026-10-03", url="https://p.io/cancel"), entry("PIXEL-LAB", "2026-08-03"),
                    entry("Netflix", "2026-10-10", price=13.49), entry("Gym", "2025-12-01", price=30), entry("Old", "2026-06-01", kind="charge", price=5),
                    entry("Old", "2026-09-01", kind="cancellation", price=None), entry("Trialer", "2026-10-20", kind="trial", price=None)])
        d = S.build_list(TODAY)
        by = {s["service"]: s for s in d["subs"]}
        self.assertEqual(len([s for s in d["subs"] if s["key"] == "pixellab"]), 1)
        self.assertEqual(by["Pixel Lab"]["emails"], 3)
        self.assertEqual((by["Pixel Lab"]["next"], by["Pixel Lab"]["days"]), ("2026-11-03", 10))
        self.assertEqual(by["Pixel Lab"]["cancel_url"], "https://p.io/cancel")
        self.assertEqual(by["Gym"]["status"], "dormant")
        self.assertEqual(by["Old"]["status"], "cancelled")
        self.assertEqual(by["Trialer"]["status"], "trial")
        self.assertEqual(d["totals"]["EUR"]["monthly"], 23.48)        # Pixel Lab 9.99 + Netflix 13.49 ; Gym/Old/Trialer exclus
        self.assertEqual(d["totals"]["EUR"]["yearly"], round(23.48 * 12, 2))

    def test_user_state_hides_and_cancels(self):
        self.cache([entry("Netflix", "2026-10-10", price=13.49)])
        S.set_state("netflix", cancelled=True)
        self.assertEqual(S.build_list(TODAY)["subs"][0]["status"], "cancelled")
        S.set_state("netflix", cancelled=False, hidden=True)
        s = S.build_list(TODAY)["subs"][0]
        self.assertTrue(s["hidden"])
        self.assertEqual(S.build_list(TODAY)["totals"], {})

    def test_cancel_info(self):
        self.cache([entry("Pixel Lab", "2026-10-03", sender="no-reply@pixellab.io", method="Écrire à help@pixellab.io")])
        c = S.cancel_info("pixellab")
        self.assertEqual(c["mail"]["to"], "help@pixellab.io")
        self.assertIn("Pixel Lab", c["mail"]["body"])
        self.assertTrue(c["mail"]["mailto"].startswith("mailto:help%40pixellab.io?"))
        self.cache([entry("Svc", "2026-10-03", sender="no-reply@svc.io")])
        self.assertEqual(S.cancel_info("svc")["mail"]["to"], "")
        with self.assertRaises(S.SubsError):
            S.cancel_info("absent")


class Accounts(Base):
    def test_roundtrip_encrypted_and_never_exposed(self):
        class FakeM:
            def logout(self):
                pass
        S._login = lambda *a: FakeM()
        accs = S.add_account("moi@gmail.com", "motdepasse-secret", "", 993)
        self.assertEqual(accs[0]["server"], "imap.gmail.com")
        self.assertNotIn("pw", accs[0])
        with open(os.path.join(self.tmp, "subs_accounts.json"), encoding="utf-8") as f:
            raw = f.read()
        self.assertNotIn("motdepasse-secret", raw)
        self.assertEqual(S._unseal(json.loads(raw)[0]["pw"]), "motdepasse-secret")
        with self.assertRaises(S.SubsError):
            S.add_account("moi@gmail.com", "x", "", 993)               # doublon
        with self.assertRaises(S.SubsError):
            S.add_account("pas-un-mail", "x")
        with self.assertRaises(S.SubsError):
            S.add_account("a@b.fr", "x", "bad host!", 993)
        self.assertEqual(S.remove_account(accs[0]["id"]), [])


MAILS = {
    101: (b"Message-ID: <a1@x>\r\nFrom: Pixel Lab <billing@pixellab.io>\r\nSubject: Votre facture Pixel Lab\r\nDate: Tue, 03 Oct 2026 10:00:00 +0000\r\n\r\n",
          b"Message-ID: <a1@x>\r\nFrom: Pixel Lab <billing@pixellab.io>\r\nSubject: Votre facture Pixel Lab\r\nDate: Tue, 03 Oct 2026 10:00:00 +0000\r\n"
          b"Content-Type: text/html; charset=utf-8\r\n\r\n<p>Montant 9,99 EUR par mois</p><a href=\"https://pixellab.io/account/cancel\">Annuler mon abonnement</a>"),
    102: (b"", b"Message-ID: <a2@x>\r\nFrom: Shop <promo@shop.com>\r\nSubject: Invoice promo\r\nDate: Wed, 04 Oct 2026 10:00:00 +0000\r\n\r\nSolde -50% !"),
}


class FakeIMAP:
    fetched = []

    def select(self, box, readonly=False):
        assert readonly                                                  # jamais d'écriture dans la boîte
        return "OK", [b"2"]

    def uid(self, cmd, *a):
        if cmd == "SEARCH":
            return "OK", [b"101 102" if a[-1] in ("facture", "invoice") else b""]
        ids = [int(x) for x in a[0].split(",")]
        assert "PEEK" in a[1]                                            # BODY.PEEK : n'altère pas l'état « lu »
        if "HEADER" in a[1]:
            out = []
            for u in ids:
                out += [(f"1 (UID {u} BODY[HEADER.FIELDS (MESSAGE-ID FROM SUBJECT DATE)] {{9}}".encode(), MAILS[u][1].split(b"Content-Type")[0] + b"\r\n"), b")"]
            return "OK", out
        FakeIMAP.fetched.append(ids[0])
        return "OK", [(f"1 (UID {ids[0]} BODY[] {{9}}".encode(), MAILS[ids[0]][1]), b")"]

    def logout(self):
        pass


class Scan(Base):
    def setUp(self):
        super().setUp()
        self.calls = []
        self.reply = None
        self.old = (S._login, S.nasko_llm.complete, S.nasko_llm.configured, S.load_config)
        S._login = lambda *a: FakeIMAP()
        S.nasko_llm.configured = lambda cfg: True
        S.load_config = lambda: {}
        FakeIMAP.fetched = []

        def fake(cfg, system, body, max_tokens=0, clean=True):
            self.calls.append(body)
            if self.reply == "boom":
                raise S.nasko_llm.LLMError("limite de débit")
            return self.reply(body)
        S.nasko_llm.complete = fake
        S._login = lambda *a: FakeIMAP()
        with open(os.path.join(self.tmp, "subs_accounts.json"), "w", encoding="utf-8") as f:
            json.dump([{"id": "a1", "email": "moi@gmail.com", "server": "imap.gmail.com", "port": 993, "user": "moi@gmail.com", "pw": S._seal("pw")}], f)

    def tearDown(self):
        S._login, S.nasko_llm.complete, S.nasko_llm.configured, S.load_config = self.old
        super().tearDown()

    @staticmethod
    def llm(body):
        if "Pixel Lab" in body:
            return 'Voici: {"is_subscription": true, "kind": "charge", "service": "Pixel Lab", "price": 9.99, "currency": "EUR", "frequency": "monthly", ' \
                   '"next_billing_date": "2026-11-03", "cancel_url": "https://pixellab.io/account/cancel", "cancel_method": null}'
        return '{"is_subscription": false, "kind": "other", "service": "Shop"}'

    def test_scan_cache_and_list(self):
        self.reply = self.llm
        st = S.scan()
        self.assertEqual((st["found"], st["analyzed"], st["subs"], st["errors"]), (2, 2, 1, []))
        self.assertIn("pixellab.io/account/cancel", self.calls[0] + self.calls[1])           # liens de résiliation transmis au LLM
        d = S.build_list(TODAY)
        self.assertEqual([s["service"] for s in d["subs"]], ["Pixel Lab"])
        self.assertEqual(d["subs"][0]["cancel_url"], "https://pixellab.io/account/cancel")
        self.assertEqual(d["subs"][0]["boxes"], ["moi@gmail.com"])
        self.assertEqual(d["totals"]["EUR"]["monthly"], 9.99)
        n = len(self.calls)
        st2 = S.scan()                                                                       # 2e scan : tout est en cache, zéro appel LLM
        self.assertEqual((st2["new"], st2["analyzed"], len(self.calls)), (0, 0, n))
        self.assertGreater(S.list_accounts()[0]["last_scan"], 0)

    def test_llm_failure_is_not_cached(self):
        self.reply = "boom"
        st = S.scan()
        self.assertEqual(st["analyzed"], 0)
        self.assertTrue(st["errors"])
        self.assertEqual(S._read("subs_cache.json", {}), {})
        self.reply = self.llm
        self.assertEqual(S.scan()["analyzed"], 2)                                            # reprise : les e-mails en échec sont réanalysés

    def test_busy_guard_and_job(self):
        S._job.update(busy=True)
        with self.assertRaises(S.SubsError):
            S.start_scan()


if __name__ == "__main__":
    unittest.main()
