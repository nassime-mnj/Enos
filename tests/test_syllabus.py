"""Tests du Syllabus Scanner (nasko_syllabus + extension de nasko_agenda). Lancer : python tests/test_syllabus.py"""
import json
import os
import shutil
import sys
import tempfile
import time
import types
import unittest
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import nasko_agenda as A  # noqa: E402
import nasko_core  # noqa: E402
import nasko_syllabus as S  # noqa: E402

TODAY = date(2025, 9, 10)
LLM_REPLY = {"events": [
    {"title": "Maths – Contrôle 1", "kind": "exam", "date": "2025-10-14", "time": "08:30", "end_time": "10:30", "location": "Salle B12", "notes": None, "recurrence": None},
    {"title": "Physique – TP 2 à rendre", "kind": "deadline", "date": "2025-10-20", "time": None, "end_time": None, "location": None, "notes": "Rapport PDF", "recurrence": None},
    {"title": "Maths – Cours", "kind": "class", "date": "2025-09-15", "time": "08:00", "end_time": "10:00", "location": "A1", "notes": None,
     "recurrence": {"weekdays": [0], "from": "2025-09-15", "until": "2025-10-06", "interval_weeks": 1, "except": ["2025-09-29"]}},
    {"title": "Date impossible", "kind": "exam", "date": "2025-02-31", "time": "10:00"},
    {"title": "Trop ancien", "kind": "exam", "date": "2019-01-10", "time": "10:00"},
    {"title": "", "kind": "exam", "date": "2025-11-01"},
    {"title": "Maths – Contrôle 1", "kind": "exam", "date": "2025-10-14", "time": "08:30"},          # doublon exact
    "n'importe quoi",
]}


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self._dd = nasko_core.data_dir
        nasko_core.data_dir = lambda: self.tmp
        self.calls = []
        fake = types.ModuleType("nasko_llm")

        class LLMError(Exception):
            pass
        fake.LLMError = LLMError
        fake.configured = lambda cfg: True

        def complete(cfg, system, user, max_tokens=160, clean=True):
            self.calls.append(user)
            return "Voici :\n" + json.dumps(self.reply, ensure_ascii=False)
        fake.complete = complete
        self.reply = LLM_REPLY
        self._old = sys.modules.get("nasko_llm")
        sys.modules["nasko_llm"] = fake

    def tearDown(self):
        nasko_core.data_dir = self._dd
        if self._old is not None:
            sys.modules["nasko_llm"] = self._old
        else:
            sys.modules.pop("nasko_llm", None)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def pdf(self, text, name="plan.pdf"):
        import pymupdf
        d = pymupdf.open()
        for chunk in text:
            d.new_page().insert_text((60, 80), chunk, fontsize=10)
        p = os.path.join(self.tmp, name)
        d.save(p)
        return p


class Parsing(Base):
    def test_normalize_validates_expands_and_dedupes(self):
        ev = S.normalize(LLM_REPLY["events"], TODAY)
        titles = [(e["title"], e["date"], e["time"]) for e in ev]
        self.assertEqual(titles, [("Maths – Cours", "2025-09-15", "08:00"), ("Maths – Cours", "2025-09-22", "08:00"), ("Maths – Cours", "2025-10-06", "08:00"),
                                  ("Maths – Contrôle 1", "2025-10-14", "08:30"), ("Physique – TP 2 à rendre", "2025-10-20", "23:59")])      # 29/09 exclu, doublon et invalides rejetés
        exam = ev[3]
        self.assertEqual((exam["duration_min"], exam["time_guess"], exam["kind"]), (120, False, "exam"))
        dl = ev[4]
        self.assertTrue(dl["time_guess"])                                                                                       # heure par défaut signalée comme estimée
        self.assertEqual(S.summary(ev), {"exam": 1, "deadline": 1, "class": 3, "task": 0})

    def test_recurrence_limits(self):
        raw = [{"title": "Cours", "kind": "class", "date": "2025-09-15", "time": "08:00", "recurrence": {"weekdays": [0, 1, 2, 3, 4, 5, 6], "from": "2025-09-15", "until": "2030-01-01"}}]
        ev = S.normalize(raw, TODAY)
        self.assertLessEqual(len(ev), S.MAX_PER_RULE)
        self.assertEqual(S.normalize([{"title": "x", "date": "2025-09-20", "recurrence": {"weekdays": [9], "from": "2025-09-15", "until": "2025-10-01"}}], TODAY)[0]["date"], "2025-09-20")

    def test_chunks_cover_text(self):
        t = "\n".join(f"ligne {i} " + "x" * 80 for i in range(600))
        parts = S.chunks(t, 5000, 300)
        self.assertGreater(len(parts), 5)
        self.assertTrue(parts[0].startswith("ligne 0") and "ligne 599" in parts[-1])
        self.assertTrue(all(len(p) <= 5000 for p in parts))

    def test_read_pdf_docx_txt_and_errors(self):
        p = self.pdf(["Contrôle de maths le 14 octobre 2025 à 8h30 en salle B12, durée deux heures, sans documents"])
        self.assertIn("14 octobre", S.read_document(p))
        import docx
        d = docx.Document()
        d.add_paragraph("Rendu du TP de physique : 20 octobre 2025")
        dp = os.path.join(self.tmp, "p.docx")
        d.save(dp)
        self.assertIn("TP de physique", S.read_document(dp))
        tp = os.path.join(self.tmp, "p.txt")
        open(tp, "w", encoding="latin-1").write("Examen final le 12/01/2026 à 14h - salle é")
        self.assertIn("Examen final", S.read_document(tp))
        import pymupdf
        blank = pymupdf.open()
        blank.new_page()
        bp = os.path.join(self.tmp, "scan.pdf")
        blank.save(bp)
        with self.assertRaises(S.SyllabusError) as cm:
            S.read_document(bp)
        self.assertIn("OCR", str(cm.exception))
        with self.assertRaises(S.SyllabusError):
            S.read_document(os.path.join(self.tmp, "x.exe"))


class Flow(Base):
    def test_analyze_import_undo_and_duplicates(self):
        p = self.pdf(["Plan de cours de maths.\n" * 5])
        res = S.analyze_file(p, TODAY)
        self.assertEqual(res["summary"], {"exam": 1, "deadline": 1, "class": 3, "task": 0})
        self.assertTrue(all(not e["dup"] for e in res["events"]))
        out = S.import_events(res["events"])
        self.assertEqual((out["added"], out["skipped"]), (5, 0))
        tasks = A.list_tasks()
        self.assertEqual(len(tasks), 5)
        exam = [t for t in tasks if t["title"] == "Maths – Contrôle 1"][0]
        self.assertEqual((exam["due"], exam["kind"], exam["duration_min"]), ("2025-10-14T08:30", "exam", 120))
        self.assertIn("Lieu : Salle B12", exam["notes"])
        item = A._task_item(exam)
        self.assertEqual((item["kind"], item["end"]), ("exam", "2025-10-14T10:30"))                      # affiché comme un contrôle dans la semaine
        # un deuxième passage reconnaît ce qui est déjà dans l'agenda
        again = S.analyze_file(p, TODAY)
        self.assertTrue(all(e["dup"] for e in again["events"]))
        self.assertEqual(S.import_events(again["events"])["added"], 0)
        # annulation du lot : tout disparaît, rien d'autre
        A.add_task("Tâche perso", "2025-10-01T10:00")
        self.assertEqual(S.undo_import(out["batch"])["removed"], 5)
        self.assertEqual([t["title"] for t in A.list_tasks()], ["Tâche perso"])

    def test_import_rejects_bad_items(self):
        with self.assertRaises(S.SyllabusError):
            S.import_events([])
        with self.assertRaises(S.SyllabusError):
            S.import_events([{"title": "x", "date": "2025-13-01", "time": "10:00"}])
        with self.assertRaises(S.SyllabusError):
            S.undo_import("../../x")

    def test_no_dates_and_bad_llm(self):
        self.reply = {"events": []}
        with self.assertRaises(S.SyllabusError) as cm:
            S.analyze_file(self.pdf(["Bienvenue dans ce cours.\n" * 4]), TODAY)
        self.assertIn("Aucune date", str(cm.exception))

    def test_job_lifecycle_deletes_upload(self):
        p = self.pdf(["Plan de cours.\n" * 5])
        S.start(p, TODAY)
        for _ in range(100):
            if not S.job()["busy"]:
                break
            time.sleep(0.05)
        j = S.job()
        self.assertEqual(j["error"], "")
        self.assertEqual(j["result"]["summary"]["exam"], 1)
        self.assertFalse(os.path.exists(p))                                                                 # le document déposé n'est pas conservé


if __name__ == "__main__":
    unittest.main()
