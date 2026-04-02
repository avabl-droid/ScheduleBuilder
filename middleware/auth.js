const { serializeAccount } = require('../services/scheduleService');
const {
  clearSessionCookie,
  getSessionByToken,
  getSessionTokenFromRequest,
} = require('../services/sessionService');

async function attachSession(req, res, next) {
  try {
    const token = getSessionTokenFromRequest(req);

    if (!token) {
      req.auth = null;
      next();
      return;
    }

    const session = await getSessionByToken(token);

    if (!session) {
      clearSessionCookie(res);
      req.auth = null;
      next();
      return;
    }

    req.auth = {
      sessionId: session.id,
      userId: session.user_id,
      token,
      user: serializeAccount({
        id: session.account_id,
        primary_email: session.primary_email,
        secondary_email: session.secondary_email,
        username: session.username,
        phone_number: session.phone_number,
        full_name: session.full_name,
        system_role: session.system_role,
        employment_role: session.employment_role,
        requires_profile_completion: session.requires_profile_completion,
        requires_password_change: session.requires_password_change,
        created_at: session.created_at,
        updated_at: session.updated_at,
      }),
      sessionExpiresAt: session.expires_at,
    };

    next();
  } catch (error) {
    next(error);
  }
}

function requireAuth(req, res, next) {
  if (!req.auth) {
    return res.status(401).send({ error: 'Authentication required.' });
  }

  next();
}

module.exports = {
  attachSession,
  requireAuth,
};
