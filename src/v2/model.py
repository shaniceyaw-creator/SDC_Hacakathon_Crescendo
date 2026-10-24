"""Loads the trained EventOps v2 bundle (Stage 1 resources -> Stage 2 money) and predicts."""
from __future__ import annotations

import json
import math
import warnings
from datetime import date
from functools import lru_cache

from . import data

MODEL_DIR = data.ROOT / "models/eventops_v2"
MODEL_FILE = MODEL_DIR / "eventops_v2_models.joblib"


class ModelUnavailable(Exception):
    pass


@lru_cache
def bundle():
    if not MODEL_FILE.is_file():
        raise ModelUnavailable("The prediction model is not installed yet.")
    import joblib
    import sklearn
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        loaded = joblib.load(MODEL_FILE)
    if loaded.get("format") != "eventops_v2":
        raise ModelUnavailable("The installed model file is not an EventOps v2 model.")
    if loaded.get("sklearn_version", "").split(".")[:2] != sklearn.__version__.split(".")[:2]:
        raise ModelUnavailable(
            f"The model was trained with scikit-learn {loaded.get('sklearn_version')}, "
            f"but the website runs {sklearn.__version__}. Install the matching version.")
    return loaded


def info():
    """Short description of the installed model for the interface (no internals)."""
    source = {}
    if (MODEL_DIR / "SOURCE.json").is_file():
        source = json.loads((MODEL_DIR / "SOURCE.json").read_text())
    try:
        b = bundle()
    except ModelUnavailable as exc:
        return {"ready": False, "message": str(exc)}
    errors = {r["Target"]: r["Error_%_of_average"] for r in b["test_results"]}
    return {
        "ready": True, "source": source.get("source", "runpod"),
        "peak_months": b["peak_months"],
        "price_error_pct": errors.get("Selling_Price_RM"), "cost_error_pct": errors.get("Total_Cost_RM"),
    }


def features(event: dict) -> dict:
    day = date.fromisoformat(event["date"])
    place = data.area(event["area"])
    peak = data.peak_name(day)
    return {
        "Event_Type": event["event_type"], "Guest_Count": int(event["guests"]), "Month": day.month,
        "Is_Weekend": int(day.weekday() >= 5), "Start_Hour": data.parse_time(event["start_time"]),
        "Duration_Hours": float(event["duration_hours"]), "Is_Peak": int(peak != "Normal"),
        "Venue_Type": event["venue_type"], "Venue_Setting": data.venue_settings().get(event["venue_type"], "Indoor"),
        "Venue_Area": event["area"], "Distance_From_PJ_KM": place["km"],
        "Seating_Style": event["seating_style"], "Service_Level": event["service_level"],
        "Repeat_Client": "Yes" if event.get("repeat_client") else "No",
    }


def _make_x(pd, frame, cols, encoded):
    return pd.get_dummies(frame[cols], dtype=int).reindex(columns=encoded, fill_value=0)


def predict(events: list[dict]) -> list[dict]:
    """One estimate per event. Inputs outside the training data are flagged, never hidden."""
    if not events:
        return []
    b = bundle()
    import numpy as np
    import pandas as pd

    rows = [features(e) for e in events]
    frame = pd.DataFrame(rows)
    stage1, stage2 = b["resource"], b["cost"]
    x1 = _make_x(pd, frame, stage1["features"], stage1["encoded_columns"])
    for target, model in stage1["models"].items():
        frame[target] = np.ceil(np.maximum(model.predict(x1) - 0.25, 0)).astype(int)
    # Minimum crew every event needs (a lead and two hands), regardless of the model.
    frame["Event_Coordinators"] = frame["Event_Coordinators"].clip(lower=1)
    frame["Logistics_Crew"] = frame["Logistics_Crew"].clip(lower=2)
    x2 = _make_x(pd, frame, stage2["features"], stage2["encoded_columns"])
    money = {t: m.predict(x2) for t, m in stage2["models"].items()}

    errors = {r["Target"]: r["Error_%_of_average"] for r in b["test_results"]}
    band = max(5.0, float(errors.get("Selling_Price_RM", 12))) / 100
    out = []
    for i, row in enumerate(rows):
        warn = []
        for col, rng in b["numeric_ranges"].items():
            value = row.get(col)
            if value is not None and not (rng["min"] <= value <= rng["max"]):
                label = {"Guest_Count": "guest count", "Duration_Hours": "event length", "Start_Hour": "start time",
                         "Distance_From_PJ_KM": "distance"}.get(col, col.lower())
                warn.append(f"The {label} is outside past events, so this estimate is less certain.")
        for col in ("Event_Type", "Venue_Type", "Venue_Area", "Seating_Style"):
            if str(row[col]) not in b["known_categories"].get(col, []):
                warn.append(f"No past events with {row[col]}; the estimate leans on similar events.")
        cost = max(0.0, float(money["Total_Cost_RM"][i]))
        price = max(cost, float(money["Selling_Price_RM"][i]))
        crew = {r: int(frame.at[i, r]) for r in data.ROLES}
        out.append({
            "crew": crew, "crew_total": sum(crew.values()),
            "equipment": {k: int(frame.at[i, k]) for k in data.EQUIPMENT},
            "cost_rm": round(cost, -1), "price_rm": round(price, -1),
            "profit_rm": round(price - cost, -1),
            "margin_pct": round((price - cost) / price * 100, 1) if price else 0.0,
            "quote_low": math.floor(price * (1 - band) / 100) * 100,
            "quote_high": math.ceil(price * (1 + band) / 100) * 100,
            "peak_period": data.peak_name(date.fromisoformat(events[i]["date"])),
            "distance_km": row["Distance_From_PJ_KM"],
            "warnings": warn,
        })
    return out
