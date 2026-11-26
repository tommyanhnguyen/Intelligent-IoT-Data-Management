import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAnalysisHistory } from '../hooks/useAnalysisHistory';
import { HISTORY_PAGE_SIZE } from '../services/analysisHistoryService';
import { ANALYSIS_HISTORY_PATH } from '../utils/analysisHistoryRoutes';
import './DashboardPage.css';
import './AnalysisHistoryPage.css';

const formatDate = new Intl.DateTimeFormat(undefined, {
  year: 'numeric', month: 'short', day: 'numeric',
  hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
});

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  if (!/^\d+$/.test(value ?? '')) return fallback;
  const number = Number(value);
  return number >= 1 && number <= maximum ? number : fallback;
}

function datasetName(name, id) {
  if (name) return name;
  return id === null ? 'Direct data batch' : `Dataset #${id}`;
}

function HistoryShell({ title, description, children }) {
  return (
    <div className="dashboard-page-shell analysis-history">
      <header className="dashboard-page-hero analysis-history__hero">
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      {children}
    </div>
  );
}

function RunTable({ runs, search }) {
  return (
    <table className="analysis-history__table" aria-label="Analysis runs" role="table">
      <thead role="rowgroup">
        <tr role="row">
          <th scope="col" role="columnheader">Run time</th>
          <th scope="col" role="columnheader">Dataset</th>
          <th scope="col" role="columnheader">Selected streams</th>
          <th scope="col" role="columnheader">Alerts</th>
          <th scope="col" role="columnheader">Highest severity</th>
          <th scope="col" role="columnheader"><span className="analysis-history__sr-only">Run details</span></th>
        </tr>
      </thead>
      <tbody role="rowgroup">
        {runs.map((run) => {
          const name = datasetName(run.datasetName, run.datasetId);
          const time = formatDate.format(new Date(run.createdAt));
          const severity = run.highestSeverity;
          return (
            <tr key={run.id} role="row">
              <td role="cell">
                <span className="analysis-history__cell-label" aria-hidden="true">Run time</span>
                <time dateTime={run.createdAt}>{time}</time>
              </td>
              <td role="cell">
                <span className="analysis-history__cell-label" aria-hidden="true">Dataset</span>
                <strong>{name}</strong>
                {run.datasetDeleted && <span className="analysis-history__deleted">Deleted dataset</span>}
              </td>
              <td role="cell">
                <span className="analysis-history__cell-label" aria-hidden="true">Selected streams</span>
                {run.streams.length > 0 ? (
                  <ul className="analysis-history__streams" aria-label="Selected streams">
                    {run.streams.map((stream, index) => <li key={`${stream}-${index}`}>{stream}</li>)}
                  </ul>
                ) : '—'}
              </td>
              <td role="cell">
                <span className="analysis-history__cell-label" aria-hidden="true">Alerts</span>
                <strong>{run.alertCount}</strong>
              </td>
              <td role="cell">
                <span className="analysis-history__cell-label" aria-hidden="true">Highest severity</span>
                {severity ? (
                  <span className="analysis-history__severity" data-severity={severity}>
                    {severity[0] + severity.slice(1).toLowerCase()}
                  </span>
                ) : <span className="analysis-history__none">None</span>}
              </td>
              <td role="cell" className="analysis-history__run-action">
                <Link
                  to={{ pathname: `${ANALYSIS_HISTORY_PATH}/${encodeURIComponent(run.id)}`, search }}
                  className="analysis-history__link"
                  aria-label={`View run for ${name}, ${time}`}
                >
                  View run <span aria-hidden="true">→</span>
                </Link>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function AnalysisHistoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = positiveInteger(searchParams.get('page'), 1);
  const pageSize = positiveInteger(searchParams.get('pageSize'), HISTORY_PAGE_SIZE, 100);
  const datasetId = positiveInteger(searchParams.get('datasetId'), null);
  const { data, error, loading, catalog, retry } = useAnalysisHistory(page, pageSize, datasetId);

  function goToPage(nextPage, nextDatasetId = datasetId) {
    const next = new URLSearchParams(searchParams);
    if (nextPage > 1) next.set('page', nextPage);
    else next.delete('page');
    if (nextDatasetId) next.set('datasetId', nextDatasetId);
    else next.delete('datasetId');
    setSearchParams(next);
  }

  if (error?.status === 401) return <Navigate to="/" replace />;

  const options = new Map(catalog.datasets.map((dataset) => [dataset.id, dataset]));
  for (const run of data?.items ?? []) {
    if (run.datasetId !== null && !options.has(run.datasetId)) {
      options.set(run.datasetId, { id: run.datasetId, name: run.datasetName, deleted: run.datasetDeleted });
    }
  }
  if (datasetId && !options.has(datasetId)) options.set(datasetId, { id: datasetId });
  const datasets = [...options.values()].sort((first, second) => (
    datasetName(first.name, first.id).localeCompare(datasetName(second.name, second.id))
  ));

  const outOfRange = data && page > Math.max(1, data.totalPages);
  const invalidRequest = error?.status === 400;

  return (
    <HistoryShell title="Analysis History" description="Browse results from your previous analysis runs.">
      <section className="analysis-history__panel" aria-label="Saved analysis runs">
        <div className="analysis-history__toolbar">
          <div className="analysis-history__filter">
            <label htmlFor="history-dataset">Dataset</label>
            <select
              id="history-dataset"
              value={datasetId ?? ''}
              onChange={(event) => goToPage(1, positiveInteger(event.target.value, null))}
            >
              <option value="">All datasets</option>
              {datasets.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {datasetName(dataset.name, dataset.id)}{dataset.deleted ? ' (deleted)' : ''}
                </option>
              ))}
            </select>
            {catalog.incomplete && <small>Some datasets may be missing from the filter.</small>}
          </div>
          {data && <p className="analysis-history__count">{data.totalItems} {data.totalItems === 1 ? 'run' : 'runs'}</p>}
        </div>

        {loading && <p className="analysis-history__state" role="status">Loading analysis runs…</p>}

        {error && (
          <div className="analysis-history__state">
            <div role="alert">
              <h2>{invalidRequest ? 'Check the history filters' : 'Could not load analysis history'}</h2>
              <p>
                {invalidRequest ? error.message : error.status === 503
                  ? 'Analysis history is temporarily unavailable. Try again in a moment.'
                  : 'Try again to load your saved runs.'}
              </p>
            </div>
            {invalidRequest ? (
              <Link className="analysis-history__link" to={ANALYSIS_HISTORY_PATH}>Reset filters</Link>
            ) : (
              <button className="analysis-history__button" type="button" onClick={retry}>Try again</button>
            )}
          </div>
        )}

        {data?.items.length > 0 && (
          <>
            <RunTable runs={data.items} search={searchParams.toString()} />
            <nav className="analysis-history__pagination" aria-label="History pagination">
              <button className="analysis-history__button" type="button" disabled={page <= 1} onClick={() => goToPage(page - 1)}>
                Previous
              </button>
              <span aria-live="polite">Page {data.page} of {data.totalPages}</span>
              <button className="analysis-history__button" type="button" disabled={page >= data.totalPages} onClick={() => goToPage(page + 1)}>
                Next
              </button>
            </nav>
          </>
        )}

        {data?.items.length === 0 && (
          <div className="analysis-history__state">
            {outOfRange ? (
              <>
                <h2>No runs on this page</h2>
                <button className="analysis-history__button" type="button" onClick={() => goToPage(Math.max(1, data.totalPages))}>
                  Go to {data.totalPages > 0 ? 'last page' : 'first page'}
                </button>
              </>
            ) : datasetId ? (
              <>
                <h2>No runs for this dataset</h2>
                <button className="analysis-history__button" type="button" onClick={() => goToPage(1, null)}>
                  Clear dataset filter
                </button>
              </>
            ) : (
              <>
                <h2>No analysis runs yet</h2>
                <p>Run an analysis from a dataset dashboard to see it here.</p>
                <Link className="analysis-history__link" to="/home">Browse datasets</Link>
              </>
            )}
          </div>
        )}
      </section>
    </HistoryShell>
  );
}

export function AnalysisRunPlaceholder() {
  const { search } = useLocation();
  return (
    <HistoryShell title="Analysis run" description="Saved run details are coming soon.">
      <div className="analysis-history__panel analysis-history__state">
        <Link className="analysis-history__link" to={{ pathname: ANALYSIS_HISTORY_PATH, search }}>
          Back to Analysis History
        </Link>
      </div>
    </HistoryShell>
  );
}
