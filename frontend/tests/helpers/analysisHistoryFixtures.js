import { readFileSync } from 'node:fs';

export function historyFixture(name) {
  const file = new URL(`../../src/mocks/analysisHistory/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(file, 'utf8'));
}

export const firstPage = historyFixture('runs_list_page1');
export const emptyHistory = historyFixture('runs_list_empty');
export const authRoute = '**/api/auth/refresh';
export const historyRoute = /\/api\/analysis\/runs\?/;

export function fixturePage(query) {
  const page = Number(query.get('page'));
  const pageSize = Number(query.get('pageSize'));
  const datasetId = query.get('datasetId');
  const runs = firstPage.items.filter((run) => !datasetId || String(run.datasetId) === datasetId);
  const start = (page - 1) * pageSize;
  return {
    items: runs.slice(start, start + pageSize),
    page,
    pageSize,
    totalItems: runs.length,
    totalPages: Math.ceil(runs.length / pageSize),
  };
}
