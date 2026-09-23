# Sensor Trend Prediction Prototype - Evaluation Results

## Status

This feature is an evaluated prototype intended for future improvement.

It was not merged into the current MVP because it was completed during
the final handover period of the trimester. The implementation is retained
on the `vishnu/prototype/sensor-trend-insights` branch for future teams.

## Automated Testing

The prototype automated test suite completed successfully:

- 7 tests executed
- 7 tests passed

The tests cover:

- increasing sensor behaviour
- decreasing sensor behaviour
- stable sensor behaviour
- exact linear prediction
- data cleaning
- trend classification
- chronological evaluation

## Traffic Dataset

Primary evaluation used a 20-observation lookback.

| Sensor | Model MAE | Persistence MAE | Direction Accuracy | MAE Improvement | Beats Baseline |
|---|---:|---:|---:|---:|---|
| occupancy_t4013 | 2.8977 | 3.2664 | 66.67% | 11.29% | Yes |
| speed_t4013 | 4.4981 | 3.9967 | 49.33% | -12.55% | No |
| occupancy_6005 | 1.8686 | 2.2751 | 65.33% | 17.87% | Yes |
| speed_6005 | 7.7163 | 8.3567 | 55.00% | 7.66% | Yes |

## AWS Dataset

| Sensor | Model MAE | Persistence MAE | Direction Accuracy | MAE Improvement | Beats Baseline |
|---|---:|---:|---:|---:|---|
| ec2_cpu | 1.3982 | 1.6177 | 64.33% | 13.57% | Yes |
| ec2_net | 12205.6534 | 16099.4267 | 57.00% | 24.19% | Yes |
| elb_req | 47.6488 | 57.0533 | 68.67% | 16.48% | Yes |

## Interpretation

The simple linear-trend predictor outperformed the persistence baseline
for six of the seven evaluated sensor streams.

The Traffic `speed_t4013` stream did not outperform the persistence
baseline. This demonstrates that the approach is not consistently suitable
for every type of sensor behaviour, particularly when recent readings
fluctuate strongly.

The results should therefore be interpreted per sensor rather than as proof
that one forecasting method is universally suitable.

## User-Facing Output

The prototype converts numerical predictions into one of:

- INCREASING
- DECREASING
- STABLE

and generates a plain-language statement such as:

"Based on recent readings, Traffic occupancy 6005 is predicted to decrease
in the next observation."

## Limitations

- prediction is for one observation ahead only
- predictions are estimates, not guarantees
- highly variable or non-linear sensor behaviour can reduce reliability
- the prototype does not predict equipment failure
- it does not establish causality
- no production integration has been completed

## Recommended Future Work

- investigate volatility or prediction-confidence indicators
- test additional forecasting models against the same persistence baseline
- evaluate further IoT datasets
- determine whether prediction insights should be exposed through AIntg,
  Backend or Frontend
- design suitable dashboard presentation
- retain per-sensor model validation before exposing predictions to users
