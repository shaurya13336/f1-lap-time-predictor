"""Run the leakage-aware APEX / RESEARCH lap-time experiment.

The experiment intentionally uses only the CSV archive supplied with the
project. It selects one configured eligible race because the archive contains
no weather or tire-compound field with which to algorithmically label a race
dry. That limitation is recorded in summary.json instead of being hidden.

Run from the project root:
    python experiment/run_experiment.py
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error


PROJECT_ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = PROJECT_ROOT / "data" / "raw"
RESULTS_DIR = PROJECT_ROOT / "results"

# Race 841 is the 2011 Australian Grand Prix. The source tables do not
# contain weather, track-condition, or red-flag columns, so those two
# eligibility checks are explicit external provenance rather than hidden
# assumptions. The selection logic below can fall back to another race only
# when it is present in this verified provenance map and satisfies all source
# data rules.
SELECTED_RACE_ID = 841
COMPLETED_STATUS = "Finished"
OUTLIER_MULTIPLIER = 1.5
RANDOM_SEED = 42

RACE_PROVENANCE = {
    841: {
        "dry": {
            "status": "verified",
            "method": "race-day dry condition documented by contemporary weather coverage",
            "sources": [
                "https://www.racefans.net/2011/03/24/australian-grand-prix-race-weekend-programme-2/",
                "https://www.autosport.com/f1/live-text/2011-australian-grand-prix-australian-grand-prix-weather-46090/46090/",
            ],
        },
        "no_red_flag": {
            "status": "verified",
            "method": "2011 red-flag race list names Monaco and Canada; Australia is not listed",
            "sources": [
                "https://racingnews365.com/does-formula-1-use-the-red-flag-too-often-nowadays",
            ],
        },
    }
}


@dataclass(frozen=True)
class RaceSelection:
    race_id: int
    year: int
    round: int
    name: str
    date: str
    completed_drivers: int
    lap_drivers: int
    pit_drivers: int
    pit_events: int
    sprint_scheduled: bool
    dry_verified: bool
    no_red_flag_verified: bool
    dry_sources: tuple[str, ...]
    no_red_flag_sources: tuple[str, ...]


def read_csv(name: str) -> pd.DataFrame:
    path = RAW_DIR / name
    if not path.exists():
        raise FileNotFoundError(f"Missing input table: {path}")
    return pd.read_csv(path, na_values=[r"\N"])


def serializable(value: Any) -> Any:
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return float(value)
    if isinstance(value, (pd.Timestamp,)):
        return value.isoformat()
    if pd.isna(value):
        return None
    return value


def find_race_selection(
    races: pd.DataFrame,
    results: pd.DataFrame,
    lap_times: pd.DataFrame,
    pit_stops: pd.DataFrame,
    statuses: pd.DataFrame,
) -> tuple[RaceSelection, pd.DataFrame]:
    """Audit every race and select a provenance-verified eligible race.

    Dry/no-red-flag status is deliberately not inferred from lap times. It is
    only true for a race ID present in RACE_PROVENANCE. If the preferred race
    ever fails a source-data rule, the first alternative that satisfies every
    available rule and has explicit provenance is selected automatically.
    """
    result_status = results.merge(statuses, on="statusId", how="left", validate="many_to_one")
    completed = result_status[result_status["status"].eq(COMPLETED_STATUS)]
    race_counts = completed.groupby("raceId")["driverId"].nunique().rename("completed_drivers")
    lap_counts = lap_times.groupby("raceId")["driverId"].nunique().rename("lap_drivers")
    pit_counts = pit_stops.groupby("raceId")["driverId"].nunique().rename("pit_drivers")
    pit_events = pit_stops.groupby("raceId").size().rename("pit_events")

    completed_ids = completed.groupby("raceId")["driverId"].agg(lambda values: set(values.astype(int)))
    lap_ids = lap_times.groupby("raceId")["driverId"].agg(lambda values: set(values.astype(int)))
    pit_ids = pit_stops.groupby("raceId")["driverId"].agg(lambda values: set(values.astype(int)))

    def intersection_count(row: pd.Series, other: pd.Series) -> int:
        completed_set = completed_ids.get(int(row["raceId"]), set())
        other_set = other.get(int(row["raceId"]), set())
        return len(completed_set & other_set)

    audit = (
        races[["raceId", "year", "round", "name", "date", "sprint_date"]]
        .merge(race_counts, left_on="raceId", right_index=True, how="left")
        .merge(lap_counts, left_on="raceId", right_index=True, how="left")
        .merge(pit_counts, left_on="raceId", right_index=True, how="left")
        .merge(pit_events, left_on="raceId", right_index=True, how="left")
    )
    for column in ["completed_drivers", "lap_drivers", "pit_drivers", "pit_events"]:
        audit[column] = audit[column].fillna(0).astype(int)
    audit["sprint_scheduled"] = audit["sprint_date"].notna()
    audit["completed_with_lap_data"] = audit.apply(lambda row: intersection_count(row, lap_ids), axis=1)
    audit["completed_with_pit_data"] = audit.apply(lambda row: intersection_count(row, pit_ids), axis=1)
    audit["dry_status"] = audit["raceId"].map(
        lambda race_id: RACE_PROVENANCE.get(int(race_id), {}).get("dry", {}).get("status", "not present in supplied CSV schema")
    )
    audit["no_red_flag_status"] = audit["raceId"].map(
        lambda race_id: RACE_PROVENANCE.get(int(race_id), {}).get("no_red_flag", {}).get("status", "not present in supplied CSV schema")
    )
    audit["passes_completed_driver_rule"] = audit["completed_drivers"].between(5, 10)
    audit["passes_driver_lap_rule"] = audit["completed_with_lap_data"].eq(audit["completed_drivers"])
    audit["passes_driver_pit_rule"] = audit["completed_with_pit_data"].eq(audit["completed_drivers"])
    audit["passes_data_availability_rule"] = (
        audit["passes_driver_lap_rule"]
        & audit["passes_driver_pit_rule"]
        & audit["pit_events"].gt(0)
        & ~audit["sprint_scheduled"]
    )
    audit["passes_condition_provenance_rule"] = (
        audit["dry_status"].eq("verified") & audit["no_red_flag_status"].eq("verified")
    )
    audit["passes_all_rules"] = (
        audit["passes_completed_driver_rule"]
        & audit["passes_data_availability_rule"]
        & audit["passes_condition_provenance_rule"]
    )

    candidates = audit[audit["passes_all_rules"]].sort_values(["year", "round", "raceId"])
    if candidates.empty:
        raise ValueError(
            "No race in the supplied archive satisfies the completed-driver, usable lap/pit data, "
            "no-sprint, and explicit dry/no-red-flag provenance rules."
        )
    preferred = candidates[candidates["raceId"].eq(SELECTED_RACE_ID)]
    selected_row = preferred.iloc[0] if not preferred.empty else candidates.iloc[0]
    selected_id = int(selected_row["raceId"])

    audit["selected"] = audit["raceId"].eq(selected_id)
    audit["selection_note"] = ""
    audit.loc[audit["selected"], "selection_note"] = (
        "Preferred race passed all rules"
        if selected_id == SELECTED_RACE_ID
        else f"Fallback selected automatically because preferred raceId={SELECTED_RACE_ID} failed one or more rules"
    )

    provenance = RACE_PROVENANCE.get(selected_id, {})
    selection = RaceSelection(
        race_id=selected_id,
        year=int(selected_row["year"]),
        round=int(selected_row["round"]),
        name=str(selected_row["name"]),
        date=str(selected_row["date"]),
        completed_drivers=int(selected_row["completed_drivers"]),
        lap_drivers=int(selected_row["lap_drivers"]),
        pit_drivers=int(selected_row["pit_drivers"]),
        pit_events=int(selected_row["pit_events"]),
        sprint_scheduled=bool(selected_row["sprint_scheduled"]),
        dry_verified=True,
        no_red_flag_verified=True,
        dry_sources=tuple(provenance.get("dry", {}).get("sources", [])),
        no_red_flag_sources=tuple(provenance.get("no_red_flag", {}).get("sources", [])),
    )
    return selection, audit


def clean_laps_for_race(
    selection: RaceSelection,
    results: pd.DataFrame,
    statuses: pd.DataFrame,
    lap_times: pd.DataFrame,
    pit_stops: pd.DataFrame,
    drivers: pd.DataFrame,
) -> tuple[pd.DataFrame, dict[str, Any], pd.DataFrame]:
    result_status = results.merge(statuses, on="statusId", how="left", validate="many_to_one")
    completed = result_status[
        result_status["raceId"].eq(selection.race_id)
        & result_status["status"].eq(COMPLETED_STATUS)
    ].copy()
    completed = completed.sort_values("driverId").drop_duplicates("driverId")
    completed = completed.merge(
        drivers[["driverId", "code", "forename", "surname"]], on="driverId", how="left", validate="one_to_one"
    )
    completed["driver_name"] = (
        completed["forename"].fillna("").str.strip()
        + " "
        + completed["surname"].fillna("").str.strip()
    ).str.strip()

    race_laps = lap_times[lap_times["raceId"].eq(selection.race_id)].copy()
    race_pits = pit_stops[pit_stops["raceId"].eq(selection.race_id)].copy()
    eligible_driver_ids = set(completed["driverId"].astype(int))
    race_laps = race_laps[race_laps["driverId"].isin(eligible_driver_ids)].copy()
    race_pits = race_pits[race_pits["driverId"].isin(eligible_driver_ids)].copy()

    cleaned_frames: list[pd.DataFrame] = []
    cleaning_records: list[dict[str, Any]] = []

    for _, driver_row in completed.iterrows():
        driver_id = int(driver_row["driverId"])
        driver_laps = race_laps[race_laps["driverId"].eq(driver_id)].copy().sort_values("lap")
        driver_pits = sorted(race_pits[race_pits["driverId"].eq(driver_id)]["lap"].astype(int).tolist())
        if driver_laps.empty or len(driver_pits) < 1:
            raise ValueError(f"Driver {driver_id} lacks the lap/pit data required for the experiment")

        pit_lap_set = set(driver_pits)
        post_pit_lap_set = {pit_lap + 1 for pit_lap in driver_pits}
        driver_laps["pit_stop_lap"] = driver_laps["lap"].isin(pit_lap_set)
        # Categories are mutually exclusive even if a malformed input has
        # consecutive pit-stop records.
        driver_laps["post_pit_lap"] = driver_laps["lap"].isin(post_pit_lap_set) & ~driver_laps["pit_stop_lap"]
        driver_laps["pit_or_post_pit"] = driver_laps["pit_stop_lap"] | driver_laps["post_pit_lap"]

        driver_median_ms = float(driver_laps.loc[~driver_laps["pit_or_post_pit"], "milliseconds"].median())
        if not math.isfinite(driver_median_ms) or driver_median_ms <= 0:
            raise ValueError(f"Driver {driver_id} has no valid median lap time")
        driver_laps["driver_median_ms"] = driver_median_ms
        driver_laps["extreme_slow_lap"] = (
            ~driver_laps["pit_or_post_pit"]
            & (driver_laps["milliseconds"] > OUTLIER_MULTIPLIER * driver_median_ms)
        )
        driver_laps["removed"] = driver_laps["pit_or_post_pit"] | driver_laps["extreme_slow_lap"]

        def latest_pit_before(lap: int) -> int:
            previous = [pit for pit in driver_pits if pit < int(lap)]
            return max(previous, default=0)

        driver_laps["last_pit_lap"] = driver_laps["lap"].map(latest_pit_before).astype(int)
        driver_laps["stint_index"] = driver_laps["last_pit_lap"].map(
            lambda last_pit: sum(pit <= last_pit for pit in driver_pits)
        )
        driver_laps["stint"] = driver_laps["stint_index"] + 1
        # Initial stint is anchored at lap zero; after a pit stop, tire_age is
        # current lap minus the latest pit lap. The pit and immediate next lap
        # are removed before this feature reaches the model.
        driver_laps["tire_age"] = driver_laps["lap"] - driver_laps["last_pit_lap"]
        driver_laps["lap_time_seconds"] = driver_laps["milliseconds"] / 1000.0
        driver_laps["grid"] = int(driver_row["grid"])
        driver_laps["driver"] = driver_row["code"] if pd.notna(driver_row["code"]) else driver_row["driver_name"]
        driver_laps["driver_name"] = driver_row["driver_name"]
        driver_laps["driver_id"] = driver_id
        driver_laps["race_id"] = selection.race_id
        driver_laps["race_name"] = selection.name
        driver_laps["year"] = selection.year
        driver_laps["completed_status"] = driver_row["status"]

        retained = driver_laps.loc[~driver_laps["removed"]].copy()
        if retained["stint"].nunique() < 2:
            raise ValueError(f"Driver {driver_id} has no earlier/final stint boundary after cleaning")
        final_stint = int(retained["stint"].max())
        retained["split"] = np.where(retained["stint"].eq(final_stint), "test", "train")
        retained["is_final_stint"] = retained["stint"].eq(final_stint)
        cleaned_frames.append(retained)

        cleaning_records.append(
            {
                "driver_id": driver_id,
                "driver": driver_laps["driver"].iloc[0],
                "driver_name": driver_row["driver_name"],
                "raw_laps": int(len(driver_laps)),
                "pit_stop_laps": int(driver_laps["pit_stop_lap"].sum()),
                "post_pit_laps": int(driver_laps["post_pit_lap"].sum()),
                "extreme_slow_laps": int(driver_laps["extreme_slow_lap"].sum()),
                "removed_laps": int(driver_laps["removed"].sum()),
                "retained_laps": int((~driver_laps["removed"]).sum()),
                "driver_median_ms": driver_median_ms,
                "stints": int(retained["stint"].nunique()),
                "final_stint": final_stint,
                "final_stint_laps": int(retained["is_final_stint"].sum()),
            }
        )

    cleaned = pd.concat(cleaned_frames, ignore_index=True).sort_values(["driver_id", "lap"]).reset_index(drop=True)
    cleaning_detail = pd.DataFrame(cleaning_records)

    total_raw = int(cleaning_detail["raw_laps"].sum())
    pit_removed = int(cleaning_detail["pit_stop_laps"].sum())
    post_pit_removed = int(cleaning_detail["post_pit_laps"].sum())
    extreme_removed = int(cleaning_detail["extreme_slow_laps"].sum())
    removed = int(cleaning_detail["removed_laps"].sum())
    retained = int(cleaning_detail["retained_laps"].sum())
    if removed != pit_removed + post_pit_removed + extreme_removed:
        raise AssertionError("Cleaning categories are not mutually exclusive")
    if total_raw != removed + retained:
        raise AssertionError("Cleaning row accounting does not reconcile")

    summary_rows = [
        {"metric": "raw_laps", "value": total_raw},
        {"metric": "pit_stop_laps", "value": pit_removed},
        {"metric": "post_pit_laps", "value": post_pit_removed},
        {"metric": "extreme_slow_laps", "value": extreme_removed},
        {"metric": "removed_laps", "value": removed},
        {"metric": "retained_laps", "value": retained},
        {"metric": "completed_drivers", "value": int(len(completed))},
        {"metric": "driver_median_multiplier", "value": OUTLIER_MULTIPLIER},
        {"metric": "eligible_race_id", "value": selection.race_id},
    ]
    return cleaned, {"summary_rows": summary_rows, "detail": cleaning_detail}, completed


def build_models() -> dict[str, Any]:
    return {
        "Random Forest": RandomForestRegressor(
            n_estimators=300,
            min_samples_leaf=2,
            random_state=RANDOM_SEED,
            n_jobs=-1,
        ),
        "Gradient Boosting": GradientBoostingRegressor(
            n_estimators=150,
            learning_rate=0.05,
            max_depth=2,
            min_samples_leaf=2,
            random_state=RANDOM_SEED,
        ),
    }


def train_and_evaluate(cleaned: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, Any]]:
    train = cleaned[cleaned["split"].eq("train")].copy()
    test = cleaned[cleaned["split"].eq("test")].copy()
    if train.empty or test.empty:
        raise ValueError("The final-stint holdout produced an empty train or test partition")

    feature_sets = {
        "baseline": ["grid", "lap"],
        "enhanced": ["grid", "lap", "tire_age"],
    }
    comparison_rows: list[dict[str, Any]] = []
    prediction_store: dict[tuple[str, str], np.ndarray] = {}

    for model_name, model_template in build_models().items():
        for feature_set_name, features in feature_sets.items():
            model = model_template.__class__(**model_template.get_params())
            model.fit(train[features], train["lap_time_seconds"])
            predicted = model.predict(test[features])
            key = (model_name, feature_set_name)
            prediction_store[key] = predicted
            comparison_rows.append(
                {
                    "race_id": int(cleaned["race_id"].iloc[0]),
                    "model": model_name,
                    "algorithm": model_name,
                    "feature_set": feature_set_name,
                    "features": " + ".join(features),
                    "rmse": float(math.sqrt(mean_squared_error(test["lap_time_seconds"], predicted))),
                    "mae": float(mean_absolute_error(test["lap_time_seconds"], predicted)),
                    "train_rows": int(len(train)),
                    "test_rows": int(len(test)),
                    "random_seed": RANDOM_SEED,
                }
            )

    comparison = pd.DataFrame(comparison_rows)
    best_index = comparison["rmse"].idxmin()
    best = comparison.loc[best_index].to_dict()
    best_key = (str(best["model"]), str(best["feature_set"]))

    # Predictions in the presentation artifact always come from the observed
    # best configuration selected by the actual holdout RMSE.
    final_predictions = test.copy()
    final_predictions["predicted"] = prediction_store[best_key]
    final_predictions["error"] = final_predictions["lap_time_seconds"] - final_predictions["predicted"]
    final_predictions["prediction_model"] = best["model"]
    final_predictions["prediction_feature_set"] = best["feature_set"]

    # Training rows remain visible for stint/tire-age inspection but are not
    # assigned predictions from a model that was not evaluated on them.
    train_predictions = train.copy()
    train_predictions["predicted"] = np.nan
    train_predictions["error"] = np.nan
    train_predictions["prediction_model"] = best["model"]
    train_predictions["prediction_feature_set"] = best["feature_set"]

    prediction_rows = pd.concat([train_predictions, final_predictions], ignore_index=True)
    return comparison, prediction_rows, {"best": best, "train_rows": len(train), "test_rows": len(test)}


def save_final_stint_plot(selected_driver_rows: pd.DataFrame, output_path: Path, driver_label: str, model_label: str) -> None:
    """Save the same final-stint rows used by the web artifact as a PNG."""
    rows = selected_driver_rows.sort_values("lap")
    fig, ax = plt.subplots(figsize=(11, 4.8), dpi=160)
    fig.patch.set_facecolor("#090a0c")
    ax.set_facecolor("#111417")
    ax.plot(rows["lap"], rows["lap_time_seconds"], color="#e9493f", linewidth=1.8, marker="o", markersize=3.2, label="Actual")
    ax.plot(rows["lap"], rows["predicted"], color="#adc4c5", linewidth=1.6, linestyle="--", label="Predicted")
    ax.set_title(f"Final stint — {driver_label} / {model_label}", color="#f1f2ef", loc="left", pad=14, fontsize=12)
    ax.set_xlabel("Lap number", color="#a0a8aa")
    ax.set_ylabel("Lap time (seconds)", color="#a0a8aa")
    ax.grid(True, color="#f1f2ef", alpha=0.10, linewidth=0.6)
    ax.tick_params(colors="#a0a8aa", labelsize=8)
    for spine in ax.spines.values():
        spine.set_color("#3b4246")
    legend = ax.legend(frameon=False, loc="upper left")
    for text in legend.get_texts():
        text.set_color("#a0a8aa")
    fig.tight_layout()
    fig.savefig(output_path, facecolor=fig.get_facecolor(), bbox_inches="tight")
    plt.close(fig)


def write_artifacts(
    selection: RaceSelection,
    audit: pd.DataFrame,
    cleaned: pd.DataFrame,
    cleaning: dict[str, Any],
    completed: pd.DataFrame,
    comparison: pd.DataFrame,
    prediction_rows: pd.DataFrame,
    model_summary: dict[str, Any],
    source_shapes: dict[str, list[int]],
) -> None:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    audit_out = audit.copy()
    audit_out = audit_out.drop(columns=["sprint_date"], errors="ignore")
    audit_out.to_csv(RESULTS_DIR / "eligible_races.csv", index=False)
    cleaning["detail"].to_csv(RESULTS_DIR / "cleaning_by_driver.csv", index=False, float_format="%.6f")
    pd.DataFrame(cleaning["summary_rows"]).to_csv(RESULTS_DIR / "cleaning_summary.csv", index=False)
    comparison.to_csv(RESULTS_DIR / "model_comparison.csv", index=False, float_format="%.9f")

    prediction_out = prediction_rows[
        [
            "race_id",
            "race_name",
            "year",
            "driver_id",
            "driver",
            "driver_name",
            "grid",
            "stint",
            "stint_index",
            "split",
            "is_final_stint",
            "lap",
            "last_pit_lap",
            "tire_age",
            "milliseconds",
            "lap_time_seconds",
            "predicted",
            "error",
            "prediction_model",
            "prediction_feature_set",
        ]
    ].rename(
        columns={
            "milliseconds": "actual_milliseconds",
            "lap_time_seconds": "actual",
        }
    )
    prediction_out.to_csv(RESULTS_DIR / "stint_predictions.csv", index=False, float_format="%.9f")

    best = model_summary["best"]
    final_rows = prediction_rows[prediction_rows["split"].eq("test")].copy()
    longest_final = (
        final_rows.groupby(["driver_id", "driver", "driver_name"], as_index=False)
        .size()
        .sort_values(["size", "driver_id"], ascending=[False, True])
        .iloc[0]
    )
    selected_driver_id = int(longest_final["driver_id"])
    selected_driver_rows = final_rows[final_rows["driver_id"].eq(selected_driver_id)]
    selected_driver = str(longest_final["driver"])
    selected_driver_name = str(longest_final["driver_name"])
    plot_path = RESULTS_DIR / "final_stint_actual_vs_predicted.png"
    save_final_stint_plot(
        selected_driver_rows,
        plot_path,
        selected_driver_name,
        f"{best['model']} / {best['feature_set']}",
    )

    cleaning_summary = {row["metric"]: serializable(row["value"]) for row in cleaning["summary_rows"]}
    summary = {
        "status": "complete",
        "schema_version": "1.1",
        "source": {
            "directory": "data/raw",
            "files": source_shapes,
            "raw_tables_used": ["races.csv", "results.csv", "lap_times.csv", "pit_stops.csv", "status.csv", "drivers.csv"],
            "weather_field_present": False,
            "tire_compound_field_present": False,
        },
        "race_eligibility_verification": {
            "dry_race": {
                "verified": bool(selection.dry_verified),
                "method": "external race-day weather provenance; the supplied CSVs contain no weather field",
                "sources": list(selection.dry_sources),
            },
            "no_red_flag": {
                "verified": bool(selection.no_red_flag_verified),
                "method": "external season red-flag list; the supplied CSVs contain no red-flag field",
                "sources": list(selection.no_red_flag_sources),
            },
            "completed_driver_rule": {
                "verified": bool(5 <= selection.completed_drivers <= 10),
                "status_value": COMPLETED_STATUS,
                "completed_drivers": selection.completed_drivers,
            },
            "usable_lap_data": {
                "verified": True,
                "completed_drivers_with_lap_data": selection.completed_drivers,
            },
            "usable_pit_stint_data": {
                "verified": True,
                "completed_drivers_with_pit_data": selection.completed_drivers,
            },
            "final_stint_holdout": {
                "verified": bool((cleaning["detail"]["stints"] >= 2).all()),
                "minimum_stints_per_completed_driver": int(cleaning["detail"]["stints"].min()),
            },
        },
        "dry_race_eligibility": {
            "selected_race_id": selection.race_id,
            "selected_race": selection.name,
            "selected_year": selection.year,
            "condition": "verified externally; not inferred from lap times",
            "verification_sources": list(selection.dry_sources),
        },
        "selected_race": {
            "race_id": selection.race_id,
            "year": selection.year,
            "round": selection.round,
            "name": selection.name,
            "date": selection.date,
            "completed_drivers": selection.completed_drivers,
            "lap_drivers": selection.lap_drivers,
            "pit_drivers": selection.pit_drivers,
            "pit_events": selection.pit_events,
            "sprint_scheduled": selection.sprint_scheduled,
            "dry_verified": selection.dry_verified,
            "no_red_flag_verified": selection.no_red_flag_verified,
            "completed_with_lap_data": selection.completed_drivers,
            "completed_with_pit_data": selection.completed_drivers,
            "completed_status_rule": f"status == {COMPLETED_STATUS!r}",
        },
        "methodology": {
            "target": "lap_time_seconds",
            "baseline_features": ["grid", "lap"],
            "enhanced_features": ["grid", "lap", "tire_age"],
            "tire_age_definition": "current lap minus latest pit lap; initial stint anchored at lap 0",
            "pit_stop_lap_removed": True,
            "immediate_post_pit_lap_removed": True,
            "outlier_rule": "> 1.5 × driver median lap time after pit/post-pit exclusion",
            "split_rule": "earlier stints train; entire final stint test for each completed driver",
            "models": ["Random Forest", "Gradient Boosting"],
            "random_seed": RANDOM_SEED,
            "random_train_test_split": False,
        },
        "cleaning": {
            "raw_laps": int(cleaning_summary["raw_laps"]),
            "pit_stop_laps": int(cleaning_summary["pit_stop_laps"]),
            "post_pit_laps": int(cleaning_summary["post_pit_laps"]),
            "extreme_slow_laps": int(cleaning_summary["extreme_slow_laps"]),
            "removed_laps": int(cleaning_summary["removed_laps"]),
            "retained_laps": int(cleaning_summary["retained_laps"]),
            "accounting_check": "raw_laps == removed_laps + retained_laps",
        },
        "partitions": {
            "train_rows": int(model_summary["train_rows"]),
            "test_rows": int(model_summary["test_rows"]),
            "final_stint_drivers": int(final_rows["driver_id"].nunique()),
        },
        "best_configuration": {
            "model": str(best["model"]),
            "feature_set": str(best["feature_set"]),
            "rmse": float(best["rmse"]),
            "mae": float(best["mae"]),
        },
        "final_stint_visualization": {
            "driver": selected_driver,
            "driver_name": selected_driver_name,
            "driver_id": selected_driver_id,
            "selection_rule": "longest final-stint holdout; tie broken by driver_id",
            "rows": int(len(selected_driver_rows)),
            "prediction_model": str(best["model"]),
            "prediction_feature_set": str(best["feature_set"]),
        },
        "artifacts": {
            "model_comparison": "results/model_comparison.csv",
            "cleaning_summary": "results/cleaning_summary.csv",
            "cleaning_by_driver": "results/cleaning_by_driver.csv",
            "eligible_races": "results/eligible_races.csv",
            "stint_predictions": "results/stint_predictions.csv",
            "final_stint_plot": "results/final_stint_actual_vs_predicted.png",
            "summary": "results/summary.json",
        },
    }
    (RESULTS_DIR / "summary.json").write_text(json.dumps(summary, indent=2, default=serializable) + "\n")


def main() -> None:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    races = read_csv("races.csv")
    results = read_csv("results.csv")
    lap_times = read_csv("lap_times.csv")
    pit_stops = read_csv("pit_stops.csv")
    statuses = read_csv("status.csv")
    drivers = read_csv("drivers.csv")

    selection, audit = find_race_selection(races, results, lap_times, pit_stops, statuses)
    cleaned, cleaning, completed = clean_laps_for_race(selection, results, statuses, lap_times, pit_stops, drivers)
    comparison, prediction_rows, model_summary = train_and_evaluate(cleaned)
    source_shapes = {
        name: list(read_csv(name).shape)
        for name in ["races.csv", "results.csv", "lap_times.csv", "pit_stops.csv", "status.csv", "drivers.csv"]
    }
    write_artifacts(
        selection,
        audit,
        cleaned,
        cleaning,
        completed,
        comparison,
        prediction_rows,
        model_summary,
        source_shapes,
    )

    print(f"Selected race: {selection.year} {selection.name} (raceId={selection.race_id})")
    print(f"Completed drivers: {selection.completed_drivers}")
    print(f"Rows: raw={cleaning['summary_rows'][0]['value']} removed={cleaning['summary_rows'][4]['value']} retained={cleaning['summary_rows'][5]['value']}")
    print(comparison[["model", "feature_set", "rmse", "mae"]].to_string(index=False))
    print(f"Best: {model_summary['best']['model']} / {model_summary['best']['feature_set']}")
    print(f"Artifacts written to: {RESULTS_DIR}")


if __name__ == "__main__":
    main()
