import { expect, test } from '@playwright/test';
import {
  authRoute, emptyHistory, firstPage, fixturePage, historyFixture, historyRoute,
} from './helpers/analysisHistoryFixtures.js';

const historyPath = '/analysis-history';
const [latest, noAlerts, deletedRun] = firstPage.items;

async function routeHistory(page, list = (route, query) => route.fulfill({ json: fixturePage(query) })) {
  await page.route(authRoute, (route) => route.fulfill({ json: { data: { accessToken: 'history-test-token' } } }));
  await page.route(/\/api\/datasets(?:\?.*)?$/, (route) => {
    const status = new URL(route.request().url()).searchParams.get('status');
    return route.fulfill({
      json: status === 'deleted'
        ? [{ id: deletedRun.datasetId, name: deletedRun.datasetName }]
        : [{ id: latest.datasetId, name: latest.datasetName }, { id: 99, name: 'New dataset' }],
    });
  });
  await page.route(historyRoute, (route) => list(route, new URL(route.request().url()).searchParams));
}

const runTable = (page) => page.getByRole('table', { name: 'Analysis runs' });
const datasetSelect = (page) => page.getByRole('combobox', { name: 'Dataset' });
const runRow = (page, run) => runTable(page).getByRole('row').filter({
  has: page.locator(`time[datetime="${run.createdAt}"]`),
});

test('opens history from the protected application navigation', async ({ page }) => {
  await routeHistory(page);
  await page.goto('/about');
  const link = page.getByRole('link', { name: 'Analysis History', exact: true });
  await link.click();
  await expect(page).toHaveURL(/\/analysis-history$/);
  await expect(link).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Analysis History' })).toBeVisible();
});

test('renders newest-first timestamps, dataset names, streams, counts and severity', async ({ page }) => {
  await routeHistory(page);
  await page.goto(historyPath);
  const times = runTable(page).locator('time');
  await expect(times).toHaveCount(3);
  await expect(times.first()).toHaveAttribute('datetime', latest.createdAt);
  await expect(times.last()).toHaveAttribute('datetime', deletedRun.createdAt);
  const row = runRow(page, latest);
  await expect(row.getByText(latest.datasetName)).toBeVisible();
  await expect(row.getByRole('listitem')).toHaveText(latest.streams);
  await expect(row.getByRole('cell', { name: '3', exact: true })).toBeVisible();
  await expect(row.getByText('High', { exact: true })).toBeVisible();
  await expect(runRow(page, deletedRun).getByText('Low', { exact: true })).toBeVisible();
});

test('shows zero alerts and no severity on a successful run without alerts', async ({ page }) => {
  await routeHistory(page);
  await page.goto(historyPath);
  const row = runRow(page, noAlerts);
  await expect(row.getByRole('cell', { name: '0', exact: true })).toBeVisible();
  await expect(row.getByRole('cell', { name: 'None', exact: true })).toBeVisible();
  await expect(row.getByRole('link', { name: /view run/i })).toBeVisible();
});

test('retains a deleted dataset name and supports filtering by its ID', async ({ page }) => {
  await routeHistory(page);
  await page.goto(historyPath);
  await expect(runRow(page, deletedRun).getByText(deletedRun.datasetName)).toBeVisible();
  await expect(runRow(page, deletedRun).getByText('Deleted dataset', { exact: true })).toBeVisible();
  await expect(datasetSelect(page).getByRole('option', { name: /(deleted)/i })).toHaveCount(1);
  await datasetSelect(page).selectOption(String(deletedRun.datasetId));
  await expect(page).toHaveURL(/datasetId=37/);
  await expect(runTable(page).locator('tbody tr')).toHaveCount(1);
  await expect(runRow(page, deletedRun)).toBeVisible();
});

test('renders direct batches and deleted runs whose dataset IDs were cleared', async ({ page }) => {
  await routeHistory(page, (route) => route.fulfill({
    json: {
      ...firstPage,
      totalItems: 2,
      items: [{ ...latest, datasetId: null, datasetName: null }, { ...deletedRun, datasetId: null }],
    },
  }));
  await page.goto(historyPath);
  await expect(runRow(page, latest).getByText('Direct data batch')).toBeVisible();
  await expect(runRow(page, deletedRun).getByText(deletedRun.datasetName)).toBeVisible();
  await expect(runRow(page, deletedRun).getByText('Deleted dataset')).toBeVisible();
});

test('shows loading while the list request is pending', async ({ page }) => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  await routeHistory(page, async (route) => {
    await pending;
    return route.fulfill({ json: firstPage });
  });
  await page.goto(historyPath);
  try {
    await expect(page.getByRole('status')).toHaveText('Loading analysis runs…');
    await expect(runTable(page)).toHaveCount(0);
  } finally {
    release();
  }
  await expect(runTable(page)).toBeVisible();
});

test('shows the unfiltered empty state and a path to datasets', async ({ page }) => {
  await routeHistory(page, (route) => route.fulfill({ json: emptyHistory }));
  await page.goto(historyPath);
  await expect(page.getByRole('heading', { name: 'No analysis runs yet' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Browse datasets' })).toHaveAttribute('href', '/home');
  await expect(page.getByRole('navigation', { name: 'History pagination' })).toHaveCount(0);
});

test('shows filtered empty results and clears the selected dataset', async ({ page }) => {
  await routeHistory(page);
  await page.goto(historyPath);
  await datasetSelect(page).selectOption('99');
  await expect(page.getByRole('heading', { name: 'No runs for this dataset' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear dataset filter' }).click();
  await expect(datasetSelect(page)).toHaveValue('');
  await expect(runTable(page).locator('tbody tr')).toHaveCount(3);
});

test('pages through server results and disables navigation at both boundaries', async ({ page }) => {
  await routeHistory(page);
  await page.goto(`${historyPath}?pageSize=2`);
  const next = page.getByRole('button', { name: 'Next' });
  const previous = page.getByRole('button', { name: 'Previous' });
  await expect(previous).toBeDisabled();
  await expect(page.getByText('Page 1 of 2')).toBeVisible();
  await next.click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByText('Page 2 of 2')).toBeVisible();
  await expect(runRow(page, deletedRun)).toBeVisible();
  await expect(next).toBeDisabled();
  await previous.click();
  await expect(page.getByText('Page 1 of 2')).toBeVisible();
  await expect(runRow(page, latest)).toBeVisible();
});

test('resets the page when the dataset changes', async ({ page }) => {
  await routeHistory(page);
  await page.goto(`${historyPath}?pageSize=2&page=2`);
  await expect(page.getByText('Page 2 of 2')).toBeVisible();
  await datasetSelect(page).selectOption('42');
  await expect(page).toHaveURL(/\?pageSize=2&datasetId=42$/);
  await expect(page.getByText('Page 1 of 1')).toBeVisible();
  await expect(runTable(page).locator('tbody tr')).toHaveCount(2);
});

test('recovers from a page beyond the last available result', async ({ page }) => {
  await routeHistory(page);
  await page.goto(`${historyPath}?pageSize=2&page=9`);
  await expect(page.getByRole('heading', { name: 'No runs on this page' })).toBeVisible();
  await page.getByRole('button', { name: 'Go to last page' }).click();
  await expect(page.getByText('Page 2 of 2')).toBeVisible();
});

test('keeps the filter when a service error is retried', async ({ page }) => {
  let fail = true;
  await routeHistory(page, async (route, query) => (
    fail
      ? route.fulfill({ status: 503, json: { error: 'Unavailable', code: 'SERVICE_UNAVAILABLE' } })
      : route.fulfill({ json: fixturePage(query) })
  ));
  await page.goto(`${historyPath}?datasetId=42`);
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
  await expect(datasetSelect(page)).toHaveValue('42');
  fail = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(runTable(page).locator('tbody tr')).toHaveCount(2);
  await expect(datasetSelect(page)).toHaveValue('42');
});

test('offers a filter reset on validation errors without retrying the request', async ({ page }) => {
  let requests = 0;
  await routeHistory(page, (route, query) => {
    requests++;
    return query.has('datasetId')
      ? route.fulfill({ status: 400, json: historyFixture('error_validation') })
      : route.fulfill({ json: fixturePage(query) });
  });
  await page.goto(`${historyPath}?datasetId=42`);
  await expect(page.getByRole('alert')).toContainText('Check the history filters');
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  expect(requests).toBe(1);
  await page.getByRole('link', { name: 'Reset filters' }).click();
  await expect(runTable(page)).toBeVisible();
});

test('returns to sign-in when the history request stays unauthorized after refresh', async ({ page }) => {
  await routeHistory(page, (route) => route.fulfill({
    status: 401,
    json: { error: 'Sign-in required', code: 'UNAUTHENTICATED' },
  }));
  await page.goto(historyPath);
  await expect(page).toHaveURL(/\/$/);
  await expect(runTable(page)).toHaveCount(0);
});

test('hands the run UUID to FE-02 and restores the history query on return', async ({ page }) => {
  await routeHistory(page);
  await page.route(/\/api\/analysis\/runs\/[^/]+$/, () => {
    throw new Error('The FE-01 handoff must not request run details');
  });
  const query = '?pageSize=2&page=2';
  await page.goto(`${historyPath}${query}`);
  await runRow(page, deletedRun).getByRole('link', { name: /view run/i }).click();
  expect(new URL(page.url()).pathname).toBe(`${historyPath}/${deletedRun.id}`);
  await expect(page.getByRole('heading', { name: 'Analysis run', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to Analysis History' }).click();
  expect(new URL(page.url()).search).toBe(query);
  await expect(runRow(page, deletedRun)).toBeVisible();
});

test('keeps the navigation and full run summary usable at a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await routeHistory(page);
  await page.goto(historyPath);
  const row = runRow(page, latest);
  await expect(row.getByText(latest.datasetName)).toBeVisible();
  await expect(row.getByRole('listitem')).toHaveCount(3);
  await expect(row.getByRole('link', { name: /view run/i })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});
