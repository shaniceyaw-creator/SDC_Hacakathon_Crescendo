"""Worker month-calendar data remains private and includes every booking day."""
from contextlib import nullcontext
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from v2 import data, ops


PERSON = data.staff()[0]
ACTOR = {"id": "calendar-check", "role": "worker", "staff_id": PERSON["id"]}


def event(event_id, start="2026-10-31", end="2026-11-02", status="Approved"):
    return {
        "id": event_id, "status": status, "source": "synthetic",
        "event": {
            "name": event_id, "event_type": "Exhibition", "date": start, "end_date": end,
            "start_time": "19:00", "end_time": "23:00", "duration_hours": 4,
            "guests": 100, "area": "Kuala Lumpur", "venue_type": "Hall",
            "open_to_public": False, "client_name": "Synthetic customer",
        },
        "estimate": {"crew": {role: 1 for role in data.ROLES}, "price_rm": 2000, "cost_rm": 1500},
        "plan": {"staff_shifts": [{"staff_id": PERSON["id"], "role": PERSON["role"],
                                  "start_time": "17:00", "end_time": "01:00"}]},
    }


class WorkerCalendarTests(unittest.TestCase):
    def setUp(self):
        events = [
            event("own"), event("other-worker"), event("pending", status="Pending"),
            event("past", start="2025-10-15", end="2025-10-15"),
        ]
        self.state = {
            "events": events,
            "assignments": [
                {"event_id": item["id"],
                 "staff_id": "someone-else" if item["id"] == "other-worker" else PERSON["id"],
                 "role": PERSON["role"], "kind": "assigned"} for item in events
            ],
        }

    def calendar(self, start, end, actor=ACTOR):
        with patch.object(ops, "connect", return_value=nullcontext(object())), \
             patch.object(ops, "_state", return_value=self.state):
            return ops.calendar(actor, {"from": start, "to": end})["events"]

    def test_only_own_confirmed_jobs_and_no_financial_details(self):
        rows = self.calendar("2026-10-01", "2026-11-11")
        self.assertEqual([row["id"] for row in rows], ["own"])
        self.assertNotIn("price_rm", rows[0])
        self.assertNotIn("cost_rm", rows[0])

    def test_multi_day_booking_is_returned_in_both_months(self):
        for start, end in (("2026-10-01", "2026-10-31"), ("2026-11-01", "2026-11-02")):
            with self.subTest(start=start):
                rows = self.calendar(start, end)
                self.assertEqual([row["id"] for row in rows], ["own"])
                self.assertEqual((rows[0]["date"], rows[0]["end_date"]), ("2026-10-31", "2026-11-02"))
        self.assertEqual(self.calendar("2026-11-03", "2026-11-30"), [])

    def test_actual_overnight_worker_hours_are_preserved(self):
        row = self.calendar("2026-10-01", "2026-10-31")[0]
        self.assertEqual((row["report_time"], row["shift_end_time"]), ("17:00", "01:00"))
        self.assertEqual((row["start_time"], row["end_time"]), ("19:00", "23:00"))

    def test_previous_month_navigation_can_show_past_assignments(self):
        self.assertEqual([row["id"] for row in self.calendar("2025-10-01", "2025-10-31")], ["past"])

    def test_empty_months_and_other_worker_have_no_jobs(self):
        self.assertEqual(self.calendar("2026-12-01", "2026-12-31"), [])
        self.assertEqual(self.calendar("2026-10-01", "2026-10-31",
                                       {**ACTOR, "staff_id": "unassigned-worker"}), [])

    def test_customers_cannot_use_the_internal_calendar(self):
        with self.assertRaises(PermissionError):
            self.calendar("2026-10-01", "2026-10-31", {"role": "customer"})


if __name__ == "__main__":
    unittest.main()
