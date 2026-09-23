# Sensor Trend Prediction and User-Friendly Insight Prototype

## Purpose

This prototype was created in response to stakeholder feedback that IoT
analytics should provide information that is easier for non-technical
users to understand.

The existing project can identify correlations, relationship changes and
anomalous behaviour. This prototype investigates an additional user
question:

"What is this sensor likely to do next?"

## What the prototype provides

For each selected sensor it provides:

- current sensor value
- predicted next value
- INCREASING, DECREASING or STABLE trend
- plain-language user insight
- Mean Absolute Error (MAE)
- Root Mean Squared Error (RMSE)
- direction accuracy
- comparison against a persistence baseline

## Prediction method

A least-squares linear trend is fitted to the most recent observations
and extrapolated one observation forward.

The method was deliberately kept simple and explainable because this is
an MVP/research prototype.

## Baseline

The trend model is compared with a persistence baseline:

next predicted value = current observed value

This prevents the prototype from claiming value simply because it can
produce a forecast.

## Evaluation

The evaluation is chronological.

Earlier readings are used to predict later readings. Future observations
are not randomly mixed into the training history.

Lookbacks of 10, 20 and 30 observations are compared.

The primary demonstration uses a 20-observation lookback.

## Datasets

The prototype is evaluated on:

- Traffic dataset
- AWS dataset

These datasets were already used by the Correlation team for previous
real-data evaluation.

## Architecture

The prototype is isolated under:

data_science/examples/sensor_prediction/

It does not modify:

- the Correlation API
- correlation thresholds
- correlation alert behaviour
- anomaly detection models
- Backend API contracts
- database structure
- Frontend behaviour

This means the existing MVP continues to operate normally while the
prediction idea is evaluated.

## User-facing example

Instead of displaying only a raw sensor value, the prototype can provide
a statement such as:

"Based on recent readings, EC2 CPU usage is predicted to increase in the
next observation."

The wording intentionally says "predicted" rather than suggesting that
the result is certain.

## Limitations

This prototype predicts only the next sensor observation.

It does not:

- predict equipment failure
- prove causality
- guarantee future behaviour
- provide a production-grade confidence probability

Further evaluation and stakeholder review are required before production
integration.

## Running the tests

python -m unittest discover -s data_science/examples/sensor_prediction/tests -v

## Status

MVP / research prototype for stakeholder evaluation.

## Handover Status

The prototype has been implemented and evaluated using the Traffic and AWS
project datasets.

The feature has intentionally not been merged into the main project because
it was completed near the end of the trimester, when the team had already
started final handover activities.

The implementation is being retained on the
`vishnu/prototype/sensor-trend-insights` branch so that a future project team,
or the same contributor in a future trimester, can continue evaluating and
integrating the feature.

Recommended future work includes:

- further evaluation across additional sensor behaviours
- handling highly fluctuating or non-linear sensor patterns
- investigating prediction confidence or volatility indicators
- deciding how prediction insights should be exposed through AIntg/Backend
- considering suitable dashboard presentation
- evaluating whether a more advanced forecasting model provides meaningful
  improvement over the current simple baseline and linear-trend approach

This should be treated as an improvement prototype rather than a completed
production feature.
