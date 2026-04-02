const { get, run } = require('../db/query');
const { createNotification } = require('../services/notificationService');
const {
  clearSessionCookie,
  createSession,
  destroySessionById,
  destroySessionsForUser,
  setSessionCookie,
} = require('../services/sessionService');
const {
  badRequest,
  generateUniqueUsername,
  getAccountByIdentifier,
  getMembershipsForUser,
  serializeAccount,
} = require('../services/scheduleService');
const {
  generateNumericCode,
  hashPassword,
  verifyPassword,
} = require('../utils/passwords');

async function sendAuthenticatedResponse(req, res, account, statusCode = 200) {
  const session = await createSession(account.id, {
    userAgent: req.headers['user-agent'] || null,
    ipAddress: req.ip || null,
  });

  setSessionCookie(res, session.token);

  res.status(statusCode).send({
    user: serializeAccount(account),
    memberships: await getMembershipsForUser(account.id),
    session: {
      expiresAt: session.expiresAt,
    },
  });
}

exports.registerManager = async (req, res) => {
  try {
    const {
      primaryEmail,
      password,
      phoneNumber,
      secondaryEmail,
      fullName,
      username,
      employmentRole,
    } = req.body;

    if (!primaryEmail || !password || !phoneNumber || !secondaryEmail || !fullName) {
      throw badRequest(
        'primaryEmail, password, phoneNumber, secondaryEmail, and fullName are required.'
      );
    }

    const existingEmail = await get(
      `SELECT id FROM accounts WHERE primary_email = ?`,
      [primaryEmail]
    );

    if (existingEmail) {
      throw badRequest('That primary email is already in use.', 409);
    }

    const finalUsername = username
      ? await generateUniqueUsername(username)
      : await generateUniqueUsername(primaryEmail.split('@')[0]);

    const result = await run(
      `
        INSERT INTO accounts (
          primary_email,
          secondary_email,
          username,
          password_hash,
          phone_number,
          full_name,
          system_role,
          employment_role
        )
        VALUES (?, ?, ?, ?, ?, ?, 'manager', ?)
      `,
      [
        primaryEmail,
        secondaryEmail,
        finalUsername,
        hashPassword(password),
        phoneNumber,
        fullName,
        employmentRole || 'Manager',
      ]
    );

    const account = await get(
      `SELECT * FROM accounts WHERE id = ?`,
      [result.lastID]
    );

    await sendAuthenticatedResponse(req, res, account, 201);
  } catch (error) {
    res.status(error.statusCode || 500).send({ error: error.message });
  }
};

exports.authenticateUser = async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      throw badRequest('identifier and password are required.');
    }

    const account = await getAccountByIdentifier(identifier);

    if (!account || !verifyPassword(password, account.password_hash)) {
      throw badRequest('Invalid credentials.', 401);
    }

    await sendAuthenticatedResponse(req, res, account);
  } catch (error) {
    res.status(error.statusCode || 500).send({ error: error.message });
  }
};

exports.getCurrentSession = async (req, res) => {
  try {
    if (!req.auth) {
      throw badRequest('Authentication required.', 401);
    }

    res.send({
      user: req.auth.user,
      memberships: await getMembershipsForUser(req.auth.userId),
      session: {
        expiresAt: req.auth.sessionExpiresAt,
      },
    });
  } catch (error) {
    res.status(error.statusCode || 500).send({ error: error.message });
  }
};

exports.logoutUser = async (req, res) => {
  try {
    if (req.auth?.sessionId) {
      await destroySessionById(req.auth.sessionId);
    }

    clearSessionCookie(res);
    res.send({ message: 'Logged out successfully.' });
  } catch (error) {
    res.status(error.statusCode || 500).send({ error: error.message });
  }
};

exports.requestPasswordReset = async (req, res) => {
  try {
    const { primaryEmail } = req.body;

    if (!primaryEmail) {
      throw badRequest('primaryEmail is required.');
    }

    const account = await get(
      `SELECT * FROM accounts WHERE primary_email = ?`,
      [primaryEmail]
    );

    if (!account) {
      throw badRequest('No account was found for that email address.', 404);
    }

    const code = generateNumericCode(6);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000)
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ');

    await run(
      `
        INSERT INTO password_reset_requests (user_id, code, expires_at)
        VALUES (?, ?, ?)
      `,
      [account.id, code, expiresAt]
    );

    const notificationId = await createNotification({
      userId: account.id,
      notificationType: 'password_reset',
      subject: 'Password reset verification',
      message: `Use verification code ${code} to reset your password.`,
      metadata: {
        primaryEmail,
        code,
        expiresAt,
      },
    });

    res.send({
      message: 'Password reset verification created.',
      notificationId,
      resetCode: code,
      expiresAt,
    });
  } catch (error) {
    res.status(error.statusCode || 500).send({ error: error.message });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { primaryEmail, code, newPassword } = req.body;

    if (!primaryEmail || !code || !newPassword) {
      throw badRequest('primaryEmail, code, and newPassword are required.');
    }

    const account = await get(
      `SELECT * FROM accounts WHERE primary_email = ?`,
      [primaryEmail]
    );

    if (!account) {
      throw badRequest('No account was found for that email address.', 404);
    }

    const resetRequest = await get(
      `
        SELECT *
        FROM password_reset_requests
        WHERE user_id = ?
          AND code = ?
          AND used_at IS NULL
          AND datetime(expires_at) >= datetime('now')
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [account.id, code]
    );

    if (!resetRequest) {
      throw badRequest('Reset code is invalid or expired.', 400);
    }

    await run(
      `
        UPDATE accounts
        SET password_hash = ?, requires_password_change = 0, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [hashPassword(newPassword), account.id]
    );

    await destroySessionsForUser(account.id);

    await run(
      `
        UPDATE password_reset_requests
        SET used_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [resetRequest.id]
    );

    res.send({
      message: 'Password updated successfully.',
    });
  } catch (error) {
    res.status(error.statusCode || 500).send({ error: error.message });
  }
};
