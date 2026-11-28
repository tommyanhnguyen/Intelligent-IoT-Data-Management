const db = require("../db/pool");

const repositoryError = (code, status, message) =>
  Object.assign(new Error(message), { code, status });

function runQuery(client, text, params) {
  if (client) return client.query(text, params);
  return db.query(text, params);
}

const SEVERITY_RANK = { LOW: 1, MEDIUM: 2, HIGH: 3 };

function countByType(alerts) {
  const counts = { POINTWISE_ANOMALY: 0, CORRELATION_CHANGE: 0 };
  for (const alert of alerts) {
    counts[alert.alert_type] = (counts[alert.alert_type] || 0) + 1;
  }
  return counts;
}

function highestSeverity(alerts) {
  let best = null;
  let bestRank = 0;
  for (const alert of alerts) {
    const rank = SEVERITY_RANK[alert.severity] || 0;
    if (rank > bestRank) {
      bestRank = rank;
      best = alert.severity;
    }
  }
  return best;
}

function toAlert(row) {
  return {
    timestamp: row.timestamp.toISOString(),
    alert_type: row.alert_type,
    target: row.target,
    method: row.method,
    score: row.score == null ? null : Number(row.score),
    score_metadata: row.score_metadata,
    severity: row.severity,
    message: row.message,
    time_window: row.time_window,
    supporting_values: row.supporting_values,
    source: row.source,
    alert_id: row.id,
  };
}

function toSummary(row, alerts) {
  const settings = row.settings || {};
  return {
    id: row.id,
    userId: row.user_id,
    datasetId: row.dataset_id,
    datasetName: row.dataset_name,
    datasetDeleted: row.dataset_deleted,
    status: "success",
    streams: row.streams,
    modelMetric: settings.model ? settings.model.metric : null,
    processedItems: null,
    alertCount: alerts.length,
    alertCountByType: countByType(alerts),
    highestSeverity: highestSeverity(alerts),
    generatedAt: null,
    createdAt: row.created_at.toISOString(),
  };
}

function toDetail(row, alerts) {
  return {
    ...toSummary(row, alerts),
    contractVersion: "0.1",
    request: row.settings,
    result: {
      status: "success",
      generated_at: null,
      alerts: alerts.map(toAlert),
      summary: {
        processed_items: null,
        alert_count: alerts.length,
      },
      errors: [],
    },
  };
}

async function loadAlerts(client, runId) {
  const result = await runQuery(
    client,
    `SELECT * FROM analysis_alerts WHERE run_id = $1 ORDER BY timestamp`,
    [runId],
  );
  return result.rows;
}

const RUN_COLUMNS = `
  r.id, r.user_id, r.dataset_id, r.streams, r.settings, r.created_at,
  d.name AS dataset_name, d.created_by,
  (d.deleted_at IS NOT NULL) AS dataset_deleted
`;

class AnalysisRepository {
  async saveAnalysisRun({
    userId,
    datasetId,
    streams,
    settings,
    alerts,
    client: providedClient,
  }) {
    // Use the test's client if provided; otherwise create our own.
    const client = providedClient || (await db.connect());
    const ownsClient = !providedClient;

    try {
      // Only manage the transaction when this repository owns the connection.
      if (ownsClient) {
        await client.query("BEGIN");
      }

      const runResult = await client.query(
        `INSERT INTO analysis_runs
          (user_id, dataset_id, streams, settings)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [
          userId,
          datasetId,
          JSON.stringify(streams || []),
          JSON.stringify(settings || {}),
        ],
      );

      const runId = runResult.rows[0].id;
      const savedAlerts = [];

      for (const alert of alerts || []) {
        const alertResult = await client.query(
          `INSERT INTO analysis_alerts
            (id, run_id, timestamp, alert_type, target, method,
             message, source, score, score_metadata, severity,
             time_window, supporting_values)
           VALUES
            (gen_random_uuid(), $1, $2, $3, $4, $5,
             $6, $7, $8, $9, $10, $11, $12)
           RETURNING id`,
          [
            runId,
            alert.timestamp,
            alert.alert_type,
            JSON.stringify(alert.target),
            alert.method,
            alert.message,
            JSON.stringify(alert.source),
            alert.score ?? null,
            alert.score_metadata == null
              ? null
              : JSON.stringify(alert.score_metadata),
            alert.severity ?? null,
            alert.time_window == null
              ? null
              : JSON.stringify(alert.time_window),
            alert.supporting_values == null
              ? null
              : JSON.stringify(alert.supporting_values),
          ],
        );

        savedAlerts.push({
          ...alert,
          alert_id: alertResult.rows[0].id,
        });
      }

      if (ownsClient) {
        await client.query("COMMIT");
      }

      return {
        runId,
        alerts: savedAlerts,
      };
    } catch (error) {
      if (ownsClient) {
        await client.query("ROLLBACK");
      }
      throw error;
    } finally {
      if (ownsClient) {
        client.release();
      }
    }
  }

  async findLatestRun({ userId, datasetId, client }) {
    const params = [userId];
    let datasetClause = "";
    if (datasetId != null) {
      params.push(datasetId);
      datasetClause = `AND r.dataset_id = $${params.length}`;
    }

    const result = await runQuery(
      client,
      `SELECT ${RUN_COLUMNS}
       FROM analysis_runs r
       JOIN datasets d ON d.id = r.dataset_id
       WHERE d.created_by = $1
       ${datasetClause}
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT 1`,
      params,
    );

    if (result.rows.length === 0) {
      throw repositoryError("RUN_NOT_FOUND", 404, "Analysis run not found");
    }

    const alerts = await loadAlerts(client, result.rows[0].id);
    return toDetail(result.rows[0], alerts);
  }

  async listRuns({ userId, page, pageSize, datasetId, client }) {
    const params = [userId];
    let datasetClause = "";
    if (datasetId != null) {
      params.push(datasetId);
      datasetClause = `AND r.dataset_id = $${params.length}`;
    }

    const where = `WHERE d.created_by = $1 ${datasetClause}`;

    const countResult = await runQuery(
      client,
      `SELECT COUNT(*)::int AS total
       FROM analysis_runs r
       JOIN datasets d ON d.id = r.dataset_id
       ${where}`,
      params,
    );
    const totalItems = Number(countResult.rows[0].total);
    const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize);

    const listParams = params.slice();
    listParams.push(pageSize, (page - 1) * pageSize);

    const result = await runQuery(
      client,
      `SELECT ${RUN_COLUMNS}
       FROM analysis_runs r
       JOIN datasets d ON d.id = r.dataset_id
       ${where}
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams,
    );

    const items = [];
    for (const row of result.rows) {
      const alerts = await loadAlerts(client, row.id);
      const summary = toSummary(row, alerts);
      delete summary.userId;
      items.push(summary);
    }

    return { items, page, pageSize, totalItems, totalPages };
  }

  async findRunById({ runId, userId, role, client }) {
    const result = await runQuery(
      client,
      `SELECT ${RUN_COLUMNS}
       FROM analysis_runs r
       JOIN datasets d ON d.id = r.dataset_id
       WHERE r.id = $1`,
      [runId],
    );

    if (result.rows.length === 0) {
      throw repositoryError("RUN_NOT_FOUND", 404, "Analysis run not found");
    }

    const row = result.rows[0];
    if (row.created_by !== userId && role !== "admin") {
      throw repositoryError("FORBIDDEN", 403, "You cannot view this analysis.");
    }

    const alerts = await loadAlerts(client, row.id);
    return toDetail(row, alerts);
  }
}

module.exports = new AnalysisRepository();
