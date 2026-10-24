# %% [markdown]
# # EventOps v2: Predict Crew, Equipment, Cost and Price
# ## RunPod notebook in the same style as Tutorial 11
#
# Each row is one **past event** of a small event company based in **Petaling Jaya**.
# There are 300 events from October 2023 to September 2026 (synthetic data).
#
# We train two groups of models:
#
# | Step | Inputs (X) | Outputs (y) |
# |---|---|---|
# | **Stage 1 – Resources** | event type, guests, date, time, venue, distance from PJ, seating, service level | coordinators, AV technicians, logistics crew, safety officers, chairs, tables, canopy tents, sound systems, stage platforms, LED screens |
# | **Stage 2 – Money** | everything above **plus the crew and equipment** | total cost (RM) and selling price (RM) |
#
# For a new event, Stage 1 predicts the crew and equipment, then Stage 2 uses
# those predictions to estimate the cost and the price. All outputs are numbers,
# so these are **regression** models.
#
# **The pattern you already know:**
# ```python
# model = ModelName()
# model.fit(X_train, y_train)
# prediction = model.predict(X_validation)
# ```

# %% [markdown]
# # Part 0: Install Libraries
# Run once. If you already imported libraries, restart the kernel afterwards.

# %%
# %pip install -r requirements.txt

# %% [markdown]
# # Part 1: Import Libraries

# %%
from pathlib import Path
import json
import platform
import shutil

import numpy as np
import pandas as pd
import seaborn as sns
import matplotlib.pyplot as plt
import joblib
import sklearn
from IPython.display import display, FileLink

from sklearn.dummy import DummyRegressor
from sklearn.linear_model import LinearRegression
from sklearn.tree import DecisionTreeRegressor
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, r2_score

sns.set_theme(style="whitegrid")

# %% [markdown]
# # Part 2: Settings and Loading the Data
# Open this notebook inside the extracted **EventOps_v2_RunPod** folder.
#
# Events have dates, so we split them **in time order** (not randomly):
#
# | Set | Dates | Purpose |
# |---|---|---|
# | Training | Oct 2023 – Oct 2025 | Teach the models |
# | Validation | Nov 2025 – Mar 2026 | Choose the best model |
# | Test | Apr 2026 – Sep 2026 | Final check, used once |

# %%
DATA = Path("EventOps_v2_Dataset")
OUTPUT = Path("outputs/eventops_v2_run_01")
RANDOM_STATE = 42

assert (DATA / "model_schema.json").is_file(), "Open the notebook beside the EventOps_v2_Dataset folder."
if OUTPUT.exists():
    raise FileExistsError("This output folder already exists. Change OUTPUT to a new name, e.g. run_02.")
(OUTPUT / "charts").mkdir(parents=True)
(OUTPUT / "reports").mkdir()

df_all = pd.read_csv(DATA / "data/events_2023_2026.csv")
df_train = pd.read_csv(DATA / "splits/train.csv")
df_validation = pd.read_csv(DATA / "splits/validation.csv")
df_clients = pd.read_csv(DATA / "data/clients.csv")
schema = json.loads((DATA / "model_schema.json").read_text())

print("All events:", len(df_all))
print("Training events:", len(df_train))
print("Validation events:", len(df_validation))
df_train.head()

# %%
print(df_train.columns.tolist())

# %% [markdown]
# ## Select the Columns
# **Inputs** are things the manager knows when a customer asks for an event.
# Client names, IDs, profit and detailed cost breakdowns are **not** inputs,
# otherwise the model could "peek" at the answer.

# %%
resource_features = schema["resource_features"]
resource_targets = schema["resource_targets"]
cost_features = schema["cost_features"]
cost_targets = schema["cost_targets"]
categorical_columns = schema["categorical_columns"]

print("Stage 1 inputs:", resource_features)
print("Stage 1 outputs:", resource_targets)
print("Stage 2 extra inputs:", [c for c in cost_features if c not in resource_features])
print("Stage 2 outputs:", cost_targets)

# %% [markdown]
# # Part 3: Check for Missing Values
# Like Tutorial 11, we check isnull(). This dataset should have none.

# %%
needed = list(dict.fromkeys(cost_features + resource_targets + cost_targets))
missing = pd.DataFrame({
    "Training missing": df_train[needed].isnull().sum(),
    "Validation missing": df_validation[needed].isnull().sum(),
})
display(missing[missing.sum(axis=1) > 0])
assert missing.to_numpy().sum() == 0, "Fix missing values first."
assert pd.to_datetime(df_train["Event_Date"]).max() < pd.to_datetime(df_validation["Event_Date"]).min()

# %% [markdown]
# # Part 4: Explore the Data with Charts

# %%
plt.figure(figsize=(10, 4))
sns.countplot(data=df_all, y="Event_Type", order=df_all["Event_Type"].value_counts().index)
plt.title("Events by Type (Oct 2023 – Sep 2026)")
plt.xlabel("Number of events")
plt.ylabel("")
plt.tight_layout()
plt.savefig(OUTPUT / "charts/event_types.png", dpi=130)
plt.show()

# %%
plt.figure(figsize=(8, 4))
sns.scatterplot(data=df_all, x="Guest_Count", y="Total_Crew", hue="Venue_Setting", alpha=0.7)
plt.title("More Guests → More Crew")
plt.xlabel("Guests")
plt.ylabel("Total crew")
plt.tight_layout()
plt.savefig(OUTPUT / "charts/guests_vs_crew.png", dpi=130)
plt.show()

# %%
plt.figure(figsize=(8, 4))
sns.scatterplot(data=df_all, x="Distance_From_PJ_KM", y="Transport_Cost_RM", alpha=0.7)
plt.title("Distance from Petaling Jaya and Transport Cost")
plt.xlabel("Road distance from PJ office (km)")
plt.ylabel("Transport cost (RM)")
plt.tight_layout()
plt.savefig(OUTPUT / "charts/distance_vs_transport.png", dpi=130)
plt.show()

# %% [markdown]
# # Part A: Find the Peak Seasons
# Which months are busiest? We count events per calendar month, average across
# the three years, and call a month **peak** when it is at least 15% busier
# than a normal month. This is a simple count, not a machine-learning model.

# %%
df_all["Event_Date"] = pd.to_datetime(df_all["Event_Date"])
monthly = df_all.groupby([df_all["Event_Date"].dt.year, df_all["Event_Date"].dt.month]).size()
monthly.index.names = ["Year", "Month"]
monthly = monthly.reset_index(name="Events")

# Oct 2023 – Sep 2026 contains every calendar month exactly three times
average_per_month = monthly.groupby("Month")["Events"].mean()
overall_average = average_per_month.mean()
demand_index = (average_per_month / overall_average).round(2)
PEAK_LINE = 1.15
peak_months = demand_index[demand_index >= PEAK_LINE].index.tolist()

month_names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
season_table = pd.DataFrame({
    "Month": [month_names[m - 1] for m in demand_index.index],
    "Average events": average_per_month.round(1).values,
    "Demand index": demand_index.values,
    "Peak?": ["Yes" if m in peak_months else "" for m in demand_index.index],
})
display(season_table)
print("Peak months:", [month_names[m - 1] for m in peak_months])

# %%
plt.figure(figsize=(10, 4))
colours = ["#e07a5f" if m in peak_months else "#81b29a" for m in demand_index.index]
plt.bar([month_names[m - 1] for m in demand_index.index], average_per_month.values, color=colours)
plt.axhline(overall_average * PEAK_LINE, linestyle="--", color="black", label="Peak line (+15%)")
plt.title("Average Events per Month — Peak Months in Orange")
plt.ylabel("Events per month")
plt.legend()
plt.tight_layout()
plt.savefig(OUTPUT / "charts/peak_months.png", dpi=130)
plt.show()

# %% [markdown]
# Festive periods (Chinese New Year, Ramadan & Hari Raya, Deepavali, Year-End &
# Christmas, school holidays) are already labelled in `Peak_Period`.
# Do peak events cost more? Freelancers and rentals are more expensive then.

# %%
festive = (df_all.groupby("Peak_Period")
           .agg(Events=("Event_ID", "count"),
                Avg_Cost_RM=("Total_Cost_RM", "mean"),
                Avg_Price_RM=("Selling_Price_RM", "mean"))
           .round(0).sort_values("Events", ascending=False))
display(festive)
festive.to_csv(OUTPUT / "reports/festive_periods.csv")

# %% [markdown]
# # Part 5: Prepare X with pd.get_dummies()
# Same as Tutorial 11. We encode training first, then use reindex() so
# validation/test have exactly the same columns in the same order.

# %%
def make_X(frame, features, columns=None):
    X = pd.get_dummies(frame[features], dtype=int)
    if columns is not None:
        X = X.reindex(columns=columns, fill_value=0)
    return X

known_categories = {c: sorted(df_train[c].astype(str).unique().tolist()) for c in categorical_columns}
for c in categorical_columns:
    new_values = set(df_validation[c].astype(str)) - set(known_categories[c])
    if new_values:
        print(f"Note: validation has {c} values never seen in training: {new_values}")

X_train = make_X(df_train, resource_features)
resource_columns = X_train.columns.tolist()
X_validation = make_X(df_validation, resource_features, resource_columns)
print("Encoded Stage 1 columns:", len(resource_columns))
X_train.head()

# %% [markdown]
# # Part B: Stage 1 — Predict Crew and Equipment
# ## Start with one target: Logistics Crew
# Exactly the tutorial pattern. We compare a simple baseline (always predicts
# the median), Linear Regression, Decision Tree and Random Forest.

# %%
y_train = df_train["Logistics_Crew"]
y_validation = df_validation["Logistics_Crew"]

baseline = DummyRegressor(strategy="median")
baseline.fit(X_train, y_train)
print("Baseline MAE:", mean_absolute_error(y_validation, baseline.predict(X_validation)))

linear_model = LinearRegression()
linear_model.fit(X_train, y_train)
print("Linear Regression MAE:", mean_absolute_error(y_validation, linear_model.predict(X_validation)))

tree_model = DecisionTreeRegressor(max_depth=6, random_state=RANDOM_STATE)
tree_model.fit(X_train, y_train)
print("Decision Tree MAE:", mean_absolute_error(y_validation, tree_model.predict(X_validation)))

forest_model = RandomForestRegressor(n_estimators=200, random_state=RANDOM_STATE, n_jobs=-1)
forest_model.fit(X_train, y_train)
print("Random Forest MAE:", mean_absolute_error(y_validation, forest_model.predict(X_validation)))

# %% [markdown]
# MAE = average error **in people**. 0.8 means "on average about one person off".

# %% [markdown]
# ## Repeat for All 10 Resource Targets
# The same fit / predict / MAE steps in a loop. Each target gets its own models,
# and we keep the one with the lowest validation MAE.

# %%
def candidate_models():
    return {
        "Median baseline": DummyRegressor(strategy="median"),
        "Linear Regression": LinearRegression(),
        "Decision Tree": DecisionTreeRegressor(max_depth=6, random_state=RANDOM_STATE),
        "Random Forest": RandomForestRegressor(n_estimators=200, random_state=RANDOM_STATE, n_jobs=-1),
    }

rows = []
resource_models, resource_model_names = {}, {}
for target in resource_targets:
    best_name, best_mae, best_model = None, None, None
    for name, model in candidate_models().items():
        model.fit(X_train, df_train[target])
        prediction = model.predict(X_validation)
        mae = mean_absolute_error(df_validation[target], prediction)
        rows.append({"Stage": "1 Resources", "Target": target, "Model": name,
                     "Validation_MAE": round(mae, 3),
                     "Validation_R2": round(r2_score(df_validation[target], prediction), 3)})
        if best_mae is None or mae < best_mae:
            best_name, best_mae, best_model = name, mae, model
    resource_models[target] = best_model
    resource_model_names[target] = best_name
    print(f"{target:20s} best = {best_name:18s} MAE = {best_mae:.2f}")

# %% [markdown]
# # Part C: Stage 2 — Predict Total Cost and Selling Price
# Stage 2 learns from the **real** crew and equipment of past events.
#
# For a new event we don't know the real crew yet, so we feed in Stage 1's
# predictions. To choose fairly, validation uses those **predicted** resources too.

# %%
def add_predicted_resources(frame, models, columns):
    """Replace the real crew/equipment with Stage 1 predictions, rounded to whole units
    (rounding up anything above x.25 so we lean towards enough crew)."""
    copy = frame.copy()
    X = make_X(copy, resource_features, columns)
    for target, model in models.items():
        copy[target] = np.ceil(np.maximum(model.predict(X) - 0.25, 0))
    return copy

C_train = make_X(df_train, cost_features)
cost_columns = C_train.columns.tolist()
validation_chained = add_predicted_resources(df_validation, resource_models, resource_columns)
C_validation = make_X(validation_chained, cost_features, cost_columns)

cost_models, cost_model_names = {}, {}
for target in cost_targets:
    best_name, best_mae, best_model = None, None, None
    for name, model in candidate_models().items():
        model.fit(C_train, df_train[target])
        prediction = model.predict(C_validation)
        mae = mean_absolute_error(df_validation[target], prediction)
        rows.append({"Stage": "2 Money", "Target": target, "Model": name,
                     "Validation_MAE": round(mae, 1),
                     "Validation_R2": round(r2_score(df_validation[target], prediction), 3)})
        if best_mae is None or mae < best_mae:
            best_name, best_mae, best_model = name, mae, model
    cost_models[target] = best_model
    cost_model_names[target] = best_name
    print(f"{target:18s} best = {best_name:18s} MAE = RM {best_mae:,.0f}")

validation_results = pd.DataFrame(rows)
validation_results.to_csv(OUTPUT / "reports/validation_comparison.csv", index=False)
display(validation_results.sort_values(["Target", "Validation_MAE"]))

# %%
chart = validation_results[validation_results["Target"] == "Total_Cost_RM"]
plt.figure(figsize=(8, 4))
sns.barplot(data=chart, x="Model", y="Validation_MAE")
plt.title("Total Cost: Validation Error by Model — Lower Is Better")
plt.ylabel("Average error (RM)")
plt.tight_layout()
plt.savefig(OUTPUT / "charts/cost_model_comparison.png", dpi=130)
plt.show()

# %% [markdown]
# ## What Matters Most for Cost?
# Feature importance of the Random Forest (if it was chosen).

# %%
cost_model = cost_models["Total_Cost_RM"]
if hasattr(cost_model, "feature_importances_"):
    importance = (pd.DataFrame({"Feature": cost_columns, "Importance": cost_model.feature_importances_})
                  .sort_values("Importance", ascending=False).head(10))
    plt.figure(figsize=(9, 5))
    sns.barplot(data=importance, x="Importance", y="Feature")
    plt.title("Top 10 Inputs for the Cost Model")
    plt.tight_layout()
    plt.savefig(OUTPUT / "charts/cost_feature_importance.png", dpi=130)
    plt.show()
else:
    print("The chosen cost model is", cost_model_names["Total_Cost_RM"], "- no feature importance chart.")

# %% [markdown]
# # Part D: Final Test on Unseen Events (Apr – Sep 2026)
# Models are already chosen. Now we open the test set **once**, using the full
# real-life chain: Stage 1 predictions → Stage 2.

# %%
df_test = pd.read_csv(DATA / "splits/test.csv")
X_test = make_X(df_test, resource_features, resource_columns)
test_chained = add_predicted_resources(df_test, resource_models, resource_columns)
C_test = make_X(test_chained, cost_features, cost_columns)

test_rows = []
comparison = df_test[["Event_ID", "Event_Type", "Guest_Count", "Venue_Area"]].copy()
for target, model in resource_models.items():
    prediction = model.predict(X_test)
    test_rows.append({"Target": target, "Model": resource_model_names[target], "Unit": "count",
                      "Test_MAE": round(mean_absolute_error(df_test[target], prediction), 2),
                      "Average_Actual": round(df_test[target].mean(), 1)})
for target, model in cost_models.items():
    prediction = model.predict(C_test)
    comparison["Actual_" + target] = df_test[target]
    comparison["Predicted_" + target] = prediction.round(0)
    test_rows.append({"Target": target, "Model": cost_model_names[target], "Unit": "RM",
                      "Test_MAE": round(mean_absolute_error(df_test[target], prediction), 0),
                      "Average_Actual": round(df_test[target].mean(), 0)})
test_results = pd.DataFrame(test_rows)
test_results["Error_%_of_average"] = (test_results["Test_MAE"] / test_results["Average_Actual"] * 100).round(1)
display(test_results)
test_results.to_csv(OUTPUT / "reports/test_results.csv", index=False)
comparison.to_csv(OUTPUT / "reports/test_predictions.csv", index=False)

# %%
actual = df_test["Total_Cost_RM"]
predicted = comparison["Predicted_Total_Cost_RM"]
low, high = min(actual.min(), predicted.min()), max(actual.max(), predicted.max())
plt.figure(figsize=(6, 5))
plt.scatter(actual, predicted, alpha=0.7)
plt.plot([low, high], [low, high], linestyle="--", color="black")
plt.xlabel("Actual cost (RM)")
plt.ylabel("Predicted cost (RM)")
plt.title("Test Events: Actual vs Predicted Cost")
plt.tight_layout()
plt.savefig(OUTPUT / "charts/test_cost_actual_vs_predicted.png", dpi=130)
plt.show()

# %% [markdown]
# **How to read this:** a cost MAE of RM 1,500 on events averaging RM 13,000
# means the estimate is usually within about 11–12%. The data is synthetic, so
# this shows the method works; it is not proof for a real company.

# %% [markdown]
# # Part E: Customers Who Book Again
# Not machine learning — just pandas. Customers with an **Annual** or
# **Frequent** booking pattern get a reminder in the website, together with
# their usual special request.

# %%
regulars = (df_clients[df_clients["Booking_Pattern"].isin(["Annual", "Frequent"])]
            [["Company_Name", "Contact_Name", "Usual_Event_Type", "Usual_Month",
              "Bookings", "Booking_Pattern", "Usual_Request"]]
            .sort_values("Usual_Month"))
regulars["Usual_Month"] = regulars["Usual_Month"].apply(lambda m: month_names[m - 1])
display(regulars.head(12))
regulars.to_csv(OUTPUT / "reports/regular_customers.csv", index=False)

# %% [markdown]
# # Part F: Save Everything the Website Needs
# One `.joblib` file stores both stages, the column order, and the peak months.
# Only load joblib files that you created yourself.

# %%
numeric_ranges = {
    c: {"min": float(df_train[c].min()), "max": float(df_train[c].max())}
    for c in resource_features if c not in categorical_columns
}
bundle = {
    "format": "eventops_v2",
    "sklearn_version": sklearn.__version__,
    "python_version": platform.python_version(),
    "resource": {"features": resource_features, "targets": resource_targets,
                 "encoded_columns": resource_columns, "models": resource_models,
                 "model_names": resource_model_names},
    "cost": {"features": cost_features, "targets": cost_targets,
             "encoded_columns": cost_columns, "models": cost_models,
             "model_names": cost_model_names},
    "categorical_columns": categorical_columns,
    "known_categories": known_categories,
    "numeric_ranges": numeric_ranges,
    "peak_months": [int(m) for m in peak_months],
    "demand_index": {int(k): float(v) for k, v in demand_index.items()},
    "test_results": test_results.to_dict("records"),
}
model_path = OUTPUT / "eventops_v2_models.joblib"
joblib.dump(bundle, model_path, compress=3)
print("Saved:", model_path, f"({model_path.stat().st_size / 1024:.0f} KB)")
print("scikit-learn version:", sklearn.__version__)

# %% [markdown]
# ## Try the Saved Model on a New Event
# A customer asks for a 250-guest annual dinner in Shah Alam in December.

# %%
loaded = joblib.load(model_path)

new_event = pd.DataFrame([{
    "Event_Type": "Corporate Annual Dinner", "Guest_Count": 250, "Month": 12,
    "Is_Weekend": 1, "Start_Hour": 19, "Duration_Hours": 4, "Is_Peak": 1,
    "Venue_Type": "Hotel Ballroom", "Venue_Setting": "Indoor", "Venue_Area": "Shah Alam",
    "Distance_From_PJ_KM": 15.0, "Seating_Style": "Banquet", "Service_Level": "Standard",
    "Repeat_Client": "No",
}])

stage1 = loaded["resource"]
X_new = make_X(new_event, stage1["features"], stage1["encoded_columns"])
for target, model in stage1["models"].items():
    new_event[target] = int(np.ceil(max(model.predict(X_new)[0] - 0.25, 0)))

stage2 = loaded["cost"]
C_new = make_X(new_event, stage2["features"], stage2["encoded_columns"])
for target, model in stage2["models"].items():
    new_event[target] = round(float(model.predict(C_new)[0]), -1)

display(new_event[resource_targets + cost_targets].T.rename(columns={0: "Estimate"}))

# %% [markdown]
# # Part G: Download the Results
# Download this ZIP and send it back so the model can be connected to the website.
# The most important file inside is **eventops_v2_models.joblib**.

# %%
(OUTPUT / "versions.json").write_text(json.dumps({
    "python": platform.python_version(), "scikit-learn": sklearn.__version__,
    "pandas": pd.__version__, "numpy": np.__version__, "joblib": joblib.__version__,
}, indent=2) + "\n")
archive = shutil.make_archive(str(OUTPUT), "zip", root_dir=OUTPUT.parent, base_dir=OUTPUT.name)
print("Download this file:", archive)
display(FileLink(str(Path(archive).relative_to(Path.cwd()))))

# %% [markdown]
# # Reflection Questions
# 1. Why are crew, chairs and cost **regression** problems?
# 2. Why do we split by date instead of randomly?
# 3. Why does Stage 2 use **predicted** crew during validation and testing?
# 4. Which inputs mattered most for cost? Does that make business sense?
# 5. Why is the peak-season table not a machine-learning model?
