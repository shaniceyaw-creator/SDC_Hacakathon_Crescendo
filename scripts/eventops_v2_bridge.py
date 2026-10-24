"""JSON-only adapter between the API server and the EventOps v2 website logic (src/v2).

Usage: python scripts/eventops_v2_bridge.py <operation>  with {"actor": {...}, ...} on stdin,
   or: python scripts/eventops_v2_bridge.py --serve   (used by the API server; JSON lines).
The API server checks the signed-in account; this script never trusts the browser directly.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from v2 import data, ops, bookings  # noqa: E402
from v2.model import ModelUnavailable  # noqa: E402

OPERATIONS = {
    "accounts": lambda a, p: ops.accounts_list(),
    "login": lambda a, p: ops.login(p["account_id"]),
    "options": lambda a, p: data.options(),
    "manager-dashboard": lambda a, p: ops.manager_dashboard(a),
    "estimate": ops.estimate,
    "create-event": ops.create_event,
    "get-event": ops.get_event,
    "update-event": ops.update_event,
    "decide-event": ops.decide_event,
    "calendar": ops.calendar,
    "list-bookings": bookings.list_bookings,
    "booking-progress": bookings.get_progress,
    "update-progress": bookings.update_progress,
    "save-staffing": bookings.save_staffing,
    "receipt": bookings.receipt,
    "insights": lambda a, p: ops.insights(a),
    "team": lambda a, p: ops.team(a),
    "leave-sync": lambda a, p: ops.leave_sync(a),
    "worker-home": lambda a, p: ops.worker_home(a),
    "take-task": ops.take_task,
    "customer-home": lambda a, p: ops.customer_home(a),
    "public-events": lambda a, p: ops.public_events(a),
    "assistant-context": lambda a, p: ops.assistant_context(a),
    "reset": lambda a, p: ops.reset(a),
    # On start-up: load the model and fill an empty database (a new published copy) with the demo data.
    "warm": lambda a, p: {"seeded": ops.reset({"name": "System"}, only_if_empty=True)["events"]},
}


def handle(operation, payload):
    try:
        if operation not in OPERATIONS:
            raise ValueError("Unsupported operation.")
        return {"ok": True, "result": OPERATIONS[operation](payload.get("actor") or {}, payload)}
    except ModelUnavailable as exc:
        return {"ok": False, "status": 503, "error": str(exc)}
    except PermissionError as exc:
        return {"ok": False, "status": 403, "error": str(exc)}
    except LookupError as exc:
        return {"ok": False, "status": 404, "error": str(exc).strip("'\"")}
    except ops.Conflict as exc:
        return {"ok": False, "status": 409, "error": str(exc)}
    except (ValueError, TypeError) as exc:
        return {"ok": False, "status": 400, "error": str(exc)}
    except Exception as exc:  # never leak tracebacks or connection strings to the browser
        print(f"bridge error in {operation}: {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
        return {"ok": False, "status": 503, "error": "The planning service is temporarily unavailable. Please retry."}


def serve():
    """Long-running mode: one JSON request per stdin line, one JSON reply per stdout line.
    Keeps the model and data in memory so pages load quickly."""
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            request = json.loads(line)
            reply = handle(request.get("op", ""), request.get("payload") or {})
            reply["id"] = request.get("id")
        except json.JSONDecodeError:
            reply = {"ok": False, "status": 400, "error": "Unreadable request.", "id": None}
        sys.stdout.write(json.dumps(reply, default=str, allow_nan=False) + "\n")
        sys.stdout.flush()


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--serve":
        serve()
        return
    operation = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError:
        payload = {}
    print(json.dumps(handle(operation, payload), default=str, allow_nan=False))


if __name__ == "__main__":
    main()
