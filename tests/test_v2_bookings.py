"""New booking/progress behaviours. Database tests always roll back."""
from contextlib import contextmanager
from datetime import timedelta
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from v2 import data, ops, bookings, staffing, db

MANAGER = {"id": "test-manager", "role": "manager", "name": "Booking checks"}
CUSTOMER = next(a for a in data.accounts() if a["role"] == "customer")
WORKER = {"id": "test-worker", "role": "worker", "name": "Crew checks", "staff_id": data.staff()[0]["id"]}


def form(**changes):
    options = data.options()
    start = (data.today() + timedelta(days=180)).isoformat()
    return {"name": "Automated check — rolled back", "event_type": options["event_types"][0]["name"],
            "date": start, "end_date": start, "start_time": "10:00", "end_time": "16:00",
            "guests": 100, "area": options["areas"][0]["name"], "venue_type": options["venue_types"][0]["name"],
            "seating_style": options["seating_styles"][0], "service_level": "Premium", "venue_name": "Synthetic hall",
            "open_to_public": True, **changes}


class DateAndRosterTests(unittest.TestCase):
    def test_lead_time_and_customer_cap(self):
        for role in (MANAGER, CUSTOMER):
            with self.assertRaises(ValueError):
                ops.normalise(form(date=(data.today()+timedelta(days=6)).isoformat()), role)
        with self.assertRaises(ValueError):
            ops.normalise(form(guests=1001), CUSTOMER)
        self.assertEqual(ops.normalise(form(guests=1000), CUSTOMER)["guests"], 1000)

    def test_reversed_dates_and_times(self):
        for change in ({"end_date": data.today().isoformat()}, {"end_time": "09:00"}, {"end_time": "10:00"}):
            with self.assertRaises(ValueError):
                ops.normalise(form(**change), MANAGER)

    def test_end_date_span_and_daily_hours(self):
        f = form(end_date=(data.today()+timedelta(days=182)).isoformat())
        e = ops.normalise(f, MANAGER)
        self.assertEqual(e["duration_hours"], 6)
        self.assertEqual(len(data.shift_windows(e)), 3)
        self.assertEqual(data.shift_hours(e), 27)

    def test_leave_on_later_day_is_blocked(self):
        e = ops.normalise(form(end_date=(data.today()+timedelta(days=182)).isoformat()), MANAGER)
        person = data.staff()[0]
        roster = staffing.Roster([], [], [{"staff_id": person["id"], "start_date": data.event_days(e)[1].isoformat(),
                                          "end_date": data.event_days(e)[1].isoformat(), "status": "Approved"}])
        self.assertEqual(roster.status(person["id"], e), "leave")

    def test_week_boundary_hours(self):
        # A Sunday/Monday assignment must split its hours into the two weeks.
        start = data.today()+timedelta(days=180)
        start += timedelta(days=(6-start.weekday()) % 7)
        e = ops.normalise(form(date=start.isoformat(), end_date=(start+timedelta(days=1)).isoformat()), MANAGER)
        person = data.staff()[0]
        roster = staffing.Roster([{"id": "X", "event": e, "plan": {}}], [{"staff_id": person["id"], "event_id": "X"}], [])
        self.assertEqual(roster.hours(person["id"], start), 9)
        self.assertEqual(roster.hours(person["id"], start+timedelta(days=1)), 9)

    def test_overnight_shifts_repeat_daily_and_split_weekly_hours(self):
        start = data.today()+timedelta(days=180)
        start += timedelta(days=(6-start.weekday()) % 7)
        e = {**ops.normalise(form(date=start.isoformat(), end_date=(start+timedelta(days=1)).isoformat()), MANAGER),
             "shift_start": "17:00", "shift_end": "01:00"}
        windows = data.shift_windows(e)
        self.assertEqual(len(windows), 2)
        self.assertEqual(windows[0][0].date(), start)
        self.assertEqual(windows[0][1].date(), start+timedelta(days=1))
        self.assertEqual(data.shift_hours(e), 16)
        person = data.staff()[0]
        roster = staffing.Roster([], [], [])
        roster.add(person["id"], "overnight", e)
        self.assertEqual(roster.hours(person["id"], start), 7)
        self.assertEqual(roster.hours(person["id"], start+timedelta(days=1)), 9)

    def test_overnight_shift_checks_following_day_leave_and_clashes(self):
        e = {**ops.normalise(form(), MANAGER), "shift_start": "17:00", "shift_end": "01:00"}
        next_day = (data.event_days(e)[0]+timedelta(days=1)).isoformat()
        person = data.staff()[0]
        for status, expected in (("Approved", "leave"), ("Pending", "pending_leave")):
            roster = staffing.Roster([], [], [{"staff_id": person["id"], "start_date": next_day,
                                              "end_date": next_day, "status": status}])
            self.assertEqual(roster.status(person["id"], e), expected)
        roster = staffing.Roster([], [], [])
        roster.add(person["id"], "other", {**e, "date": next_day, "end_date": next_day,
                                         "shift_start": "00:30", "shift_end": "02:00"})
        self.assertEqual(roster.status(person["id"], e), "busy")
        roster = staffing.Roster([], [], [])
        roster.add(person["id"], "touching", {**e, "date": next_day, "end_date": next_day,
                                            "shift_start": "01:00", "shift_end": "02:00"})
        self.assertEqual(roster.status(person["id"], e), "free")

    def test_manual_shift_validation_handles_overnight_duration(self):
        person = data.staff()[0]
        row = {"id": "shift-check", "event": ops.normalise(form(), MANAGER),
               "estimate": {"crew": {r: 1 for r in data.ROLES}}, "plan": {}}
        for start, end, valid in (("17:00", "01:00", True), ("17:00", "00:00", True),
                                  ("16:00", "08:00", True), ("09:30", "17:00", True),
                                  ("17:00", "17:00", False), ("16:00", "08:01", False),
                                  ("24:00", "01:00", False), ("17:00", "", False)):
            with self.subTest(start=start, end=end):
                row["plan"]["staff_shifts"] = [{"staff_id": person["id"], "role": person["role"],
                                               "start_time": start, "end_time": end}]
                roster = staffing.Roster([], [], [])
                if valid:
                    result = bookings.selected_suggestion(row, roster)
                    self.assertEqual(result[person["role"]]["staff"][0]["id"], person["id"])
                else:
                    with self.assertRaises(ValueError):
                        bookings.selected_suggestion(row, roster)

    def test_overnight_shift_still_enforces_weekly_cap(self):
        person = data.staff()[0]
        e = {**ops.normalise(form(), MANAGER), "shift_start": "17:00", "shift_end": "01:00"}
        roster = staffing.Roster([], [], [])
        with patch.object(roster, "hours", return_value=person["weekly_cap"]):
            self.assertEqual(roster.status(person["id"], e), "over_hours")

    def test_daily_estimate_scaling_and_floor(self):
        one = ops.normalise(form(), MANAGER)
        three = {**one, "end_date": (data.today()+timedelta(days=182)).isoformat()}
        a, b = ops._predict_one(one), ops._predict_one(three)
        self.assertGreater(a["cost_rm"], 0)
        self.assertEqual(b["cost_rm"], 3*a["cost_rm"])
        self.assertEqual(b["price_rm"], 3*a["price_rm"])
        # Exercise the original zero-cost failure without depending on model weights.
        zero = {**a, "cost_rm": 0, "price_rm": 0, "warnings": []}
        with patch("v2.model.predict", return_value=[zero]):
            fixed = ops._predict_one(one)
        self.assertGreater(fixed["cost_rm"], 0)
        self.assertGreater(fixed["price_rm"], fixed["cost_rm"])
        self.assertTrue(any("minimum" in x for x in fixed["warnings"]))


class PersistedBookingsTests(unittest.TestCase):
    def setUp(self):
        self.context = db.connect(write=True)
        self.conn = self.context.__enter__()
        self.tx = self.conn.transaction(force_rollback=True)
        self.tx.__enter__()
        @contextmanager
        def same_connection(write=False):
            yield self.conn
        self.patches = [patch.object(module, "connect", same_connection) for module in (ops, bookings)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tx.__exit__(None, None, None)
        self.context.__exit__(None, None, None)

    def create(self, days=1):
        f = form(end_date=(data.today()+timedelta(days=179+days)).isoformat())
        result = ops.create_event(CUSTOMER, {"event": f})
        self.id = result["id"]
        return ops.get_event(MANAGER, {"id": self.id})

    def test_customer_choices_survive_and_manual_shift_reaches_worker(self):
        d = self.create(2)
        self.assertEqual(d["event"]["service_level"], "Premium")
        self.assertEqual(d["event"]["venue_name"], "Synthetic hall")
        candidate = next(x for x in d["staff_options"] if x["available"] and d["crew"][x["role"]] > 0)
        pick = {"staff_id": candidate["id"], "role": candidate["role"], "start_time": "09:30", "end_time": "17:00"}
        saved = bookings.save_staffing(MANAGER, {"id": self.id, "expected_version": d["version"], "selections": [pick]})
        with self.assertRaises(ops.Conflict):
            bookings.save_staffing(MANAGER, {"id": self.id, "expected_version": d["version"], "selections": []})
        ops.decide_event(MANAGER, {"id": self.id, "expected_version": saved["version"], "action": "approve"})
        worker = {**WORKER, "staff_id": candidate["id"]}
        job = next(j for j in ops.worker_home(worker)["jobs"] if j["id"] == self.id)
        self.assertEqual(job["report_time"], "09:30")
        self.assertEqual(job["shift_end_time"], "17:00")
        second_day = data.event_days(saved["event"])[1].isoformat()
        cal = ops.calendar(worker, {"from": second_day, "to": second_day})
        self.assertTrue(any(j["id"] == self.id for j in cal["events"]))
        current = ops.get_event(MANAGER, {"id": self.id})
        bookings.save_staffing(MANAGER, {"id": self.id, "expected_version": current["version"],
                                       "selections": [{**pick, "end_time": "17:30"}]})
        job = next(j for j in ops.worker_home(worker)["jobs"] if j["id"] == self.id)
        self.assertEqual(job["shift_end_time"], "17:30")

    def test_shared_task_expense_and_budget_lifecycle(self):
        d = self.create()
        ops.decide_event(MANAGER, {"id": self.id, "action": "approve", "expected_version": d["version"]})
        p = bookings.get_progress(WORKER, {"id": self.id})
        self.assertEqual(p["spent"], 0)
        def change(actor, **body):
            nonlocal p
            p = bookings.update_progress(actor, {"id": self.id, "expected_version": p["version"], **body})
            return p
        change(WORKER, action="add_task", title="Check demo venue", note="Call venue")
        task = p["tasks"][-1]
        change(WORKER, action="update_task", item_id=task["id"], title="Demo venue booked", status="Done", note="Confirmed")
        self.assertEqual(bookings.get_progress(MANAGER, {"id": self.id})["tasks"][-1]["status"], "Done")
        with self.assertRaises(PermissionError):
            change(WORKER, action="set_budget", amount=500)
        change(MANAGER, action="set_budget", amount=500)
        change(WORKER, action="add_expense", title="Venue deposit", amount=100)
        self.assertEqual(p["remaining"], 400)
        expense = p["expenses"][-1]
        change(WORKER, action="update_expense", item_id=expense["id"], title="Deposit corrected", amount=150)
        self.assertEqual(p["remaining"], 350)
        with self.assertRaises(ops.Conflict):
            bookings.update_progress(MANAGER, {"id": self.id, "expected_version": p["version"]-1, "action": "add_task", "title": "Stale"})
        change(WORKER, action="delete_expense", item_id=expense["id"])
        change(WORKER, action="delete_task", item_id=task["id"])
        self.assertEqual(p["remaining"], 500)
        self.assertTrue(p["activity"])
        with self.assertRaises(PermissionError):
            bookings.get_progress(CUSTOMER, {"id": self.id})

    def test_overnight_staffing_persists_through_approval_and_reloads(self):
        d = self.create(2)
        candidate = next(x for x in d["staff_options"] if x["available"] and d["crew"][x["role"]] > 0)
        pick = {"staff_id": candidate["id"], "role": candidate["role"], "start_time": "17:00", "end_time": "01:00"}
        saved = bookings.save_staffing(MANAGER, {"id": self.id, "expected_version": d["version"], "selections": [pick]})
        self.assertEqual(ops.get_event(MANAGER, {"id": self.id})["shift_selections"], [pick])
        ops.decide_event(MANAGER, {"id": self.id, "expected_version": saved["version"], "action": "approve"})
        worker = {**WORKER, "staff_id": candidate["id"]}
        job = next(j for j in ops.worker_home(worker)["jobs"] if j["id"] == self.id)
        self.assertEqual((job["report_time"], job["shift_end_time"]), ("17:00", "01:00"))
        current = ops.get_event(MANAGER, {"id": self.id})
        pick = {**pick, "end_time": "00:30"}
        bookings.save_staffing(MANAGER, {"id": self.id, "expected_version": current["version"], "selections": [pick]})
        reloaded = ops.get_event(MANAGER, {"id": self.id})
        self.assertEqual(reloaded["shift_selections"], [pick])
        roster = ops._state(self.conn)["roster"]
        self.assertEqual(sum(h for _, _, event_id, h in roster.shifts[candidate["id"]] if event_id == self.id), 15)
        job = next(j for j in ops.worker_home(worker)["jobs"] if j["id"] == self.id)
        self.assertEqual(job["shift_end_time"], "00:30")


if __name__ == "__main__":
    unittest.main()
