# Data provenance

The attached CSV archive has been copied to `data/raw/` so the experiment is reproducible from the project directory.

Primary tables used:

- `races.csv`
- `results.csv`
- `lap_times.csv`
- `pit_stops.csv`
- `status.csv`
- `drivers.csv`

The remaining supplied tables are retained in `data/raw/` as provenance. The source schema does not contain a weather or tire-compound field, so dry-race eligibility is recorded as an explicit external verification note in `results/summary.json` rather than inferred or fabricated from lap times.
