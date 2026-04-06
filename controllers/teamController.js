const { exec, get, run, all } = require('../db/query');
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

exports.deleteTeamMember = async (req, res) => {
  try {
    if (!req.auth) {
      throw badRequest('Authentication required.', 401);
    }

    const teamId = Number(req.params.teamId);
    const memberUserId = Number(req.params.memberId);
    const managerUserId = req.auth.userId;
    const { deleteFutureShiftsOnly = true } = req.body; // По умолчанию удаляем только будущие смены


    await ensureManagerForTeam(teamId, Number(managerUserId));

    if (memberUserId === managerUserId) {
      throw badRequest('You cannot remove yourself from the team.', 400);
    }
    const membership = await getMembership(teamId, memberUserId);
    if (!membership) {
      throw badRequest('Team member not found.', 404);
    }

    /*const account = await getAccountById(memberUserId);
    if (!account) {
      throw badRequest('User not found.', 404);
    }*/

    await exec('BEGIN TRANSACTION');

    try {
      const today = new Date().toISOString().slice(0, 10);
      var shiftsToDelete = [];
      var shiftsKept = [];

      if (deleteFutureShiftsOnly) {
        // Удаляем только будущие смены - включая сегодня
        shiftsToDelete = await all(
          `SELECT id, shift_date FROM shifts WHERE team_id = ? AND user_id = ? AND shift_date >= ?`,
          [teamId, memberUserId, today]
        );
        // Сохраняем прошлые смены
        shiftsKept = await all(
          `SELECT id, shift_date FROM shifts WHERE team_id = ? AND user_id = ? AND shift_date < ?`,
          [teamId, memberUserId, today]
        );
        if (!shiftsToDelete) {
          shiftsToDelete=[];
        }
        if (!shiftsKept) {
          shiftsKept =[];
        }
      } else {
        // Удаляем все смены
        shiftsToDelete = await all(
          `SELECT id, shift_date FROM shifts WHERE team_id = ? AND user_id = ?`,
          [teamId, memberUserId]
        );
      }

      // Удаляем выбранные смены
      if (shiftsToDelete.length > 0) {
        const placeholders = shiftsToDelete.map(() => '?').join(',');
        const shiftIds = shiftsToDelete.map(s => s.id);
        await run(          
          `DELETE FROM shifts WHERE id IN (${placeholders})`,
          shiftIds
        );
        console.log("deleted shifts", shiftIds);
      }

      // Удаляем availability участника (опционально)
      await run(`DELETE FROM availability WHERE user_id = ?`, [memberUserId]);

      // Удаляем членство в команде
      await run(`DELETE FROM team_memberships WHERE team_id = ? AND user_id = ?`, [teamId, memberUserId]);

      // Записываем аудит удаления shifts
      //const weekStartDate = getWeekStartDate(today);
      //await touchScheduleWeek(teamId, weekStartDate);
      
      /*await recordShiftAudit({
        teamId,
        userId: memberUserId,
        shiftId: null,
        weekStartDate,
        action: 'delete_member',
        summary: deleteFutureShiftsOnly 
          ? `Team member was removed. ${shiftsToDelete.length} future shifts deleted, ${shiftsKept.length} past shifts preserved.`
          : `Team member was removed. All ${shiftsToDelete.length} shifts deleted.`,
        createdByUserId: Number(managerUserId),
      });*/

      // Создаем уведомление для удаленного пользователя
      await createNotification({
        userId: memberUserId,
        teamId,
        notificationType: 'team_removed',
        subject: `You were removed from the team`,
        message: deleteFutureShiftsOnly
          ? `You have been removed from the team. Your future shifts have been cancelled, but your past shifts remain in the records.`
          : `You have been removed from the team. All your shifts have been deleted.`,
        metadata: {
          teamId,
          removedBy: managerUserId,
          futureShiftsDeleted: shiftsToDelete.length,
          pastShiftsPreserved: shiftsKept.length,
        },
      });

      await exec('COMMIT');

      res.send({
        message: deleteFutureShiftsOnly
          ? `Team member removed. ${shiftsToDelete.length} future shifts deleted, ${shiftsKept.length} past shifts preserved.`
          : `Team member removed. All ${shiftsToDelete.length} shifts deleted.`,
        userId: memberUserId,
        futureShiftsDeleted: shiftsToDelete.length,
        pastShiftsPreserved: shiftsKept.length,
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
