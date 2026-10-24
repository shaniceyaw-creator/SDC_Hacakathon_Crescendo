"""Shared event delivery work, actual spending and safe manual crew selection."""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime
import math
import re
from uuid import uuid4

from . import data, staffing
from .db import connect, log, Jsonb

DEFAULT_TASKS = ["Venue booking", "Equipment preparation / rental", "Crew confirmation", "Transport and setup", "Supplier confirmation"]
STATUSES = {"Not started", "In progress", "Done", "Blocked"}


def _ops():
    from . import ops
    return ops


def _team(actor):
    _ops()._require(actor, "manager", "worker")


def _row(conn, event_id, approved=True):
    row = conn.execute("SELECT * FROM eo2_events WHERE id=%s FOR UPDATE", (event_id,)).fetchone()
    if not row:
        raise LookupError("Booking not found.")
    if approved and row["status"] != "Approved":
        raise ValueError("Progress is available for confirmed bookings only.")
    return row


def _version(row, payload):
    if row["version"] != payload.get("expected_version"):
        raise _ops().Conflict("A teammate updated this booking. Reload the latest changes before saving.")


def list_bookings(actor, payload):
    _team(actor)
    with connect() as conn:
        return [_ops().summary(r) for r in _ops()._state(conn)["events"] if r["status"] == "Approved"]


def _progress(conn, row):
    saved = (row["plan"] or {}).get("progress") or {}
    tasks = saved.get("tasks", [{"id": f"setup-{i}", "title": title, "status": "Not started", "note": "",
                                 "updated_by": "Not updated yet", "updated_at": ""} for i, title in enumerate(DEFAULT_TASKS)])
    expenses = saved.get("expenses", [])
    budget = float(saved.get("budget", row["estimate"]["cost_rm"]))
    spent = round(sum(float(e["amount"]) for e in expenses), 2)
    return {"event": _ops().summary(row), "version": row["version"], "budget": budget, "spent": spent,
            "remaining": round(budget-spent, 2), "tasks": tasks, "expenses": expenses,
            "activity": _ops()._activity(conn, row["id"])}


def get_progress(actor, payload):
    _team(actor)
    with connect() as conn:
        return _progress(conn, _row(conn, payload["id"]))


def _money(value):
    try:
        number = float(value)
    except (ValueError, TypeError):
        raise ValueError("Enter a valid amount.") from None
    if not math.isfinite(number) or not 0 <= number <= 10_000_000:
        raise ValueError("Use an amount from RM 0 to RM 10,000,000.")
    return round(number, 2)


def update_progress(actor, payload):
    _team(actor)
    action = payload["action"]
    with connect(write=True) as conn:
        row = _row(conn, payload["id"])
        _version(row, payload)
        p = _progress(conn, row)
        if action == "set_budget":
            _ops()._require(actor, "manager")
            p["budget"] = _money(payload.get("amount"))
        else:
            collection = "expenses" if action.endswith("expense") else "tasks"
            items = deepcopy(p[collection])
            item = next((r for r in items if r["id"] == payload.get("item_id")), None)
            if not action.startswith("add_") and item is None:
                raise LookupError("This item was removed. Reload the booking.")
            if action.startswith("delete_"):
                items.remove(item)
            else:
                if item is None:
                    item = {"id": str(uuid4())}
                    items.append(item)
                title = str(payload.get("title", item.get("title", ""))).strip()
                if not 1 <= len(title) <= 160:
                    raise ValueError("Enter a title from 1 to 160 characters.")
                item.update(title=title, updated_by=actor["name"], updated_at=datetime.now(data.MYT).isoformat())
                if collection == "tasks":
                    status = payload.get("status", item.get("status", "Not started"))
                    if status not in STATUSES:
                        raise ValueError("Choose a task status.")
                    item.update(status=status, note=str(payload.get("note", item.get("note", "")))[:1500])
                else:
                    item["amount"] = _money(payload.get("amount", item.get("amount")))
                    receipt_path = payload.get("receipt_path", item.get("receipt_path", ""))
                    receipt_name = payload.get("receipt_name", item.get("receipt_name", ""))
                    if receipt_path:
                        rid = str(receipt_path).rsplit("/", 1)[-1]
                        receipt = conn.execute("SELECT value FROM eo2_meta WHERE key=%s", (f"receipt:{rid}",)).fetchone()
                        if not receipt or receipt["value"]["event_id"] != row["id"] or receipt["value"]["path"] != receipt_path:
                            raise ValueError("Upload a receipt for this booking first.")
                        receipt_name = receipt["value"]["name"]
                    item.update(receipt_path=receipt_path, receipt_name=receipt_name)
            p[collection] = items
        plan = dict(row["plan"] or {})
        plan["progress"] = {k: p[k] for k in ("budget", "tasks", "expenses")}
        conn.execute("UPDATE eo2_events SET plan=%s, version=version+1, updated_at=now() WHERE id=%s",
                     (Jsonb(plan), row["id"]))
        log(conn, actor["name"], action.replace("_", " ").capitalize(), row["id"],
            item_id=payload.get("item_id"), title=payload.get("title"), amount=payload.get("amount"))
        return _progress(conn, _row(conn, row["id"]))


def receipt(actor, payload):
    _team(actor)
    rid = payload["receipt_id"]
    if not re.fullmatch(r"[a-f0-9-]{36}", rid):
        raise ValueError("Invalid receipt.")
    with connect(write=payload.get("register", False)) as conn:
        _row(conn, payload["id"])
        if payload.get("register"):
            metadata = {k: payload[k] for k in ("path", "name", "content_type")}
            metadata["event_id"] = payload["id"]
            conn.execute("INSERT INTO eo2_meta (key,value) VALUES (%s,%s)", (f"receipt:{rid}", Jsonb(metadata)))
            log(conn, actor["name"], "Demo receipt uploaded", payload["id"], name=payload["name"])
            return metadata
        row = conn.execute("SELECT value FROM eo2_meta WHERE key=%s", (f"receipt:{rid}",)).fetchone()
        if not row or row["value"]["event_id"] != payload["id"]:
            raise LookupError("Receipt not found.")
        return row["value"]


def selected_suggestion(row, roster):
    """Recheck saved selections against the live roster before reserving anything."""
    selections = (row["plan"] or {}).get("staff_shifts")
    if selections is None:
        return staffing.suggest(row["event"], _ops().crew_of(row), roster, ignore_event=row["id"])
    result = {r: {"role": r, "label": data.ROLE_LABEL[r], "needed": _ops().crew_of(row)[r], "staff": [], "short": 0}
              for r in data.ROLES}
    seen = set()
    for pick in selections:
        person = data.staff_by_id().get(pick["staff_id"])
        role = pick["role"]
        if not person or role not in data.ROLES or person["role"] != role or person["id"] in seen:
            raise ValueError("Choose each worker once, in their qualified role.")
        seen.add(person["id"])
        start, end = pick["start_time"], pick["end_time"]
        if not _ops().TIME.fullmatch(start) or not _ops().TIME.fullmatch(end):
            raise ValueError("Choose valid start and end times for each shift.")
        shifted = {**row["event"], "shift_start": start, "shift_end": end}
        shift_start, shift_end = data.shift_window(shifted)
        if (shift_end - shift_start).total_seconds() > 16*3600:
            raise ValueError("A crew shift may not exceed 16 hours per day.")
        status = roster.status(person["id"], shifted, ignore_event=row["id"])
        if status not in ("free", "pending_leave"):
            reason = {"leave": "on leave", "busy": "booked elsewhere", "over_hours": "over their weekly hours limit"}[status]
            raise ValueError(f"{person['name']} is {reason}. Change the shift or choose another worker.")
        result[role]["staff"].append({"id": person["id"], "name": person["name"],
                                     "note": "Leave request pending" if status == "pending_leave" else ""})
    for role, item in result.items():
        if len(item["staff"]) > item["needed"]:
            raise ValueError(f"Choose no more than {item['needed']} workers for {item['label']}.")
        item["short"] = item["needed"] - len(item["staff"])
    return result


def save_staffing(actor, payload):
    _ops()._require(actor, "manager")
    with connect(write=True) as conn:
        row = _row(conn, payload["id"], approved=False)
        if row["status"] not in ("Pending", "Approved"):
            raise ValueError("Only pending or confirmed plans can change crew.")
        _version(row, payload)
        plan = dict(row["plan"] or {})
        if payload.get("use_recommendation"):
            plan.pop("staff_shifts", None)
        else:
            plan["staff_shifts"] = payload["selections"]
        row["plan"] = plan
        state = _ops()._state(conn)
        selected_suggestion(row, state["roster"])
        conn.execute("UPDATE eo2_events SET plan=%s, version=version+1, updated_at=now() WHERE id=%s",
                     (Jsonb(plan), row["id"]))
        if row["status"] == "Approved":
            conn.execute("DELETE FROM eo2_assignments WHERE event_id=%s", (row["id"],))
            conn.execute("DELETE FROM eo2_open_tasks WHERE event_id=%s", (row["id"],))
            _ops()._book(conn, state, row, actor["name"])
        log(conn, actor["name"], "Crew shifts updated", row["id"], recommendation=payload.get("use_recommendation", False))
        state = _ops()._state(conn)
        result = _ops()._event_detail(state, state["by_id"][row["id"]], data.today())
        result["activity"] = _ops()._activity(conn, row["id"])
        return result
