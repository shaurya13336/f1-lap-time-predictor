# APEX / RESEARCH — Experiment 001

Artifact-aware presentation layer and reproducible Formula One lap-time prediction experiment.

## Run the experiment

```bash
python -m pip install -r requirements.txt
python experiment/run_experiment.py
```

The runner reads the supplied CSV archive from `data/raw/` and writes generated outputs to `results/`. The notebook uses the same experiment functions and reproduces the same run from top to bottom.

## Run the authoritative notebook

```bash
jupyter notebook notebooks/f1_lap_time_prediction.ipynb
```

Notebook: `notebooks/f1_lap_time_prediction.ipynb`

It loads the source tables, validates schemas, verifies eligibility, cleans laps, reconstructs stints, checks the leakage boundary, trains both regressors, evaluates RMSE/MAE, plots the selected final stint, and writes the artifacts consumed by the website.

## Dataset inspection

The attached archive is an Ergast-style F1 dataset. The experiment uses:

- `races.csv`
- `results.csv`
- `lap_times.csv`
- `pit_stops.csv`
- `status.csv`
- `drivers.csv`

The other supplied tables remain in `data/raw/` for provenance but are not needed by the current experiment.

The source archive contains no weather, track-condition, tire-compound, or red-flag field. Those conditions are not inferred from lap times. The configured race is the 2011 Australian Grand Prix, race ID `841`, and the external verification sources are recorded in `experiment/dry_race_selection.md` and `results/summary.json`. If the preferred race fails any source-data rule, the runner audits the supplied race table and selects the first alternative with explicit condition provenance; it fails loudly rather than fabricating a dry/no-red-flag label.

## Methodology

- Eligible race: dry, no red flag, 5–10 exact `Finished` drivers, usable lap and pit data, no sprint flag, and at least two reconstructed stints per selected driver.
- Selected race: 2011 Australian Grand Prix, race ID `841`.
- Remove pit-stop laps.
- Remove immediate post-pit laps.
- Remove laps greater than `1.5 × driver median` after pit/post-pit exclusion.
- Reconstruct `tire_age = current lap − latest pit lap`; the opening stint is anchored at lap zero.
- Baseline features: `grid + lap`.
- Enhanced features: `grid + lap + tire_age`.
- Train on earlier stints.
- Hold out the entire final stint for every completed driver.
- Evaluate Random Forest and Gradient Boosting with RMSE and MAE.
- Use a fixed random seed of `42` for both estimators.
- Select the best configuration by the lowest actual holdout RMSE for the final-stint visualization.

No random train/test split is used. Tests explicitly check the final-stint boundary and train/test disjointness.

## Generated artifacts

- `results/cleaning_summary.csv`
- `results/cleaning_by_driver.csv`
- `results/eligible_races.csv`
- `results/model_comparison.csv`
- `results/stint_predictions.csv`
- `results/final_stint_actual_vs_predicted.png`
- `results/summary.json`

The website reads the result artifacts through `lib/results.js`. It does not embed the experiment metrics in the UI.

## Tests

```bash
python -m unittest discover -s tests -v
```

Coverage includes schema checks, tire-age arithmetic, pit-stop reset behavior, cleaning accounting, final-stint split correctness, and no train/test lap overlap.

## Run the website

```bash
npm start
```

Then open `http://localhost:4173`. The current preview is already running in the app panel.
