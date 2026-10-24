"""EventOps v2 website operations. Called through scripts/eventops_v2_bridge.py.

`actor` is the signed-in demo account, checked by the API server before the call.
Managers see everything; workers only their own jobs; customers only their own requests
and public events.
"""
from __future__ import annotations

import re
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta

from . import data, staffing
from .db import Jsonb, connect, log


class Conflict(Exception):
    """Someone else changed the same thing first (HTTP 409)."""

STAFF_FIRST_SHIFTS = 1  # open shifts per role per event offered to own staff before freelancers


# ------------------------------------------------------------------ accounts

def all_accounts():
    base = data.accounts()
    listed = {a.get("staff_id") for a in base}
    extra = [{"id": f"WK-{s['id']}", "role": "worker", "name": s["name"], "title": s["role_label"],
              "staff_id": s["id"]} for s in data.staff() if s["id"] not in listed]
    return base + extra


def accounts_list():
    acc = all_accounts()
    return {"featured": [a for a in acc if a in data.accounts()], "staff": [a for a in acc if a not in data.accounts()]}


def login(account_id: str):
    for a in all_accounts():
        if a["id"] == account_id:
            return a
    raise ValueError("That demo account could not be found.")


def _require(actor, *roles):
    if actor.get("role") not in roles:
        raise PermissionError("This page is not available for your account.")


# ------------------------------------------------------------------ state

def _state(conn):
    events = conn.execute("SELECT * FROM eo2_events ORDER BY event->>'date', event->>'start_time', id").fetchall()
    assignments = conn.execute("SELECT * FROM eo2_assignments").fetchall()
    leave = conn.execute("SELECT * FROM eo2_leave ORDER BY start_date").fetchall()
    tasks = conn.execute("SELECT * FROM eo2_open_tasks ORDER BY id").fetchall()
    approved = [e for e in events if e["status"] == "Approved"]
    return {"events": events, "by_id": {e["id"]: e for e in events}, "assignments": assignments,
            "leave": leave, "tasks": tasks, "roster": staffing.Roster(approved, assignments, leave)}


def crew_of(row):
    return (row["plan"] or {}).get("crew") or row["estimate"]["crew"]


def price_of(row):
    return (row["plan"] or {}).get("price_rm") or row["estimate"]["price_rm"]


def status_label(row, today=None):
    today = today or data.today()
    if row["status"] == "Approved":
        return "Completed" if (row["event"].get("end_date") or row["event"]["date"]) < today.isoformat() else "Confirmed"
    return {"Pending": "Waiting for review"}.get(row["status"], row["status"])


def summary(row, today=None):
    e = row["event"]
    est = row["estimate"]
    crew = crew_of(row)
    return {
        "id": row["id"], "status": row["status"], "status_label": status_label(row, today),
        "name": e["name"], "event_type": e["event_type"], "date": e["date"], "start_time": e["start_time"],
        "end_time": data.end_time(e), "duration_hours": e["duration_hours"], "guests": e["guests"],
        "end_date": e.get("end_date") or e["date"], "venue_name": e.get("venue_name", ""),
        "area": e["area"], "venue_type": e["venue_type"], "open_to_public": e["open_to_public"],
        "client_name": e["client_name"], "company_name": e.get("company_name", ""),
        "special_request": e.get("special_request", ""), "source": row["source"],
        "crew_total": sum(crew.values()), "price_rm": price_of(row), "cost_rm": est["cost_rm"],
        "submitted_at": row["created_at"].isoformat() if row.get("created_at") else None,
    }


def apply_worker_shift(summary_row, row, staff_id):
    """Keep event times intact; expose the worker's actual reporting/finish time."""
    pick = next((p for p in (row["plan"] or {}).get("staff_shifts", []) if p["staff_id"] == staff_id), None)
    start, end = data.shift_window({**row["event"], **({"shift_start": pick["start_time"], "shift_end": pick["end_time"]} if pick else {})})
    summary_row["report_time"] = start.strftime("%H:%M")
    summary_row["shift_end_time"] = end.strftime("%H:%M")


# ------------------------------------------------------------------ input checks

TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _client_history(client_id):
    return [e for e in data.history() if e["Client_ID"] == client_id]


def normalise(raw: dict, actor: dict, *, defaults_from_history=True, enforce_lead=True) -> dict:
    types = data.event_types()
    etype = raw.get("event_type")
    if etype not in types:
        raise ValueError("Choose an event type from the list.")
    name = str(raw.get("name", "")).strip()
    if not 3 <= len(name) <= 120:
        raise ValueError("Give the event a name (3 to 120 characters).")
    try:
        day = date.fromisoformat(str(raw.get("date")))
    except ValueError:
        raise ValueError("Choose a valid event date.") from None
    if enforce_lead and day < data.today() + timedelta(days=7):
        raise ValueError("Bookings must start at least one week from today (Malaysia time).")
    if day > data.today() + timedelta(days=730):
        raise ValueError("We take bookings up to two years ahead.")
    start = str(raw.get("start_time", ""))
    if not TIME.match(start):
        raise ValueError("Choose a start time.")
    end_day = date.fromisoformat(str(raw.get("end_date") or day.isoformat()))
    if end_day < day or (end_day-day).days > 30:
        raise ValueError("Choose an end date on or after the start, within 31 days. Longer events need a custom discussion.")
    end = str(raw.get("end_time") or "")
    if end:
        if not TIME.match(end) or end <= start:
            raise ValueError("Choose an end time later than the start time each day.")
        duration = (int(end[:2])*60 + int(end[3:]) - int(start[:2])*60 - int(start[3:]))/60
    else:
        duration = float(raw.get("duration_hours") or 0)
    if not 1 <= duration <= 14:
        raise ValueError("Events can run from 1 to 14 hours.")
    guests = int(raw.get("guests") or 0)
    limit = 1000 if actor.get("role") == "customer" else 5000
    if not 10 <= guests <= limit:
        raise ValueError(f"Online bookings support 10–{limit:,} guests. Larger cases need a custom discussion (demo: hello@opusevents.example).")
    data.area(raw.get("area"))

    client_id = raw.get("client_id") or ""
    past = _client_history(client_id) if client_id else []
    same = [e for e in past if e["Event_Type"] == etype]
    template = types[etype]
    venue = raw.get("venue_type") or (same[-1]["Venue_Type"] if same and defaults_from_history else template["venue_type"])
    if venue not in data.venue_settings():
        raise ValueError("Choose a venue type from the list.")
    seating = raw.get("seating_style") or (same[-1]["Seating_Style"] if same and defaults_from_history else template["seating_style"])
    if seating not in options_seating():
        raise ValueError("Choose a seating style from the list.")
    service = raw.get("service_level") or (same[-1]["Service_Level"] if same and defaults_from_history else "Standard")
    if service not in data.SERVICE_LEVELS:
        raise ValueError("Choose Basic, Standard or Premium service.")
    request = str(raw.get("special_request") or "").strip()[:500]
    return {
        "name": name, "event_type": etype, "date": day.isoformat(), "end_date": end_day.isoformat(), "start_time": start,
        "end_time": end or data.end_time({"start_time": start, "duration_hours": duration}),
        "venue_name": str(raw.get("venue_name") or "").strip()[:200],
        "duration_hours": duration, "guests": guests, "area": raw["area"], "venue_type": venue,
        "seating_style": seating, "service_level": service,
        "open_to_public": bool(raw.get("open_to_public", etype == "Fun Run / Charity Run")),
        "special_request": request or "None",
        "client_id": client_id, "client_name": str(raw.get("client_name") or "").strip()[:80] or "Walk-in customer",
        "company_name": str(raw.get("company_name") or "").strip()[:120],
        "client_type": "Corporate" if raw.get("company_name") else "Individual",
        "repeat_client": bool(past),
    }


def options_seating():
    return data.options()["seating_styles"]


def _predict_one(event):
    from . import model
    result = model.predict([event])[0]
    # Small events can extrapolate below zero with linear regression. A transparent
    # labour + transport floor is safer than displaying a free event.
    labour = sum(result["crew"][r] * data.company()["crew_hourly_rate_rm"][r] for r in data.ROLES) * (float(event["duration_hours"]) + data.SETUP_HOURS)
    floor = round(labour + max(80, result["distance_km"] * 4), -1)
    if result["cost_rm"] < floor:
        result["cost_rm"] = floor
        result["price_rm"] = max(result["price_rm"], round(floor * 1.25, -1))
        result["warnings"].append("A crew-labour and transport minimum replaces the model's unusually low cost. Equipment and other supplier costs still need review.")
    days = len(data.event_days(event))
    if days > 1:
        for key in ("cost_rm", "price_rm"):
            result[key] *= days
        result["warnings"].append(f"Multi-day estimate: {days} daily estimates combined; resources are needed each day. This is a planning assumption, not a separately trained multi-day model.")
    result["profit_rm"] = result["price_rm"] - result["cost_rm"]
    result["margin_pct"] = round(result["profit_rm"]/result["price_rm"]*100, 1) if result["price_rm"] else 0
    result["quote_low"] = round(result["price_rm"]*.85/100)*100
    result["quote_high"] = round(result["price_rm"]*1.15/100)*100
    return result


def _with_gaps(suggestion):
    """Preview of what approval will do with each gap: staff first, then freelancers."""
    out = []
    for item in suggestion.values():
        offered = min(item["short"], STAFF_FIRST_SHIFTS)
        out.append({**item, "open_shifts": offered, "freelance": item["short"] - offered})
    return out


def _equipment_check(conn_state, event, equipment, ignore_event=None):
    owned = data.company()["owned_inventory"]
    used = Counter()
    for row in conn_state["events"]:
        if (row["status"] == "Approved" and row["id"] != ignore_event and
            row["event"]["date"] <= (event.get("end_date") or event["date"]) and
            event["date"] <= (row["event"].get("end_date") or row["event"]["date"])):
            for k, v in row["estimate"]["equipment"].items():
                used[k] += v
    out = []
    for k in data.EQUIPMENT:
        need = int(equipment.get(k, 0))
        free = max(0, owned[k] - used[k])
        out.append({"item": k, "label": data.EQUIPMENT_LABEL[k], "needed": need, "in_store": min(need, free),
                    "rent": max(0, need - free)})
    return out


# ------------------------------------------------------------------ manager: dashboard

def _regulars(state, today):
    out = []
    by_client = defaultdict(list)
    for e in data.history():
        by_client[e["Client_ID"]].append(e)
    for c in data.clients():
        if c["Booking_Pattern"] not in ("Annual", "Frequent"):
            continue
        last = by_client[c["Client_ID"]][-1]
        step = 365 if c["Booking_Pattern"] == "Annual" else 135
        expected = date.fromisoformat(last["Event_Date"]) + timedelta(days=step)
        while expected < today - timedelta(days=20):
            expected += timedelta(days=step)
        if (expected - today).days > 120:
            continue
        mine = [r for r in state["events"] if r["event"].get("client_id") == c["Client_ID"]
                and r["status"] in ("Approved", "Pending")
                and abs((date.fromisoformat(r["event"]["date"]) - expected).days) <= 60]
        if any(r["status"] == "Approved" and r["event"]["date"] < today.isoformat() for r in mine):
            continue  # already happened this season
        status = "booked" if any(r["status"] == "Approved" for r in mine) else (
            "requested" if mine else "not_booked")
        out.append({
            "client_id": c["Client_ID"], "company": c["Company_Name"] or c["Contact_Name"],
            "contact": c["Contact_Name"], "pattern": c["Booking_Pattern"], "bookings": c["Bookings"],
            "usual_type": c["Usual_Event_Type"], "usual_request": c["Usual_Request"] or "None",
            "expected_date": expected.isoformat(), "days_away": (expected - today).days,
            "last_event": last["Event_Name"], "last_date": last["Event_Date"],
            "last_guests": last["Guest_Count"], "last_price_rm": last["Selling_Price_RM"],
            "status": status, "event_id": mine[0]["id"] if mine else None,
        })
    order = {"not_booked": 0, "requested": 1, "booked": 2}
    return sorted(out, key=lambda r: (order[r["status"]], r["expected_date"]))


def _season(state, today):
    periods = [p for p in data.peak_periods() if p["end"] >= today.isoformat() and p["label"] != "Mid-Year School Holidays"]
    current = next((p for p in periods if p["start"] <= today.isoformat()), None)
    nxt = current or (periods[0] if periods else None)
    out = {"active": bool(current), "label": nxt["label"] if nxt else None, "start": nxt["start"] if nxt else None,
           "end": nxt["end"] if nxt else None}
    if nxt:
        s, e = nxt["start"], nxt["end"]
        out["days_to_start"] = max(0, (date.fromisoformat(s) - today).days)
        out["confirmed"] = sum(1 for r in state["events"] if r["status"] == "Approved" and s <= r["event"]["date"] <= e)
        out["pending"] = sum(1 for r in state["events"] if r["status"] == "Pending" and s <= r["event"]["date"] <= e)
        ly_s = (date.fromisoformat(s) - timedelta(days=364)).isoformat()
        ly_e = (date.fromisoformat(e) - timedelta(days=364)).isoformat()
        out["last_year"] = sum(1 for h in data.history() if ly_s <= h["Event_Date"] <= ly_e)
    return out


def _strip(state, today):
    end = max(date(today.year + (1 if today.month >= 7 else 0), 3, 31), today + timedelta(days=120))
    days = defaultdict(lambda: {"confirmed": 0, "pending": 0})
    for r in state["events"]:
        d = r["event"]["date"]
        if today.isoformat() <= d <= end.isoformat() and r["status"] in ("Approved", "Pending"):
            days[d]["confirmed" if r["status"] == "Approved" else "pending"] += 1
    bands = [p for p in data.peak_periods() if p["end"] >= today.isoformat() and p["start"] <= end.isoformat()]
    return {"start": today.isoformat(), "end": end.isoformat(), "today": today.isoformat(),
            "bands": bands, "markers": [f for f in data.festivals() if today.isoformat() <= f["date"] <= end.isoformat()],
            "days": [{"date": d, **v} for d, v in sorted(days.items())]}


def _leave_feed(conn, state, today):
    meta = conn.execute("SELECT value FROM eo2_meta WHERE key='leave_sync'").fetchone()
    meta = meta["value"] if meta else {"cycle": 0, "at": None, "changes": []}
    soon = (today + timedelta(days=14)).isoformat()
    names = data.staff_by_id()
    away = [{"staff_id": l["staff_id"], "name": names[l["staff_id"]]["name"],
             "role": names[l["staff_id"]]["role_label"], "start": str(l["start_date"]), "end": str(l["end_date"]),
             "status": l["status"]}
            for l in state["leave"] if str(l["end_date"]) >= today.isoformat() and str(l["start_date"]) <= soon]
    return {"synced_at": meta.get("at"), "changes": meta.get("changes", []), "away_next_14_days": away}


def manager_dashboard(actor):
    _require(actor, "manager")
    from . import model
    today = data.today()
    with connect() as conn:
        state = _state(conn)
        pending_rows = [r for r in state["events"] if r["status"] == "Pending"]
        pending = []
        for r in sorted(pending_rows, key=lambda r: r["created_at"]):
            s = summary(r, today)
            sugg = staffing.suggest(r["event"], crew_of(r), state["roster"])
            s["crew"] = crew_of(r)
            s["short"] = sum(v["short"] for v in sugg.values())
            s["quote_low"], s["quote_high"] = r["estimate"]["quote_low"], r["estimate"]["quote_high"]
            s["margin_pct"] = r["estimate"]["margin_pct"]
            s["repeat_client"] = r["event"].get("repeat_client", False)
            pending.append(s)
        future = [r for r in state["events"] if r["status"] == "Approved" and (r["event"].get("end_date") or r["event"]["date"]) >= today.isoformat()]
        next30 = [r for r in future if r["event"]["date"] <= (today + timedelta(days=30)).isoformat()]
        soon = (today + timedelta(days=30)).isoformat()
        gaps = [t for t in state["tasks"] if today.isoformat() <= state["by_id"][t["event_id"]]["event"]["date"] <= soon]
        open_tasks = [t for t in gaps if t["status"] == "Open"]
        return {
            "today": today.isoformat(),
            "season": _season(state, today),
            "model": model.info(),
            "strip": _strip(state, today),
            "kpis": {
                "pending": len(pending), "confirmed_next_30": len(next30),
                "revenue_next_30": round(sum(price_of(r) for r in next30)),
                "open_shifts": len(open_tasks),
                "freelancers_next_30": sum(1 for t in gaps if t["status"] == "Freelance"),
                "upcoming_total": len(future),
            },
            "pending": pending,
            "next_events": [summary(r, today) for r in next30[:6]],
            "regulars": _regulars(state, today),
            "leave": _leave_feed(conn, state, today),
        }


# ------------------------------------------------------------------ manager: one event

def estimate(actor, payload):
    _require(actor, "manager", "customer")
    event = normalise(payload["event"], actor)
    est = _predict_one(event)
    out = {"event": event, "estimate": est}
    if actor["role"] == "manager":
        with connect() as conn:
            state = _state(conn)
        out["staffing"] = _with_gaps(staffing.suggest(event, est["crew"], state["roster"]))
        out["equipment"] = _equipment_check(state, event, est["equipment"])
    return out


def _next_id(conn):
    row = conn.execute("SELECT max(substring(id from 4)::int) AS n FROM eo2_events").fetchone()
    return f"EV-{max(2000, (row['n'] or 0)) + 1}"


def create_event(actor, payload):
    _require(actor, "manager", "customer")
    raw = dict(payload["event"])
    if actor["role"] == "customer":
        acc = login(actor["id"])
        raw["client_id"] = acc["client_id"]
        raw["client_name"] = acc["name"]
        raw["company_name"] = "" if acc["title"] == "Private customer" else acc["title"]
    event = normalise(raw, actor)
    est = _predict_one(event)
    with connect(write=True) as conn:
        new_id = _next_id(conn)
        conn.execute("INSERT INTO eo2_events (id, status, source, account_id, event, estimate) VALUES (%s,'Pending',%s,%s,%s,%s)",
                     (new_id, actor["role"], actor["id"] if actor["role"] == "customer" else None, Jsonb(event), Jsonb(est)))
        log(conn, actor["name"], "Request sent" if actor["role"] == "customer" else "Event created", new_id,
            name=event["name"], date=event["date"])
    return {"id": new_id, "status": "Pending", "status_label": "Waiting for review",
            "quote_low": est["quote_low"], "quote_high": est["quote_high"], "event": event}


def _event_detail(state, row, today):
    e = row["event"]
    crew = crew_of(row)
    detail = {"summary": summary(row, today), "event": e, "estimate": row["estimate"], "crew": crew,
              "price_rm": price_of(row), "version": row["version"], "decision_note": row["decision_note"],
              "crew_changed": bool((row["plan"] or {}).get("crew")),
              "price_changed": bool((row["plan"] or {}).get("price_rm"))}
    names = data.staff_by_id()
    if row["status"] == "Pending":
        detail["staffing"] = _with_gaps(staffing.suggest(e, crew, state["roster"], ignore_event=row["id"]))
        saved = (row["plan"] or {}).get("staff_shifts")
        if saved is not None:
            detail["staffing"] = _with_gaps({
                role: {"role": role, "label": data.ROLE_LABEL[role], "needed": crew.get(role, 0),
                       "staff": [{"id": p["staff_id"], "name": names[p["staff_id"]]["name"], "note": "Manager selected"}
                                 for p in saved if p["role"] == role and p["staff_id"] in names],
                       "short": max(0, crew.get(role, 0)-sum(p["role"] == role for p in saved))}
                for role in data.ROLES})
    else:
        booked = [a for a in state["assignments"] if a["event_id"] == row["id"]]
        tasks = [t for t in state["tasks"] if t["event_id"] == row["id"]]
        detail["staffing"] = [{
            "role": role, "label": data.ROLE_LABEL[role], "needed": crew.get(role, 0),
            "staff": [{"id": a["staff_id"], "name": names[a["staff_id"]]["name"],
                       "note": "Extra shift" if a["kind"] == "extra" else ""} for a in booked if a["role"] == role],
            "short": sum(1 for t in tasks if t["role"] == role and t["status"] in ("Open", "Freelance")),
            "open_shifts": sum(1 for t in tasks if t["role"] == role and t["status"] == "Open"),
            "freelance": sum(1 for t in tasks if t["role"] == role and t["status"] == "Freelance"),
        } for role in data.ROLES]
    detail["equipment"] = _equipment_check(state, e, row["estimate"]["equipment"], ignore_event=row["id"])
    detail["staff_options"] = []
    for person in data.staff():
        status = state["roster"].status(person["id"], e, ignore_event=row["id"])
        detail["staff_options"].append({"id": person["id"], "name": person["name"], "role": person["role"],
                                       "available": status in ("free", "pending_leave"),
                                       "reason": {"free": "Available", "pending_leave": "Leave request pending", "leave": "On leave",
                                                  "busy": "Already booked", "over_hours": "Weekly hours limit"}[status]})
    default_start, default_end = data.shift_window(e)
    detail["shift_selections"] = (row["plan"] or {}).get("staff_shifts")
    if detail["shift_selections"] is None:
        detail["shift_selections"] = [{"staff_id": s["id"], "role": r["role"],
                                        "start_time": default_start.strftime("%H:%M"), "end_time": default_end.strftime("%H:%M")}
                                       for r in detail["staffing"] for s in r["staff"]]
    cid = e.get("client_id")
    hist = _client_history(cid) if cid else []
    client = next((c for c in data.clients() if c["Client_ID"] == cid), None)
    detail["client"] = {
        "bookings": len(hist), "pattern": client["Booking_Pattern"] if client else "New",
        "usual_request": (client or {}).get("Usual_Request") or "",
        "past": [{"name": h["Event_Name"], "date": h["Event_Date"], "guests": h["Guest_Count"],
                  "price_rm": h["Selling_Price_RM"]} for h in hist[-3:]][::-1],
    }
    return detail


def get_event(actor, payload):
    today = data.today()
    with connect() as conn:
        state = _state(conn)
        row = state["by_id"].get(payload["id"])
        if not row:
            raise LookupError("This event could not be found.")
        if actor["role"] == "customer" and row["account_id"] != actor["id"]:
            raise LookupError("This event could not be found.")
        if actor["role"] == "worker":
            raise PermissionError("This page is not available for your account.")
        detail = _event_detail(state, row, today)
        if actor["role"] == "customer":
            return {"summary": detail["summary"], "quote_low": row["estimate"]["quote_low"],
                    "quote_high": row["estimate"]["quote_high"], "decision_note": row["decision_note"]}
        detail["activity"] = _activity(conn, row["id"])
        return detail


def _activity(conn, event_id):
    return [{"at": a["created_at"].isoformat(), "actor": a["actor"], "action": a["action"], "details": a["details"]}
            for a in conn.execute("SELECT * FROM eo2_activity WHERE event_id=%s ORDER BY id DESC LIMIT 20",
                                  (event_id,)).fetchall()]


def update_event(actor, payload):
    _require(actor, "manager")
    with connect(write=True) as conn:
        row = conn.execute("SELECT * FROM eo2_events WHERE id=%s FOR UPDATE", (payload["id"],)).fetchone()
        if not row:
            raise LookupError("This event could not be found.")
        if row["status"] != "Pending":
            raise ValueError("Only events waiting for review can be changed.")
        if row["version"] != payload.get("expected_version"):
            raise Conflict("Someone else changed this event. Reload to see the latest version.")
        event, est, plan = row["event"], row["estimate"], dict(row["plan"] or {})
        changes = payload.get("event") or {}
        if changes:
            merged = {**event, **changes}
            event = normalise(merged, actor, defaults_from_history=False,
                              enforce_lead=any(k in changes for k in ("date", "end_date")))
            event["repeat_client"] = row["event"].get("repeat_client", False)
            est = _predict_one(event)
        if "crew" in payload:
            crew = payload["crew"]
            if crew is not None:
                crew = {r: max(0, min(60, int(crew.get(r, 0)))) for r in data.ROLES}
                if crew["Event_Coordinators"] < 1:
                    raise ValueError("Every event needs at least one coordinator.")
            plan["crew"] = crew
        if "price_rm" in payload:
            price = payload["price_rm"]
            if price is not None and not 100 <= float(price) <= 2_000_000:
                raise ValueError("Enter a price between RM 100 and RM 2,000,000.")
            plan["price_rm"] = round(float(price), 2) if price is not None else None
        conn.execute("UPDATE eo2_events SET event=%s, estimate=%s, plan=%s, version=version+1, updated_at=now() WHERE id=%s",
                     (Jsonb(event), Jsonb(est), Jsonb(plan), row["id"]))
        log(conn, actor["name"], "Plan edited", row["id"], fields=sorted(changes) + [k for k in ("crew", "price_rm") if k in payload])
        state = _state(conn)
        detail = _event_detail(state, state["by_id"][row["id"]], data.today())
        detail["activity"] = _activity(conn, row["id"])
        return detail


def _book(conn, state, row, actor_name):
    """Book people for an approved event; shortages become open shifts. Returns shortage count."""
    event = row["event"]
    from .bookings import selected_suggestion
    sugg = selected_suggestion(row, state["roster"])
    short = freelance = 0
    for role, item in sugg.items():
        for person in item["staff"]:
            conn.execute("INSERT INTO eo2_assignments (event_id, staff_id, role, kind) VALUES (%s,%s,%s,'assigned')",
                         (row["id"], person["id"], role))
            pick = next((s for s in (row["plan"] or {}).get("staff_shifts", []) if s["staff_id"] == person["id"]), None)
            state["roster"].add(person["id"], row["id"], {**event, **({"shift_start": pick["start_time"], "shift_end": pick["end_time"]} if pick else {})})
        for n in range(item["short"]):
            # Staff first: one gap per role is offered to our own crew for extra pay;
            # the rest are booked from the freelance crew agency.
            status = "Open" if n < STAFF_FIRST_SHIFTS else "Freelance"
            short += status == "Open"
            freelance += status == "Freelance"
            conn.execute("INSERT INTO eo2_open_tasks (event_id, role, hours, pay_rm, status) VALUES (%s,%s,%s,%s,%s)",
                         (row["id"], role, data.shift_hours(event), staffing.extra_pay(role, event), status))
    return short, freelance


def decide_event(actor, payload):
    _require(actor, "manager")
    action = payload.get("action")
    note = str(payload.get("note") or "").strip()[:500]
    with connect(write=True) as conn:
        row = conn.execute("SELECT * FROM eo2_events WHERE id=%s FOR UPDATE", (payload["id"],)).fetchone()
        if not row:
            raise LookupError("This event could not be found.")
        if payload.get("expected_version") not in (None, row["version"]):
            raise Conflict("Someone else changed this event. Reload to see the latest version.")
        if action == "approve":
            if row["status"] == "Approved":
                return {"id": row["id"], "status": "Approved", "open_shifts": 0, "message": "Already approved."}
            if row["status"] != "Pending":
                raise ValueError("Only events waiting for review can be approved.")
            if row["event"]["date"] < data.today().isoformat():
                raise ValueError("This event date has passed.")
            state = _state(conn)
            short, freelance = _book(conn, state, row, actor["name"])
            conn.execute("UPDATE eo2_events SET status='Approved', decision_note=%s, version=version+1, updated_at=now() WHERE id=%s",
                         (note, row["id"]))
            log(conn, actor["name"], "Approved", row["id"], open_shifts=short, freelancers=freelance, price_rm=price_of(row))
            parts = [f"{short} open shift(s) posted to staff for extra pay"] if short else []
            parts += [f"{freelance} freelancer(s) to book"] if freelance else []
            return {"id": row["id"], "status": "Approved", "open_shifts": short,
                    "message": "Approved and crew booked" + (": " + ", ".join(parts) + "." if parts else ".")}
        if action == "decline":
            if row["status"] != "Pending":
                raise ValueError("Only events waiting for review can be declined.")
            conn.execute("UPDATE eo2_events SET status='Declined', decision_note=%s, version=version+1, updated_at=now() WHERE id=%s",
                         (note, row["id"]))
            log(conn, actor["name"], "Declined", row["id"], note=note)
            return {"id": row["id"], "status": "Declined", "open_shifts": 0, "message": "Request declined."}
        if action == "cancel":
            if row["status"] != "Approved" or row["event"]["date"] < data.today().isoformat():
                raise ValueError("Only upcoming confirmed events can be cancelled.")
            conn.execute("DELETE FROM eo2_assignments WHERE event_id=%s", (row["id"],))
            conn.execute("UPDATE eo2_open_tasks SET status='Closed' WHERE event_id=%s", (row["id"],))
            conn.execute("UPDATE eo2_events SET status='Cancelled', decision_note=%s, version=version+1, updated_at=now() WHERE id=%s",
                         (note, row["id"]))
            log(conn, actor["name"], "Cancelled", row["id"], note=note)
            return {"id": row["id"], "status": "Cancelled", "open_shifts": 0, "message": "Event cancelled and crew released."}
    raise ValueError("Choose approve, decline or cancel.")


# ------------------------------------------------------------------ calendar

def calendar(actor, payload):
    start, end = payload.get("from"), payload.get("to")
    date.fromisoformat(start), date.fromisoformat(end)
    today = data.today()
    out = []
    with connect() as conn:
        state = _state(conn)
    if actor["role"] == "manager":
        for r in state["events"]:
            if r["event"]["date"] <= end and (r["event"].get("end_date") or r["event"]["date"]) >= start and r["status"] in ("Approved", "Pending"):
                out.append(summary(r, today))
        seen = {r["event"]["date"] + r["event"]["name"] for r in state["events"]}
        for h in data.history():
            if start <= h["Event_Date"] <= end and h["Event_Date"] + h["Event_Name"] not in seen:
                out.append({"id": h["Event_ID"], "status": "Completed", "status_label": "Completed",
                            "name": h["Event_Name"], "event_type": h["Event_Type"], "date": h["Event_Date"],
                            "start_time": h["Start_Time"], "end_time": h["End_Time"],
                            "duration_hours": h["Duration_Hours"], "guests": h["Guest_Count"], "area": h["Venue_Area"],
                            "venue_type": h["Venue_Type"], "open_to_public": h["Open_To_Public"] == "Yes",
                            "client_name": h["Client_Name"], "company_name": h["Company_Name"],
                            "special_request": h["Special_Request"], "source": "history",
                            "crew_total": h["Total_Crew"], "price_rm": h["Selling_Price_RM"], "cost_rm": h["Total_Cost_RM"],
                            "submitted_at": None})
    elif actor["role"] == "worker":
        mine = {a["event_id"]: a for a in state["assignments"] if a["staff_id"] == actor["staff_id"]}
        for r in state["events"]:
            if r["id"] in mine and r["event"]["date"] <= end and (r["event"].get("end_date") or r["event"]["date"]) >= start and r["status"] == "Approved":
                s = summary(r, today)
                apply_worker_shift(s, r, actor["staff_id"])
                s["my_role"] = data.ROLE_LABEL[mine[r["id"]]["role"]]
                s["extra"] = mine[r["id"]]["kind"] == "extra"
                for k in ("price_rm", "cost_rm"):
                    s.pop(k)
                out.append(s)
    else:
        raise PermissionError("This page is not available for your account.")
    return {"from": start, "to": end, "events": sorted(out, key=lambda s: (s["date"], s["start_time"]))}


# ------------------------------------------------------------------ insights

def insights(actor):
    _require(actor, "manager")
    today = data.today()
    with connect() as conn:
        state = _state(conn)
    rows = [{"date": h["Event_Date"], "type": h["Event_Type"], "price": h["Selling_Price_RM"], "cost": h["Total_Cost_RM"],
             "crew": h["Total_Crew"], "crew_hours": h["Total_Crew"] * h["Crew_Hours_Each"], "name": h["Event_Name"],
             "area": h["Venue_Area"], "guests": h["Guest_Count"], "client": h["Company_Name"] or h["Client_Name"],
             "roles": {r: h[r] for r in data.ROLES}, "done": True} for h in data.history()]
    for r in state["events"]:
        if r["status"] != "Approved":
            continue
        crew = crew_of(r)
        rows.append({"date": r["event"]["date"], "type": r["event"]["event_type"], "price": price_of(r),
                     "cost": r["estimate"]["cost_rm"], "crew": sum(crew.values()),
                     "crew_hours": sum(crew.values()) * (data.shift_hours(r["event"]) + 1),
                     "name": r["event"]["name"], "area": r["event"]["area"], "guests": r["event"]["guests"],
                     "client": r["event"].get("company_name") or r["event"]["client_name"], "roles": crew,
                     "done": r["event"]["date"] < today.isoformat()})
    start = date(today.year - 1, today.month, 1)
    months = []
    d = start
    while len(months) < 18:
        months.append(d.strftime("%Y-%m"))
        d = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
    monthly = []
    for m in months:
        sel = [r for r in rows if r["date"][:7] == m]
        monthly.append({"month": m, "label": f"{data.MONTHS[int(m[5:]) - 1]} {m[2:4]}",
                        "events": len(sel), "revenue": round(sum(r["price"] for r in sel)),
                        "cost": round(sum(r["cost"] for r in sel)), "profit": round(sum(r["price"] - r["cost"] for r in sel)),
                        "crew_hours": round(sum(r["crew_hours"] for r in sel)),
                        "planned": m >= today.strftime("%Y-%m")})
    last12 = [r for r in rows if r["done"] and r["date"] >= (today - timedelta(days=365)).isoformat()]
    prev12 = [r for r in rows if r["done"] and (today - timedelta(days=730)).isoformat() <= r["date"] < (today - timedelta(days=365)).isoformat()]
    def totals(sel):
        n = len(sel) or 1
        revenue = sum(r["price"] for r in sel)
        cost = sum(r["cost"] for r in sel)
        return {"events": len(sel), "revenue": round(revenue), "cost": round(cost), "profit": round(revenue - cost),
                "avg_price": round(revenue / n), "avg_cost": round(cost / n),
                "margin_pct": round((revenue - cost) / revenue * 100, 1) if revenue else 0,
                "avg_crew": round(sum(r["crew"] for r in sel) / n, 1), "crew_hours": round(sum(r["crew_hours"] for r in sel)),
                "avg_guests": round(sum(r["guests"] for r in sel) / n)}
    by_type = []
    for t in sorted({r["type"] for r in last12}):
        sel = [r for r in last12 if r["type"] == t]
        tt = totals(sel)
        by_type.append({"type": t, **tt, "roles": {role: round(sum(r["roles"][role] for r in sel) / len(sel), 1) for role in data.ROLES}})
    customers = Counter()
    for r in last12:
        customers[r["client"]] += r["price"]
    # labour: next 30 days, hours per person
    soon = (today + timedelta(days=30)).isoformat()
    hours = Counter()
    for a in state["assignments"]:
        ev = state["by_id"][a["event_id"]]
        if today.isoformat() <= ev["event"]["date"] <= soon and ev["status"] == "Approved":
            hours[a["staff_id"]] += data.shift_hours(ev["event"])
    people = [{"id": s["id"], "name": s["name"], "role": s["role_label"], "hours_next_30": hours[s["id"]],
               "capacity_next_30": round(s["weekly_cap"] * 30 / 7)} for s in data.staff()]
    open_tasks = [t for t in state["tasks"] if t["status"] == "Open" and state["by_id"][t["event_id"]]["event"]["date"] >= today.isoformat()]
    recent = sorted([r for r in rows if r["done"]], key=lambda r: r["date"], reverse=True)[:8]
    return {
        "today": today.isoformat(), "monthly": monthly,
        "last_12": totals(last12), "previous_12": totals(prev12),
        "by_type": sorted(by_type, key=lambda r: -r["revenue"]),
        "top_customers": [{"name": k, "revenue": round(v)} for k, v in customers.most_common(5)],
        "people": people, "open_shifts": len(open_tasks),
        "open_shift_pay": round(sum(float(t["pay_rm"]) for t in open_tasks)),
        "recent": [{"date": r["date"], "name": r["name"], "type": r["type"], "area": r["area"], "guests": r["guests"],
                    "crew": r["crew"], "price": round(r["price"]), "cost": round(r["cost"])} for r in recent],
    }


# ------------------------------------------------------------------ team & data

def team(actor):
    _require(actor, "manager")
    from . import model
    today = data.today()
    with connect() as conn:
        state = _state(conn)
        feed = _leave_feed(conn, state, today)
    days = [today + timedelta(days=i) for i in range(21)]
    by_staff_day = defaultdict(dict)
    for a in state["assignments"]:
        ev = state["by_id"][a["event_id"]]
        if ev["status"] == "Approved":
            for day in data.event_days(ev["event"]):
                by_staff_day[a["staff_id"]][day.isoformat()] = ev["event"]["name"]
    grid = []
    for s in data.staff():
        cells = []
        for d in days:
            iso = d.isoformat()
            leave = state["roster"].leave_on(s["id"], d)
            if leave == "Approved":
                cells.append({"date": iso, "state": "leave", "label": "On leave"})
            elif iso in by_staff_day[s["id"]]:
                cells.append({"date": iso, "state": "event", "label": by_staff_day[s["id"]][iso]})
            elif leave == "Pending":
                cells.append({"date": iso, "state": "pending_leave", "label": "Leave request pending"})
            else:
                cells.append({"date": iso, "state": "free", "label": "Free"})
        upcoming = sum(1 for a in state["assignments"] if a["staff_id"] == s["id"]
                       and (state["by_id"][a["event_id"]]["event"].get("end_date") or state["by_id"][a["event_id"]]["event"]["date"]) >= today.isoformat())
        grid.append({**s, "upcoming_jobs": upcoming,
                     "hours_this_week": state["roster"].hours(s["id"], today, "week"), "days": cells})
    return {
        "today": today.isoformat(), "days": [d.isoformat() for d in days], "staff": grid, "leave": feed,
        "sources": [
            {"name": "Past events", "detail": "Oct 2023 – Sep 2026", "count": len(data.history())},
            {"name": "Customers", "detail": "with booking pattern", "count": len(data.clients())},
            {"name": "Staff", "detail": "Orbyte staff directory", "count": len(data.staff())},
            {"name": "Leave records", "detail": "Orbyte eLeave", "count": len(state["leave"])},
            {"name": "Bookings", "detail": "confirmed and waiting", "count": sum(1 for r in state["events"] if r["status"] in ("Approved", "Pending"))},
            {"name": "Venue areas", "detail": "KL & Selangor", "count": len(data.areas())},
        ],
        "model": model.info(),
    }


def _reopen_for_leave(conn, state, actor_name):
    """Approved leave beats a job: free the person and post an open shift instead."""
    today = data.today().isoformat()
    changes = []
    for a in list(state["assignments"]):
        ev = state["by_id"][a["event_id"]]
        if ev["status"] != "Approved" or ev["event"]["date"] < today:
            continue
        if state["roster"].leave_on(a["staff_id"], date.fromisoformat(ev["event"]["date"])) == "Approved":
            conn.execute("DELETE FROM eo2_assignments WHERE event_id=%s AND staff_id=%s", (a["event_id"], a["staff_id"]))
            conn.execute("INSERT INTO eo2_open_tasks (event_id, role, hours, pay_rm) VALUES (%s,%s,%s,%s)",
                         (a["event_id"], a["role"], data.shift_hours(ev["event"]), staffing.extra_pay(a["role"], ev["event"])))
            name = data.staff_by_id()[a["staff_id"]]["name"]
            log(conn, actor_name, "Shift reopened", a["event_id"], staff=name, reason="Approved leave")
            changes.append(f"{name} is on leave for {ev['event']['name']}: the shift is now open for extra pay.")
    return changes


def leave_sync(actor):
    _require(actor, "manager")
    today = data.today()
    with connect(write=True) as conn:
        state = _state(conn)
        meta = conn.execute("SELECT value FROM eo2_meta WHERE key='leave_sync'").fetchone()
        meta = meta["value"] if meta else {"cycle": 0}
        cycle = meta.get("cycle", 0) + 1
        names = data.staff_by_id()
        changes = []
        step = cycle % 3
        if step == 1:
            person = data.staff()[(cycle * 5) % len(data.staff())]
            d = today + timedelta(days=(5 - today.weekday()) % 7 or 7)
            conn.execute("INSERT INTO eo2_leave (id, staff_id, start_date, end_date, status) VALUES (%s,%s,%s,%s,'Pending') ON CONFLICT (id) DO NOTHING",
                         (f"SYNC-{cycle}", person["id"], d, d + timedelta(days=1)))
            changes.append(f"New leave request from {person['name']} for {d.strftime('%d %b')} (waiting in Orbyte).")
        elif step == 2:
            pend = [l for l in state["leave"] if l["status"] == "Pending" and l["end_date"] >= today]
            if pend:
                l = pend[0]
                conn.execute("UPDATE eo2_leave SET status='Approved', synced_at=now() WHERE id=%s", (l["id"],))
                changes.append(f"{names[l['staff_id']]['name']}'s leave from {l['start_date'].strftime('%d %b')} was approved in Orbyte.")
        else:
            soon = [a for a in state["assignments"] if a["kind"] == "assigned"
                    and today.isoformat() < state["by_id"][a["event_id"]]["event"]["date"] <= (today + timedelta(days=14)).isoformat()]
            if soon:
                a = sorted(soon, key=lambda a: state["by_id"][a["event_id"]]["event"]["date"])[0]
                d = date.fromisoformat(state["by_id"][a["event_id"]]["event"]["date"])
                conn.execute("INSERT INTO eo2_leave (id, staff_id, start_date, end_date, status) VALUES (%s,%s,%s,%s,'Approved') ON CONFLICT (id) DO NOTHING",
                             (f"SYNC-{cycle}", a["staff_id"], d, d))
                changes.append(f"Emergency leave approved for {names[a['staff_id']]['name']} on {d.strftime('%d %b')}.")
        state = _state(conn)
        changes += _reopen_for_leave(conn, state, actor["name"])
        if not changes:
            changes.append("No leave changes since the last sync.")
        value = {"cycle": cycle, "at": datetime.now(data.MYT).isoformat(), "changes": changes}
        conn.execute("INSERT INTO eo2_meta (key, value) VALUES ('leave_sync', %s) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value",
                     (Jsonb(value),))
        log(conn, actor["name"], "Synced Orbyte eLeave", None, changes=changes)
    return {"synced_at": value["at"], "changes": changes}


# ------------------------------------------------------------------ worker

def worker_home(actor):
    _require(actor, "worker")
    today = data.today()
    me = data.staff_by_id()[actor["staff_id"]]
    names = data.staff_by_id()
    with connect() as conn:
        state = _state(conn)
    mine = [a for a in state["assignments"] if a["staff_id"] == me["id"]]
    jobs = []
    for a in mine:
        row = state["by_id"][a["event_id"]]
        if row["status"] != "Approved" or (row["event"].get("end_date") or row["event"]["date"]) < today.isoformat():
            continue
        s = summary(row, today)
        apply_worker_shift(s, row, me["id"])
        for k in ("price_rm", "cost_rm", "source", "submitted_at"):
            s.pop(k)
        s["my_role"] = data.ROLE_LABEL[a["role"]]
        s["extra"] = a["kind"] == "extra"
        s["extra_pay_rm"] = float(a["pay_rm"]) if a["pay_rm"] is not None else None
        s["setting"] = data.venue_settings().get(row["event"]["venue_type"], "Indoor")
        start, end = data.shift_window(row["event"])
        s["teammates"] = [{"name": names[b["staff_id"]]["name"], "role": data.ROLE_LABEL[b["role"]],
                           "phone": names[b["staff_id"]]["phone"]}
                          for b in state["assignments"] if b["event_id"] == a["event_id"] and b["staff_id"] != me["id"]]
        place = data.area(row["event"]["area"])
        s["lat"], s["lon"] = place["lat"], place["lon"]
        jobs.append(s)
    jobs.sort(key=lambda j: (j["date"], j["start_time"]))
    tasks = []
    for t in state["tasks"]:
        row = state["by_id"][t["event_id"]]
        if t["status"] != "Open" or row["event"]["date"] < today.isoformat() or row["status"] != "Approved":
            continue
        ok, reason = staffing.can_take(me["id"], t["role"], row["event"], row["id"], state["roster"])
        if not ok and (reason.startswith("For ") or reason == "You already work this event"):
            continue
        tasks.append({"id": t["id"], "event_id": row["id"], "name": row["event"]["name"], "date": row["event"]["date"],
                      "end_date": row["event"].get("end_date") or row["event"]["date"],
                      "start_time": row["event"]["start_time"], "end_time": data.end_time(row["event"]),
                      "area": row["event"]["area"], "role": data.ROLE_LABEL[t["role"]], "hours": float(t["hours"]),
                      "pay_rm": float(t["pay_rm"]), "can_take": ok, "reason": reason})
    tasks.sort(key=lambda t: (not t["can_take"], t["date"]))
    leave = [{"id": l["id"], "start": str(l["start_date"]), "end": str(l["end_date"]), "status": l["status"]}
             for l in state["leave"] if l["staff_id"] == me["id"] and str(l["end_date"]) >= today.isoformat()]
    return {
        "today": today.isoformat(),
        "me": {"id": me["id"], "name": me["name"], "role": me["role_label"], "weekly_cap": me["weekly_cap"],
               "hours_this_week": state["roster"].hours(me["id"], today, "week"),
               "hours_this_month": state["roster"].hours(me["id"], today, "month")},
        "jobs": jobs, "open_tasks": tasks[:12], "leave": leave,
        "extra_earned_rm": round(sum(float(a["pay_rm"] or 0) for a in mine if a["kind"] == "extra")),
    }


def take_task(actor, payload):
    _require(actor, "worker")
    with connect(write=True) as conn:
        state = _state(conn)
        task = next((t for t in state["tasks"] if t["id"] == int(payload["task_id"])), None)
        if not task or task["status"] != "Open":
            raise Conflict("Someone else has already taken this shift.")
        row = state["by_id"][task["event_id"]]
        if row["event"]["date"] < data.today().isoformat():
            raise ValueError("This shift has passed.")
        ok, reason = staffing.can_take(actor["staff_id"], task["role"], row["event"], row["id"], state["roster"])
        if not ok:
            raise ValueError(reason + ".")
        conn.execute("UPDATE eo2_open_tasks SET status='Taken', taken_by=%s WHERE id=%s", (actor["staff_id"], task["id"]))
        conn.execute("INSERT INTO eo2_assignments (event_id, staff_id, role, kind, pay_rm) VALUES (%s,%s,%s,'extra',%s)",
                     (row["id"], actor["staff_id"], task["role"], task["pay_rm"]))
        log(conn, actor["name"], "Took an extra shift", row["id"], role=data.ROLE_LABEL[task["role"]], pay_rm=float(task["pay_rm"]))
    return {"ok": True, "message": f"Shift added: {row['event']['name']} on {row['event']['date']}."}


# ------------------------------------------------------------------ customer

def customer_home(actor):
    _require(actor, "customer")
    today = data.today()
    acc = login(actor["id"])
    with connect() as conn:
        state = _state(conn)
    mine = [r for r in state["events"] if r["account_id"] == actor["id"]
            or (r["event"].get("client_id") == acc["client_id"] and r["event"]["date"] >= today.isoformat())]
    requests = []
    for r in sorted(mine, key=lambda r: r["created_at"], reverse=True):
        s = summary(r, today)
        for k in ("cost_rm", "crew_total", "source"):
            s.pop(k)
        s["quote_low"], s["quote_high"] = r["estimate"]["quote_low"], r["estimate"]["quote_high"]
        s["decision_note"] = r["decision_note"]
        if r["status"] != "Approved":
            s.pop("price_rm")
        requests.append(s)
    hist = _client_history(acc["client_id"])
    return {"today": today.isoformat(), "me": acc, "requests": requests,
            "past_events": [{"name": h["Event_Name"], "date": h["Event_Date"], "type": h["Event_Type"]} for h in hist[-3:]][::-1],
            "options": data.options()}


def public_events(actor):
    today = data.today()
    with connect() as conn:
        state = _state(conn)
    groups = defaultdict(list)
    for r in state["events"]:
        e = r["event"]
        if r["status"] == "Approved" and e.get("open_to_public") and (e.get("end_date") or e["date"]) >= today.isoformat():
            groups[e["area"]].append({"id": r["id"], "name": e["name"], "event_type": e["event_type"], "date": e["date"],
                                      "end_date": e.get("end_date") or e["date"], "venue_name": e.get("venue_name", ""),
                                      "start_time": e["start_time"], "end_time": data.end_time(e), "area": e["area"],
                                      "venue_type": e["venue_type"], "guests": e["guests"],
                                      "organiser": e.get("company_name") or e["client_name"]})
    info = {a["name"]: a for a in data.areas()}
    return {"areas": [{"area": k, "state": info[k]["state"], "lat": info[k]["lat"], "lon": info[k]["lon"],
                       "events": sorted(v, key=lambda x: x["date"])}
                      for k, v in sorted(groups.items(), key=lambda kv: (-len(kv[1]), kv[0]))]}


# ------------------------------------------------------------------ assistant facts

def assistant_context(actor):
    _require(actor, "manager")
    d = manager_dashboard(actor)
    with connect() as conn:
        state = _state(conn)
    today = data.today()
    months = Counter(r["event"]["date"][:7] for r in state["events"] if r["status"] == "Approved" and r["event"]["date"] >= today.isoformat())
    lines = [f"Today is {today.isoformat()} (Malaysia). Company: small event company in Petaling Jaya with {len(data.staff())} field staff."]
    s = d["season"]
    if s.get("label"):
        lines.append(f"Next peak season: {s['label']} {s['start']} to {s['end']} ({'active now' if s['active'] else str(s['days_to_start']) + ' days away'}); "
                     f"{s['confirmed']} confirmed, {s['pending']} waiting; same period last year had {s['last_year']} events.")
    m = d["model"]
    if m.get("ready"):
        lines.append("Model peak months: " + ", ".join(data.MONTHS[x - 1] for x in m["peak_months"]) +
                     f". Price estimates are usually within about {m['price_error_pct']}% (synthetic test data).")
    lines.append("Confirmed events per month ahead: " + ", ".join(f"{k}: {v}" for k, v in sorted(months.items())))
    lines.append(f"Next 30 days: {d['kpis']['open_shifts']} open shifts offered to staff, {d['kpis']['freelancers_next_30']} freelancers to book. Confirmed next 30 days: {d['kpis']['confirmed_next_30']} "
                 f"worth RM {d['kpis']['revenue_next_30']:,}.")
    for p in d["pending"]:
        lines.append(f"Waiting for approval: {p['id']} '{p['name']}' ({p['event_type']}) on {p['date']} {p['start_time']}, "
                     f"{p['guests']} guests in {p['area']}; model: crew {p['crew_total']} ({', '.join(f'{data.ROLE_LABEL[k]} {v}' for k, v in p['crew'].items())}), "
                     f"cost RM {p['cost_rm']:,.0f}, price RM {p['price_rm']:,.0f} (margin {p['margin_pct']}%), "
                     f"{p['short']} crew short; request: {p['special_request']}.")
    for r in d["regulars"][:10]:
        lines.append(f"Regular customer {r['company']} ({r['pattern']}): usually {r['usual_type']} around {r['expected_date']}; "
                     f"status {r['status'].replace('_', ' ')}; usual request: {r['usual_request']}.")
    for a in d["leave"]["away_next_14_days"]:
        lines.append(f"Leave: {a['name']} ({a['role']}) {a['start']} to {a['end']} ({a['status']}).")
    for e in d["next_events"]:
        lines.append(f"Upcoming: {e['name']} on {e['date']} {e['start_time']}-{e['end_time']} in {e['area']}, {e['guests']} guests, crew {e['crew_total']}.")
    return {"facts": "\n".join(lines)}


# ------------------------------------------------------------------ reset

def reset(actor, only_if_empty=False):
    """Restore the demo data. With only_if_empty, seed a brand-new database (e.g. first publish) and leave existing data alone."""
    if only_if_empty:
        with connect(write=True) as conn:
            if conn.execute("SELECT 1 FROM eo2_events LIMIT 1").fetchone():
                # Repair invalid saved predictions without resetting user plans.
                broken = conn.execute("SELECT id,event FROM eo2_events WHERE (estimate->>'cost_rm')::numeric <= 0").fetchall()
                for row in broken:
                    conn.execute("UPDATE eo2_events SET estimate=%s,version=version+1 WHERE id=%s", (Jsonb(_predict_one(row["event"])), row["id"]))
                return {"ok": True, "events": 0}
    seeds = data.upcoming_seed()
    known = {c["Client_ID"] for c in data.clients()}
    events = []
    for s in seeds:
        events.append({
            "name": s["Event_Name"], "event_type": s["Event_Type"], "date": s["Event_Date"],
            "start_time": s["Start_Time"], "duration_hours": float(s["Duration_Hours"]), "guests": int(s["Guest_Count"]),
            "area": s["Venue_Area"], "venue_type": s["Venue_Type"], "seating_style": s["Seating_Style"],
            "service_level": s["Service_Level"], "open_to_public": s["Open_To_Public"] == "Yes",
            "special_request": s["Special_Request"], "client_id": s["Client_ID"], "client_name": s["Client_Name"],
            "company_name": s["Company_Name"], "client_type": s["Client_Type"], "repeat_client": s["Client_ID"] in known,
        })
    estimates = [_predict_one(event) for event in events]
    today = data.today()
    with connect(write=True) as conn:
        if only_if_empty and conn.execute("SELECT 1 FROM eo2_events LIMIT 1").fetchone():
            return {"ok": True, "events": 0}
        conn.execute("TRUNCATE eo2_assignments, eo2_open_tasks, eo2_events, eo2_leave, eo2_activity, eo2_meta")
        for l in data.seed_leave():
            conn.execute("INSERT INTO eo2_leave (id, staff_id, start_date, end_date, status) VALUES (%s,%s,%s,%s,%s)",
                         (l["Leave_ID"], l["Staff_ID"], l["Start_Date"], l["End_Date"], l["Status"]))
        for s, event, est in zip(seeds, events, estimates):
            created = s["Submitted_At"] or (date.fromisoformat(s["Event_Date"]) - timedelta(days=45)).isoformat() + "T10:00:00"
            conn.execute("INSERT INTO eo2_events (id, status, source, account_id, event, estimate, created_at) "
                         "VALUES (%s,%s,%s,%s,%s,%s,%s::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')",
                         (s["Event_ID"], s["Status"], s["Source"], s["Account_ID"] or None, Jsonb(event), Jsonb(est), created))
        state = _state(conn)
        for row in state["events"]:
            if row["status"] == "Approved":
                short, freelance = _book(conn, state, row, "System")
                if row["event"]["date"] < today.isoformat() and (short or freelance):
                    conn.execute("UPDATE eo2_open_tasks SET status='Closed' WHERE event_id=%s", (row["id"],))
        log(conn, actor.get("name", "System"), "Demo reset", None, events=len(events))
    return {"ok": True, "events": len(events)}
