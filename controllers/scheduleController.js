const crypto = require('crypto');

const { all, exec, get, run } = require('../db/query');
const { createNotification } = require('../services/notificationService');
const {
  badRequest,
  ensureAccountExists,
  ensureManagerForTeam,
  ensureTeamAccess,
  ensureUserCanViewSchedule,
  ensureValidManagerPassword,
  evaluateShiftMutation,
  evaluateWeekForFinalization,
  getConstraints,
  getMembership,
  getShiftById,
  getTeamSchedule,
  getShiftsInRange,
  getWeekStartDate,
  getWeeklyHoursByUser,
  recordShiftAudit,
  touchScheduleWeek,
} = require('../services/scheduleService');
const { buildWeeklyDates, addDays, assertValidDate } = require('../utils/time');

function buildOverrideResponse(issues) {
  return {
    overrideRequired: true,
    issues,
    message:
      'Schedule changes violate availability or scheduling constraints. Re-submit with overridePassword to confirm.',
  };
}

async function requireOverrideIfNeeded(issues, managerUserId, overridePassword) {
  if (!issues.length) {
    return;
  }

  if (!overridePassword) {
    throw Object.assign(new Error('Override password required.'), {
      statusCode: 409,
      payload: buildOverrideResponse(issues),
    });
  }

  await ensureValidManagerPassword(managerUserId, overridePassword);
}

async function getEffectiveRole(userId, providedRole) {
  if (providedRole) {
    return providedRole;
  }

  const account = await ensureAccountExists(userId);
  return account.employment_role || account.system_role;
}

exports.getConstraints = async (req, res) => {
  try {
    if (!req.auth) {
      throw badRequest('Authentication required.', 401);
    }

    const teamId = Number(req.params.teamId);
    const viewerUserId = req.auth.userId;

    await ensureTeamAccess(teamId, viewerUserId);
    res.send(await getConstraints(teamId));
  } catch (error) {
    res.status(error.statusCode || 500).send(error.payload || { error: error.message });
  }
};

exports.updateConstraints = async (req, res) => {
  try {
    if (!req.auth) {
      throw badRequest('Authentication required.', 401);
    }

    const teamId = Number(req.params.teamId);
    const {
      hoursWindowDays = 7,
      minHoursPerWindow = null,
      maxHoursPerWindow = null,
      minStaffPerHour = null,
      maxStaffPerHour = null,
      businessHours = null,
      roleRequirements = null,
    } = req.body;

    const managerUserId = req.auth.userId;

    await ensureManagerForTeam(teamId, Number(managerUserId));

    await exec('BEGIN TRANSACTION');

    try {
      await run(
        `
          INSERT INTO schedule_constraints (
            team_id,
            min_hours_per_window,
            max_hours_per_window,
            hours_window_days,
            min_staff_per_hour,
            max_staff_per_hour,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(team_id)
          DO UPDATE SET
            min_hours_per_window = excluded.min_hours_per_window,
            max_hours_per_window = excluded.max_hours_per_window,
            hours_window_days = excluded.hours_window_days,
            min_staff_per_hour = excluded.min_staff_per_hour,
            max_staff_per_hour = excluded.max_staff_per_hour,
            updated_at = CURRENT_TIMESTAMP
        `,
        [
          teamId,
          minHoursPerWindow,
          maxHoursPerWindow,
          hoursWindowDays,
          minStaffPerHour,
          maxStaffPerHour,
        ]
      );

      if (businessHours) {
        await run(`DELETE FROM business_hours WHERE team_id = ?`, [teamId]);

        for (const entry of businessHours) {
          await run(
            `
              INSERT INTO business_hours (team_id, day_of_week, is_open, start_time, end_time)
              VALUES (?, ?, ?, ?, ?)
            `,
            [
              teamId,
              entry.dayOfWeek,
              entry.isOpen ? 1 : 0,
              entry.startTime || null,
              entry.endTime || null,
            ]
          );
        }
      }

      if (roleRequirements) {
        await run(`DELETE FROM role_requirements WHERE team_id = ?`, [teamId]);

        for (const requirement of roleRequirements) {
          await run(
            `
              INSERT INTO role_requirements (
                team_id,
                role_name,
                day_of_week,
                start_time,
                end_time,
                min_employees
              )
              VALUES (?, ?, ?, ?, ?, ?)
            `,
            [
              teamId,
              requirement.roleName,
              requirement.dayOfWeek ?? null,
              requirement.startTime || null,
              requirement.endTime || null,
              requirement.minEmployees || 1,
            ]
          );
        }
      }

      await exec('COMMIT');
      res.send(await getConstraints(teamId));
    } catch (error) {
      await exec('ROLLBACK');
      throw error;
    }
  } catch (error) {
    res.status(error.statusCode || 500).send(error.payload || { error: error.message });
  }
};

exports.createShift = async (req, res) => {
  try {
    if (!req.auth) {
      throw badRequest('Authentication required.', 401);
    }

    const {
      teamId,
      userId,
      shiftDate,
      startTime,
      endTime,
      employmentRole,
      repeatWeekly = false,
      repeatUntil,
      overridePassword,
    } = req.body;

    const managerUserId = req.auth.userId;

    if (!teamId || !userId || !shiftDate || !startTime || !endTime) {
      throw badRequest(
        'teamId, userId, shiftDate, startTime, and endTime are required.'
      );
    }

    if (repeatWeekly && !repeatUntil) {
      throw badRequest('repeatUntil is required when repeatWeekly is true.');
    }

    await ensureManagerForTeam(Number(teamId), Number(managerUserId));

    const member = await getMembership(Number(teamId), Number(userId));
    if (!member) {
      throw badRequest('The selected employee does not belong to this team.', 400);
    }

    const effectiveRole = await getEffectiveRole(Number(userId), employmentRole);
    const dates = repeatWeekly ? buildWeeklyDates(shiftDate, repeatUntil) : [shiftDate];
    const recurringGroupId = repeatWeekly ? crypto.randomUUID() : null;
    const issues = [];

    for (const date of dates) {
      const shiftIssues = await evaluateShiftMutation({
        teamId: Number(teamId),
        candidateShift: {
          userId: Number(userId),
          shiftDate: date,
          startTime,
          endTime,
          employmentRole: effectiveRole,
        },
      });
      issues.push(...shiftIssues);
    }

    await requireOverrideIfNeeded(issues, Number(managerUserId), overridePassword);

    await exec('BEGIN TRANSACTION');

    try {
      const createdShiftIds = [];

      for (const date of dates) {
        const result = await run(
          `
            INSERT INTO shifts (
              team_id,
              user_id,
              shift_date,
              start_time,
              end_time,
              employment_role,
              recurring_group_id,
              created_by_user_id,
              updated_by_user_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            teamId,
            userId,
            date,
            startTime,
            endTime,
            effectiveRole,
            recurringGroupId,
            managerUserId,
            managerUserId,
          ]
        );

        createdShiftIds.push(result.lastID);

        const weekStartDate = getWeekStartDate(date);
        await touchScheduleWeek(Number(teamId), weekStartDate);
        await recordShiftAudit({
          teamId: Number(teamId),
          userId: Number(userId),
          shiftId: result.lastID,
          weekStartDate,
          action: 'create',
          summary: `Shift created for ${date} from ${startTime} to ${endTime}.`,
          createdByUserId: Number(managerUserId),
        });
      }

      await exec('COMMIT');

      res.status(201).send({
        createdShiftIds,
        recurringGroupId,
        weekSummary: await getTeamSchedule(Number(teamId), getWeekStartDate(shiftDate)),
      });
    } catch (error) {
      await exec('ROLLBACK');
      throw error;
    }
  } catch (error) {
    res.status(error.statusCode || 500).send(error.payload || { error: error.message });
  }
};

exports.updateShift = async (req, res) => {
  try {
    if (!req.auth) {
      throw badRequest('Authentication required.', 401);
    }

    const shiftId = Number(req.params.shiftId);
    const {
      userId,
      shiftDate,
      startTime,
      endTime,
      employmentRole,
      overridePassword,
    } = req.body;

    const managerUserId = req.auth.userId;

    const existingShift = await getShiftById(shiftId);

    if (!existingShift) {
      throw badRequest('Shift was not found.', 404);
    }

    await ensureManagerForTeam(existingShift.team_id, Number(managerUserId));

    const nextUserId = userId ? Number(userId) : existingShift.user_id;
    const nextDate = shiftDate || existingShift.shift_date;
    const nextStartTime = startTime || existingShift.start_time;
    const nextEndTime = endTime || existingShift.end_time;
    const nextRole = await getEffectiveRole(
      nextUserId,
      employmentRole || existingShift.employment_role
    );

    const issues = await evaluateShiftMutation({
      teamId: existingShift.team_id,
      candidateShift: {
        id: shiftId,
        userId: nextUserId,
        shiftDate: nextDate,
        startTime: nextStartTime,
        endTime: nextEndTime,
        employmentRole: nextRole,
      },
      excludedShiftId: shiftId,
      removedShift: existingShift,
    });

    await requireOverrideIfNeeded(issues, Number(managerUserId), overridePassword);

    await exec('BEGIN TRANSACTION');

    try {
      await run(
        `
          UPDATE shifts
          SET
            user_id = ?,
            shift_date = ?,
            start_time = ?,
            end_time = ?,
            employment_role = ?,
            updated_by_user_id = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [
          nextUserId,
          nextDate,
          nextStartTime,
          nextEndTime,
          nextRole,
          managerUserId,
          shiftId,
        ]
      );

      const oldWeekStart = getWeekStartDate(existingShift.shift_date);
      const newWeekStart = getWeekStartDate(nextDate);

      await touchScheduleWeek(existingShift.team_id, oldWeekStart);
      if (newWeekStart !== oldWeekStart) {
        await touchScheduleWeek(existingShift.team_id, newWeekStart);
      }

      await recordShiftAudit({
        teamId: existingShift.team_id,
        userId: nextUserId,
        shiftId,
        weekStartDate: newWeekStart,
        action: 'update',
        summary: `Shift updated to ${nextDate} from ${nextStartTime} to ${nextEndTime}.`,
        createdByUserId: Number(managerUserId),
      });

      await exec('COMMIT');

      res.send({
        shift: await getShiftById(shiftId),
        weekSummary: await getTeamSchedule(existingShift.team_id, newWeekStart),
      });
    } catch (error) {
      await exec('ROLLBACK');
      throw error;
    }
  } catch (error) {
    res.status(error.statusCode || 500).send(error.payload || { error: error.message });
  }
};

exports.deleteShift = async (req, res) => {
  try {
    if (!req.auth) {
      throw badRequest('Authentication required.', 401);
    }

    const shiftId = Number(req.params.shiftId);
    const managerUserId = req.auth.userId;
    const { overridePassword } = req.body;

    const existingShift = await getShiftById(shiftId);

    if (!existingShift) {
      throw badRequest('Shift was not found.', 404);
    }

    await ensureManagerForTeam(existingShift.team_id, Number(managerUserId));

    const issues = await evaluateShiftMutation({
      teamId: existingShift.team_id,
      removedShift: existingShift,
      excludedShiftId: shiftId,
    });
    //
    await requireOverrideIfNeeded(issues, Number(managerUserId), overridePassword);

    await exec('BEGIN TRANSACTION');

    try {
      await run(`DELETE FROM shifts WHERE id = ?`, [shiftId]);

      const weekStartDate = getWeekStartDate(existingShift.shift_date);
      await touchScheduleWeek(existingShift.team_id, weekStartDate);
      await recordShiftAudit({
        teamId: existingShift.team_id,
        userId: existingShift.user_id,
        shiftId,
        weekStartDate,
        action: 'delete',
        summary: `Shift deleted for ${existingShift.shift_date}.`,
        createdByUserId: Number(managerUserId),
      });

      await exec('COMMIT');

      res.send({
        message: 'Shift deleted.',
        weekSummary: await getTeamSchedule(existingShift.team_id, weekStartDate),
      });
    } catch (error) {
      await exec('ROLLBACK');
      throw error;
    }
  } catch (error) {
    res.status(error.statusCode || 500).send(error.payload || { error: error.message });
  }
};

exports.getTeamSchedule = async (req, res) => {
  try {
    if (!req.auth) {
      throw badRequest('Authentication required.', 401);
    }

    const teamId = Number(req.params.teamId);
    const viewerUserId = req.auth.userId;
    const weekStartDate = req.query.weekStartDate || getWeekStartDate(new Date().toISOString().slice(0, 10));

    assertValidDate(weekStartDate);
    await ensureTeamAccess(teamId, viewerUserId);
    res.send(await getTeamSchedule(teamId, weekStartDate));
  } catch (error) {
    res.status(error.statusCode || 500).send(error.payload || { error: error.message });
  }
};

exports.getUserSchedule = async (req, res) => {
  try {
    if (!req.auth) {
      throw badRequest('Authentication required.', 401);
    }

    const userId = Number(req.params.userId);
    const viewerUserId = req.auth.userId;
    const teamId = req.query.teamId ? Number(req.query.teamId) : null;
    const weekStartDate = req.query.weekStartDate || getWeekStartDate(new Date().toISOString().slice(0, 10));

    assertValidDate(weekStartDate);
    const resolvedTeamId = await ensureUserCanViewSchedule(viewerUserId, userId, teamId);
    const weekEndDate = addDays(weekStartDate, 6);

    const [allShifts, totals] = await Promise.all([
      getShiftsInRange(resolvedTeamId, weekStartDate, weekEndDate),
      getWeeklyHoursByUser(resolvedTeamId, weekStartDate),
    ]);

    const userShifts = allShifts
      .filter((shift) => Number(shift.user_id) === userId)
      .map((shift) => ({
        id: shift.id,
        teamId: shift.team_id,
        userId: shift.user_id,
        shiftDate: shift.shift_date,
        startTime: shift.start_time,
        endTime: shift.end_time,
        employmentRole: shift.employment_role,
      }));

    const total = totals.find((entry) => Number(entry.userId) === userId);

    res.send({
      userId,
      teamId: resolvedTeamId,
      weekStartDate,
      weekEndDate,
      totalHours: total?.totalHours || 0,
      shifts: userShifts,
    });
  } catch (error) {
    res.status(error.statusCode || 500).send(error.payload || { error: error.message });
  }
};

exports.finalizeSchedule = async (req, res) => {
  try {
    if (!req.auth) {
      throw badRequest('Authentication required.', 401);
    }

    const { teamId, weekStartDate, /*managerPassword,*/ overridePassword } = req.body;
    const managerUserId = req.auth.userId;

    if (!teamId || !weekStartDate /*|| !managerPassword*/) {
      //throw badRequest('teamId, weekStartDate/*, and managerPassword are required.');
      throw badRequest('teamId and weekStartDate are required.');
    }

    assertValidDate(weekStartDate);
    await ensureManagerForTeam(Number(teamId), Number(managerUserId));
    //await ensureValidManagerPassword(Number(managerUserId), managerPassword);

    const issues = [];

    if (!overridePassword) {
      weekIssues = await evaluateWeekForFinalization(Number(teamId), weekStartDate);

      /*if (issues.length) {
        return res.status(409).send({
          issues,
          message: 'The schedule cannot be finalized until these issues are resolved.',
        });
      }*/
      issues.push(...weekIssues);
      await requireOverrideIfNeeded(issues, Number(managerUserId), overridePassword);      
    }
    const priorWeek = await get(
      `
        SELECT finalized_at
        FROM schedule_weeks
        WHERE team_id = ? AND week_start_date = ?
      `,
      [teamId, weekStartDate]
    );

    await exec('BEGIN TRANSACTION');

    try {
      await run(
        `
          INSERT INTO schedule_weeks (
            team_id,
            week_start_date,
            finalized_at,
            finalized_by_user_id,
            last_change_at
          )
          VALUES (?, ?, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(team_id, week_start_date)
          DO UPDATE SET
            finalized_at = CURRENT_TIMESTAMP,
            finalized_by_user_id = excluded.finalized_by_user_id,
            last_change_at = CURRENT_TIMESTAMP
        `,
        [teamId, weekStartDate, managerUserId]
      );

      const changedUsers = await all(
        `
          SELECT DISTINCT user_id
          FROM shift_audit_logs
          WHERE team_id = ?
            AND week_start_date = ?
            AND created_at > COALESCE(?, '1970-01-01T00:00:00.000Z')
        `,
        [teamId, weekStartDate, priorWeek?.finalized_at || null]
      );

      for (const row of changedUsers) {
        await createNotification({
          userId: row.user_id,
          teamId: Number(teamId),
          notificationType: 'schedule_finalized',
          subject: `Your schedule changed for the week of ${weekStartDate}`,
          message: `Your schedule was updated and finalized for the week starting ${weekStartDate}.`,
          metadata: {
            weekStartDate,
          },
        });
      }

      await exec('COMMIT');

      res.send({
        message: 'Schedule finalized successfully.',
        schedule: await getTeamSchedule(Number(teamId), weekStartDate),
      });
    } catch (error) {
      await exec('ROLLBACK');
      throw error;
    }
  } catch (error) {
    res.status(error.statusCode || 500).send(error.payload || { error: error.message });
  }
};
