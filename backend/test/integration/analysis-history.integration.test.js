const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { randomUUID } = require("node:crypto");

require("dotenv").config();

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

if (!TEST_DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL is required");
}

const pool = new Pool({ connectionString: TEST_DATABASE_URL });

const migrationPath = path.join(
  __dirname,
  "../../src/db/migrations/005_analysis_runs_and_alerts.sql",
);

const analysisRepository = require("../../src/repositories/analysisRepository");

test.after(async () => {
  await pool.end();
});

async function withSchema(fn) {
  const client = await pool.connect();
  const schemaName = `analysis_hist_${randomUUID().replace(/-/g, "")}`;

  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA "${schemaName}"`);
    await client.query(`SET LOCAL search_path TO "${schemaName}", public`);
    await client.query(`
      CREATE TABLE auth_users (
        id UUID PRIMARY KEY
      );

      CREATE TABLE datasets (
        id SERIAL PRIMARY KEY,
        name TEXT,
        created_by UUID,
        deleted_at TIMESTAMPTZ
      );
    `);
    await client.query(fs.readFileSync(migrationPath, "utf8"));
    await fn(client);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

function sampleAlerts() {
  return [
    {
      timestamp: "2026-08-27T00:00:00.000Z",
      alert_type: "POINTWISE_ANOMALY",
      target: { metric: "temperature" },
      method: "isolationforest",
      message: "Temperature anomaly detected",
      source: { service: "analytics" },
      score: 0.95,
      score_metadata: { threshold: 0.8 },
      severity: "HIGH",
      time_window: { start: "2026-08-27T00:00:00.000Z" },
      supporting_values: { temperature: 35.5 },
    },
    {
      timestamp: "2026-08-27T00:01:00.000Z",
      alert_type: "CORRELATION_CHANGE",
      target: { streams: ["temperature", "humidity"] },
      method: "pearson",
      message: "Correlation change detected",
      source: { service: "analytics" },
      score: 0.75,
      score_metadata: { threshold: 0.7 },
      severity: "MEDIUM",
      time_window: { start: "2026-08-27T00:01:00.000Z" },
      supporting_values: { correlation: 0.75 },
    },
  ];
}

async function insertOwnerDataset(client) {
  const ownerId = randomUUID();
  const otherId = randomUUID();
  await client.query("INSERT INTO auth_users (id) VALUES ($1), ($2)", [
    ownerId,
    otherId,
  ]);
  await client.query(
    "INSERT INTO datasets (id, name, created_by) VALUES ($1, $2, $3)",
    [42, "melbourne-weather-replay", ownerId],
  );
  return { ownerId, otherId };
}

async function setCreatedAt(client, runId, createdAt) {
  await client.query("UPDATE analysis_runs SET created_at = $2 WHERE id = $1", [
    runId,
    createdAt,
  ]);
}

test("owner can read a saved run", async () => {
  await withSchema(async (client) => {
    const { ownerId } = await insertOwnerDataset(client);
    const streams = ["temperature", "humidity"];
    const settings = {
      model: { metric: "temperature" },
      correlation: { method: "pearson" },
    };
    const alerts = sampleAlerts();

    const saved = await analysisRepository.saveAnalysisRun({
      userId: ownerId,
      datasetId: 42,
      streams,
      settings,
      alerts,
      client,
    });

    const found = await analysisRepository.findRunById({
      runId: saved.runId,
      userId: ownerId,
      role: "user",
      client,
    });

    assert.equal(found.userId, ownerId);
    assert.equal(found.datasetId, 42);
    assert.deepEqual(found.streams, streams);
    assert.deepEqual(found.request, settings);
    assert.equal(found.result.alerts.length, 2);

    const alertRows = await client.query(
      `SELECT id FROM analysis_alerts WHERE run_id = $1 ORDER BY timestamp`,
      [saved.runId],
    );
    assert.equal(found.result.alerts[0].alert_id, alertRows.rows[0].id);
    assert.equal(found.result.alerts[1].alert_id, alertRows.rows[1].id);
  });
});

test("the list is one page at a time", async () => {
  await withSchema(async (client) => {
    const { ownerId } = await insertOwnerDataset(client);
    const streams = ["temperature"];
    const settings = { model: { metric: "temperature" }, correlation: null };

    async function saveAt(createdAt) {
      const saved = await analysisRepository.saveAnalysisRun({
        userId: ownerId,
        datasetId: 42,
        streams,
        settings,
        alerts: [],
        client,
      });
      await setCreatedAt(client, saved.runId, createdAt);
      return saved.runId;
    }

    const oldest = await saveAt("2026-11-21T09:00:00.000Z");
    const middle = await saveAt("2026-11-21T10:00:00.000Z");
    const newest = await saveAt("2026-11-21T11:00:00.000Z");

    const page1 = await analysisRepository.listRuns({
      userId: ownerId,
      page: 1,
      pageSize: 2,
      client,
    });
    assert.deepEqual(
      page1.items.map((item) => item.id),
      [newest, middle],
    );
    assert.equal(page1.totalItems, 3);
    assert.equal(page1.totalPages, 2);

    const page2 = await analysisRepository.listRuns({
      userId: ownerId,
      page: 2,
      pageSize: 2,
      client,
    });
    assert.deepEqual(
      page2.items.map((item) => item.id),
      [oldest],
    );
    assert.equal(page2.totalItems, 3);

    const page3 = await analysisRepository.listRuns({
      userId: ownerId,
      page: 3,
      pageSize: 2,
      client,
    });
    assert.deepEqual(page3.items, []);
    assert.equal(page3.totalItems, 3);
  });
});

test("a different user is refused", async () => {
  await withSchema(async (client) => {
    const { ownerId, otherId } = await insertOwnerDataset(client);

    const saved = await analysisRepository.saveAnalysisRun({
      userId: ownerId,
      datasetId: 42,
      streams: ["temperature"],
      settings: { model: { metric: "temperature" }, correlation: null },
      alerts: [],
      client,
    });

    await assert.rejects(
      () =>
        analysisRepository.findRunById({
          runId: saved.runId,
          userId: otherId,
          role: "user",
          client,
        }),
      (err) => {
        assert.equal(err.status, 403);
        assert.equal(err.code, "FORBIDDEN");
        return true;
      },
    );

    const listed = await analysisRepository.listRuns({
      userId: otherId,
      page: 1,
      pageSize: 20,
      client,
    });
    assert.deepEqual(listed.items, []);
    assert.equal(listed.totalItems, 0);

    await assert.rejects(
      () =>
        analysisRepository.findLatestRun({
          userId: otherId,
          client,
        }),
      (err) => {
        assert.equal(err.code, "RUN_NOT_FOUND");
        return true;
      },
    );
  });
});
