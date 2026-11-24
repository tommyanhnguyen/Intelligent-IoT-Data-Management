import { expect, test } from '@playwright/test';

const series = [-4, 0, null, ' ', '0oops', undefined, 8, 4, '', -8, 2].map((value, index) => ({
  entry_id: index + 1,
  created_at: new Date(Date.UTC(2026, 10, 23, 0, index * 5)).toISOString(),
  field1: value,
  field2: 10,
}));

async function openDashboard(page, rows = series) {
  await page.route('**/api/auth/refresh', (route) => route.fulfill({
    json: { data: { accessToken: 'playwright-test-token' } },
  }));
  await page.route('**/api/datasets/5', (route) => route.fulfill({
    json: {
      mappings: [
        { storageField: 'field1', displayName: 'Temperature' },
        { storageField: 'field2', displayName: 'Pressure' },
      ],
    },
  }));
  await page.route('**/api/datasets/5/series', (route) => route.fulfill({ json: rows }));
  await page.goto('/dashboard/5');
  await page.getByRole('button', { name: 'Temperature', exact: true }).click();
  return page.getByRole('img', { name: 'Sensor timeline' });
}

const temperatureCurve = (chart) => chart.locator('path.recharts-line-curve').first();

async function focusFirstReading(chart) {
  await chart.locator('svg.recharts-surface[tabindex="0"]').focus();
}

test('raw timeline and mini chart leave gaps for missing and invalid readings', async ({ page }) => {
  const chart = await openDashboard(page);
  const miniChart = page.getByRole('button', { name: /focus temperature/i });
  const threeSegments = /^M[^M]+M[^M]+M[^M]+$/;
  await expect(temperatureCurve(chart)).toHaveAttribute('d', threeSegments);
  await expect(temperatureCurve(miniChart)).toHaveAttribute('d', threeSegments);
});

test('stream statistics count only finite readings and retain negatives and zero', async ({ page }) => {
  await openDashboard(page);
  const card = page.locator('.stream-insight-card').filter({ hasText: 'Temperature' });
  await expect(card.getByText('6 records')).toBeVisible();
  await expect(card.getByText('0.33', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'View details' }).click();
  await expect(card.getByText('-8.00', { exact: true })).toBeVisible();
  await expect(card.getByText('8.00', { exact: true })).toBeVisible();
});

test('raw tooltip shows a negative and a genuine zero and omits the next gap', async ({ page }) => {
  const chart = await openDashboard(page);
  await focusFirstReading(chart);
  const tooltip = chart.locator('.sensor-chart-tooltip');
  await expect(tooltip.locator('.sensor-tooltip-row strong')).toHaveText('-4');
  await page.keyboard.press('ArrowRight');
  await expect(tooltip.locator('.sensor-tooltip-row strong')).toHaveText('0');
  await page.keyboard.press('ArrowRight');
  await expect(tooltip).toHaveCount(0);
});

test('normalised timeline retains gaps and shows only available raw tooltip values', async ({ page }) => {
  const chart = await openDashboard(page);
  await page.getByRole('button', { name: 'Pressure', exact: true }).click();
  await expect(page.getByText('Sensor Timeline (normalised view)')).toBeVisible();
  await expect(temperatureCurve(chart)).toHaveAttribute('d', /^M[^M]+M[^M]+M[^M]+$/);
  const pressureCurve = chart.locator('path.recharts-line-curve').nth(1);
  const [axisZeroY, pressureEndY] = await pressureCurve.evaluate((path) => [
    path.getPointAtLength(0).y,
    path.getPointAtLength(path.getTotalLength()).y,
  ]);
  expect(pressureEndY).toBeCloseTo(axisZeroY);
  // The source mean is 1/3, so the distance from -4 to the mean is 4 + 1/3.
  await expect.poll(async () => {
    const path = await temperatureCurve(chart).getAttribute('d');
    const firstSegment = path.split('M')[1].match(/-?[\d.]+/g).map(Number);
    const negativeY = firstSegment[1];
    const measuredZeroY = firstSegment.at(-1);
    return (negativeY - axisZeroY) / (negativeY - measuredZeroY);
  }).toBeCloseTo(13 / 12);
  const path = await temperatureCurve(chart).getAttribute('d');
  const [firstX, , secondX] = path.split('M')[1].match(/-?[\d.]+/g).map(Number);
  const surface = chart.locator('svg.recharts-surface[tabindex="0"]');
  const tooltip = chart.locator('.sensor-chart-tooltip');
  await surface.hover({ position: { x: secondX, y: 100 } });
  await expect(tooltip.getByText('0', { exact: true })).toBeVisible();
  await surface.hover({ position: { x: secondX + (secondX - firstX), y: 100 } });
  await expect(tooltip.locator('.sensor-tooltip-row')).toHaveCount(1);
  await expect(tooltip.getByText('Pressure')).toBeVisible();
  await expect(tooltip.getByText('10', { exact: true })).toBeVisible();
});

test('anomaly markers skip missing samples and preserve fallback and explicit zero values', async ({ page }) => {
  await page.route('**/api/analyse', (route) => route.fulfill({
    json: {
      alerts: [0, 2, 6].map((index) => ({
        alert_id: `reading-${index}`,
        alert_type: 'POINTWISE_ANOMALY',
        timestamp: series[index].created_at,
        target: { metrics: ['Temperature'] },
        severity: 'MEDIUM',
        message: 'Unusual temperature reading',
        supporting_values: { sensor_value: index === 6 ? 0 : null },
      })),
    },
  }));
  const chart = await openDashboard(page);
  await page.getByRole('button', { name: 'Pressure', exact: true }).click();
  await page.getByRole('button', { name: 'Run Analysis', exact: true }).click();
  await expect(chart.locator('circle[fill="#dc2626"]')).toHaveCount(2);
  await focusFirstReading(chart);
  const tooltip = chart.locator('.sensor-anomaly-tooltip');
  await expect(tooltip).toContainText('Recorded value: -4');
  for (let index = 0; index < 6; index++) await page.keyboard.press('ArrowRight');
  await expect(tooltip).toContainText('Recorded value: 0');
});

test('a first row without mapped readings keeps its timestamp and an isolated zero remains visible', async ({ page }) => {
  const rows = series.slice(0, 3).map(({ entry_id, created_at, field1 }, index) => (
    index === 1 ? { entry_id, created_at, field1 } : { entry_id, created_at }
  ));
  const chart = await openDashboard(page, rows);
  await expect(chart.locator('.sensor-reading-dot')).toHaveCount(1);
  const miniChart = page.getByRole('button', { name: /focus temperature/i });
  await expect(miniChart.locator('.sensor-reading-dot')).toHaveCount(1);
  await expect(page.getByText('1 records')).toBeVisible();
});

test('an all-missing stream shows an empty timeline and zero records', async ({ page }) => {
  await openDashboard(page, series.slice(0, 3).map((row) => ({ ...row, field1: null })));
  await expect(page.getByText('No readings are available for the selected streams and time range.')).toBeVisible();
  await expect(page.getByText('No data available for this time range.')).toBeVisible();
  await expect(page.getByText('0 records')).toBeVisible();
});
