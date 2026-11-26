import { expect, test } from '@playwright/test';
import {
  authRoute, emptyHistory, firstPage, fixturePage, historyFixture, historyRoute,
} from './helpers/analysisHistoryFixtures.js';

const unauthenticated = { error: 'Sign-in required', code: 'UNAUTHENTICATED' };

async function requestHistory(page, options) {
  await page.goto('/');
  return page.evaluate(async (requestOptions) => {
    const servicePath = '/src/services/analysisHistoryService.js';
    const authPath = '/src/services/authClient.js';
    const [{ listAnalysisRuns }, { getAccessToken, setAccessToken }] = await Promise.all([
      import(servicePath), import(authPath),
    ]);
    setAccessToken('initial-token');
    try {
      const body = await listAnalysisRuns(requestOptions);
      return { body, token: getAccessToken() };
    } catch (error) {
      return { message: error.message, status: error.status, code: error.code, token: getAccessToken() };
    }
  }, options);
}

test('HIST-02 sends an authenticated GET with contract defaults and preserves server order', async ({ page }) => {
  await page.route(historyRoute, (route) => route.fulfill({ json: firstPage }));
  const pending = page.waitForRequest(historyRoute);
  const result = await requestHistory(page);
  const request = await pending;
  expect(request.method()).toBe('GET');
  expect(request.headers().authorization).toBe('Bearer initial-token');
  expect(Object.fromEntries(new URL(request.url()).searchParams)).toEqual({ page: '1', pageSize: '20' });
  expect(result.body).toEqual(firstPage);
});

test('HIST-02 serializes the dataset, page and page size and consumes filtered totals', async ({ page }) => {
  await page.route(historyRoute, (route) => route.fulfill({
    json: fixturePage(new URL(route.request().url()).searchParams),
  }));
  const pending = page.waitForRequest(historyRoute);
  const result = await requestHistory(page, { datasetId: 42, page: 2, pageSize: 1 });
  expect(Object.fromEntries(new URL((await pending).url()).searchParams)).toEqual({
    datasetId: '42', page: '2', pageSize: '1',
  });
  expect(result.body).toEqual({
    items: [firstPage.items[1]], page: 2, pageSize: 1, totalItems: 2, totalPages: 2,
  });
});

test('HIST-02 accepts a 200 empty response with zero total pages', async ({ page }) => {
  await page.route(historyRoute, (route) => route.fulfill({ json: emptyHistory }));
  expect((await requestHistory(page)).body).toEqual(emptyHistory);
});

test('HIST-02 accepts an empty page beyond the end with nonzero totals', async ({ page }) => {
  const outOfRange = { ...firstPage, items: [], page: 5 };
  await page.route(historyRoute, (route) => route.fulfill({ json: outOfRange }));
  expect((await requestHistory(page, { page: 5 })).body).toEqual(outOfRange);
});

test('HIST-02 preserves the flat 400 validation message and makes no automatic retry', async ({ page }) => {
  const error = historyFixture('error_validation');
  let calls = 0;
  await page.route(historyRoute, (route) => {
    calls++;
    return route.fulfill({ status: 400, json: error });
  });
  expect(await requestHistory(page, { pageSize: 101 })).toMatchObject({
    status: 400, code: 'VALIDATION_ERROR', message: error.error,
  });
  expect(calls).toBe(1);
});

test('HIST-02 preserves a 503 service error for the retry UI', async ({ page }) => {
  await page.route(historyRoute, (route) => route.fulfill({
    status: 503,
    json: { error: 'History temporarily unavailable', code: 'SERVICE_UNAVAILABLE' },
  }));
  expect(await requestHistory(page)).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
});

test('HIST-02 reports an upstream 500 response without JSON as a generic error', async ({ page }) => {
  await page.route(historyRoute, (route) => route.fulfill({ status: 500, body: 'Upstream unavailable' }));
  expect(await requestHistory(page)).toMatchObject({
    status: 500, message: 'Could not load analysis history.',
  });
});

test('HIST-02 refreshes once on flat 401 and retries with the new bearer token', async ({ page }) => {
  const credentials = [];
  let refreshes = 0;
  await page.route(authRoute, (route) => {
    refreshes++;
    return route.fulfill({ json: { data: { accessToken: 'refreshed-token' } } });
  });
  await page.route(historyRoute, (route) => {
    credentials.push(route.request().headers().authorization);
    return credentials.length === 1
      ? route.fulfill({ status: 401, json: unauthenticated })
      : route.fulfill({ json: firstPage });
  });
  expect(await requestHistory(page)).toEqual({ body: firstPage, token: 'refreshed-token' });
  expect(credentials).toEqual(['Bearer initial-token', 'Bearer refreshed-token']);
  expect(refreshes).toBe(1);
});

test('HIST-02 clears the session when the retried request is still unauthorized', async ({ page }) => {
  let refreshes = 0;
  let calls = 0;
  await page.route(authRoute, (route) => {
    refreshes++;
    return route.fulfill({ json: { data: { accessToken: 'refreshed-token' } } });
  });
  await page.route(historyRoute, (route) => {
    calls++;
    return route.fulfill({ status: 401, json: unauthenticated });
  });
  expect(await requestHistory(page)).toMatchObject({ status: 401, code: 'UNAUTHENTICATED', token: null });
  expect(refreshes).toBe(1);
  expect(calls).toBe(2);
});

test('HIST-02 clears the session when the authorization refresh fails', async ({ page }) => {
  let calls = 0;
  await page.route(authRoute, (route) => route.fulfill({ status: 401, json: unauthenticated }));
  await page.route(historyRoute, (route) => {
    calls++;
    return route.fulfill({ status: 401, json: unauthenticated });
  });
  expect(await requestHistory(page)).toMatchObject({ status: 401, code: 'UNAUTHENTICATED', token: null });
  expect(calls).toBe(1);
});

test('HIST-02 rejects a malformed success body before rendering the list', async ({ page }) => {
  await page.route(historyRoute, (route) => route.fulfill({
    json: { ...firstPage, items: [{ ...firstPage.items[0], streams: null }] },
  }));
  expect(await requestHistory(page)).toMatchObject({ message: 'Invalid analysis history response.' });
});
