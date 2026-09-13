from pathlib import Path
import json
import joblib
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / "results"
MODEL_PATH = RESULTS / "best_model.joblib"
META_PATH = RESULTS / "model_metadata.json"

app = FastAPI(title="APEX F1 Lap Time Predictor")


def load_artifacts():
    if not MODEL_PATH.exists() or not META_PATH.exists():
        raise RuntimeError("Model artifact is missing. Run python experiment/run_experiment.py first.")
    return joblib.load(MODEL_PATH), json.loads(META_PATH.read_text(encoding="utf-8"))


class PredictionRequest(BaseModel):
    driver: str = Field(min_length=1)
    grid_position: int = Field(ge=1)
    lap_number: int = Field(ge=1)
    tire_age: int = Field(ge=0)


@app.get("/api")
def api(driver: str | None = None, grid_position: int | None = None, lap_number: int | None = None, tire_age: int | None = None):
    try:
        model, meta = load_artifacts()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    # A plain GET /api is the health/metadata endpoint.
    if driver is None and grid_position is None and lap_number is None and tire_age is None:
        return {"ok": True, "model": meta["model"], "feature_set": meta["feature_set"], "drivers": meta["drivers"]}

    if driver is None or grid_position is None or lap_number is None or tire_age is None:
        raise HTTPException(status_code=400, detail="driver, grid_position, lap_number, and tire_age are required.")
    if grid_position < 1 or lap_number < 1 or tire_age < 0:
        raise HTTPException(status_code=400, detail="Grid and lap must be >= 1; tire age must be >= 0.")
    if driver not in meta.get("drivers", []):
        raise HTTPException(status_code=400, detail="Driver is not part of the selected race experiment.")

    import pandas as pd
    features = pd.DataFrame([{
        "grid": grid_position,
        "lap": lap_number,
        "tire_age": tire_age,
    }])
    prediction = float(model.predict(features)[0])
    return {
        "prediction_seconds": prediction,
        "prediction": round(prediction, 3),
        "unit": "seconds",
        "driver": driver,
        "model": meta["model"],
        "feature_set": meta["feature_set"],
        "features": meta["features"],
    }

