import io
import os
import sys

import pandas as pd
import pytest

TESTING_DIR = os.path.dirname(os.path.abspath(__file__))
CORRELATION_DIR = os.path.dirname(TESTING_DIR)

if CORRELATION_DIR not in sys.path:
    sys.path.insert(0, CORRELATION_DIR)

from server import app


@pytest.fixture
def client():
    app.config["TESTING"] = True

    with app.test_client() as test_client:
        yield test_client


def make_csv(rows=80):
    df = pd.DataFrame({
        "timestamp": pd.date_range(
            "2026-01-01",
            periods=rows,
            freq="min",
        ),
        "sensor_a": range(rows),
        "sensor_b": [
            value * 2
            for value in range(rows)
        ],
        "sensor_c": [
            100 - value
            for value in range(rows)
        ],
    })

    return io.BytesIO(
        df.to_csv(index=False).encode("utf-8")
    )


def valid_request(**overrides):
    data = {
        "file": (
            make_csv(),
            "test.csv",
        ),
        "timestamp_col": "timestamp",
        "selected_streams": (
            "sensor_a,sensor_b,sensor_c"
        ),
        "window_size": "20",
        "step_size": "10",
        "method": "pearson",
        "strong_corr_threshold": "0.7",
        "weak_corr_threshold": "0.4",
        "delta_threshold": "0.3",
    }

    data.update(overrides)
    return data


def assert_structured_error(
    response,
    expected_status,
):
    assert response.status_code == expected_status

    payload = response.get_json()

    assert payload["status"] == "error"
    assert "error_code" in payload
    assert payload["error_code"]
    assert "message" in payload
    assert payload["message"]


def test_empty_request_returns_400(client):
    response = client.post(
        "/detect-correlation-alert"
    )

    assert_structured_error(
        response,
        400,
    )


def test_wrong_file_type_returns_400(client):
    response = client.post(
        "/detect-correlation-alert",
        data=valid_request(
            file=(
                io.BytesIO(b"not csv"),
                "input.txt",
            )
        ),
        content_type="multipart/form-data",
    )

    assert_structured_error(
        response,
        400,
    )


def test_empty_csv_returns_400(client):
    response = client.post(
        "/detect-correlation-alert",
        data=valid_request(
            file=(
                io.BytesIO(
                    b"timestamp,sensor_a,sensor_b\n"
                ),
                "empty.csv",
            )
        ),
        content_type="multipart/form-data",
    )

    assert_structured_error(
        response,
        400,
    )


def test_missing_timestamp_returns_400(client):
    response = client.post(
        "/detect-correlation-alert",
        data=valid_request(
            timestamp_col="missing_timestamp",
        ),
        content_type="multipart/form-data",
    )

    assert_structured_error(
        response,
        400,
    )


def test_missing_stream_returns_400(client):
    response = client.post(
        "/detect-correlation-alert",
        data=valid_request(
            selected_streams=(
                "sensor_a,sensor_b,missing_sensor"
            ),
        ),
        content_type="multipart/form-data",
    )

    assert_structured_error(
        response,
        400,
    )


def test_single_stream_returns_400(client):
    response = client.post(
        "/detect-correlation-alert",
        data=valid_request(
            selected_streams="sensor_a",
        ),
        content_type="multipart/form-data",
    )

    assert_structured_error(
        response,
        400,
    )


def test_invalid_method_returns_400(client):
    response = client.post(
        "/detect-correlation-alert",
        data=valid_request(
            method="banana",
        ),
        content_type="multipart/form-data",
    )

    assert_structured_error(
        response,
        400,
    )

    assert (
        response.get_json()["error_code"]
        == "INVALID_METHOD"
    )


@pytest.mark.parametrize(
    "field,value",
    [
        ("window_size", "0"),
        ("step_size", "-1"),
        ("strong_corr_threshold", "2"),
        ("weak_corr_threshold", "-2"),
        ("delta_threshold", "-0.1"),
        ("delta_threshold", "2.1"),
    ],
)
def test_invalid_configuration_returns_400(
    client,
    field,
    value,
):
    response = client.post(
        "/detect-correlation-alert",
        data=valid_request(
            **{field: value}
        ),
        content_type="multipart/form-data",
    )

    assert_structured_error(
        response,
        400,
    )


def test_insufficient_rows_returns_422(client):
    response = client.post(
        "/detect-correlation-alert",
        data=valid_request(
            file=(
                make_csv(rows=10),
                "small.csv",
            ),
            window_size="20",
        ),
        content_type="multipart/form-data",
    )

    assert_structured_error(
        response,
        422,
    )

    assert (
        response.get_json()["error_code"]
        == "INSUFFICIENT_DATA"
    )


def test_only_one_window_returns_422(client):
    response = client.post(
        "/detect-correlation-alert",
        data=valid_request(
            file=(
                make_csv(rows=20),
                "one_window.csv",
            ),
            window_size="20",
            step_size="10",
        ),
        content_type="multipart/form-data",
    )

    assert_structured_error(
        response,
        422,
    )


def test_valid_request_returns_200(client):
    response = client.post(
        "/detect-correlation-alert",
        data=valid_request(),
        content_type="multipart/form-data",
    )

    assert response.status_code == 200

    payload = response.get_json()

    assert payload["status"] == "success"
    assert "alerts" in payload
    assert "summary" in payload


def test_no_alerts_is_success_not_error(client):
    response = client.post(
        "/detect-correlation-alert",
        data=valid_request(
            delta_threshold="2",
        ),
        content_type="multipart/form-data",
    )

    assert response.status_code == 200

    payload = response.get_json()

    assert payload["status"] == "success"
    assert isinstance(
        payload["alerts"],
        list,
    )


def test_oversized_upload_returns_error(client):
    oversized_content = (
        b"a" * (5 * 1024 * 1024 + 1024)
    )

    response = client.post(
        "/detect-correlation-alert",
        data={
            "file": (
                io.BytesIO(oversized_content),
                "large.csv",
            ),
            "timestamp_col": "timestamp",
            "selected_streams": (
                "sensor_a,sensor_b"
            ),
        },
        content_type="multipart/form-data",
    )

    assert response.status_code == 400

    payload = response.get_json()

    assert payload["status"] == "error"
    assert payload["error_code"] == "FILE_TOO_LARGE"
