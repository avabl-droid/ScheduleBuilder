const express = require('express');
const router = express.Router();

const controller = require('../controllers/teamController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.post('/create', controller.createTeam);
router.get('/:teamId', controller.getTeam);
router.get('/:teamId/members', controller.getTeamMembers);
router.post('/:teamId/members', controller.addMembersToTeam);

module.exports = router;
