const express = require('express');
const router = express.Router();

const { analyse } = require('../controllers/analyseController');
const {
  getLatestRun,
  listRuns,
  getRunById,
} = require('../controllers/analysisHistoryController');
const authMiddleware = require('../middleware/authMiddleware');

// POST /api/analyse
router.post('/analyse', authMiddleware, analyse);

router.get('/analysis/runs/latest', authMiddleware, getLatestRun);
router.get('/analysis/runs', authMiddleware, listRuns);
router.get('/analysis/runs/:runId', authMiddleware, getRunById);

module.exports = router;
