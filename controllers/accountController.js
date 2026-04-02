const { all, get, run } = require('../db/query');
const {
  badRequest,
  ensureAccountExists,
  ensureUserCanAccessUser,
  getMembershipsForUser,
  serializeAccount,
} = require('../services/scheduleService');
const { hashPassword, verifyPassword } = require('../utils/passwords');
const {
  createSession,
  destroySessionsForUser,
  setSessionCookie,
} = require('../services/sessionService');

exports.getAccount = async (req, res) => {
  try {
    if (!req.auth) {
      throw badRequest('Authentication required.', 401);
    }

    const userId = Number(req.params.userId);
    await ensureUserCanAccessUser(req.auth.userId, userId);
    const account = await ensureAccountExists(userId);
    const memberships = await getMembershipsForUser(userId);

    res.send({
      user: serializeAccount(account),
      memberships,
    });
  } catch (error) {
    res.status(error.statusCode || 500).send({ error: error.message });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    if (!req.auth) {
      throw badRequest('Authentication required.', 401);
    }

    const userId = Number(req.params.userId);
    const {
      fullName,
      phoneNumber,
      secondaryEmail,
      username,
      currentPassword,
      newPassword,
    } = req.body;

    if (Number(req.auth.userId) !== userId) {
      throw badRequest('Users may only update their own profile through this route.', 403);
    }

    const account = await ensureAccountExists(userId);
    const updates = [];
    const params = [];

    if (username || newPassword) {
      if (!currentPassword || !verifyPassword(currentPassword, account.password_hash)) {
        throw badRequest('currentPassword is required to change username or password.', 401);
      }
    }

    if (typeof fullName === 'string' && fullName.trim()) {
      updates.push('full_name = ?');
      params.push(fullName.trim());
    }

    if (typeof phoneNumber === 'string') {
      updates.push('phone_number = ?');
      params.push(phoneNumber.trim() || null);
    }

    if (typeof secondaryEmail === 'string') {
      updates.push('secondary_email = ?');
      params.push(secondaryEmail.trim() || null);
    }

    if (typeof username === 'string' && username.trim()) {
      const existing = await get(
        `SELECT id FROM accounts WHERE username = ? AND id != ?`,
        [username.trim(), userId]
      );

      if (existing) {
        throw badRequest('That username is already taken.', 409);
      }

      updates.push('username = ?');
      params.push(username.trim());
    }

    if (typeof newPassword === 'string' && newPassword) {
      updates.push('password_hash = ?');
      params.push(hashPassword(newPassword));
      updates.push('requires_password_change = 0');
    }

    if (!updates.length) {
      throw badRequest('No profile changes were provided.');
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(userId);

    await run(
      `
        UPDATE accounts
        SET ${updates.join(', ')}
        WHERE id = ?
      `,
      params
    );

    if (newPassword) {
      await destroySessionsForUser(userId);
      const session = await createSession(userId, {
        userAgent: req.headers['user-agent'] || null,
        ipAddress: req.ip || null,
      });
      setSessionCookie(res, session.token);
    }

    const updatedAccount = await ensureAccountExists(userId);

    res.send({
      user: serializeAccount(updatedAccount),
    });
  } catch (error) {
    res.status(error.statusCode || 500).send({ error: error.message });
  }
};

exports.completeSetup = async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    const { temporaryPassword, username, newPassword, phoneNumber, secondaryEmail } = req.body;

    if (req.auth && Number(req.auth.userId) !== userId) {
      throw badRequest('You cannot complete setup for another user.', 403);
    }

    if (!temporaryPassword || !username || !newPassword || !phoneNumber || !secondaryEmail) {
      throw badRequest(
        'temporaryPassword, username, newPassword, phoneNumber, and secondaryEmail are required.'
      );
    }

    const account = await ensureAccountExists(userId);

    if (!verifyPassword(temporaryPassword, account.password_hash)) {
      throw badRequest('Temporary password is incorrect.', 401);
    }

    const existing = await get(
      `SELECT id FROM accounts WHERE username = ? AND id != ?`,
      [username, userId]
    );

    if (existing) {
      throw badRequest('That username is already taken.', 409);
    }

    await run(
      `
        UPDATE accounts
        SET
          username = ?,
          password_hash = ?,
          phone_number = ?,
          secondary_email = ?,
          requires_profile_completion = 0,
          requires_password_change = 0,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [username, hashPassword(newPassword), phoneNumber, secondaryEmail, userId]
    );

    await destroySessionsForUser(userId);
    const session = await createSession(userId, {
      userAgent: req.headers['user-agent'] || null,
      ipAddress: req.ip || null,
    });
    setSessionCookie(res, session.token);

    const updatedAccount = await ensureAccountExists(userId);

    res.send({
      user: serializeAccount(updatedAccount),
      memberships: await getMembershipsForUser(userId),
      session: {
        expiresAt: session.expiresAt,
      },
    });
  } catch (error) {
    res.status(error.statusCode || 500).send({ error: error.message });
  }
};

exports.getNotifications = async (req, res) => {
  try {
    if (!req.auth) {
      throw badRequest('Authentication required.', 401);
    }

    const userId = Number(req.params.userId);
    await ensureUserCanAccessUser(req.auth.userId, userId);
    await ensureAccountExists(userId);

    const rows = await all(
      `
        SELECT *
        FROM notifications
        WHERE user_id = ?
        ORDER BY created_at DESC, id DESC
      `,
      [userId]
    );

    res.send({
      notifications: rows.map((row) => ({
        id: row.id,
        type: row.notification_type,
        channel: row.channel,
        subject: row.subject,
        message: row.message,
        metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
        status: row.status,
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    res.status(error.statusCode || 500).send({ error: error.message });
  }
};
