import pageOne from './runs_list_page1.json';
import emptyList from './runs_list_empty.json';
import validationError from './error_validation.json';

export const mockHistoryDatasets = [...new Map(
  pageOne.items
    .filter((run) => run.datasetId !== null)
    .map((run) => [run.datasetId, {
      id: run.datasetId,
      name: run.datasetName,
      deleted: run.datasetDeleted,
    }]),
).values()];

const isPositiveInteger = (value) => Number.isSafeInteger(value) && value > 0;

export function listMockAnalysisRuns(query) {
  const page = Number(query.get('page'));
  const pageSize = Number(query.get('pageSize'));
  const datasetId = query.has('datasetId') ? Number(query.get('datasetId')) : null;
  if (
    !isPositiveInteger(page) || !isPositiveInteger(pageSize) || pageSize > 100 ||
    (datasetId !== null && !isPositiveInteger(datasetId))
  ) {
    return { status: 400, body: validationError };
  }

  const matching = pageOne.items.filter((run) => datasetId === null || run.datasetId === datasetId);
  const offset = (page - 1) * pageSize;
  return {
    status: 200,
    body: {
      ...(matching.length ? pageOne : emptyList),
      items: matching.slice(offset, offset + pageSize),
      page,
      pageSize,
      totalItems: matching.length,
      totalPages: Math.ceil(matching.length / pageSize),
    },
  };
}
