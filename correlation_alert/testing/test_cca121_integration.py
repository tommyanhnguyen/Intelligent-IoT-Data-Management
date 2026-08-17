import io
import logging
import os
from pathlib import Path
import re
import subprocess
import sys

import pandas as pd
import pytest


TESTING_DIR = Path(__file__).resolve().parent
CORRELATION_DIR = TESTING_DIR.parent

if str(CORRELATION_DIR) not in sys.path:
    sys.path.insert(0, str(CORRELATION_DIR))

import server


@pytest.fixture
def client():
    server.app.config["TESTING"] = True
    with server.app.test_client() as test_client:
        yield test_client


@pytest.fixture
def service_logs():
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(logging.Formatter("%(message)s"))
    service_logger = logging.getLogger("correlation")
    service_logger.addHandler(handler)

    try:
        yield stream
    finally:
        service_logger.removeHandler(handler)


def make_csv():
    rows = 80
    dataframe = pd.DataFrame({
        "timestamp": pd.date_range(
            "2026-01-01",
            periods=rows,
            freq="min",
        ),
        "sensor_a": range(rows),
        "sensor_b": [value * 2 for value in range(rows)],
        "sensor_c": [100 - value for value in range(rows)],
    })
    return io.BytesIO(dataframe.to_csv(index=False).encode("utf-8"))


def multipart_request(**overrides):
    data = {
        "file": (make_csv(), "test.csv"),
        "timestamp_col": "timestamp",
        "selected_streams": "sensor_a,sensor_b,sensor_c",
        "window_size": "20",
        "step_size": "10",
        "method": "pearson",
    }
    data.update(overrides)
    return data


def test_observability_preserves_configurable_api(client, service_logs):
    response = client.post(
        "/detect-correlation-alert",
        data=multipart_request(
            strong_corr_threshold="0.8",
            weak_corr_threshold="0.3",
            delta_threshold="0.5",
        ),
        content_type="multipart/form-data",
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["configuration"] == {
        "window_size": 20,
        "step_size": 10,
        "method": "pearson",
        "strong_corr_threshold": 0.8,
        "weak_corr_threshold": 0.3,
        "delta_threshold": 0.5,
    }
    assert len(payload["request_id"]) == 8

    logs = service_logs.getvalue()
    assert f"[{payload['request_id']}] received" in logs
    assert "rows_in=80" in logs
    assert "streams=['sensor_a', 'sensor_b', 'sensor_c']" in logs
    assert f"[{payload['request_id']}] completed" in logs
    assert re.search(r"alerts=\d+", logs)
    assert "runtime_ms=" in logs


def test_invalid_method_keeps_request_id(client, service_logs):
    response = client.post(
        "/detect-correlation-alert",
        data=multipart_request(method="banana"),
        content_type="multipart/form-data",
    )

    assert response.status_code == 400
    payload = response.get_json()
    assert payload["error_type"] == "invalid_input"
    assert len(payload["request_id"]) == 8
    assert f"[{payload['request_id']}] invalid_input" in service_logs.getvalue()


def test_health_reports_ready(client):
    response = client.get("/service-status")

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["live"] is True
    assert payload["ready"] is True
    assert payload["checks"]["pipeline"]["ok"] is True


def test_health_returns_503_when_pipeline_fails(client, monkeypatch):
    def fail_self_test():
        raise RuntimeError("forced readiness failure")

    monkeypatch.setattr(server, "_run_pipeline_self_test", fail_self_test)
    response = client.get("/service-status")

    assert response.status_code == 503
    payload = response.get_json()
    assert payload["live"] is True
    assert payload["ready"] is False
    assert payload["checks"]["pipeline"]["ok"] is False


def test_preprocessing_cli_does_not_log_sensor_values(tmp_path):
    data_dir = tmp_path / "datasets"
    data_dir.mkdir()
    sentinel = "987654.321"
    rows = [
        "time,s1,s2",
        f"0,{sentinel},1",
        f"1,{sentinel},2",
        f"2,{sentinel},3",
        f"3,{sentinel},4",
        f"4,{sentinel},5",
        f"5,{sentinel},6",
    ]
    (data_dir / "complex.csv").write_text(
        "\n".join(rows) + "\n",
        encoding="utf-8",
    )

    environment = os.environ.copy()
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    result = subprocess.run(
        [sys.executable, str(CORRELATION_DIR / "preprocessing.py")],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        env=environment,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert sentinel not in result.stdout
