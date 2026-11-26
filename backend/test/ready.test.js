const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

process.env.JWT_SECRET ||= "test-only-secret-not-for-production";

const app = require("../src/app");
const db = require("../src/db/pool");

function listen(server) {
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(server.address().port)),
  );
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function getReady() {
  const server = http.createServer(app);
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/ready`);
    const body = await response.json();
    return { status: response.status, body };
  } finally {
    await close(server);
  }
}

test("GET /ready returns ready when the database answers", async () => {
  const originalQuery = db.query;
  db.query = async (sql) => {
    assert.equal(sql, "SELECT 1");
    return { rows: [{ "?column?": 1 }] };
  };

  try {
    const { status, body } = await getReady();
    assert.equal(status, 200);
    assert.deepEqual(body, { status: "ready" });
  } finally {
    db.query = originalQuery;
  }
});

test("GET /ready returns not ready when the database connection fails", async () => {
  const originalQuery = db.query;
  db.query = async () => {
    throw new Error("connect ECONNREFUSED");
  };

  try {
    const { status, body } = await getReady();
    assert.equal(status, 503);
    assert.deepEqual(body, {
      error: {
        code: "READY_DEPENDENCY_UNAVAILABLE",
        message: "PostgreSQL is unavailable.",
      },
    });
  } finally {
    db.query = originalQuery;
  }
});
