const express = require('express');
const router = express.Router();

const controller = require('../controllers/teamController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.post('/create', controller.createTeam);
router.get('/:teamId', controller.getTeam);
router.get('/:teamId/members', controller.getTeamMembers);
router.post('/:teamId/members', controller.addMembersToTeam);
//router.delete('/shifts/:shiftId', controller.deleteShift);
router.delete('/:teamId/members/:memberId', controller.deleteTeamMember);

module.exports = router;
