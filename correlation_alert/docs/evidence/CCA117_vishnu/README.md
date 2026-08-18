# CCA117 — API Validation and Predictable Error Handling

## Objective

Harden the correlation API for Backend integration by validating input before pipeline execution and returning predictable HTTP responses instead of generic HTTP 500 errors.

## Implemented

- Added CSV and JSON request validation.
- Restricted uploads to CSV files.
- Added a 5 MB upload/request-size limit.
- Added timestamp-column validation.
- Added selected-stream validation.
- Added method, threshold, window and step validation.
- Added structured machine-readable error codes.
- Invalid caller input returns HTTP 400.
- Valid but analytically insufficient input returns HTTP 422.
- Successful analysis with no alerts returns HTTP 200 with an empty alerts array.
- Flask debug mode is disabled by default outside explicit development mode.
- Added endpoint regression tests.

## Automated Test Result

CCA117 API validation suite: 18 tests passed.

See `pytest_cca117.txt` for the complete automated test output.
