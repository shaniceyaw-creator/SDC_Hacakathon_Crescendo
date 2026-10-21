"""Build and validate an entirely synthetic EventOps worker dataset.

Standard-library only. Run with Python 3.10+.
"""

from collections import Counter, defaultdict
import csv
from datetime import date, datetime, time, timedelta
import hashlib
import json
from pathlib import Path
import random
import shutil
import zipfile


SEED = 42
YEAR = 2026
ROLES = ("Logistics Crew", "Event Coordinator", "AV Technician", "Safety Coordinator")
TIMEZONE = "Asia/Kuala_Lumpur"
SCHEMAS = {
    "staff.csv": [
        "Staff_ID", "Display_Name", "Role", "Primary_Skill",
        "Max_Weekly_Hours", "Active", "Employment_Type", "eOT_Eligible",
    ],
    "staff_leave.csv": [
        "Leave_ID", "Staff_ID", "Start_Date", "End_Date", "Approval_Status",
    ],
    "staff_assignments.csv": [
        "Assignment_ID", "Staff_ID", "Event_ID", "Start_DateTime",
        "End_DateTime", "Assignment_Status",
    ],
    "seed_events.csv": [
        "Event_ID", "Event_Name", "Record_Type", "Event_Type",
        "Start_DateTime", "End_DateTime",
    ],
    "demo_cases.csv": [
        "Case_ID", "Description", "Start_DateTime", "End_DateTime",
        "Required_Logistics", "Required_Coordinators", "Required_AV",
        "Required_Safety", "Total_Crew_Required",
        "Expected_Available_FullTime", "Expected_Assignable_FullTime",
        "Expected_PartTimers_Required", "Expected_Role_Shortages",
    ],
    "demo_availability_expected.csv": [
        "Case_ID", "Staff_ID", "Display_Name", "Role", "Eligible",
        "Exclusion_Reasons", "Booked_Hours_Start_Week",
        "Free_Hours_Start_Week", "Proposed_Hours_Start_Week",
        "All_Weeks_Within_Limit",
    ],
}


def dt(value):
    return datetime.strptime(str(value), "%Y-%m-%d %H:%M")


def fmt(value):
    return value.strftime("%Y-%m-%d %H:%M")


def overlap(a, b, c, d):
    """Half-open datetime intervals: an end exactly at a start is not overlap."""
    return a < d and c < b


def week_start(value):
    return value.date() - timedelta(days=value.weekday())


def split_week_hours(start, end):
    assert start < end
    hours = defaultdict(float)
    cursor = start
    while cursor < end:
        monday = week_start(cursor)
        boundary = datetime.combine(monday + timedelta(days=7), time.min)
        stop = min(end, boundary)
        hours[monday] += (stop - cursor).total_seconds() / 3600
        cursor = stop
    return dict(hours)


def leave_interval(row):
    # Leave dates include the whole final day.
    return (
        datetime.combine(date.fromisoformat(row["Start_Date"]), time.min),
        datetime.combine(
            date.fromisoformat(row["End_Date"]) + timedelta(days=1), time.min
        ),
    )


def weekly_bookings(assignments, staff_id):
    totals = defaultdict(float)
    for row in assignments:
        if row["Staff_ID"] == staff_id and row["Assignment_Status"] == "Confirmed":
            for week, hours in split_week_hours(
                dt(row["Start_DateTime"]), dt(row["End_DateTime"])
            ).items():
                totals[week] += hours
    return dict(totals)


def eligibility(worker, leaves, assignments, start, end):
    reasons = []
    if not worker["Active"]:
        reasons.append("Inactive")
    if any(
        row["Staff_ID"] == worker["Staff_ID"]
        and row["Approval_Status"] == "Approved"
        and overlap(start, end, *leave_interval(row))
        for row in leaves
    ):
        reasons.append("Approved_Leave")
    if any(
        row["Staff_ID"] == worker["Staff_ID"]
        and row["Assignment_Status"] == "Confirmed"
        and overlap(start, end, dt(row["Start_DateTime"]), dt(row["End_DateTime"]))
        for row in assignments
    ):
        reasons.append("Booking_Conflict")
    booked = weekly_bookings(assignments, worker["Staff_ID"])
    required = split_week_hours(start, end)
    hours_ok = all(
        booked.get(week, 0) + hours <= worker["Max_Weekly_Hours"] + 1e-9
        for week, hours in required.items()
    )
    if not hours_ok:
        reasons.append("Weekly_Hour_Limit")
    start_week = week_start(start)
    return {
        "Eligible": not reasons,
        "Exclusion_Reasons": ";".join(reasons) if reasons else "None",
        "Booked_Hours_Start_Week": round(booked.get(start_week, 0), 2),
        "Free_Hours_Start_Week": round(
            max(0, worker["Max_Weekly_Hours"] - booked.get(start_week, 0)), 2
        ),
        "Proposed_Hours_Start_Week": round(required[start_week], 2),
        "All_Weeks_Within_Limit": hours_ok,
    }


def write_csv(path, rows):
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle, fieldnames=SCHEMAS[path.name], lineterminator="\n"
        )
        writer.writeheader()
        writer.writerows(rows)


def build():
    output = Path("deliverables/worker_dataset_2026")
    output.mkdir(parents=True, exist_ok=True)
    names = [
        "Aina Faris", "Ben Lee", "Chen Iman", "Dev Tan", "Elise Noor",
        "Farid Ong", "Grace Amir", "Haris Lim", "Iman Chen",
        "Jamie Rahman", "Kai Devi", "Lina Wong",
    ]
    skills = [
        "Furniture_Setup", "Stage_Setup", "Transport_Logistics",
        "Tentage_Setup", "Furniture_Setup", "Load_In_Out",
        "Banquet_Coordination", "Vendor_Coordination", "Client_Protocol",
        "Sound_Operations", "Lighting_Operations", "Crowd_Safety",
    ]
    overtime = [True, True, False, True, True, True, False, True, True, True, False, False]
    staff = []
    for i, (name, skill, ot) in enumerate(zip(names, skills, overtime), 1):
        role = ROLES[0] if i <= 6 else ROLES[1] if i <= 9 else ROLES[2] if i <= 11 else ROLES[3]
        staff.append({
            "Staff_ID": f"STF-{i:03d}", "Display_Name": name, "Role": role,
            "Primary_Skill": skill, "Max_Weekly_Hours": 40, "Active": True,
            "Employment_Type": "FullTime", "eOT_Eligible": ot,
        })
    staff_by_id = {row["Staff_ID"]: row for row in staff}
    leaves = []

    def add_leave(staff_id, start, end, status="Approved"):
        leaves.append({
            "Leave_ID": f"LV-{len(leaves) + 1:03d}", "Staff_ID": staff_id,
            "Start_Date": start, "End_Date": end, "Approval_Status": status,
        })

    for i in range(1, 13):
        first_month = i
        second_month = ((i + 5) % 12) + 1
        add_leave(f"STF-{i:03d}", f"2026-{first_month:02d}-07", f"2026-{first_month:02d}-09")
        add_leave(f"STF-{i:03d}", f"2026-{second_month:02d}-21", f"2026-{second_month:02d}-23")
    add_leave("STF-001", "2026-10-23", "2026-10-25")
    add_leave("STF-007", "2026-10-24", "2026-10-24")
    add_leave("STF-010", "2026-10-24", "2026-10-24")
    add_leave("STF-003", "2026-10-28", "2026-10-29", "Pending")
    add_leave("STF-005", "2026-10-28", "2026-10-28", "Rejected")
    add_leave("STF-004", "2026-12-31", "2027-01-02")

    events, assignments = [], []

    def add_event(event_id, name, kind, event_type, start, end):
        row = {
            "Event_ID": event_id, "Event_Name": name, "Record_Type": kind,
            "Event_Type": event_type, "Start_DateTime": start, "End_DateTime": end,
        }
        events.append(row)
        return row

    def add_assignment(worker_id, event, status="Confirmed"):
        assignments.append({
            "Assignment_ID": f"ASG-{len(assignments) + 1:04d}",
            "Staff_ID": worker_id, "Event_ID": event["Event_ID"],
            "Start_DateTime": event["Start_DateTime"],
            "End_DateTime": event["End_DateTime"],
            "Assignment_Status": status,
        })

    for n, day in enumerate(range(19, 23), 1):
        event = add_event(
            f"WORK2026-OCT-{n:02d}", f"Synthetic equipment preparation {n}",
            "Internal_Work", "Not_Applicable", f"2026-10-{day:02d} 08:00",
            f"2026-10-{day:02d} 16:00",
        )
        add_assignment("STF-006", event)
    event = add_event(
        "EV2026-OCT-PARALLEL", "Synthetic parallel corporate seminar", "Event",
        "Corporate Seminar", "2026-10-24 08:00", "2026-10-24 18:00",
    )
    for staff_id in ("STF-002", "STF-008", "STF-011"):
        add_assignment(staff_id, event)
    event = add_event(
        "EV2026-OCT-CANCELLED", "Synthetic cancelled grand opening", "Event",
        "Grand Opening Ceremony", "2026-10-28 08:00", "2026-10-28 18:00",
    )
    add_assignment("STF-004", event, "Cancelled")

    event_types = [
        "Annual Dinner / Gala", "Festive Open House", "Trade Exhibition",
        "City Marathon / Run", "Grand Opening Ceremony", "Corporate Seminar",
    ]
    rng = random.Random(SEED)
    for month in range(1, 13):
        for slot, day in enumerate((5, 12, 19, 26), 1):
            event = add_event(
                f"EV2026-{month:02d}-{slot:02d}",
                f"Synthetic {month:02d}/{slot:02d} event",
                "Event", event_types[((month - 1) * 4 + slot - 1) % 6],
                f"2026-{month:02d}-{day:02d} 08:00",
                f"2026-{month:02d}-{day:02d} 16:00",
            )
            candidates = [
                row for row in staff
                if eligibility(
                    row, leaves, assignments,
                    dt(event["Start_DateTime"]), dt(event["End_DateTime"])
                )["Eligible"]
            ]
            # Seed bookings contain at least one of each broad role, plus four
            # other workers. They are workload records, not complete event plans.
            selected = []
            for role in ROLES:
                choices = [row for row in candidates if row["Role"] == role]
                selected.append(rng.choice(choices))
            remaining = [row for row in candidates if row not in selected]
            selected += rng.sample(remaining, 4)
            for row in sorted(selected, key=lambda row: row["Staff_ID"]):
                add_assignment(row["Staff_ID"], event)

    cases_spec = [
        ("CASE-01", "Normal event: enough staff and all broad roles",
         "2026-10-17 08:00", "2026-10-17 18:00", (4, 2, 1, 1), (12, 8, 0)),
        ("CASE-02", "Peak conflict: leave, parallel booking and weekly-hour cap",
         "2026-10-24 08:00", "2026-10-24 18:00", (7, 2, 2, 1), (5, 5, 7)),
        ("CASE-03", "Enough headcount but no eligible AV technician",
         "2026-10-24 08:00", "2026-10-24 16:00", (3, 1, 1, 1), (6, 5, 1)),
        ("CASE-04", "Pending/rejected leave and cancelled booking do not block",
         "2026-10-28 08:00", "2026-10-28 18:00", (4, 2, 1, 1), (12, 8, 0)),
        ("CASE-05", "Booking ends exactly at new shift start: no overlap",
         "2026-10-24 18:00", "2026-10-24 22:00", (2, 1, 1, 0), (9, 4, 0)),
        ("CASE-06", "Overnight shift crosses Monday: split weekly hours",
         "2026-10-25 22:00", "2026-10-26 04:00", (2, 0, 0, 0), (11, 2, 0)),
        ("CASE-07", "Sunday shift stays in current Monday-Sunday week",
         "2026-10-25 12:00", "2026-10-25 22:00", (4, 2, 1, 1), (10, 8, 0)),
        ("CASE-08", "Year boundary: approved leave continues into January",
         "2026-12-31 20:00", "2027-01-01 04:00", (4, 2, 1, 1), (11, 8, 0)),
    ]
    cases, expected = [], []
    required_columns = [
        "Required_Logistics", "Required_Coordinators", "Required_AV", "Required_Safety"
    ]
    for case_id, description, start, end, requirements, hand_expected in cases_spec:
        available = []
        for worker in staff:
            result = eligibility(worker, leaves, assignments, dt(start), dt(end))
            expected.append({
                "Case_ID": case_id, "Staff_ID": worker["Staff_ID"],
                "Display_Name": worker["Display_Name"], "Role": worker["Role"], **result,
            })
            if result["Eligible"]:
                available.append(worker)
        counts = Counter(row["Role"] for row in available)
        assigned = sum(min(need, counts[role]) for role, need in zip(ROLES, requirements))
        shortages = {
            role: max(0, need - counts[role])
            for role, need in zip(ROLES, requirements)
        }
        total = sum(requirements)
        actual = (len(available), assigned, total - assigned)
        assert actual == hand_expected, (case_id, actual, hand_expected)
        cases.append({
            "Case_ID": case_id, "Description": description,
            "Start_DateTime": start, "End_DateTime": end,
            **dict(zip(required_columns, requirements)),
            "Total_Crew_Required": total,
            "Expected_Available_FullTime": len(available),
            "Expected_Assignable_FullTime": assigned,
            "Expected_PartTimers_Required": total - assigned,
            "Expected_Role_Shortages": ";".join(f"{role}={shortages[role]}" for role in ROLES),
        })

    tables = {
        "staff.csv": staff, "staff_leave.csv": leaves,
        "staff_assignments.csv": assignments, "seed_events.csv": events,
        "demo_cases.csv": cases, "demo_availability_expected.csv": expected,
    }
    for filename, rows in tables.items():
        write_csv(output / filename, rows)
    guide = make_guide(tables)
    (output / "WORKER_DATA_GUIDE.md").write_text(guide, encoding="utf-8")
    source = Path(__file__).resolve()
    target = (output / "generate_worker_dataset.py").resolve()
    if source != target:
        shutil.copyfile(source, target)
    report = validate(output)
    (output / "VALIDATION.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    archive = output.parent / "worker_dataset_2026.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
        for path in sorted(output.iterdir()):
            if path.is_file():
                z.write(path, arcname=f"worker_dataset_2026/{path.name}")
    print(json.dumps({
        "package": str(archive), "validation": report,
        "demo_summary": [
            {k: row[k] for k in [
                "Case_ID", "Expected_Available_FullTime",
                "Expected_Assignable_FullTime", "Expected_PartTimers_Required"
            ]} for row in cases
        ],
    }, indent=2))


def validate(output):
    tables = {}
    for filename, fields in SCHEMAS.items():
        with (output / filename).open(encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            assert reader.fieldnames == fields, filename
            tables[filename] = list(reader)
        assert all(set(row) == set(fields) for row in tables[filename])
        assert all(all(value not in (None, "") for value in row.values()) for row in tables[filename])
    staff = tables["staff.csv"]
    for row in staff:
        assert row["Active"] in {"True", "False"}
        assert row["eOT_Eligible"] in {"True", "False"}
        assert row["Role"] in ROLES
        assert row["Employment_Type"] == "FullTime"
        row["Active"] = row["Active"] == "True"
        row["Max_Weekly_Hours"] = int(row["Max_Weekly_Hours"])
        assert row["Max_Weekly_Hours"] > 0
    staff_ids = {row["Staff_ID"] for row in staff}
    assert len(staff) == len(staff_ids) == 12
    for filename, field in [
        ("staff_leave.csv", "Leave_ID"), ("staff_assignments.csv", "Assignment_ID"),
        ("seed_events.csv", "Event_ID"), ("demo_cases.csv", "Case_ID"),
    ]:
        values = [row[field] for row in tables[filename]]
        assert len(values) == len(set(values)), filename
    leaves = tables["staff_leave.csv"]
    assignments = tables["staff_assignments.csv"]
    events = {row["Event_ID"]: row for row in tables["seed_events.csv"]}
    for row in leaves:
        assert row["Staff_ID"] in staff_ids
        assert row["Approval_Status"] in {"Approved", "Pending", "Rejected"}
        assert date.fromisoformat(row["Start_Date"]) <= date.fromisoformat(row["End_Date"])
    for row in events.values():
        assert dt(row["Start_DateTime"]) < dt(row["End_DateTime"])
    for row in assignments:
        assert row["Staff_ID"] in staff_ids
        assert row["Event_ID"] in events
        assert row["Assignment_Status"] in {"Confirmed", "Cancelled"}
        start, end = dt(row["Start_DateTime"]), dt(row["End_DateTime"])
        assert start < end
        event = events[row["Event_ID"]]
        assert dt(event["Start_DateTime"]) <= start < end <= dt(event["End_DateTime"])
        if row["Assignment_Status"] == "Confirmed":
            assert not any(
                leave["Staff_ID"] == row["Staff_ID"]
                and leave["Approval_Status"] == "Approved"
                and overlap(start, end, *leave_interval(leave))
                for leave in leaves
            ), row["Assignment_ID"]
    confirmed = [row for row in assignments if row["Assignment_Status"] == "Confirmed"]
    for i, a in enumerate(confirmed):
        for b in confirmed[i + 1:]:
            if a["Staff_ID"] == b["Staff_ID"]:
                assert not overlap(
                    dt(a["Start_DateTime"]), dt(a["End_DateTime"]),
                    dt(b["Start_DateTime"]), dt(b["End_DateTime"]),
                ), (a["Assignment_ID"], b["Assignment_ID"])
    for worker in staff:
        assert all(
            value <= worker["Max_Weekly_Hours"]
            for value in weekly_bookings(assignments, worker["Staff_ID"]).values()
        )
    expected = tables["demo_availability_expected.csv"]
    index = {(row["Case_ID"], row["Staff_ID"]): row for row in expected}
    assert len(index) == len(expected) == 8 * 12
    for case in tables["demo_cases.csv"]:
        eligible_by_role = Counter()
        for worker in staff:
            result = eligibility(
                worker, leaves, assignments,
                dt(case["Start_DateTime"]), dt(case["End_DateTime"])
            )
            for field, value in result.items():
                assert str(value) == index[(case["Case_ID"], worker["Staff_ID"])][field]
            if result["Eligible"]:
                eligible_by_role[worker["Role"]] += 1
        needs = [
            int(case[field]) for field in [
                "Required_Logistics", "Required_Coordinators", "Required_AV", "Required_Safety"
            ]
        ]
        assigned = sum(min(need, eligible_by_role[role]) for need, role in zip(needs, ROLES))
        assert sum(eligible_by_role.values()) == int(case["Expected_Available_FullTime"])
        assert assigned == int(case["Expected_Assignable_FullTime"])
        assert sum(needs) - assigned == int(case["Expected_PartTimers_Required"])
    # Boundary tests independent of the fixture totals.
    assert not overlap(dt("2026-10-24 08:00"), dt("2026-10-24 18:00"),
                       dt("2026-10-24 18:00"), dt("2026-10-24 22:00"))
    assert split_week_hours(dt("2026-10-25 22:00"), dt("2026-10-26 04:00")) == {
        date(2026, 10, 19): 2.0, date(2026, 10, 26): 4.0
    }
    # Inactive flag must work, without adding a thirteenth worker.
    inactive = dict(staff[0], Active=False)
    assert "Inactive" in eligibility(
        inactive, [], [], dt("2026-10-17 08:00"), dt("2026-10-17 18:00")
    )["Exclusion_Reasons"]
    assert index[("CASE-02", "STF-006")]["Exclusion_Reasons"] == "Weekly_Hour_Limit"
    assert index[("CASE-03", "STF-006")]["Eligible"] == "True"
    assert index[("CASE-04", "STF-003")]["Eligible"] == "True"
    assert index[("CASE-04", "STF-005")]["Eligible"] == "True"
    assert index[("CASE-04", "STF-004")]["Eligible"] == "True"
    assert index[("CASE-05", "STF-011")]["Eligible"] == "True"
    assert index[("CASE-08", "STF-004")]["Exclusion_Reasons"] == "Approved_Leave"
    return {
        "status": "PASS",
        "synthetic": True, "seed": SEED, "planning_year": YEAR,
        "timezone": TIMEZONE,
        "row_counts": {name: len(rows) for name, rows in tables.items()},
        "role_counts": dict(Counter(row["Role"] for row in staff)),
        "leave_status_counts": dict(Counter(row["Approval_Status"] for row in leaves)),
        "assignment_status_counts": dict(Counter(row["Assignment_Status"] for row in assignments)),
        "checks": [
            "CSV schemas and nonempty fields",
            "Unique primary identifiers and staff/event foreign keys",
            "Date ranges and assignment windows within seed-event windows",
            "No overlapping confirmed bookings for the same worker",
            "No confirmed booking overlaps approved leave",
            "Confirmed hours within synthetic weekly limits",
            "Eight hand-specified scenario totals and 96 worker-level expectations",
            "Role-aware staffing shortages rather than headcount alone",
            "Pending/rejected leave and cancelled booking exclusions",
            "Exact-end boundary, Monday rollover and cross-year approved leave",
            "Inactive worker exclusion",
        ],
        "csv_sha256": {
            filename: hashlib.sha256((output / filename).read_bytes()).hexdigest()
            for filename in SCHEMAS
        },
        "limitations": [
            "No application/UI, approval workflow or live integration has been tested.",
            "No real employee data, statutory compliance claim or validated market assumptions.",
            "Sparse synthetic schedule; not a complete timesheet or payroll record.",
            "Broad roles are used in fixtures; exact skills must be matched for specialised work.",
            "A request for part-timers is not a confirmed hire.",
        ],
    }


def make_guide(tables):
    counts = {name: len(rows) for name, rows in tables.items()}
    return f"""# EventOps synthetic worker dataset — 2026

## Start here

This is a small, fully synthetic dataset for the team's event-planning prototype.
Names are invented display labels; no employee records were collected or copied.
Leave dates, bookings, role requirements and hours are illustrative assumptions,
not observed business facts or verified Malaysian holiday dates. Do not infer
leave, religion, ethnicity, or availability from anyone's name.

The three main worker files are staff.csv, staff_leave.csv and
staff_assignments.csv. seed_events.csv is a supporting reference table that
resolves the Event_ID values used by existing bookings. Import seed_events.csv
as well if your database enforces an event foreign key.

| File | Rows | Purpose |
|---|---:|---|
| staff.csv | {counts['staff.csv']} | Stable worker profiles |
| staff_leave.csv | {counts['staff_leave.csv']} | Date-based approved, pending and rejected leave |
| staff_assignments.csv | {counts['staff_assignments.csv']} | Existing confirmed or cancelled bookings |
| seed_events.csv | {counts['seed_events.csv']} | Names and times for existing events/work blocks |
| demo_cases.csv | {counts['demo_cases.csv']} | Proposed new shifts and expected staffing totals |
| demo_availability_expected.csv | {counts['demo_availability_expected.csv']} | Expected result for each case and worker |
| VALIDATION.json | — | Executed validation checks, counts and CSV checksums |
| generate_worker_dataset.py | — | Reproducible, standard-library-only data generator |

Do not import demo_cases.csv or demo_availability_expected.csv as existing
bookings. They are test inputs and expected answers. They must not be treated
as model training labels or independent evidence of forecasting accuracy.

## Scope and calendar

- Planning year: 2026. One approved leave extends into 2 January 2027.
- All datetimes are local Asia/Kuala_Lumpur (MYT, UTC+08:00).
- Date format: YYYY-MM-DD. Datetime format: YYYY-MM-DD HH:MM.
- Weeks run Monday 00:00 to the following Monday 00:00.
- All 12 staff are active, full-time workers with a synthetic 40-hour weekly cap.
- Roles: 6 Logistics Crew, 3 Event Coordinators, 2 AV Technicians, 1 Safety Coordinator.
- No weekly hours or availability are stored as fixed profile columns.
  Compute them for the requested dates from confirmed assignments.
- The schedule includes four illustrative event windows per month plus
  targeted October workload/conflict examples. This is a sparse demonstration
  schedule, not a complete year of employee work.
- This is separate from malaysia_events_2025.csv. Those 717 historical records
  contain generated aggregate availability, not this roster's actual history.
  Do not join the two datasets by position or claim they reconcile.

## Data dictionary

### staff.csv

| Column | Meaning |
|---|---|
| Staff_ID | Unique stable ID, STF-001 through STF-012 |
| Display_Name | Invented display label; never used as a join key |
| Role | Broad allocation group; match exactly |
| Primary_Skill | Specific capability tag; not a licence/certification claim |
| Max_Weekly_Hours | Synthetic cap on confirmed scheduled hours plus proposed work |
| Active | True or False; only True may be assigned |
| Employment_Type | FullTime in this roster; no part-timer candidates included |
| eOT_Eligible | True/False flag for a possible future request; not OT approval |

Exact CSV boolean spellings are True and False. Never use bool("False") or
astype(bool) on unparsed strings: nonempty strings become truthy. Parse the
values explicitly or use the CSV reader's boolean conversion.

### staff_leave.csv

| Column | Meaning |
|---|---|
| Leave_ID | Unique leave request ID |
| Staff_ID | References staff.csv |
| Start_Date | First full calendar day of leave, inclusive |
| End_Date | Last full calendar day of leave, inclusive |
| Approval_Status | Approved, Pending, or Rejected |

Only Approved leave blocks assignment. Pending leave should be surfaced as an
advisory for owner review, not silently treated as approved. Rejected leave
does not block. Approved leave from 23–25 October ends at 26 October 00:00,
not at the beginning of 25 October. There are no private leave reasons.

### staff_assignments.csv

| Column | Meaning |
|---|---|
| Assignment_ID | Unique booking ID; prevent duplicate imports |
| Staff_ID | References staff.csv |
| Event_ID | References seed_events.csv for these initial records |
| Start_DateTime | Beginning of the reserved shift, including prep/setup |
| End_DateTime | End of the reserved shift, including teardown |
| Assignment_Status | Confirmed or Cancelled |

Only Confirmed assignments block time and count toward weekly hours.
The windows are the complete reserved shifts; do not add setup hours again.
Confirmed seed bookings have no same-worker overlap, no approved-leave
overlap, and no weekly-cap violations. Conflict demo cases are NEW proposed
shifts that must be evaluated against the valid seed schedule.

### seed_events.csv

| Column | Meaning |
|---|---|
| Event_ID | Unique event or internal-work ID used by seed assignments |
| Event_Name | Invented descriptive label |
| Record_Type | Event or Internal_Work |
| Event_Type | One of the historical dataset's six event types, or Not_Applicable for internal work |
| Start_DateTime / End_DateTime | Full reserved window for this demo record |

These are booking references, not historical revenue records or complete
staffing plans. Internal work consumes hours and must not be fed to the event
model as an event type. Some events can require additional part-timers; the
seed tables do not assert complete staffing or equipment sufficiency.

## Availability rules to implement

1. Require start < end and a supported timezone.
2. Exclude inactive workers.
3. Exclude any worker whose Approved leave overlaps any part of the shift.
4. Exclude any worker with an overlapping Confirmed assignment.
5. Add confirmed scheduled hours plus proposed hours in EVERY affected
   Monday-Sunday week. Exclude the worker if any week exceeds their cap.
6. Match the broad role and the exact required skill where the event needs it.
7. Choose only the workers needed. One worker may fill at most one slot in
   a simultaneous event. Do not automatically assign every eligible worker.
8. Compute shortages per role/skill. Part-timers required are the unfilled
   qualified slots, not simply total demand minus raw available headcount.

Datetime booking windows are half-open: [start, end). Two bookings overlap when:

    existing_start < proposed_end AND existing_end > proposed_start

Approved date-only leave must first become a datetime window from Start_Date
00:00 to the day AFTER End_Date 00:00.

Weekly booked hours are scheduled work, not leave hours or payroll hours.
The fixture cap does not automatically fall when someone takes a day of leave.
For an overnight Sunday-Monday shift, allocate hours to both weeks.

eOT_Eligible does not bypass the cap or remove a simultaneous booking conflict.
Overtime is NOT implemented or authorised by these CSVs. Keep it out of the
first version unless you add separate limits, cost assumptions and explicit
owner approval. Overtime is not an extra person at the same moment.

## Ready-to-use demo cases

Each case runs independently against the same original seed data. Do not
approve and append CASE-01 before checking CASE-02 unless you reset the data;
otherwise your expected answers will change.

| Case | Proposed shift (MYT) | Crew needed | Eligible FT | Assignable FT | Part-timer slots |
|---|---|---:|---:|---:|---:|
| CASE-01 | 17 Oct 08:00–18:00 | 8 | 12 | 8 | 0 |
| CASE-02 | 24 Oct 08:00–18:00 | 12 | 5 | 5 | 7 |
| CASE-03 | 24 Oct 08:00–16:00 | 6 | 6 | 5 | 1 AV |
| CASE-04 | 28 Oct 08:00–18:00 | 8 | 12 | 8 | 0 |
| CASE-05 | 24 Oct 18:00–22:00 | 4 | 9 | 4 | 0 |
| CASE-06 | 25 Oct 22:00–26 Oct 04:00 | 2 | 11 | 2 | 0 |
| CASE-07 | 25 Oct 12:00–22:00 | 8 | 10 | 8 | 0 |
| CASE-08 | 31 Dec 20:00–1 Jan 2027 04:00 | 8 | 11 | 8 | 0 |

CASE-02 details:
- STF-001, STF-007 and STF-010 are on Approved leave.
- STF-002, STF-008 and STF-011 have a parallel Confirmed booking.
- STF-006 has 32 hours already booked in the week starting 19 October.
  Adding the 10-hour proposed shift would reach 42 hours, over the 40-hour cap.
- Eligible workers: STF-003, STF-004, STF-005, STF-009, STF-012.
- Requirements: 7 Logistics Crew, 2 Coordinators, 2 AV Technicians, 1 Safety.
- Shortages: 4 Logistics Crew, 1 Coordinator, 2 AV Technicians.

CASE-03 is the important headcount trap:
- The 8-hour shift lets STF-006 reach exactly 40 weekly hours and remain eligible.
- Six people are eligible, but none is an AV Technician.
- Only five of the six required qualified slots can be filled.
- Request one appropriately skilled AV part-timer, not zero general workers.

CASE-04 confirms that pending leave for STF-003, rejected leave for STF-005,
and the cancelled booking for STF-004 do not block assignment.

CASE-05 permits a shift to start exactly when an existing shift ends.
This is an interval-logic test, not a recommendation to schedule travel or
back-to-back shifts without rest.

CASE-06 places 2 proposed hours in the week starting 19 October and 4 in the
week starting 26 October. Leave for STF-001 still overlaps its first 2 hours.

CASE-08 excludes STF-004 because Approved leave extends into January 2027.

## How to use the files next

1. Extract the ZIP into a separate local folder. Review the CSVs before import.
2. Add the worker CSVs and seed_events.csv to a data/ folder in your repository.
3. Import staff, seed events, leave and existing assignments into the app's
   persistent database once. Use the supplied IDs as unique keys so rerunning
   setup does not duplicate rows.
4. After that, use the database as the live source of truth for new approvals.
   Do not keep writing competing versions to CSV and session state.
5. Implement the availability rules in planner.py, and compare its results
   with demo_cases.csv and demo_availability_expected.csv.
6. Show the eligible names, exclusions, role shortages and owner review in
   Streamlit. Label everything as simulated Orbyte data.
7. Upon owner approval, recheck availability and atomically save the approved
   plan, selected worker bookings, requests and audit entry. Protect against
   duplicate approval. Those application behaviours are NOT supplied/tested here.
8. A part-timer requisition is a DRAFT request, not confirmed staffing.
   Keep "plan approved" separate from "fully staffed".

There is no second AI worker model. Use the existing event model, if validated,
to suggest event resources; use these exact records and rules for availability.
The previous event model saw generated FT availability of 2–8. This roster has
12 people; warn/fall back for unsupported input combinations and recompute
qualified staffing shortages from the live roster rather than its fourth output.

## Reproduce and validate

Use Python 3.10 or later, with no third-party packages:

    python generate_worker_dataset.py

Run it in an empty working directory. It recreates a
deliverables/worker_dataset_2026 folder and ZIP using fixed seed 42.
Running it again intentionally overwrites those generated outputs.
VALIDATION.json records the checks that actually ran. CSV SHA-256 checksums
allow you to detect accidental changes.

## Limitations and declaration

The availability fixtures match BROAD roles, with one primary skill per worker.
For exact requirements (for example, a lighting operator), match Primary_Skill
as well. Do not assume every AV worker has both sound and lighting capability.
No professional safety certification, driving licence, physical capacity,
employment eligibility or legal compliance is asserted.

The simplified calendar assumes an active worker is potentially schedulable
outside approved leave, bookings and weekly caps. It does not implement
working-day preferences, shift rosters, daily caps, break rules, travel buffers,
minimum rest, payroll, overtime approval, real hiring or actual Orbyte APIs.
Include any needed travel/rest blocks before using similar logic in reality.
The 40-hour setting is a demo business assumption, not Malaysian legal advice.

These files do not change or validate the Streamlit app, live GitHub repository,
trained model, deployment or owner-approval workflow. The validation report
covers the DATASET and documented availability examples only.

Suggested tools declaration (review and adapt):
"Team-reviewed synthetic worker profiles, 2026 leave requests, existing bookings
and test scenarios generated with Replit AI assistance. Reproducible generator
uses Python's standard library and seed 42. No real employee/customer records
or live Orbyte access were used."

All figures are synthetic; there are no external market-data sources.
"""


if __name__ == "__main__":
    build()
