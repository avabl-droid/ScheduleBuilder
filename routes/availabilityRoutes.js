const express = require('express');
const router = express.Router();

const controller = require('../controllers/availabilityController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/:userId', controller.getAvailability);
router.put('/:userId', controller.updateAvailability);

module.exports = router;
