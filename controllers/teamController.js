const { exec, get, run } = require('../db/query');
const { createNotification } = require('../services/notificationService');
const {
  badRequest,
  ensureAccountExists,
  ensureManagerForTeam,
  generateUniqueUsername,
  getConstraints,
  getTeamById,
  getTeamMembers,
  getMembership,
  serializeAccount,
} = require('../services/scheduleService');
const { generateTemporaryPassword, hashPassword } = require('../utils/passwords');

exports.createTeam = async (req, res) => {
  try {
    if (!req.auth) {
      throw badRequest('Authentication required.', 401);
    }

    const managerUserId = req.auth.userId;
    const { name } = req.body;

    if (!name) {
      throw badRequest('name is required.');
    }

    const manager = await ensureAccountExists(Number(managerUserId));

    if (manager.system_role !== 'manager') {
      throw badRequest('Only a manager account can create a team.', 403);
    }

    const existingManagedTeam = await get(
      `SELECT id FROM teams WHERE manager_user_id = ?`,
      [managerUserId]
    );

    if (existingManagedTeam) {
      throw badRequest('This manager already owns a team in the current backend.', 409);
    }

    await exec('BEGIN TRANSACTION');

    try {
      const teamResult = await run(
        `
          INSERT INTO teams (name, manager_user_id)
          VALUES (?, ?)
        `,
        [name, managerUserId]
      );

      await run(
        `
          INSERT INTO team_memberships (team_id, user_id, is_manager)
          VALUES (?, ?, 1)
        `,
        [teamResult.lastID, managerUserId]
      );

      await exec('COMMIT');

      res.status(201).send({
        team: {
          id: teamResult.lastID,
          name,
          managerUserId: Number(managerUserId),
        },
      });
    } catch (error) {
      await exec('ROLLBACK');
      throw error;
    }
  } catch (error) {
    res.status(error.statusCode || 500).send({ error: error.message });
  }
};

exports.addMembersToTeam = async (req, res) => {
  try {
    if (!req.auth) {
      throw badRequest('Authentication required.', 401);
    }

    const teamId = Number(req.params.teamId);
    const managerUserId = req.auth.userId;
    const { members } = req.body;

    if (!Array.isArray(members) || !members.length) {
      throw badRequest('A non-empty members array is required.');
    }

    await ensureManagerForTeam(teamId, Number(managerUserId));
    const team = await getTeamById(teamId);

    await exec('BEGIN TRANSACTION');

    try {
      const createdMembers = [];

      for (const member of members) {
        if (!member.primaryEmail || !member.fullName || !member.employmentRole) {
          throw badRequest(
            'Each member requires primaryEmail, fullName, and employmentRole.'
          );
        }

        const existingEmail = await get(
          `SELECT id FROM accounts WHERE primary_email = ?`,
          [member.primaryEmail]
        );

        if (existingEmail) {
          throw badRequest(`An account already exists for ${member.primaryEmail}.`, 409);
        }

        const username = await generateUniqueUsername(member.fullName);
        const temporaryPassword = generateTemporaryPassword();

        const accountResult = await run(
          `
            INSERT INTO accounts (
              primary_email,
              username,
              password_hash,
              full_name,
              system_role,
              employment_role,
              created_by_user_id,
              requires_profile_completion,
              requires_password_change
            )
            VALUES (?, ?, ?, ?, 'team_member', ?, ?, 1, 1)
          `,
          [
            member.primaryEmail,
            username,
            hashPassword(temporaryPassword),
            member.fullName,
            member.employmentRole,
            managerUserId,
          ]
        );

        await run(
          `
            INSERT INTO team_memberships (team_id, user_id, is_manager)
            VALUES (?, ?, 0)
          `,
          [teamId, accountResult.lastID]
        );

        const notificationId = await createNotification({
          userId: accountResult.lastID,
          teamId,
          notificationType: 'invitation',
          subject: `Invitation to join ${team.name}`,
          message: `You were added to ${team.name}. Use username ${username} and the temporary password provided to sign in.`,
          metadata: {
            loginLink: '/login',
            temporaryUsername: username,
            temporaryPassword,
            teamName: team.name,
          },
        });

        createdMembers.push({
          user: serializeAccount(await ensureAccountExists(accountResult.lastID)),
          temporaryCredentials: {
            username,
            password: temporaryPassword,
          },
          notificationId,
        });
      }

      await exec('COMMIT');

      res.status(201).send({
        teamId,
        createdMembers,
      });
    } catch (error) {
      await exec('ROLLBACK');
      throw error;
    }
  } catch (error) {
    res.status(error.statusCode || 500).send({ error: error.message });
  }
};

exports.getTeam = async (req, res) => {
  try {
    if (!req.auth) {
      throw badRequest('Authentication required.', 401);
    }

    const teamId = Number(req.params.teamId);
    const viewerUserId = req.auth.userId;

    const membership = await getMembership(teamId, viewerUserId);
    if (!membership) {
      throw badRequest('You do not belong to this team.', 403);
    }

    const [team, members, constraints] = await Promise.all([
      getTeamById(teamId),
      getTeamMembers(teamId),
      getConstraints(teamId),
    ]);

    if (!team) {
      throw badRequest('Team was not found.', 404);
    }

    res.send({
      team: {
        id: team.id,
        name: team.name,
        managerUserId: team.manager_user_id,
      },
      members,
      constraints,
    });
  } catch (error) {
    res.status(error.statusCode || 500).send({ error: error.message });
  }
};

exports.getTeamMembers = async (req, res) => {
  try {
    if (!req.auth) {
      throw badRequest('Authentication required.', 401);
    }

    const teamId = Number(req.params.teamId);
    const viewerUserId = req.auth.userId;

    const membership = await getMembership(teamId, viewerUserId);
    if (!membership) {
      throw badRequest('You do not belong to this team.', 403);
    }

    res.send({
      teamId,
      members: await getTeamMembers(teamId),
    });
  } catch (error) {
    res.status(error.statusCode || 500).send({ error: error.message });
  }
};
