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
def health():
    try:
        _, meta = load_artifacts()
        return {"ok": True, "model": meta["model"], "feature_set": meta["feature_set"], "drivers": meta["drivers"]}
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@app.post("/api/predict")
def predict(payload: PredictionRequest):
    try:
        model, meta = load_artifacts()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    drivers = meta.get("drivers", [])
    if payload.driver not in drivers:
        raise HTTPException(status_code=400, detail="Driver is not part of the selected race experiment.")

    # The assignment's enhanced model intentionally uses grid + lap + tire_age.
    # Driver is validated as context but is not an additional feature.
    import pandas as pd
    features = pd.DataFrame([{
        "grid": payload.grid_position,
        "lap": payload.lap_number,
        "tire_age": payload.tire_age,
    }])
    prediction = float(model.predict(features)[0])
    return {
        "prediction_seconds": prediction,
        "prediction": round(prediction, 3),
        "unit": "seconds",
        "driver": payload.driver,
        "model": meta["model"],
        "feature_set": meta["feature_set"],
        "features": meta["features"],
    }
