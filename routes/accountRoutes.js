const express = require('express');
const router = express.Router();

const controller = require('../controllers/accountController');
const { requireAuth } = require('../middleware/auth');

router.post('/:userId/complete-setup', controller.completeSetup);
router.use(requireAuth);
router.get('/:userId', controller.getAccount);
router.patch('/:userId/profile', controller.updateProfile);
router.get('/:userId/notifications', controller.getNotifications);

module.exports = router;
