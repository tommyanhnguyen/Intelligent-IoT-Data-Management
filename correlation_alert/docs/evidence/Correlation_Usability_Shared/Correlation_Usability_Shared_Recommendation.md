# Correlation MVP Usability Investigation and Shared Recommendation

## Team Members

- Vishnu Vardhan Reddy Pulluru
- Guna Varshith Kanagala

## 1. Purpose

The current Correlation component successfully detects changes in relationships between sensor streams using rolling-window correlation analysis.

However, stakeholder feedback identified a usability issue: although the current output is technically useful, correlation coefficients, deltas, rolling windows, thresholds and large numbers of individual alerts are difficult for non-technical users to interpret.

The investigation therefore addressed the following question:

> How can we use the correlation information we already produce to give users something simple, meaningful and actionable?

The goal is not to replace the existing Correlation algorithm or redesign the Frontend. The goal is to improve the meaning and usefulness of the existing Correlation results for the final MVP.

---

## 2. Current Correlation Output

A current alert contains:

- window_index
- start_time
- end_time
- stream_1
- stream_2
- previous_corr
- current_corr
- delta
- alert_level
- reason

This information is useful technically, but it requires statistical knowledge.

For example, a current reason may say:

> "Correlation changed by 1.78, classified as HIGH severity."

This tells the user the numerical change but does not immediately explain what happened between the sensors.

---

## 3. Investigation Approach

Both team members investigated the usability problem independently and then compared findings.

### Guna's Investigation

Guna investigated the current output using a detailed complex.csv reference run.

His investigation focused on:

- repeated alerts from the same sensor relationships;
- sign reversals;
- technical reason messages;
- plain-language explanations;
- grouping alerts into episodes;
- important information missing from the current response;
- severity and relationship-strength behaviour.

His main proposal was to group repeated alerts and explain relationship changes in simple language while retaining technical values as secondary detail.

### Vishnu's Investigation

Vishnu expanded the investigation across multiple datasets and rolling-window configurations.

Datasets:

- complex.csv
- NAB Traffic merged dataset
- NAB AWS control merged dataset

Configurations:

- window_size = 20, step_size = 10
- window_size = 60, step_size = 30
- Pearson correlation

The investigation analysed:

- total alert volume;
- LOW, MEDIUM and HIGH alert counts;
- repeated sensor pairs;
- relationship sign reversals;
- candidate grouping into consecutive episodes;
- ranking by correlation change magnitude;
- information that should be primary versus technical detail.

---

## 4. Investigation Results

| Run | Alerts | LOW | MEDIUM | HIGH | Unique Pairs | Reversals | Grouped Episodes |
|---|---:|---:|---:|---:|---:|---:|---:|
| AWS 20/10 | 251 | 184 | 60 | 7 | 3 | 196 (78.09%) | 200 |
| AWS 60/30 | 23 | 18 | 4 | 1 | 3 | 21 (91.30%) | 20 |
| Complex 20/10 | 19 | 3 | 2 | 14 | 3 | 14 (73.68%) | 14 |
| Traffic 20/10 | 282 | 194 | 68 | 20 | 6 | 193 (68.44%) | 212 |
| Traffic 60/30 | 43 | 38 | 4 | 1 | 6 | 26 (60.47%) | 41 |

All investigation API requests returned HTTP 200.

The complete current Correlation test suite also remained successful:

> 74 passed

No production Correlation code was modified during this investigation.

---

## 5. Main Usability Problems

### 5.1 Large Alert Volume

Alert volume changes significantly depending on the rolling-window configuration.

Examples:

- Traffic 20/10 produced 282 alerts.
- Traffic 60/30 produced 43 alerts.
- AWS 20/10 produced 251 alerts.
- AWS 60/30 produced 23 alerts.

A non-technical user should not be expected to manually inspect hundreds of individual correlation alerts.

### 5.2 Repeated Sensor Relationships

The same sensor pairs can generate many alerts.

Examples:

AWS 20/10:

- ec2_net ↔ elb_req: 102 alerts
- ec2_cpu ↔ ec2_net: 78 alerts
- ec2_cpu ↔ elb_req: 71 alerts

Traffic 20/10:

- occupancy_6005 ↔ speed_t4013: 54 alerts
- occupancy_6005 ↔ occupancy_t4013: 51 alerts
- speed_6005 ↔ speed_t4013: 49 alerts

This creates unnecessary repetition when each rolling-window alert is treated as a separate user-facing result.

### 5.3 Grouping Helps but Is Not Enough

Candidate consecutive grouping produced:

| Run | Raw Alerts | Episodes | Reduction |
|---|---:|---:|---:|
| AWS 20/10 | 251 | 200 | 20.3% |
| AWS 60/30 | 23 | 20 | 13.0% |
| Complex 20/10 | 19 | 14 | 26.3% |
| Traffic 20/10 | 282 | 212 | 24.8% |
| Traffic 60/30 | 43 | 41 | 4.7% |

Grouping reduces repetition, but a high-volume run can still contain hundreds of episodes.

Therefore grouping should be combined with prioritisation.

### 5.4 Sign Reversals Are Common

Relationship reversals represented:

- 78.09% of AWS 20/10 alerts
- 91.30% of AWS 60/30 alerts
- 73.68% of Complex 20/10 alerts
- 68.44% of Traffic 20/10 alerts
- 60.47% of Traffic 60/30 alerts

A reversal has an understandable sensor-level meaning: the relationship changed direction.

The current API provides previous_corr and current_corr but does not directly expose this as a simple relationship change type.

### 5.5 Users Need Prioritisation

Ranking by absolute correlation change identified clear high-impact relationship changes.

Examples included:

- AWS: ec2_cpu ↔ ec2_net
- Complex: s1 ↔ s3
- Traffic 20/10: occupancy_6005 ↔ speed_6005
- Traffic 60/30: occupancy_t4013 ↔ speed_t4013

The largest change in each tested run was also a sign reversal.

This suggests that the system can provide more value by identifying important relationship changes instead of treating every alert equally.

### 5.6 Severity Alone Should Not Be the Ranking Method

The current implementation primarily derives severity from correlation delta thresholds. Some relationship-strength transitions can also be promoted to at least MEDIUM.

Therefore severity and change magnitude are related but are not identical concepts.

The investigation found many pairwise ordering cases where an alert with a larger delta had a lower severity than another alert.

These should not be interpreted as hundreds of individual software defects. Instead, they show that severity alone should not be used as the ranking method.

Candidate ranking signals include:

- severity;
- magnitude of correlation change;
- relationship reversal;
- persistence across consecutive windows.

The exact ranking rule should be agreed by the Correlation team before implementation.

### 5.7 Technical Messages Should Be Simplified

Instead of making this the main result:

> "Correlation changed by 1.78, classified as HIGH severity."

A user-facing result could say:

> "The relationship between these sensors reversed during this period. In the previous analysed window they tended to move together, while in the current window they tended to move in opposite directions."

Words such as "normally" or "usually" should only be used if a future Correlation implementation calculates a historical baseline.

---

## 6. Shared Recommendation

The team recommendation is:

> Correlation should convert repeated technical window-level alerts into a smaller number of prioritised relationship-change insights. Each insight should clearly identify the sensor pair, time period, importance and type of relationship change using simple language. Raw coefficients, delta, method and threshold information should remain available as secondary technical details.

Recommended flow:

Raw correlation alerts

→ group related alerts into relationship episodes

→ identify the meaning of the relationship change

→ prioritise important episodes

→ generate simple deterministic summaries

→ retain technical information as secondary details

This improves the usability of the existing Correlation system without replacing Pearson/Spearman correlation.

---

## 7. Recommended Primary Information

The main insight should contain:

- sensor pair;
- start/end time;
- relationship change type;
- importance/rank;
- short plain-language summary.

Technical details should remain available separately:

- previous correlation;
- current correlation;
- delta;
- correlation method;
- thresholds;
- window size;
- step size;
- source window information.

---

## 8. Recommended Information for AIntg / Frontend

A conceptual episode-level response could be:

```json
{
  "episode_id": "correlation-episode-001",
  "stream_1": "temperature",
  "stream_2": "energy",
  "start_time": "2026-09-01T14:00:00Z",
  "end_time": "2026-09-01T14:30:00Z",
  "importance": "HIGH",
  "rank": 1,
  "change_type": "REVERSED",
  "summary": "The relationship between temperature and energy reversed during this period.",
  "episode_alert_count": 3,
  "technical_details": {
    "previous_corr": 0.84,
    "current_corr": -0.71,
    "max_abs_delta": 1.55,
    "method": "pearson"
  }
}
