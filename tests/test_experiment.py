import unittest
from pathlib import Path

import pandas as pd

from experiment.run_experiment import (
    clean_laps_for_race,
    find_race_selection,
    read_csv,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = PROJECT_ROOT / "data" / "raw"


class ExperimentContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.races = read_csv("races.csv")
        cls.results = read_csv("results.csv")
        cls.lap_times = read_csv("lap_times.csv")
        cls.pit_stops = read_csv("pit_stops.csv")
        cls.statuses = read_csv("status.csv")
        cls.drivers = read_csv("drivers.csv")
        cls.selection, cls.audit = find_race_selection(
            cls.races, cls.results, cls.lap_times, cls.pit_stops, cls.statuses
        )
        cls.cleaned, cls.cleaning, cls.completed = clean_laps_for_race(
            cls.selection,
            cls.results,
            cls.statuses,
            cls.lap_times,
            cls.pit_stops,
            cls.drivers,
        )

    def test_required_input_schema(self):
        required = {
            "races.csv": {"raceId", "year", "round", "name", "date"},
            "results.csv": {"raceId", "driverId", "grid", "statusId", "laps"},
            "lap_times.csv": {"raceId", "driverId", "lap", "milliseconds"},
            "pit_stops.csv": {"raceId", "driverId", "stop", "lap", "milliseconds"},
        }
        loaded = {
            "races.csv": self.races,
            "results.csv": self.results,
            "lap_times.csv": self.lap_times,
            "pit_stops.csv": self.pit_stops,
        }
        for filename, columns in required.items():
            with self.subTest(filename=filename):
                self.assertTrue(columns.issubset(loaded[filename].columns))

    def test_selected_race_and_completed_driver_rule(self):
        self.assertEqual(self.selection.race_id, 841)
        self.assertTrue(self.selection.dry_verified)
        self.assertTrue(self.selection.no_red_flag_verified)
        self.assertGreaterEqual(self.selection.completed_drivers, 5)
        self.assertLessEqual(self.selection.completed_drivers, 10)
        self.assertEqual(len(self.completed), self.selection.completed_drivers)

    def test_tire_age_calculation(self):
        expected = self.cleaned["lap"] - self.cleaned["last_pit_lap"]
        pd.testing.assert_series_equal(
            self.cleaned["tire_age"].reset_index(drop=True),
            expected.reset_index(drop=True),
            check_names=False,
        )

    def test_pit_stop_reset_behavior(self):
        hamilton = self.cleaned[self.cleaned["driver_id"].eq(1)]
        # Lap 36 is the pit lap, lap 37 is the immediate post-pit lap, so the
        # first retained row in the final stint is lap 38 with tire_age 2.
        final_first = hamilton[hamilton["stint"].eq(hamilton["stint"].max())].sort_values("lap").iloc[0]
        self.assertEqual(int(final_first["lap"]), 38)
        self.assertEqual(int(final_first["last_pit_lap"]), 36)
        self.assertEqual(int(final_first["tire_age"]), 2)
        self.assertNotIn(36, set(hamilton["lap"]))
        self.assertNotIn(37, set(hamilton["lap"]))

    def test_cleaning_accounting(self):
        values = {row["metric"]: row["value"] for row in self.cleaning["summary_rows"]}
        self.assertEqual(values["raw_laps"], values["removed_laps"] + values["retained_laps"])
        self.assertEqual(
            values["removed_laps"],
            values["pit_stop_laps"] + values["post_pit_laps"] + values["extreme_slow_laps"],
        )

    def test_final_stint_split(self):
        for driver_id, rows in self.cleaned.groupby("driver_id"):
            final_stint = rows["stint"].max()
            train = rows[rows["split"].eq("train")]
            test = rows[rows["split"].eq("test")]
            with self.subTest(driver_id=driver_id):
                self.assertGreater(len(train), 0)
                self.assertGreater(len(test), 0)
                self.assertTrue((test["stint"] == final_stint).all())
                self.assertTrue((train["stint"] < final_stint).all())

    def test_no_train_test_overlap(self):
        train_keys = set(
            zip(
                self.cleaned.loc[self.cleaned["split"].eq("train"), "driver_id"],
                self.cleaned.loc[self.cleaned["split"].eq("train"), "lap"],
            )
        )
        test_keys = set(
            zip(
                self.cleaned.loc[self.cleaned["split"].eq("test"), "driver_id"],
                self.cleaned.loc[self.cleaned["split"].eq("test"), "lap"],
            )
        )
        self.assertTrue(train_keys.isdisjoint(test_keys))

    def test_final_stint_never_enters_training(self):
        train = self.cleaned[self.cleaned["split"].eq("train")]
        for _, rows in self.cleaned.groupby("driver_id"):
            final_stint = rows["stint"].max()
            self.assertFalse(((train["driver_id"] == rows["driver_id"].iloc[0]) & (train["stint"] == final_stint)).any())


if __name__ == "__main__":
    unittest.main()
