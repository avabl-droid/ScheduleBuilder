const express = require('express');
const router = express.Router();

const controller = require('../controllers/scheduleController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/constraints/:teamId', controller.getConstraints);
router.put('/constraints/:teamId', controller.updateConstraints);
router.post('/shifts', controller.createShift);
router.put('/shifts/:shiftId', controller.updateShift);
router.delete('/shifts/:shiftId', controller.deleteShift);
router.get('/team/:teamId', controller.getTeamSchedule);
router.get('/user/:userId', controller.getUserSchedule);
router.post('/finalize', controller.finalizeSchedule);

module.exports = router;
