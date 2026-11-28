const analysisRepository = require("../repositories/analysisRepository");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validationError(message) {
  return Object.assign(new Error(message), {
    status: 400,
    code: "VALIDATION_ERROR",
  });
}

function parseOptionalDatasetId(value) {
  if (value === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(String(value))) {
    throw validationError("datasetId must be a positive integer");
  }
  return Number(value);
}

function parsePage(value) {
  if (value === undefined) return 1;
  if (!/^[1-9]\d*$/.test(String(value))) {
    throw validationError("page must be an integer of 1 or more");
  }
  return Number(value);
}

function parsePageSize(value) {
  if (value === undefined) return 20;
  if (!/^[1-9]\d*$/.test(String(value))) {
    throw validationError("pageSize must be an integer from 1 to 100");
  }
  const pageSize = Number(value);
  if (pageSize > 100) {
    throw validationError("pageSize must be an integer from 1 to 100");
  }
  return pageSize;
}

function sendError(res, err) {
  return res.status(err.status || 500).json({
    error: err.message || "Failed to load analysis history",
    code: err.code || "INTERNAL_ERROR",
  });
}

function withoutUserId(run) {
  const { userId, ...body } = run;
  return body;
}

const getLatestRun = async (req, res) => {
  try {
    const datasetId = parseOptionalDatasetId(req.query.datasetId);
    const run = await analysisRepository.findLatestRun({
      userId: req.user.sub,
      datasetId,
    });
    return res.status(200).json(withoutUserId(run));
  } catch (err) {
    return sendError(res, err);
  }
};

const listRuns = async (req, res) => {
  try {
    const page = parsePage(req.query.page);
    const pageSize = parsePageSize(req.query.pageSize);
    const datasetId = parseOptionalDatasetId(req.query.datasetId);
    const pageResult = await analysisRepository.listRuns({
      userId: req.user.sub,
      page,
      pageSize,
      datasetId,
    });
    return res.status(200).json(pageResult);
  } catch (err) {
    return sendError(res, err);
  }
};

const getRunById = async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.runId)) {
      throw validationError("runId must be a UUID");
    }
    const run = await analysisRepository.findRunById({
      runId: req.params.runId,
      userId: req.user.sub,
      role: req.user.role,
    });
    return res.status(200).json(withoutUserId(run));
  } catch (err) {
    return sendError(res, err);
  }
};

module.exports = { getLatestRun, listRuns, getRunById };
