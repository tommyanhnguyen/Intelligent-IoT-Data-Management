import os
from pathlib import Path

import pandas as pd
from flask import Flask, jsonify, request
from flask_cors import CORS
from werkzeug.exceptions import RequestEntityTooLarge

from main import detect_correlation_change_alert as run_correlation_pipeline
from main import to_iso8601, with_iso_timestamps
from preprocessing import InputValidationError


app = Flask(__name__)
CORS(app)


# ---------------------------------------------------------------------
# API configuration
# ---------------------------------------------------------------------

DEFAULT_WINDOW_SIZE = 20
DEFAULT_STEP_SIZE = 10
DEFAULT_METHOD = "pearson"

DEFAULT_STRONG_CORR_THRESHOLD = 0.7
DEFAULT_WEAK_CORR_THRESHOLD = 0.4
DEFAULT_DELTA_THRESHOLD = 0.3

ALLOWED_METHODS = {"pearson", "spearman"}

MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024
ALLOWED_FILE_EXTENSIONS = {".csv"}

app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_SIZE_BYTES


# ---------------------------------------------------------------------
# Structured API error codes
# ---------------------------------------------------------------------

ERROR_INVALID_REQUEST = "INVALID_REQUEST"
ERROR_INVALID_FILE_TYPE = "INVALID_FILE_TYPE"
ERROR_INVALID_CSV = "INVALID_CSV"
ERROR_FILE_TOO_LARGE = "FILE_TOO_LARGE"
ERROR_MISSING_TIMESTAMP = "MISSING_TIMESTAMP_COLUMN"
ERROR_INVALID_STREAMS = "INVALID_STREAMS"
ERROR_INVALID_METHOD = "INVALID_METHOD"
ERROR_INVALID_CONFIGURATION = "INVALID_CONFIGURATION"
ERROR_INSUFFICIENT_DATA = "INSUFFICIENT_DATA"
ERROR_INTERNAL = "INTERNAL_ERROR"


def error_response(
    error_code,
    message,
    http_status,
    error_type="invalid_input",
):
    """
    Build a predictable structured API error response.
    """
    return jsonify({
        "status": "error",
        "error_type": error_type,
        "error_code": error_code,
        "message": message,
    }), http_status


# ---------------------------------------------------------------------
# Configuration parsing and validation
# ---------------------------------------------------------------------

def parse_positive_int(value, name):
    """
    Convert a request value to a positive integer.

    Raises:
        InputValidationError:
            If the value cannot be converted to an integer
            or is less than or equal to zero.
    """
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        raise InputValidationError(
            f"'{name}' must be a positive integer."
        )

    if parsed <= 0:
        raise InputValidationError(
            f"'{name}' must be a positive integer."
        )

    return parsed


def parse_correlation_threshold(value, name):
    """
    Convert a correlation threshold to float and validate
    that it is inside [-1, 1].
    """
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        raise InputValidationError(
            f"'{name}' must be a number between -1 and 1."
        )

    if parsed < -1 or parsed > 1:
        raise InputValidationError(
            f"'{name}' must be between -1 and 1."
        )

    return parsed


def parse_delta_threshold(value):
    """
    Convert delta_threshold to float and validate the
    absolute correlation-difference range [0, 2].
    """
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        raise InputValidationError(
            "'delta_threshold' must be a number "
            "between 0 and 2."
        )

    if parsed < 0 or parsed > 2:
        raise InputValidationError(
            "'delta_threshold' must be between 0 and 2."
        )

    return parsed


def validate_method(method):
    """
    Validate the requested correlation method.
    """
    if not isinstance(method, str):
        raise InputValidationError(
            "'method' must be either 'pearson' or 'spearman'."
        )

    parsed = method.strip().lower()

    if parsed not in ALLOWED_METHODS:
        raise InputValidationError(
            "'method' must be either 'pearson' or 'spearman'."
        )

    return parsed


def validate_configuration(
    window_size,
    step_size,
    strong_corr_threshold,
    weak_corr_threshold,
    delta_threshold,
):
    """
    Validate configurable correlation alert parameters.

    Rules:
        - window_size must be a positive integer
        - step_size must be a positive integer
        - strong/weak correlation thresholds must be [-1, 1]
        - delta_threshold must be [0, 2]
        - weak_corr_threshold must be less than
          strong_corr_threshold
    """
    window_size = parse_positive_int(
        window_size,
        "window_size",
    )

    step_size = parse_positive_int(
        step_size,
        "step_size",
    )

    strong_corr_threshold = parse_correlation_threshold(
        strong_corr_threshold,
        "strong_corr_threshold",
    )

    weak_corr_threshold = parse_correlation_threshold(
        weak_corr_threshold,
        "weak_corr_threshold",
    )

    delta_threshold = parse_delta_threshold(
        delta_threshold,
    )

    if weak_corr_threshold >= strong_corr_threshold:
        raise InputValidationError(
            "'weak_corr_threshold' must be less than "
            "'strong_corr_threshold'."
        )

    return (
        window_size,
        step_size,
        strong_corr_threshold,
        weak_corr_threshold,
        delta_threshold,
    )


# ---------------------------------------------------------------------
# File and dataset validation
# ---------------------------------------------------------------------

def validate_uploaded_file(uploaded_file):
    """
    Validate an uploaded CSV before parsing.
    """
    if uploaded_file is None:
        raise InputValidationError(
            "A CSV file must be provided."
        )

    filename = (uploaded_file.filename or "").strip()

    if not filename:
        raise InputValidationError(
            "Uploaded file must have a filename."
        )

    extension = Path(filename).suffix.lower()

    if extension not in ALLOWED_FILE_EXTENSIONS:
        raise InputValidationError(
            "Only .csv files are supported."
        )


def validate_dataset_columns(
    df,
    timestamp_col,
    selected_streams,
):
    """
    Validate the timestamp column and selected streams
    before running the correlation pipeline.
    """
    if df is None or df.empty:
        raise InputValidationError(
            "The dataset contains no data rows."
        )

    if not timestamp_col:
        raise InputValidationError(
            "'timestamp_col' is required."
        )

    if timestamp_col not in df.columns:
        raise InputValidationError(
            f"Timestamp column '{timestamp_col}' "
            "was not found in the dataset."
        )

    if not selected_streams:
        raise InputValidationError(
            "'selected_streams' is required."
        )

    if isinstance(selected_streams, str):
        selected_streams = [
            stream.strip()
            for stream in selected_streams.split(",")
            if stream.strip()
        ]

    if not isinstance(selected_streams, list):
        raise InputValidationError(
            "'selected_streams' must contain "
            "column names."
        )

    if len(selected_streams) < 2:
        raise InputValidationError(
            "At least two selected streams are "
            "required for correlation analysis."
        )

    missing_streams = [
        stream
        for stream in selected_streams
        if stream not in df.columns
    ]

    if missing_streams:
        raise InputValidationError(
            "Unknown selected stream(s): "
            + ", ".join(missing_streams)
        )

    return selected_streams


def validate_analysis_possible(
    df,
    window_size,
    step_size,
):
    """
    Perform an API-level preflight check that the supplied
    dataset can produce at least two rolling windows.

    This does not replace deeper pipeline validation.
    """
    row_count = len(df)

    if row_count < window_size:
        return (
            False,
            (
                f"Dataset contains {row_count} rows, "
                f"which is fewer than window_size="
                f"{window_size}."
            ),
        )

    window_count = (
        1
        + ((row_count - window_size) // step_size)
    )

    if window_count < 2:
        return (
            False,
            (
                "At least two rolling windows are "
                "required to compare correlation changes."
            ),
        )

    return True, None


def classify_input_error(message):
    """
    Map validation exceptions to stable API error codes.
    """
    lowered = message.lower()

    if "method" in lowered:
        return ERROR_INVALID_METHOD

    if "timestamp" in lowered:
        return ERROR_MISSING_TIMESTAMP

    if "stream" in lowered:
        return ERROR_INVALID_STREAMS

    if (
        "csv" in lowered
        or "file" in lowered
    ):
        return ERROR_INVALID_CSV

    return ERROR_INVALID_CONFIGURATION


# ---------------------------------------------------------------------
# Flask error handlers
# ---------------------------------------------------------------------

@app.errorhandler(RequestEntityTooLarge)
def handle_request_too_large(_error):
    return error_response(
        ERROR_FILE_TOO_LARGE,
        "Uploaded request exceeds the maximum "
        "allowed size of 5 MB.",
        400,
    )


# ---------------------------------------------------------------------
# Service status endpoint
# ---------------------------------------------------------------------

@app.route("/service-status", methods=["GET"])
def service_status():
    return jsonify({
        "status": "running",
        "message": "Correlation Alert Service is running.",
        "service": "correlation-alert-api",
    })


# ---------------------------------------------------------------------
# Correlation alert endpoint
# ---------------------------------------------------------------------

@app.route("/detect-correlation-alert", methods=["POST"])
def detect_correlation_alert_api():
    try:
        # -------------------------------------------------------------
        # Multipart CSV request
        # -------------------------------------------------------------

        if "file" in request.files:
            uploaded_file = request.files["file"]

            try:
                validate_uploaded_file(uploaded_file)
            except InputValidationError as exc:
                message = str(exc)

                if "Only .csv" in message:
                    return error_response(
                        ERROR_INVALID_FILE_TYPE,
                        message,
                        400,
                    )

                return error_response(
                    ERROR_INVALID_CSV,
                    message,
                    400,
                )

            try:
                df = pd.read_csv(uploaded_file)
            except (
                pd.errors.ParserError,
                pd.errors.EmptyDataError,
                UnicodeDecodeError,
                ValueError,
            ):
                return error_response(
                    ERROR_INVALID_CSV,
                    (
                        "The uploaded file could not be "
                        "parsed as a valid CSV."
                    ),
                    400,
                )

            if df.empty:
                return error_response(
                    ERROR_INVALID_CSV,
                    (
                        "The uploaded CSV contains "
                        "no data rows."
                    ),
                    400,
                )

            df.columns = df.columns.str.strip()

            timestamp_col = request.form.get(
                "timestamp_col"
            )

            selected_streams = request.form.get(
                "selected_streams"
            )

            window_size = request.form.get(
                "window_size",
                DEFAULT_WINDOW_SIZE,
            )

            step_size = request.form.get(
                "step_size",
                DEFAULT_STEP_SIZE,
            )

            method = request.form.get(
                "method",
                DEFAULT_METHOD,
            )

            strong_corr_threshold = request.form.get(
                "strong_corr_threshold",
                DEFAULT_STRONG_CORR_THRESHOLD,
            )

            weak_corr_threshold = request.form.get(
                "weak_corr_threshold",
                DEFAULT_WEAK_CORR_THRESHOLD,
            )

            delta_threshold = request.form.get(
                "delta_threshold",
                DEFAULT_DELTA_THRESHOLD,
            )

        # -------------------------------------------------------------
        # JSON request
        # -------------------------------------------------------------

        else:
            body = request.get_json(silent=True)

            if body is None:
                return error_response(
                    ERROR_INVALID_REQUEST,
                    (
                        "Request must contain either "
                        "a CSV file or a valid JSON body."
                    ),
                    400,
                )

            if not isinstance(body, dict):
                return error_response(
                    ERROR_INVALID_REQUEST,
                    (
                        "JSON request body must be "
                        "an object."
                    ),
                    400,
                )

            data = body.get("data")

            if data is None:
                return error_response(
                    ERROR_INVALID_REQUEST,
                    "Missing 'data' in request body.",
                    400,
                )

            try:
                df = pd.DataFrame(data)
            except (TypeError, ValueError):
                return error_response(
                    ERROR_INVALID_REQUEST,
                    (
                        "'data' could not be converted "
                        "to a table."
                    ),
                    400,
                )

            if df.empty:
                return error_response(
                    ERROR_INVALID_REQUEST,
                    "'data' contains no rows.",
                    400,
                )

            df.columns = df.columns.str.strip()

            timestamp_col = body.get(
                "timestamp_col"
            )

            selected_streams = body.get(
                "selected_streams"
            )

            window_size = body.get(
                "window_size",
                DEFAULT_WINDOW_SIZE,
            )

            step_size = body.get(
                "step_size",
                DEFAULT_STEP_SIZE,
            )

            method = body.get(
                "method",
                DEFAULT_METHOD,
            )

            strong_corr_threshold = body.get(
                "strong_corr_threshold",
                DEFAULT_STRONG_CORR_THRESHOLD,
            )

            weak_corr_threshold = body.get(
                "weak_corr_threshold",
                DEFAULT_WEAK_CORR_THRESHOLD,
            )

            delta_threshold = body.get(
                "delta_threshold",
                DEFAULT_DELTA_THRESHOLD,
            )

        # -------------------------------------------------------------
        # Validate caller-controlled parameters
        # -------------------------------------------------------------

        selected_streams = validate_dataset_columns(
            df,
            timestamp_col,
            selected_streams,
        )

        method = validate_method(method)

        (
            window_size,
            step_size,
            strong_corr_threshold,
            weak_corr_threshold,
            delta_threshold,
        ) = validate_configuration(
            window_size,
            step_size,
            strong_corr_threshold,
            weak_corr_threshold,
            delta_threshold,
        )

        # -------------------------------------------------------------
        # Determine whether valid input can produce correlations
        # -------------------------------------------------------------

        analysis_possible, reason = (
            validate_analysis_possible(
                df,
                window_size,
                step_size,
            )
        )

        if not analysis_possible:
            return error_response(
                ERROR_INSUFFICIENT_DATA,
                reason,
                422,
                error_type="unprocessable_input",
            )

        # -------------------------------------------------------------
        # Run correlation pipeline
        # -------------------------------------------------------------

        results = run_correlation_pipeline(
            df=df,
            timestamp_col=timestamp_col,
            selected_streams=selected_streams,
            window_size=window_size,
            step_size=step_size,
            method=method,
            strong_corr_threshold=strong_corr_threshold,
            weak_corr_threshold=weak_corr_threshold,
            delta_threshold=delta_threshold,
        )

        # -------------------------------------------------------------
        # Build API response
        # -------------------------------------------------------------

        if not isinstance(results, dict):
            raise RuntimeError(
                "Correlation pipeline returned an unexpected "
                "response type."
            )

        raw_alerts = results.get("alerts", [])

        if raw_alerts is None:
            raw_alerts = []

        if not isinstance(raw_alerts, list):
            raise RuntimeError(
                "Correlation pipeline returned an invalid "
                "'alerts' value."
            )

        alert_payloads = with_iso_timestamps(
            raw_alerts
        )

        pipeline_summary = results.get(
            "summary",
            {},
        )

        if not isinstance(pipeline_summary, dict):
            pipeline_summary = {}

        # Preserve the pipeline summary while ensuring the
        # alert count always matches the returned alert list.
        summary = dict(pipeline_summary)
        summary["alerts"] = len(alert_payloads)

        return jsonify({
            "status": "success",
            "message": (
                "Correlation analysis completed "
                "successfully."
            ),
            "configuration": {
                "window_size": window_size,
                "step_size": step_size,
                "method": method,
                "strong_corr_threshold": (
                    strong_corr_threshold
                ),
                "weak_corr_threshold": (
                    weak_corr_threshold
                ),
                "delta_threshold": (
                    delta_threshold
                ),
            },
            "summary": summary,
            "alerts": alert_payloads,
        }), 200

    # -----------------------------------------------------------------
    # Expected caller-input validation failures
    # -----------------------------------------------------------------

    except RequestEntityTooLarge:
        raise

    except InputValidationError as exc:
        message = str(exc)

        return error_response(
            classify_input_error(message),
            message,
            400,
        )

    # -----------------------------------------------------------------
    # Unexpected server failures
    # -----------------------------------------------------------------

    except Exception:
        app.logger.exception(
            "Unexpected correlation API failure"
        )

        return error_response(
            ERROR_INTERNAL,
            (
                "An unexpected internal server "
                "error occurred."
            ),
            500,
            error_type="internal_error",
        )


# ---------------------------------------------------------------------
# Development server
# ---------------------------------------------------------------------

if __name__ == "__main__":
    development_mode = (
        os.getenv("FLASK_ENV", "").lower()
        == "development"
    )

    app.run(
        host="127.0.0.1",
        port=5001,
        debug=development_mode,
    )
