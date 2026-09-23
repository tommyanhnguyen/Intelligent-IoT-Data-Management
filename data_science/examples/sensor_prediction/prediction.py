"""Short-horizon IoT sensor trend prediction prototype.

The prototype predicts the next sensor observation from recent readings
using a simple least-squares linear trend.

It is intentionally isolated from the production Correlation, Backend,
Frontend and anomaly-detection components.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd


SENSOR_LABELS = {
    "occupancy_t4013": "Traffic occupancy T4013",
    "speed_t4013": "Traffic speed T4013",
    "occupancy_6005": "Traffic occupancy 6005",
    "speed_6005": "Traffic speed 6005",
    "ec2_cpu": "EC2 CPU usage",
    "ec2_net": "EC2 network activity",
    "elb_req": "ELB requests",
}


@dataclass
class PredictionResult:
    sensor: str
    current_value: float
    predicted_value: float
    predicted_change: float
    predicted_change_percent: float | None
    trend: str
    lookback: int
    message: str

    def to_dict(self):
        return asdict(self)


@dataclass
class EvaluationResult:
    sensor: str
    lookback: int
    evaluations: int
    model_mae: float
    baseline_mae: float
    model_rmse: float
    baseline_rmse: float
    direction_accuracy: float
    improvement_over_baseline_percent: float
    model_beats_baseline: bool

    def to_dict(self):
        return asdict(self)


def clean_series(series: pd.Series) -> np.ndarray:
    """Convert a sensor column into finite numeric observations."""
    numeric = pd.to_numeric(series, errors="coerce")
    numeric = numeric.replace([np.inf, -np.inf], np.nan).dropna()

    return numeric.astype(float).to_numpy()


def validate_values(values, lookback: int) -> np.ndarray:
    if not isinstance(lookback, int):
        raise ValueError("lookback must be an integer")

    if lookback < 3:
        raise ValueError("lookback must be at least 3")

    values = np.asarray(values, dtype=float)
    values = values[np.isfinite(values)]

    if len(values) < lookback:
        raise ValueError(
            f"At least {lookback} valid observations are required; "
            f"received {len(values)}"
        )

    return values


def linear_trend_prediction(values, lookback: int = 20) -> float:
    """Predict one observation ahead using recent linear trend."""
    values = validate_values(values, lookback)

    recent = values[-lookback:]

    x = np.arange(lookback, dtype=float)

    slope, intercept = np.polyfit(
        x,
        recent,
        1,
    )

    next_x = float(lookback)

    return float(
        slope * next_x + intercept
    )


def persistence_prediction(values) -> float:
    """Baseline model: assume the next reading equals the current reading."""
    values = np.asarray(values, dtype=float)
    values = values[np.isfinite(values)]

    if len(values) == 0:
        raise ValueError(
            "At least one valid observation is required"
        )

    return float(values[-1])


def classify_trend(
    current: float,
    predicted: float,
    stable_percent: float = 2.0,
) -> str:
    """Classify expected movement."""
    if stable_percent < 0:
        raise ValueError(
            "stable_percent must be non-negative"
        )

    current = float(current)
    predicted = float(predicted)

    change = predicted - current

    scale = max(
        abs(current),
        1.0,
    )

    threshold = (
        scale
        * stable_percent
        / 100.0
    )

    if abs(change) <= threshold:
        return "STABLE"

    if change > 0:
        return "INCREASING"

    return "DECREASING"


def calculate_change_percent(
    current: float,
    predicted: float,
) -> float | None:
    current = float(current)
    predicted = float(predicted)

    if math.isclose(
        current,
        0.0,
        abs_tol=1e-12,
    ):
        return None

    return (
        (predicted - current)
        / abs(current)
        * 100.0
    )


def sensor_label(sensor: str) -> str:
    return SENSOR_LABELS.get(
        sensor,
        sensor.replace("_", " "),
    )


def create_user_message(
    sensor: str,
    trend: str,
) -> str:
    label = sensor_label(sensor)

    if trend == "INCREASING":
        return (
            f"Based on recent readings, {label} is predicted "
            "to increase in the next observation."
        )

    if trend == "DECREASING":
        return (
            f"Based on recent readings, {label} is predicted "
            "to decrease in the next observation."
        )

    return (
        f"Based on recent readings, {label} is predicted "
        "to remain relatively stable in the next observation."
    )


def predict_sensor(
    series: pd.Series,
    sensor: str,
    lookback: int = 20,
    stable_percent: float = 2.0,
) -> PredictionResult:
    values = clean_series(series)
    values = validate_values(values, lookback)

    current = float(values[-1])

    predicted = linear_trend_prediction(
        values,
        lookback,
    )

    trend = classify_trend(
        current,
        predicted,
        stable_percent,
    )

    return PredictionResult(
        sensor=sensor,
        current_value=current,
        predicted_value=predicted,
        predicted_change=predicted - current,
        predicted_change_percent=calculate_change_percent(
            current,
            predicted,
        ),
        trend=trend,
        lookback=lookback,
        message=create_user_message(
            sensor,
            trend,
        ),
    )


def evaluate_sensor(
    series: pd.Series,
    sensor: str,
    lookback: int = 20,
    stable_percent: float = 2.0,
    max_evaluations: int = 300,
) -> EvaluationResult:
    """Perform chronological walk-forward evaluation."""
    values = clean_series(series)

    values = validate_values(
        values,
        lookback + 1,
    )

    if max_evaluations > 0:
        start_index = max(
            lookback,
            len(values) - max_evaluations,
        )
    else:
        start_index = lookback

    actual_values = []
    model_predictions = []
    baseline_predictions = []
    direction_matches = []

    for index in range(
        start_index,
        len(values),
    ):
        history = values[:index]

        actual = float(values[index])
        previous = float(values[index - 1])

        model_prediction = linear_trend_prediction(
            history,
            lookback,
        )

        baseline_prediction = persistence_prediction(
            history
        )

        actual_values.append(actual)
        model_predictions.append(model_prediction)
        baseline_predictions.append(
            baseline_prediction
        )

        actual_direction = classify_trend(
            previous,
            actual,
            stable_percent,
        )

        predicted_direction = classify_trend(
            previous,
            model_prediction,
            stable_percent,
        )

        direction_matches.append(
            actual_direction
            == predicted_direction
        )

    if not actual_values:
        raise ValueError(
            "Not enough observations for evaluation"
        )

    actual_values = np.asarray(
        actual_values,
        dtype=float,
    )

    model_predictions = np.asarray(
        model_predictions,
        dtype=float,
    )

    baseline_predictions = np.asarray(
        baseline_predictions,
        dtype=float,
    )

    model_errors = (
        actual_values
        - model_predictions
    )

    baseline_errors = (
        actual_values
        - baseline_predictions
    )

    model_mae = float(
        np.mean(
            np.abs(model_errors)
        )
    )

    baseline_mae = float(
        np.mean(
            np.abs(baseline_errors)
        )
    )

    model_rmse = float(
        np.sqrt(
            np.mean(
                model_errors ** 2
            )
        )
    )

    baseline_rmse = float(
        np.sqrt(
            np.mean(
                baseline_errors ** 2
            )
        )
    )

    direction_accuracy = float(
        np.mean(direction_matches)
        * 100.0
    )

    if math.isclose(
        baseline_mae,
        0.0,
        abs_tol=1e-12,
    ):
        improvement = 0.0
    else:
        improvement = (
            (
                baseline_mae
                - model_mae
            )
            / baseline_mae
            * 100.0
        )

    return EvaluationResult(
        sensor=sensor,
        lookback=lookback,
        evaluations=len(actual_values),
        model_mae=model_mae,
        baseline_mae=baseline_mae,
        model_rmse=model_rmse,
        baseline_rmse=baseline_rmse,
        direction_accuracy=direction_accuracy,
        improvement_over_baseline_percent=float(
            improvement
        ),
        model_beats_baseline=(
            model_mae
            < baseline_mae
        ),
    )
