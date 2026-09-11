import argparse
import csv
import json
from collections import Counter, defaultdict
from pathlib import Path


LEVEL_SCORE = {
    "LOW": 1,
    "MEDIUM": 2,
    "HIGH": 3,
}


def find_alerts(obj):
    if isinstance(obj, dict):
        if isinstance(obj.get("alerts"), list):
            return obj["alerts"]

        for value in obj.values():
            found = find_alerts(value)
            if found is not None:
                return found

    elif isinstance(obj, list):
        for value in obj:
            found = find_alerts(value)
            if found is not None:
                return found

    return None


def number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def pair_name(alert):
    s1 = str(alert.get("stream_1", "unknown"))
    s2 = str(alert.get("stream_2", "unknown"))

    return " <-> ".join(sorted([s1, s2]))


def is_reversal(alert):
    previous = number(alert.get("previous_corr"))
    current = number(alert.get("current_corr"))

    if previous is None or current is None:
        return False

    return previous * current < 0


def plain_message(alert):
    s1 = alert.get("stream_1", "Sensor 1")
    s2 = alert.get("stream_2", "Sensor 2")

    previous = number(alert.get("previous_corr"))
    current = number(alert.get("current_corr"))

    if previous is None or current is None:
        return f"The relationship between {s1} and {s2} changed during this period."

    if previous * current < 0:
        if previous > 0:
            return (
                f"The relationship between {s1} and {s2} reversed during this period: "
                f"it changed from tending to move together to tending to move in "
                f"opposite directions."
            )

        return (
            f"The relationship between {s1} and {s2} reversed during this period: "
            f"it changed from tending to move in opposite directions to tending "
            f"to move together."
        )

    previous_strength = abs(previous)
    current_strength = abs(current)

    if current_strength > previous_strength:
        return (
            f"The relationship between {s1} and {s2} became stronger "
            f"during this period."
        )

    if current_strength < previous_strength:
        return (
            f"The relationship between {s1} and {s2} became weaker "
            f"during this period."
        )

    return (
        f"The relationship between {s1} and {s2} remained similar "
        f"during this period."
    )


def build_episodes(alerts):
    by_pair = defaultdict(list)

    for alert in alerts:
        by_pair[pair_name(alert)].append(alert)

    episodes = []

    for pair, items in by_pair.items():
        items.sort(
            key=lambda x: (
                x.get("window_index")
                if isinstance(x.get("window_index"), int)
                else 10**9
            )
        )

        current_episode = []

        for alert in items:
            if not current_episode:
                current_episode = [alert]
                continue

            previous_index = current_episode[-1].get("window_index")
            current_index = alert.get("window_index")

            if (
                isinstance(previous_index, int)
                and isinstance(current_index, int)
                and current_index == previous_index + 1
            ):
                current_episode.append(alert)
            else:
                episodes.append((pair, current_episode))
                current_episode = [alert]

        if current_episode:
            episodes.append((pair, current_episode))

    result = []

    for pair, items in episodes:
        deltas = [
            abs(number(a.get("delta")))
            for a in items
            if number(a.get("delta")) is not None
        ]

        levels = [
            str(a.get("alert_level", "")).upper()
            for a in items
        ]

        highest_level = max(
            levels,
            key=lambda x: LEVEL_SCORE.get(x, 0),
            default="",
        )

        result.append({
            "pair": pair,
            "alert_count": len(items),
            "first_window": items[0].get("window_index"),
            "last_window": items[-1].get("window_index"),
            "start_time": items[0].get("start_time"),
            "end_time": items[-1].get("end_time"),
            "highest_current_severity": highest_level,
            "max_abs_delta": max(deltas) if deltas else None,
            "contains_reversal": any(is_reversal(a) for a in items),
        })

    return result


parser = argparse.ArgumentParser()

parser.add_argument(
    "json_files",
    nargs="+",
)

parser.add_argument(
    "--out",
    default="correlation_alert/docs/evidence/Correlation_Usability_Vishnu/analysis",
)

args = parser.parse_args()

out = Path(args.out)
out.mkdir(parents=True, exist_ok=True)

run_rows = []
top_rows = []
pair_rows = []
episode_rows = []
conflict_rows = []

for filename in args.json_files:
    path = Path(filename)

    data = json.loads(path.read_text())

    alerts = find_alerts(data)

    if alerts is None:
        print(f"No alert list found in {path}")
        continue

    levels = Counter(
        str(a.get("alert_level", "UNKNOWN")).upper()
        for a in alerts
    )

    pairs = Counter(pair_name(a) for a in alerts)

    reversals = sum(is_reversal(a) for a in alerts)

    deltas = [
        abs(number(a.get("delta")))
        for a in alerts
        if number(a.get("delta")) is not None
    ]

    episodes = build_episodes(alerts)

    run_rows.append({
        "run": path.stem,
        "alerts": len(alerts),
        "low": levels.get("LOW", 0),
        "medium": levels.get("MEDIUM", 0),
        "high": levels.get("HIGH", 0),
        "unique_pairs": len(pairs),
        "reversals": reversals,
        "reversal_percent": (
            round(reversals / len(alerts) * 100, 2)
            if alerts else 0
        ),
        "episodes_after_grouping": len(episodes),
        "max_abs_delta": max(deltas) if deltas else None,
    })

    ordered = sorted(
        alerts,
        key=lambda a: abs(number(a.get("delta")) or 0),
        reverse=True,
    )

    for rank, alert in enumerate(ordered[:5], start=1):
        top_rows.append({
            "run": path.stem,
            "rank_by_delta": rank,
            "pair": pair_name(alert),
            "window_index": alert.get("window_index"),
            "start_time": alert.get("start_time"),
            "end_time": alert.get("end_time"),
            "previous_corr": alert.get("previous_corr"),
            "current_corr": alert.get("current_corr"),
            "delta": alert.get("delta"),
            "current_severity": alert.get("alert_level"),
            "reversal": is_reversal(alert),
            "current_reason": alert.get("reason"),
            "candidate_plain_message": plain_message(alert),
        })

    for pair, count in pairs.most_common():
        pair_rows.append({
            "run": path.stem,
            "pair": pair,
            "alert_count": count,
        })

    for episode in episodes:
        episode_rows.append({
            "run": path.stem,
            **episode,
        })

    # Investigate disagreement between current severity and delta magnitude.
    for low_alert in alerts:
        low_level = LEVEL_SCORE.get(
            str(low_alert.get("alert_level", "")).upper(),
            0,
        )

        low_delta = abs(number(low_alert.get("delta")) or 0)

        for high_alert in alerts:
            high_level = LEVEL_SCORE.get(
                str(high_alert.get("alert_level", "")).upper(),
                0,
            )

            high_delta = abs(number(high_alert.get("delta")) or 0)

            if (
                low_level > 0
                and high_level > low_level
                and low_delta > high_delta
            ):
                conflict_rows.append({
                    "run": path.stem,
                    "lower_severity_pair": pair_name(low_alert),
                    "lower_severity": low_alert.get("alert_level"),
                    "lower_severity_delta": low_alert.get("delta"),
                    "higher_severity_pair": pair_name(high_alert),
                    "higher_severity": high_alert.get("alert_level"),
                    "higher_severity_delta": high_alert.get("delta"),
                })


def write_csv(filename, rows):
    path = out / filename

    if not rows:
        path.write_text("")
        return

    with path.open("w", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=rows[0].keys(),
        )

        writer.writeheader()
        writer.writerows(rows)


write_csv("run_summary.csv", run_rows)
write_csv("top_changes_by_delta.csv", top_rows)
write_csv("alerts_by_pair.csv", pair_rows)
write_csv("episodes.csv", episode_rows)
write_csv("severity_magnitude_conflicts.csv", conflict_rows)

print("\nInvestigation summary\n")

for row in run_rows:
    print(
        f"{row['run']}: "
        f"{row['alerts']} alerts | "
        f"{row['unique_pairs']} pairs | "
        f"{row['reversals']} reversals | "
        f"{row['episodes_after_grouping']} grouped episodes"
    )

print("\nCreated:")
print(out / "run_summary.csv")
print(out / "top_changes_by_delta.csv")
print(out / "alerts_by_pair.csv")
print(out / "episodes.csv")
print(out / "severity_magnitude_conflicts.csv")
