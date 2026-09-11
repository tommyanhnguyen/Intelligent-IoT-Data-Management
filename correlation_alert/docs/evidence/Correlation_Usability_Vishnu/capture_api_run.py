import argparse
import io
import json
import sys
from pathlib import Path

# Repository root:
# repo/correlation_alert/docs/evidence/Correlation_Usability_Vishnu/script.py
REPO_ROOT = Path(__file__).resolve().parents[4]

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from correlation_alert.server import app


parser = argparse.ArgumentParser(
    description="Capture one Correlation API CSV analysis response."
)

parser.add_argument("csv")

parser.add_argument(
    "--endpoint",
    default="/detect-correlation-alert",
)

parser.add_argument(
    "--timestamp-col",
    required=True,
)

parser.add_argument(
    "--streams",
    required=True,
    help="Comma-separated stream names",
)

parser.add_argument(
    "--window",
    type=int,
    default=20,
)

parser.add_argument(
    "--step",
    type=int,
    default=10,
)

parser.add_argument(
    "--method",
    default="pearson",
)

parser.add_argument(
    "--output",
    required=True,
)

args = parser.parse_args()

csv_path = Path(args.csv)

if not csv_path.exists():
    raise SystemExit(f"File not found: {csv_path}")

data = {
    "file": (
        io.BytesIO(csv_path.read_bytes()),
        csv_path.name,
    ),
    "timestamp_col": args.timestamp_col,
    "selected_streams": args.streams,
    "window_size": str(args.window),
    "step_size": str(args.step),
    "method": args.method,
}

with app.test_client() as client:
    response = client.post(
        args.endpoint,
        data=data,
        content_type="multipart/form-data",
    )

print("Endpoint:", args.endpoint)
print("Dataset:", csv_path)
print("Timestamp column:", args.timestamp_col)
print("Streams:", args.streams)
print("Window:", args.window)
print("Step:", args.step)
print("Method:", args.method)
print("HTTP status:", response.status_code)

try:
    result = response.get_json()
except Exception:
    result = None

output_path = Path(args.output)
output_path.parent.mkdir(parents=True, exist_ok=True)

if result is not None:
    output_path.write_text(
        json.dumps(result, indent=2, default=str)
    )
else:
    output_path.write_text(
        response.get_data(as_text=True)
    )

print("Saved:", output_path)

if response.status_code != 200:
    print("\nResponse:")

    if result is not None:
        print(json.dumps(result, indent=2))
    else:
        print(response.get_data(as_text=True))
