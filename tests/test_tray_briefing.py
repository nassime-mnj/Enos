"""Barre d'état, notifications interactives, briefing quotidien. Lancer : python tests/test_tray_briefing.py"""
import json
import os
import shutil
import sys
import tempfile
import time
import types
import unittest
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
for name, attrs in {"nasko_llm": {"configured": lambda cfg: False, "complete": lambda *a, **k: "", "LLMError": type("LLMError", (Exception,), {})}}.items():
    sys.modules.setdefault(name, types.ModuleType(name)).__dict__.update(attrs)
import nasko_agenda as A  # noqa: E402
import nasko_agent as G  # noqa: E402
import nasko_autostart as AU  # noqa: E402
import nasko_core  # noqa: E402
import nasko_notify as N  # noqa: E402
import nasko_toast as T  # noqa: E402
import nasko_tray as TR  # noqa: E402

NOW = datetime(2026, 3, 10, 8, 0)           # mardi


class FakeReg:
    HKEY_CURRENT_USER, KEY_READ, REG_SZ = "HKCU", 1, 1

    def __init__(self):
        self.d = {}

    class _K:
        def __init__(s, reg, path): s.reg, s.path = reg, path
        def __enter__(s): return s
        def __exit__(s, *a): return False

    def CreateKey(self, root, path):
        self.d.setdefault(path, {})
        return self._K(self, path)

    def OpenKey(self, root, path, res=0, acc=0):
        if path not in self.d:
            raise FileNotFoundError(path)
        return self._K(self, path)

    def SetValueEx(self, k, name, r, typ, val): self.d[k.path][name] = val
    def QueryValueEx(self, k, name):
        if name not in self.d[k.path]:
            raise FileNotFoundError(name)
        return self.d[k.path][name], 1
    def DeleteValue(self, k, name):
        if name not in self.d[k.path]:
            raise FileNotFoundError(name)
        del self.d[k.path][name]


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self._dd = nasko_core.data_dir
        nasko_core.data_dir = lambda: self.tmp
        self.cfg = {}
        self._lc, self._uc = nasko_core.load_config, nasko_core.update_config
        nasko_core.load_config = lambda: dict(nasko_core.DEFAULT_CONFIG, **self.cfg, user_label="Nassime")
        nasko_core.update_config = lambda v: self.cfg.update(v)
        for m in (A, G, N, TR):
            m.nasko_core = nasko_core
        self.pushed = []
        self._push = N.push
        N.push = lambda title, message, **kw: self.pushed.append((title, message, kw)) or 1
        G.nasko_notify = N
        self._fetch = A.nasko_epita.fetch_sync
        self.zeus, self.moodle = [], []
        A.nasko_epita.fetch_sync = lambda src, cfg=None, *a, **k: {"items": self.zeus if src == "zeus" else self.moodle, "configured": True, "error": "", "age_s": 0}
        A.nasko_core = nasko_core

    def tearDown(self):
        nasko_core.data_dir, nasko_core.load_config, nasko_core.update_config = self._dd, self._lc, self._uc
        N.push = self._push
        A.nasko_epita.fetch_sync = self._fetch
        shutil.rmtree(self.tmp, ignore_errors=True)

    def ev(self, uid, title, start, end, kind="class", loc=""):
        return {"uid": uid, "title": title, "start": start, "end": end, "all_day": False, "kind": kind, "location": loc, "description": ""}


class Toast(Base):
    def test_xml_is_wellformed_escaped_and_silent(self):
        x = T.build_xml('Réunion <b>"X"</b> & co', "Appeler 'le médecin' > 14h", [{"label": "Fait", "verb": "done", "id": "ab12cd34ef"}, {"label": "Reporter à demain", "verb": "snooze", "id": "ab12cd34ef"}], True)
        root = ET.fromstring(x)
        self.assertEqual(root.find(".//audio").get("silent"), "true")
        self.assertEqual([a.get("arguments") for a in root.findall(".//action")], ["enos-action://done/ab12cd34ef", "enos-action://snooze/ab12cd34ef"])
        self.assertEqual(root.findall(".//text")[0].text, 'Réunion <b>"X"</b> & co')                    # affiché tel quel, jamais interprété
        self.assertIsNone(ET.fromstring(T.build_xml("t", "m", [], False)).find(".//audio"))
        self.assertLessEqual(len(ET.fromstring(T.build_xml("t", "m", [{"label": "x", "verb": "open"}] * 9)).findall(".//action")), 3)

    def test_uri_validation(self):
        self.assertEqual(T.parse_uri("enos-action://done/ab12cd34ef"), ("done", "ab12cd34ef"))
        self.assertEqual(T.parse_uri('"enos-action://open"'), ("open", ""))
        for bad in ("http://x", "enos-action://done", "enos-action://done/../../etc", "enos-action://rm/ab12cd34ef", "enos-action://done/ZZZZZZ", "", None, "enos-action://done/ab12cd34ef;calc"):
            with self.assertRaises(ValueError, msg=str(bad)):
                T.parse_uri(bad)

    def test_actions_for_items(self):
        self.assertEqual([a["verb"] for a in T.actions_for({"source": "manual", "task_id": "ab12cd34ef"})], ["done", "snooze"])
        self.assertEqual([a["verb"] for a in T.actions_for({"source": "zeus"})], ["open"])

    def test_done_and_snooze_modify_the_agenda_file(self):
        t = A.add_task("Appeler le médecin", "2026-03-10T14:00")
        r = T.handle_action(f"enos-action://snooze/{t['id']}", NOW)
        self.assertTrue(r["ok"])
        self.assertEqual(A.list_tasks()[0]["due"], "2026-03-11T14:00")                                  # demain, même heure
        old = A.add_task("En retard", "2026-03-05T09:30")
        T.handle_action(f"enos-action://snooze/{old['id']}", NOW)
        self.assertEqual([x for x in A.list_tasks() if x["id"] == old["id"]][0]["due"], "2026-03-11T09:30")   # en retard depuis 5 jours : demain, pas le 6
        r = T.handle_action(f"enos-action://done/{t['id']}", NOW)
        self.assertTrue(r["ok"] and [x for x in A.list_tasks() if x["id"] == t["id"]][0]["done"])
        self.assertFalse(T.handle_action("enos-action://done/ffffffffff", NOW)["ok"])                   # tâche inconnue : message clair
        self.assertFalse(T.handle_action("n'importe quoi")["ok"])
        self.assertEqual(T.handle_action("enos-action://open")["verb"], "open")

    def test_show_native_is_noop_off_windows(self):
        self.assertEqual(T.show_native("<toast/>") if os.name != "nt" else False, False)


class Autostart(unittest.TestCase):
    def test_run_key_and_protocol(self):
        reg = FakeReg()
        self.assertFalse(AU.is_enabled(reg))
        self.assertTrue(AU.set_enabled(True, reg))
        self.assertIn("--background", reg.d[AU.RUN_KEY][AU.RUN_NAME])
        self.assertFalse(AU.set_enabled(False, reg))
        self.assertFalse(AU.set_enabled(False, reg))                                                  # idempotent
        AU.register_notifications("C:\\logo.ico", reg)
        AU.register_notifications("C:\\logo.ico", reg)
        cmd = [v for k, v in reg.d.items() if k.endswith("shell\\open\\command")][0][""]
        self.assertTrue(cmd.endswith('--action "%1"'))
        self.assertEqual(reg.d[r"Software\Classes\\enos-action"]["URL Protocol"], "")
        self.assertEqual(reg.d[r"Software\Classes\AppUserModelId\\" + AU.AUMID]["DisplayName"], "E.N.O.S.")


class Briefing(Base):
    def test_text_examples(self):
        self.zeus = [self.ev("1", "Maths", "2026-03-10T08:30", "2026-03-10T10:30"), self.ev("2", "Algo", "2026-03-10T10:45", "2026-03-10T12:45"), self.ev("3", "Anglais", "2026-03-10T14:00", "2026-03-10T16:00")]
        self.moodle = [{"uid": "m1", "title": "TP Physique", "start": "2026-03-10T23:59", "end": "2026-03-10T23:59", "all_day": False, "kind": "deadline", "done": False},
                       {"uid": "m2", "title": "Projet C", "start": "2026-03-11T23:59", "end": "2026-03-11T23:59", "all_day": False, "kind": "deadline", "done": False}]
        A.add_task("Ranger mon bureau")
        A.add_task("Idée appli")
        txt = G.format_briefing("Nassime", A.briefing_data(NOW), NOW)
        self.assertEqual(txt, "Bonjour Nassime. Aujourd'hui : 3 cours dès 8h30, 1 rendu (TP Physique), 2 notes en attente. Demain : rendu Projet C. Bonne journée !")

    def test_empty_exam_overdue_and_plurals(self):
        self.assertEqual(G.format_briefing("Nassime", A.briefing_data(NOW), NOW), "Bonjour Nassime. Journée libre : rien de prévu. Bonne journée !")
        self.zeus = [self.ev("1", "Maths", "2026-03-10T14:30", "2026-03-10T16:00", kind="exam")]
        A.add_task("Vieux truc", "2026-03-08T10:00")
        A.add_task("Appeler Paul", "2026-03-10T17:00")
        txt = G.format_briefing("Nassime", A.briefing_data(NOW), NOW)
        self.assertIn("contrôle Maths à 14h30", txt)
        self.assertIn("1 tâche : Appeler Paul", txt)
        self.assertIn("1 tâche en retard", txt)

    def test_schedule_catch_up_dnd_and_once_per_day(self):
        self.zeus = [self.ev("1", "Maths", "2026-03-10T08:30", "2026-03-10T10:30")]
        d = {"seen": {}, "feed": []}
        at = lambda h, m=0: NOW.replace(hour=h, minute=m)                                               # noqa: E731
        self.assertEqual(G._daily_briefing(d, at(7, 59), nasko_core.load_config(), False), 0)           # avant l'heure
        self.assertEqual(G._daily_briefing(d, at(8, 0), nasko_core.load_config(), False), 1)
        title, msg, kw = self.pushed[-1]
        self.assertTrue(kw["silent"] and kw["actions"][0]["verb"] == "open" and "BRIEFING" in title)    # silencieux, sans voix
        self.assertEqual(G._daily_briefing(d, at(9, 0), nasko_core.load_config(), False), 0)            # une seule fois par jour
        d2 = {"seen": {}, "feed": []}
        self.assertEqual(G._daily_briefing(d2, at(10, 30), nasko_core.load_config(), False), 1)         # PC allumé en retard : rattrapage
        d3 = {"seen": {}, "feed": []}
        self.assertEqual(G._daily_briefing(d3, at(15, 0), nasko_core.load_config(), False), 0)          # trop tard : on ne dérange plus
        self.cfg["briefing_enabled"] = False
        self.assertEqual(G._daily_briefing({"seen": {}, "feed": []}, at(9), nasko_core.load_config(), False), 0)
        self.assertEqual(G._daily_briefing({"seen": {}, "feed": []}, at(9), nasko_core.load_config(), True), 1)   # « briefing maintenant » force
        self.cfg.update(briefing_enabled=True, briefing_time="06:30")
        self.assertEqual(G._daily_briefing({"seen": {}, "feed": []}, at(7), nasko_core.load_config(), False), 1)  # heure personnalisée

    def test_run_once_respects_pause_and_quiet_hours(self):
        self.zeus = [self.ev("1", "Maths", "2026-03-10T08:30", "2026-03-10T10:30")]
        G.nasko_agenda = A
        G.nasko_agenda.upcoming_for_agent = lambda h=72: []
        self.cfg["notify_paused_until"] = time.time() + 3600
        self.assertTrue(N.paused(nasko_core.load_config()))
        self.assertEqual(G.run_once(), 0)                                                               # ne pas déranger : rien, briefing reporté
        self.assertEqual(self.pushed, [])


class Alerts(Base):
    def test_task_gets_a_card_at_its_due_time_with_buttons(self):
        t = A.add_task("Appeler le médecin", "2026-03-10T14:00")
        item = A._task_item(t)
        d = {"seen": {}, "feed": []}
        now = datetime(2026, 3, 10, 14, 2)
        self.assertEqual(G._alerts(d, [item], now, nasko_core.load_config()), 1)
        title, msg, kw = self.pushed[-1]
        self.assertEqual(msg, "C'est l'heure : Appeler le médecin.")
        self.assertEqual([a["verb"] for a in kw["actions"]], ["done", "snooze"])
        self.assertEqual(G._alerts(d, [item], now + timedelta(minutes=5), nasko_core.load_config()), 0)  # une seule fois
        self.assertEqual(G._alerts({"seen": {}, "feed": []}, [item], datetime(2026, 3, 10, 15, 0), nasko_core.load_config()), 0)   # > 30 min de retard : trop tard

    def test_zeus_alert_only_offers_to_open(self):
        it = {"id": "zeus-1", "source": "zeus", "kind": "class", "title": "Maths", "start": "2026-03-10T08:30", "end": "2026-03-10T10:30", "all_day": False, "location": "B12", "notes": "", "done": False}
        d = {"seen": {}, "feed": []}
        G._alerts(d, [it], datetime(2026, 3, 10, 8, 20), nasko_core.load_config())
        self.assertEqual([a["verb"] for a in self.pushed[-1][2]["actions"]], ["open"])


class Tray(Base):
    def test_menu_spec(self):
        m = {x["id"]: x for x in TR.menu_spec({}, False) if "id" in x}
        self.assertTrue(m["open"]["default"])
        self.assertFalse(m["dnd"]["checked"] or m["autostart"]["checked"])
        self.assertTrue(m["dnd_day"]["enabled"])
        m = {x["id"]: x for x in TR.menu_spec({"notify_paused_until": time.time() + 3000}, True) if "id" in x}
        self.assertTrue(m["dnd"]["checked"] and "réactiver" in m["dnd"]["label"] and m["autostart"]["checked"] and not m["dnd_day"]["enabled"])
        self.assertEqual(sum(1 for x in TR.menu_spec({}) if x.get("sep")), 2)

    def test_pause_helpers(self):
        ts = TR.pause_for(3600)
        self.assertAlmostEqual(ts, time.time() + 3600, delta=5)
        self.assertEqual(self.cfg["notify_paused_until"], ts)
        tm = TR.pause_for(until_tomorrow=True)
        self.assertEqual(datetime.fromtimestamp(tm).hour, 7)
        self.assertGreater(tm, time.time())
        self.assertEqual(TR.pause_for(off=True), 0)
        self.assertFalse(N.paused(nasko_core.load_config()))

    def test_tooltip(self):
        self.assertEqual(TR.tooltip(), "E.N.O.S. — actif en arrière-plan")
        self.assertTrue(TR.tooltip("TP Physique demain 14h").endswith("14h"))

    def test_start_wires_menu_actions_to_callbacks(self):
        """pystray est simulé : on vérifie le câblage (menu, actions, arrêt), pas l'affichage Windows."""
        made = {}

        class Menu:
            SEPARATOR = "---"

            def __init__(self, *items):
                self._items = items

            @property
            def items(self):
                return self._items[0]() if self._items and callable(self._items[0]) else self._items

        class MenuItem:
            def __init__(self, text, action, checked=None, default=False, enabled=True):
                self.text, self.action, self.checked, self.default, self.enabled = text, action, checked, default, enabled

        class Icon:
            def __init__(self, name, image, title, menu):
                self.name, self.image, self.title, self.menu, self.stopped, self.detached = name, image, title, menu, False, False
                made["icon"] = self

            def run_detached(self): self.detached = True
            def stop(self): self.stopped = True
            def update_menu(self): pass

        fake = types.ModuleType("pystray")
        fake.Menu, fake.MenuItem, fake.Icon = Menu, MenuItem, Icon
        old, TR.available = sys.modules.get("pystray"), TR.available
        sys.modules["pystray"] = fake
        TR.available = lambda: True
        calls, auto = [], {"on": False}
        try:
            self.assertTrue(TR.start(lambda: calls.append("open"), lambda: calls.append("brief"), lambda: calls.append("quit"), lambda: auto["on"], lambda on: auto.update(on=on)))
            icon = made["icon"]
            self.assertTrue(icon.detached and TR.active())
            items = [i for i in icon.menu.items if i != Menu.SEPARATOR]
            by = {i.text: i for i in items}
            self.assertTrue(by["Ouvrir E.N.O.S."].default)
            by["Ouvrir E.N.O.S."].action()
            by["Briefing du jour maintenant"].action()
            by["Lancer avec Windows"].action()
            self.assertEqual((calls, auto["on"]), (["open", "brief"], True))                            # « Lancer avec Windows » bascule
            by["Ne pas déranger pendant 1 h"].action()
            self.assertGreater(self.cfg["notify_paused_until"], time.time())
            self.assertTrue(TR.start(None, None, None, None, None))                                     # idempotent
            by["Quitter E.N.O.S."].action()
            self.assertEqual(calls[-1], "quit")
            self.assertTrue(icon.stopped and not TR.active())
            TR._icon["obj"] = None
            # une action qui plante ne doit pas faire tomber l'icône
            TR.start(lambda: 1 / 0, None, None, lambda: False, None)
            [i for i in made["icon"].menu.items if getattr(i, "text", "") == "Ouvrir E.N.O.S."][0].action()
            self.assertTrue(TR.active())
        finally:
            TR.stop()
            TR.available = lambda: False if old is None else True
            if old is None:
                sys.modules.pop("pystray", None)
            else:
                sys.modules["pystray"] = old


if __name__ == "__main__":
    unittest.main()
