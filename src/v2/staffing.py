"""Matches the model's crew numbers to real people: leave, clashes and weekly hours."""
from __future__ import annotations

from datetime import date, datetime, timedelta

from . import data

EXTRA_PAY_FACTOR = 1.5  # open shifts are paid as overtime


class Roster:
    """Snapshot of who is booked when, built from approved events and leave."""

    def __init__(self, events: list[dict], assignments: list[dict], leave: list[dict]):
        self.events = {e["id"]: e for e in events}
        self.shifts = {}  # staff_id -> list of (start, end, event_id, hours)
        for a in assignments:
            ev = self.events.get(a["event_id"])
            if ev:
                selected = next((s for s in (ev.get("plan") or {}).get("staff_shifts", []) if s["staff_id"] == a["staff_id"]), None)
                self.add(a["staff_id"], ev["id"], {**ev["event"], **({"shift_start": selected["start_time"], "shift_end": selected["end_time"]} if selected else {})})
        self.leave = leave

    def add(self, staff_id, event_id, event):
        for start, end in data.shift_windows(event):
            self.shifts.setdefault(staff_id, []).append((start, end, event_id, (end-start).total_seconds()/3600))

    def clash(self, staff_id, start: datetime, end: datetime, ignore_event=None):
        for s, e, event_id, _ in self.shifts.get(staff_id, []):
            if event_id != ignore_event and s < end and start < e:
                return event_id
        return None

    def leave_on(self, staff_id, day: date):
        iso = day.isoformat()
        for row in self.leave:
            if row["staff_id"] == staff_id and str(row["start_date"]) <= iso <= str(row["end_date"]):
                return row["status"]
        return None

    def hours(self, staff_id, day: date, period="week", ignore_event=None):
        total = 0.0
        for s, end, event_id, h in self.shifts.get(staff_id, []):
            if event_id == ignore_event:
                continue
            for d, hours in split_hours(s, end):
                same = d.isocalendar()[:2] == day.isocalendar()[:2] if period == "week" else (d.year, d.month) == (day.year, day.month)
                if same:
                    total += hours
        return total

    def status(self, staff_id, event: dict, ignore_event=None):
        """'free', 'leave', 'pending_leave', 'busy' or 'over_hours' for one event shift."""
        windows = data.shift_windows(event)
        leaves = [self.leave_on(staff_id, d) for s, e in windows for d, _ in split_hours(s, e)]
        if "Approved" in leaves:
            return "leave"
        if any(self.clash(staff_id, s, e, ignore_event) for s, e in windows):
            return "busy"
        person = data.staff_by_id()[staff_id]
        weekly = {}
        for s, e in windows:
            for d, hours in split_hours(s, e):
                key = d.isocalendar()[:2]
                if key not in weekly:
                    weekly[key] = [d, 0]
                weekly[key][1] += hours
        if any(self.hours(staff_id, d, "week", ignore_event) + h > person["weekly_cap"] for d, h in weekly.values()):
            return "over_hours"
        return "pending_leave" if "Pending" in leaves else "free"


def split_hours(start, end):
    """Allocate actual hours across midnight and ISO-week boundaries."""
    cursor = start
    while cursor < end:
        midnight = datetime.combine(cursor.date() + timedelta(days=1), datetime.min.time())
        stop = min(end, midnight)
        yield cursor.date(), (stop-cursor).total_seconds()/3600
        cursor = stop


def suggest(event: dict, crew: dict, roster: Roster, ignore_event=None) -> dict:
    """Pick people for each role. Fewest hours this month first, so work is shared fairly."""
    start = data.shift_window(event)[0].date()
    result = {}
    for role in data.ROLES:
        needed = int(crew.get(role, 0))
        candidates = []
        for person in data.staff():
            if person["role"] != role:
                continue
            state = roster.status(person["id"], event, ignore_event)
            if state in ("free", "pending_leave"):
                candidates.append((state == "pending_leave", roster.hours(person["id"], start, "month", ignore_event),
                                   person["id"], state))
        candidates.sort()
        chosen = [{"id": sid, "name": data.staff_by_id()[sid]["name"],
                   "note": "Leave request pending" if state == "pending_leave" else ""}
                  for _, _, sid, state in candidates[:needed]]
        result[role] = {"role": role, "label": data.ROLE_LABEL[role], "needed": needed,
                        "staff": chosen, "short": max(0, needed - len(chosen))}
    return result


def extra_pay(role: str, event: dict) -> float:
    rate = data.company()["crew_hourly_rate_rm"][role]
    return round(rate * data.shift_hours(event) * EXTRA_PAY_FACTOR / 10) * 10


def can_take(staff_id: str, task_role: str, event: dict, event_id: str, roster: Roster):
    """Extra shifts: same role (anyone may help logistics), not on leave, no clash. No weekly cap."""
    person = data.staff_by_id()[staff_id]
    if task_role != person["role"] and task_role != "Logistics_Crew":
        return False, f"For {data.ROLE_LABEL[task_role].lower()}s"
    windows = data.shift_windows(event)
    if any(roster.leave_on(staff_id, d) == "Approved" for s, e in windows for d, _ in split_hours(s, e)):
        return False, "You are on leave"
    if any(eid == event_id for _, _, eid, _ in roster.shifts.get(staff_id, [])):
        return False, "You already work this event"
    if any(roster.clash(staff_id, s, e) for s, e in windows):
        return False, "Clashes with your other job"
    return True, ""
