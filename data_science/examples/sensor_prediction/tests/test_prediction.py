import unittest

import numpy as np
import pandas as pd

from data_science.examples.sensor_prediction.prediction import (
    classify_trend,
    clean_series,
    evaluate_sensor,
    linear_trend_prediction,
    predict_sensor,
)


class SensorPredictionTests(unittest.TestCase):

    def test_exact_linear_prediction(self):
        values = np.arange(
            1,
            21,
            dtype=float,
        )

        prediction = linear_trend_prediction(
            values,
            lookback=20,
        )

        self.assertAlmostEqual(
            prediction,
            21.0,
            places=5,
        )

    def test_increasing_series(self):
        series = pd.Series(
            np.arange(
                1,
                41,
                dtype=float,
            )
        )

        result = predict_sensor(
            series,
            sensor="test_sensor",
            lookback=20,
            stable_percent=1.0,
        )

        self.assertEqual(
            result.trend,
            "INCREASING",
        )

        self.assertGreater(
            result.predicted_value,
            result.current_value,
        )

    def test_decreasing_series(self):
        series = pd.Series(
            np.arange(
                40,
                0,
                -1,
                dtype=float,
            )
        )

        result = predict_sensor(
            series,
            sensor="test_sensor",
            lookback=20,
            stable_percent=1.0,
        )

        self.assertEqual(
            result.trend,
            "DECREASING",
        )

        self.assertLess(
            result.predicted_value,
            result.current_value,
        )

    def test_constant_series(self):
        series = pd.Series(
            np.full(
                40,
                50.0,
            )
        )

        result = predict_sensor(
            series,
            sensor="test_sensor",
            lookback=20,
        )

        self.assertEqual(
            result.trend,
            "STABLE",
        )

        self.assertAlmostEqual(
            result.predicted_value,
            50.0,
            places=5,
        )

    def test_clean_series(self):
        series = pd.Series(
            [
                1,
                "2",
                None,
                "bad",
                3,
            ]
        )

        result = clean_series(
            series
        )

        self.assertEqual(
            result.tolist(),
            [1.0, 2.0, 3.0],
        )

    def test_trend_classification(self):
        self.assertEqual(
            classify_trend(
                100,
                110,
                2,
            ),
            "INCREASING",
        )

        self.assertEqual(
            classify_trend(
                100,
                90,
                2,
            ),
            "DECREASING",
        )

        self.assertEqual(
            classify_trend(
                100,
                101,
                2,
            ),
            "STABLE",
        )

    def test_chronological_evaluation(self):
        series = pd.Series(
            np.arange(
                1,
                101,
                dtype=float,
            )
        )

        result = evaluate_sensor(
            series,
            sensor="test_sensor",
            lookback=20,
            stable_percent=1.0,
            max_evaluations=50,
        )

        self.assertEqual(
            result.evaluations,
            50,
        )

        self.assertTrue(
            result.model_beats_baseline
        )

        self.assertAlmostEqual(
            result.direction_accuracy,
            100.0,
            places=5,
        )


if __name__ == "__main__":
    unittest.main()
