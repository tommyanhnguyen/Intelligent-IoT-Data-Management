"""Run the sensor trend prediction prototype on project CSV data."""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import pandas as pd


THIS_FILE = Path(__file__).resolve()
REPO_ROOT = THIS_FILE.parents[3]

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(
        0,
        str(REPO_ROOT),
    )


from data_science.examples.sensor_prediction.prediction import (
    clean_series,
    evaluate_sensor,
    predict_sensor,
)


def parse_args():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "csv_file"
    )

    parser.add_argument(
        "--timestamp-col",
        default="timestamp",
    )

    parser.add_argument(
        "--sensors",
        required=True,
    )

    parser.add_argument(
        "--lookbacks",
        default="10,20,30",
    )

    parser.add_argument(
        "--primary-lookback",
        type=int,
        default=20,
    )

    parser.add_argument(
        "--stable-percent",
        type=float,
        default=2.0,
    )

    parser.add_argument(
        "--max-evaluations",
        type=int,
        default=300,
    )

    parser.add_argument(
        "--output-dir",
        required=True,
    )

    return parser.parse_args()


def prepare_dataset(
    csv_path: Path,
    timestamp_col: str,
):
    df = pd.read_csv(csv_path)

    df.columns = [
        str(column).strip()
        for column in df.columns
    ]

    if timestamp_col not in df.columns:
        raise ValueError(
            f"Timestamp column '{timestamp_col}' not found. "
            f"Available columns: {list(df.columns)}"
        )

    parsed_time = pd.to_datetime(
        df[timestamp_col],
        errors="coerce",
    )

    valid_time_count = (
        parsed_time.notna().sum()
    )

    if valid_time_count < 2:
        raise ValueError(
            "Timestamp column could not be parsed"
        )

    df = df.assign(
        _parsed_timestamp=parsed_time
    )

    df = (
        df.dropna(
            subset=["_parsed_timestamp"]
        )
        .sort_values("_parsed_timestamp")
        .reset_index(drop=True)
    )

    return df


def save_plot(
    series,
    sensor,
    prediction,
    output_dir,
):
    values = clean_series(series)

    lookback = prediction.lookback

    recent = values[-lookback:]

    x = list(
        range(len(recent))
    )

    plt.figure(
        figsize=(8, 4.5)
    )

    plt.plot(
        x,
        recent,
        marker="o",
        label="Recent observations",
    )

    plt.scatter(
        [len(recent)],
        [prediction.predicted_value],
        marker="x",
        s=120,
        label="Predicted next value",
    )

    plt.xlabel(
        "Recent observation"
    )

    plt.ylabel(sensor)

    plt.title(
        f"Sensor trend prediction: {sensor}"
    )

    plt.legend()
    plt.tight_layout()

    path = (
        output_dir
        / f"{sensor}_prediction.png"
    )

    plt.savefig(
        path,
        dpi=150,
    )

    plt.close()


def main():
    args = parse_args()

    csv_path = Path(
        args.csv_file
    )

    if not csv_path.exists():
        raise SystemExit(
            f"Dataset not found: {csv_path}"
        )

    try:
        df = prepare_dataset(
            csv_path,
            args.timestamp_col,
        )
    except ValueError as exc:
        raise SystemExit(
            str(exc)
        )

    sensors = [
        item.strip()
        for item in args.sensors.split(",")
        if item.strip()
    ]

    lookbacks = [
        int(item.strip())
        for item in args.lookbacks.split(",")
        if item.strip()
    ]

    missing_sensors = [
        sensor
        for sensor in sensors
        if sensor not in df.columns
    ]

    if missing_sensors:
        raise SystemExit(
            f"Missing sensors: {missing_sensors}. "
            f"Available columns: {list(df.columns)}"
        )

    output_dir = Path(
        args.output_dir
    )

    output_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    predictions = []
    primary_evaluations = []
    comparison_rows = []

    print("=" * 74)
    print(
        "SENSOR TREND PREDICTION PROTOTYPE"
    )
    print("=" * 74)

    print(
        "Dataset:",
        csv_path,
    )

    print(
        "Chronological rows:",
        len(df),
    )

    print(
        "Sensors:",
        ", ".join(sensors),
    )

    print(
        "Primary lookback:",
        args.primary_lookback,
    )

    print(
        "Comparison lookbacks:",
        lookbacks,
    )

    print()

    for sensor in sensors:
        print(
            f"Sensor: {sensor}"
        )

        prediction = predict_sensor(
            df[sensor],
            sensor=sensor,
            lookback=args.primary_lookback,
            stable_percent=(
                args.stable_percent
            ),
        )

        predictions.append(
            prediction.to_dict()
        )

        print(
            f"  Current value:       "
            f"{prediction.current_value:.4f}"
        )

        print(
            f"  Predicted next:      "
            f"{prediction.predicted_value:.4f}"
        )

        print(
            f"  Trend:               "
            f"{prediction.trend}"
        )

        if (
            prediction.predicted_change_percent
            is not None
        ):
            print(
                f"  Predicted change:    "
                f"{prediction.predicted_change_percent:.2f}%"
            )

        print(
            f"  User insight:        "
            f"{prediction.message}"
        )

        print()
        print(
            "  Lookback evaluation:"
        )

        for lookback in lookbacks:
            evaluation = evaluate_sensor(
                df[sensor],
                sensor=sensor,
                lookback=lookback,
                stable_percent=(
                    args.stable_percent
                ),
                max_evaluations=(
                    args.max_evaluations
                ),
            )

            row = evaluation.to_dict()

            comparison_rows.append(
                row
            )

            if (
                lookback
                == args.primary_lookback
            ):
                primary_evaluations.append(
                    row
                )

            print(
                f"    {lookback:>2} observations | "
                f"MAE={evaluation.model_mae:.4f} | "
                f"baseline={evaluation.baseline_mae:.4f} | "
                f"direction={evaluation.direction_accuracy:.2f}% | "
                f"beats baseline={evaluation.model_beats_baseline}"
            )

        save_plot(
            df[sensor],
            sensor,
            prediction,
            output_dir,
        )

        print("-" * 74)

    results = {
        "dataset": str(csv_path),
        "rows": len(df),
        "timestamp_column": (
            args.timestamp_col
        ),
        "primary_lookback": (
            args.primary_lookback
        ),
        "lookbacks_compared": lookbacks,
        "predictions": predictions,
        "primary_evaluation": (
            primary_evaluations
        ),
        "lookback_comparison": (
            comparison_rows
        ),
    }

    json_path = (
        output_dir
        / "prediction_results.json"
    )

    json_path.write_text(
        json.dumps(
            results,
            indent=2,
        ),
        encoding="utf-8",
    )

    prediction_csv = (
        output_dir
        / "predictions.csv"
    )

    with prediction_csv.open(
        "w",
        newline="",
        encoding="utf-8",
    ) as file:
        writer = csv.DictWriter(
            file,
            fieldnames=(
                predictions[0].keys()
            ),
        )

        writer.writeheader()
        writer.writerows(
            predictions
        )

    evaluation_csv = (
        output_dir
        / "evaluation.csv"
    )

    with evaluation_csv.open(
        "w",
        newline="",
        encoding="utf-8",
    ) as file:
        writer = csv.DictWriter(
            file,
            fieldnames=(
                primary_evaluations[0].keys()
            ),
        )

        writer.writeheader()
        writer.writerows(
            primary_evaluations
        )

    comparison_csv = (
        output_dir
        / "lookback_comparison.csv"
    )

    with comparison_csv.open(
        "w",
        newline="",
        encoding="utf-8",
    ) as file:
        writer = csv.DictWriter(
            file,
            fieldnames=(
                comparison_rows[0].keys()
            ),
        )

        writer.writeheader()
        writer.writerows(
            comparison_rows
        )

    print()
    print(
        "Evidence saved to:",
        output_dir,
    )

    print(
        " - prediction_results.json"
    )

    print(
        " - predictions.csv"
    )

    print(
        " - evaluation.csv"
    )

    print(
        " - lookback_comparison.csv"
    )

    print(
        " - prediction PNG files"
    )


if __name__ == "__main__":
    main()
