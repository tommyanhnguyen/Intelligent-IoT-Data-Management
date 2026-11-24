import { useEffect, useState } from 'react';
import { listAnalysisRuns, listHistoryDatasets } from '../services/analysisHistoryService';

export function useAnalysisHistory(page, pageSize, datasetId) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(null);
  const [catalog, setCatalog] = useState({ datasets: [], incomplete: false });
  const requestKey = `${page}/${pageSize}/${datasetId}/${attempt}`;

  useEffect(() => {
    const controller = new AbortController();
    // A development Strict Mode cleanup can cancel an effect before it sends a request.
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      listAnalysisRuns({ page, pageSize, datasetId, signal: controller.signal }).then(
        (data) => {
          if (!controller.signal.aborted) setResult({ key: requestKey, data });
        },
        (error) => {
          if (!controller.signal.aborted) setResult({ key: requestKey, error });
        },
      );
    });
    return () => controller.abort();
  }, [page, pageSize, datasetId, requestKey]);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      listHistoryDatasets(controller.signal).then(
        (nextCatalog) => {
          if (!controller.signal.aborted) setCatalog(nextCatalog);
        },
        () => {
          if (!controller.signal.aborted) setCatalog({ datasets: [], incomplete: true });
        },
      );
    });
    return () => controller.abort();
  }, []);

  const current = result?.key === requestKey ? result : null;
  return {
    data: current?.data,
    error: current?.error,
    loading: current === null,
    catalog,
    retry: () => setAttempt((value) => value + 1),
  };
}
