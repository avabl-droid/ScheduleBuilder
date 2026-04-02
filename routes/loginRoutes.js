const express = require('express');
const router = express.Router();

const controller = require('../controllers/loginController');
const { requireAuth } = require('../middleware/auth');

router.post('/register-manager', controller.registerManager);
router.post('/login', controller.authenticateUser);
router.get('/session', requireAuth, controller.getCurrentSession);
router.post('/logout', requireAuth, controller.logoutUser);
router.post('/request-password-reset', controller.requestPasswordReset);
router.post('/reset-password', controller.resetPassword);

module.exports = router;
