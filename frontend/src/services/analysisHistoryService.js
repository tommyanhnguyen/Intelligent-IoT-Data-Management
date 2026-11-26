import { authenticatedFetch, clearAccessToken } from './authClient';

const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';
const useMocks = import.meta.env.DEV && import.meta.env.VITE_ANALYSIS_HISTORY_MOCKS === 'true';
export const HISTORY_PAGE_SIZE = 20;

class HistoryRequestError extends Error {
  constructor(status, body) {
    super(typeof body?.error === 'string' ? body.error : 'Could not load analysis history.');
    this.status = status;
    this.code = body?.code;
  }
}

const isCount = (value) => Number.isSafeInteger(value) && value >= 0;

function isRunSummary(run) {
  return run &&
    typeof run.id === 'string' && run.id.length > 0 &&
    (run.datasetId === null || (isCount(run.datasetId) && run.datasetId > 0)) &&
    (run.datasetName === null || typeof run.datasetName === 'string') &&
    typeof run.datasetDeleted === 'boolean' &&
    Array.isArray(run.streams) && run.streams.every((stream) => typeof stream === 'string') &&
    isCount(run.alertCount) &&
    (run.highestSeverity === null || typeof run.highestSeverity === 'string') &&
    typeof run.createdAt === 'string' && Number.isFinite(Date.parse(run.createdAt));
}

function readRunList(body) {
  if (
    !Array.isArray(body?.items) || !body.items.every(isRunSummary) ||
    !isCount(body.page) || body.page < 1 ||
    !isCount(body.pageSize) || body.pageSize < 1 || body.pageSize > 100 ||
    !isCount(body.totalItems) || !isCount(body.totalPages)
  ) {
    throw new Error('Invalid analysis history response.');
  }
  return body;
}

export async function listAnalysisRuns({
  page = 1, pageSize = HISTORY_PAGE_SIZE, datasetId, signal,
} = {}) {
  const query = new URLSearchParams({ page, pageSize });
  if (datasetId !== undefined && datasetId !== null) query.set('datasetId', datasetId);

  if (useMocks) {
    const { listMockAnalysisRuns } = await import('../mocks/analysisHistory/listMockAnalysisRuns.js');
    const { status, body } = listMockAnalysisRuns(query);
    if (status !== 200) throw new HistoryRequestError(status, body);
    return readRunList(body);
  }

  let response;
  try {
    response = await authenticatedFetch(
      `${apiBase}/analysis/runs?${query}`,
      { signal },
      { refreshOnUnauthorized: true },
    );
  } catch (error) {
    if (error.response?.status !== 401) throw error;
    clearAccessToken();
    throw new HistoryRequestError(401, error.response.data);
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) throw new HistoryRequestError(response.status, body);
  return readRunList(body);
}

export async function listHistoryDatasets(signal) {
  if (useMocks) {
    const { mockHistoryDatasets } = await import('../mocks/analysisHistory/listMockAnalysisRuns.js');
    return { datasets: mockHistoryDatasets, incomplete: false };
  }

  // The dataset API lists active and deleted datasets separately.
  const results = await Promise.allSettled(['active', 'deleted'].map(async (status) => {
    const response = await authenticatedFetch(`${apiBase}/datasets?status=${status}`, { signal });
    if (!response.ok) throw new Error('Could not load datasets.');
    const datasets = await response.json();
    if (!Array.isArray(datasets)) throw new Error('Invalid dataset list.');
    return datasets
      .filter(({ id }) => Number.isSafeInteger(Number(id)) && Number(id) > 0)
      .map(({ id, name }) => ({ id: Number(id), name, deleted: status === 'deleted' }));
  }));

  return {
    datasets: results.flatMap((result) => result.status === 'fulfilled' ? result.value : []),
    incomplete: results.some((result) => result.status === 'rejected'),
  };
}
