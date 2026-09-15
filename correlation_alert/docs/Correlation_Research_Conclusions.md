# Correlation Research Conclusions:

## Recommendation:

Keep Correlation as an independent service and team. It is not duplicate work from the Models team. Correlation gives direct and explainable evidence about relationships between sensors. Models detect broader abnormal patterns through learned behaviour. AIntg should combine both outputs without moving model logic into Correlation.

## Different responsibilities:

1. **Correlation:** Detects whether relationships between user selected sensors have changed from their normal history. Its output should include the baseline correlation, current correlation, change magnitude, affected pairs, event severity and suspected sensors.

2. **Models:** Uses PCA or other anomaly models to decide whether the joint data pattern differs from learned normal behaviour. Its output is mainly an anomaly flag, model score and model specific explanation.

3. **AIntg:** Matches results by sensor group and time window. Agreement between Correlation and Models raises alert confidence. A result from only one service remains useful because each method can detect cases that the other misses.

The two services have different failure modes. If one service is inaccurate or unavailable, it must not corrupt the baseline or state of the other service. Separation does not remove all risk when both results are wrong. AIntg should expose service health, confidence and supporting evidence so uncertain alerts remain auditable.

## Proposed Correlation direction:

1. Use a covariance or correlation matrix to suggest related sensors. Let the user confirm a meaningful sensor group.

2. Calculate one correlation matrix for each rolling window in that group.

3. Compare the current matrix with multiple accepted normal historical windows. Do not rely only on the immediately previous window.

4. Select historical windows from the same time context. For example, compare a 09:00 window with normal 09:00 windows from previous days. Use the same weekday when a weekly pattern matters. Maintain separate profiles for seasons or operating modes when their relationships differ.

5. Update an adaptive baseline slowly with accepted normal windows. Keep a frozen long term baseline to detect cumulative drift. Pause all baseline updates while an anomaly event is active. This prevents a persistent fault from gradually becoming normal.

6. Create one group event for each timestamp or window. Store all affected pairs inside that event instead of creating a separate alert for every pair.

7. Rank suspected sensors by both the number and severity of changed pairs. A sensor found in ten strongly changed pairs should rank above one found in three. This is attribution for investigation, not proof of causation.

## Complementary methods:

PCA should remain a supporting Models experiment. It may detect a joint multivariate anomaly that direct pair comparisons miss. Correlation should remain the explainable baseline because it identifies which relationships changed.

River is a possible later experiment for online statistics, covariance updates and streaming anomaly tools. Automatic learning must pause during suspected anomaly events so persistent faults do not enter the normal profile.

## Evaluation before adoption:

Compare the current Correlation method, enhanced Correlation and PCA on the same time ordered data, windows and sensor groups. Keep normal baseline, validation and test periods separate. Measure event precision, recall, F1, false event rate, detection delay, duplicate reduction, sensor ranking accuracy, runtime and memory.

## References:

1. Jackson, JE & Mudholkar, GS 1979, 'Control procedures for residuals associated with principal component analysis', *Technometrics*, vol. 21, no. 3, pp. 341 to 349, <https://www.stat.cmu.edu/technometrics/70-79/VOL-21-03/v2103341.pdf>.

2. Montiel, J et al. 2021, 'River: machine learning for streaming data in Python', *Journal of Machine Learning Research*, vol. 22, no. 110, pp. 1 to 8, <https://www.jmlr.org/papers/v22/20-1380.html>.

3. NIST/SEMATECH 2003, 'EWMA control charts', *e-Handbook of Statistical Methods*, <https://www.itl.nist.gov/div898/handbook/pmc/section3/pmc324.htm>.

4. Schober, P, Boer, C & Schwarte, LA 2018, 'Correlation coefficients: appropriate use and interpretation', *Anesthesia & Analgesia*, vol. 126, no. 5, pp. 1763 to 1768, <https://doi.org/10.1213/ANE.0000000000002864>.

5. Wied, D & Galeano, P 2013, 'Monitoring correlation change in a sequence of random variables', *Journal of Statistical Planning and Inference*, vol. 143, no. 1, pp. 186 to 196, <https://doi.org/10.1016/j.jspi.2012.06.007>.
