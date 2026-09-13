# Race eligibility verification

The supplied CSV schema contains no weather, track-condition, tire-compound, or red-flag field. Those two race-condition checks are therefore not inferred from lap times or from missing values. They are recorded as external provenance in `results/summary.json` and the experiment only selects a race whose ID appears in the verification map in `experiment/run_experiment.py`.

## Selected race

- `raceId`: 841
- `year`: 2011
- `name`: Australian Grand Prix
- `date`: 2011-03-27
- sprint scheduled in `races.csv`: no

## Explicit checks

- **Dry race:** verified by contemporary race-weekend weather coverage; the race-day forecast was dry and the post-race descriptions report a dry race.
- **No red flag:** the season red-flag list reports two red-flagged 2011 races — Monaco and Canada — and does not list Australia.
- **Completed-driver rule:** `status == "Finished"` gives 7 drivers, within the required 5–10 range.
- **Usable lap data:** all 7 selected drivers have lap-time rows for the race.
- **Usable pit/stint data:** all 7 selected drivers have pit-stop rows.
- **Final-stint holdout:** every selected driver has at least two reconstructed stints after cleaning, so earlier stints can train and the entire final stint can test.

## Provenance references

Dry-race verification:

- RaceFans: https://www.racefans.net/2011/03/24/australian-grand-prix-race-weekend-programme-2/
- Autosport: https://www.autosport.com/f1/live-text/2011-australian-grand-prix-australian-grand-prix-weather-46090/46090/

No-red-flag verification:

- RacingNews365 season table: https://racingnews365.com/does-formula-1-use-the-red-flag-too-often-nowadays

If the preferred race fails any source-data rule, the runner audits the complete supplied `races.csv` table and automatically selects the first alternative that satisfies the 5–10 completed-driver rule, usable lap/pit data, no-sprint rule, and an explicit dry/no-red-flag provenance entry. It will fail loudly rather than invent a condition label if no provenance-verified alternative exists.
