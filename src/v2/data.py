"""Read-only company data for the EventOps v2 website (data/v2/)."""
from __future__ import annotations

import csv
import json
import math
from collections import Counter
from datetime import date, datetime, timedelta
from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data/v2"
MYT = ZoneInfo("Asia/Kuala_Lumpur")

ROLES = ["Event_Coordinators", "AV_Technicians", "Logistics_Crew", "Safety_Officers"]
ROLE_LABEL = {"Event_Coordinators": "Event coordinator", "AV_Technicians": "AV technician",
              "Logistics_Crew": "Logistics crew", "Safety_Officers": "Safety officer"}
EQUIPMENT = ["Chairs", "Tables", "Canopy_Tents", "Sound_Systems", "Stage_Platforms", "LED_Screens"]
EQUIPMENT_LABEL = {"Chairs": "Chairs", "Tables": "Tables", "Canopy_Tents": "Canopy tents",
                   "Sound_Systems": "Sound systems", "Stage_Platforms": "Stage platforms", "LED_Screens": "LED screens"}
SERVICE_LEVELS = ["Basic", "Standard", "Premium"]
SETUP_HOURS = 3  # setup + teardown on top of the event itself
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def today() -> date:
    return datetime.now(MYT).date()


def now_local() -> datetime:
    return datetime.now(MYT).replace(tzinfo=None)


def _csv(name):
    with (DATA / name).open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


@lru_cache
def history():
    rows = _csv("events_history.csv")
    for r in rows:
        for k in ("Guest_Count", "Start_Hour", "Duration_Hours", "Month", "Year", "Total_Crew", *ROLES, *EQUIPMENT):
            r[k] = int(r[k])
        for k in ("Total_Cost_RM", "Selling_Price_RM", "Profit_RM", "Labour_Cost_RM", "Crew_Hours_Each",
                  "Distance_From_PJ_KM", "Margin_Pct"):
            r[k] = float(r[k])
    return rows


@lru_cache
def clients():
    rows = _csv("clients.csv")
    for r in rows:
        r["Usual_Month"] = int(r["Usual_Month"])
        r["Bookings"] = int(r["Bookings"])
    return rows


@lru_cache
def areas():
    return [{"name": r["Venue_Area"], "state": r["State"], "lat": float(r["Latitude"]),
             "lon": float(r["Longitude"]), "km": float(r["Distance_From_PJ_KM"])} for r in _csv("venue_areas.csv")]


def area(name):
    for a in areas():
        if a["name"] == name:
            return a
    raise ValueError(f"Choose a venue area from the list (got '{name}').")


@lru_cache
def peak_periods():
    return [{"label": r["Period"], "start": r["Start_Date"], "end": r["End_Date"]} for r in _csv("peak_periods.csv")]


def peak_name(day: date) -> str:
    iso = day.isoformat()
    names = [p["label"] for p in peak_periods() if p["start"] <= iso <= p["end"]]
    return " + ".join(dict.fromkeys(names)) if names else "Normal"


@lru_cache
def festivals():
    return [{"date": r["Date"], "label": r["Label"]} for r in _csv("festivals.csv")]


@lru_cache
def staff():
    return [{"id": r["Staff_ID"], "name": r["Name"], "role": r["Role"], "role_label": ROLE_LABEL[r["Role"]],
             "phone": r["Phone"], "weekly_cap": int(r["Weekly_Hours_Cap"])} for r in _csv("staff.csv")]


def staff_by_id():
    return {s["id"]: s for s in staff()}


@lru_cache
def seed_leave():
    return _csv("leave.csv")


@lru_cache
def upcoming_seed():
    return _csv("upcoming_events.csv")


@lru_cache
def accounts():
    return json.loads((DATA / "accounts.json").read_text())


@lru_cache
def company():
    return json.loads((DATA / "company_profile.json").read_text())


@lru_cache
def event_types():
    """Typical venue, seating, time and length for each event type, learned from history."""
    out = {}
    for etype in sorted({e["Event_Type"] for e in history()}):
        rows = [e for e in history() if e["Event_Type"] == etype]
        common = lambda key: Counter(r[key] for r in rows).most_common(1)[0][0]  # noqa: E731
        out[etype] = {
            "venue_types": [v for v, _ in Counter(r["Venue_Type"] for r in rows).most_common()],
            "seating": [v for v, _ in Counter(r["Seating_Style"] for r in rows).most_common()],
            "venue_type": common("Venue_Type"), "seating_style": common("Seating_Style"),
            "start_hour": common("Start_Hour"), "duration_hours": common("Duration_Hours"),
            "guests": {"min": min(r["Guest_Count"] for r in rows), "max": max(r["Guest_Count"] for r in rows)},
        }
    return out


@lru_cache
def venue_settings():
    return {e["Venue_Type"]: e["Venue_Setting"] for e in history()}


def options():
    return {
        "earliest_booking_date": (today() + timedelta(days=7)).isoformat(),
        "contact_email": "hello@opusevents.example",
        "contact_note": "Demo contact only — not a monitored address. Larger or unusual bookings need a custom discussion.",
        "event_types": [{"name": k, **v} for k, v in event_types().items()],
        "areas": areas(),
        "venue_types": [{"name": k, "setting": v} for k, v in sorted(venue_settings().items())],
        "seating_styles": sorted({e["Seating_Style"] for e in history()}),
        "service_levels": SERVICE_LEVELS,
        "base": company()["base"],
    }


def parse_time(value: str) -> int:
    hour, minute = (value or "00:00").split(":")[:2]
    return int(hour) + (1 if int(minute) >= 30 else 0)


def event_days(event: dict):
    start = date.fromisoformat(event["date"])
    end = date.fromisoformat(event.get("end_date") or event["date"])
    return [start + timedelta(days=n) for n in range((end - start).days + 1)]


def shift_windows(event: dict):
    return [shift_window({**event, "date": d.isoformat()}) for d in event_days(event)]


def shift_window(event: dict):
    """(start, end) datetimes of a crew shift: setup before the event and teardown after."""
    day = date.fromisoformat(event["date"])
    if event.get("shift_start") and event.get("shift_end"):
        begin = datetime.combine(day, datetime.strptime(event["shift_start"], "%H:%M").time())
        end = datetime.combine(day, datetime.strptime(event["shift_end"], "%H:%M").time())
        if end == begin:
            raise ValueError("Shift start and end times must be different.")
        if end < begin:
            end += timedelta(days=1)
        return begin, end
    start_h = int(event["start_time"][:2]) + int(event["start_time"][3:5]) / 60
    begin = datetime.combine(day, datetime.min.time()) + timedelta(hours=start_h)
    end = begin + timedelta(hours=float(event["duration_hours"]))
    return begin - timedelta(hours=SETUP_HOURS - 1), end + timedelta(hours=1)


def shift_hours(event: dict) -> float:
    return sum((end - start).total_seconds() / 3600 for start, end in shift_windows(event))


def end_time(event: dict) -> str:
    if event.get("end_time"):
        return event["end_time"]
    begin = int(event["start_time"][:2]) * 60 + int(event["start_time"][3:5])
    total = begin + int(round(float(event["duration_hours"]) * 60))
    return f"{(total // 60) % 24:02d}:{total % 60:02d}"


def clean_number(value, digits=0):
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    return round(float(value), digits) if digits else int(round(float(value)))
