const { all, get, run } = require('../db/query');
const { verifyPassword } = require('../utils/passwords');
const {
  addDays,
  assertValidDate,
  assertValidTime,
  calculateDurationHours,
  getDayOfWeek,
  getHourSlots,
  getWeekStartDate,
  getWindowStartDate,
  isRangeWithin,
  rangesOverlap,
} = require('../utils/time');

function badRequest(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function dedupeIssues(issues) {
  const seen = new Set();
  const deduped = [];

  for (const issue of issues) {
    const key = JSON.stringify(issue);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(issue);
  }

  return deduped;
}

function serializeAccount(account) {
  if (!account) {
    return null;
  }

  return {
    id: account.id,
    primaryEmail: account.primary_email,
    secondaryEmail: account.secondary_email,
    username: account.username,
    phoneNumber: account.phone_number,
    fullName: account.full_name,
    systemRole: account.system_role,
    employmentRole: account.employment_role,
    requiresProfileCompletion: Boolean(account.requires_profile_completion),
    requiresPasswordChange: Boolean(account.requires_password_change),
    createdAt: account.created_at,
    updatedAt: account.updated_at,
  };
}

function serializeMembership(row) {
  return {
    teamId: row.team_id,
    teamName: row.team_name,
    isManager: Boolean(row.is_manager),
  };
}

function serializeShift(row) {
  return {
    id: row.id,
    teamId: row.team_id,
    userId: row.user_id,
    shiftDate: row.shift_date,
    startTime: row.start_time,
    endTime: row.end_time,
    employmentRole: row.employment_role,
    recurringGroupId: row.recurring_group_id,
    fullName: row.full_name,
    username: row.username,
  };
}

async function getAccountById(userId, includePasswordHash = false) {
  const columns = includePasswordHash ? 'a.*' : `
    a.id,
    a.primary_email,
    a.secondary_email,
    a.username,
    a.phone_number,
    a.full_name,
    a.system_role,
    a.employment_role,
    a.requires_profile_completion,
    a.requires_password_change,
    a.created_at,
    a.updated_at
  `;

  return get(`SELECT ${columns} FROM accounts a WHERE a.id = ?`, [userId]);
}

async function getAccountByIdentifier(identifier) {
  return get(
    `
      SELECT *
      FROM accounts
      WHERE primary_email = ? OR username = ?
    `,
    [identifier, identifier]
  );
}

async function getMembershipsForUser(userId) {
  const rows = await all(
    `
      SELECT
        tm.team_id,
        tm.is_manager,
        t.name AS team_name
      FROM team_memberships tm
      JOIN teams t ON t.id = tm.team_id
      WHERE tm.user_id = ?
      ORDER BY t.name
    `,
    [userId]
  );

  return rows.map(serializeMembership);
}

async function getMembership(teamId, userId) {
  return get(
    `
      SELECT *
      FROM team_memberships
      WHERE team_id = ? AND user_id = ?
    `,
    [teamId, userId]
  );
}

async function ensureAccountExists(userId) {
  const account = await getAccountById(userId, true);
  if (!account) {
    throw badRequest('User was not found.', 404);
  }
  return account;
}

async function ensureManagerForTeam(teamId, managerUserId) {
  const account = await ensureAccountExists(managerUserId);
  const membership = await getMembership(teamId, managerUserId);

  if (!membership || !membership.is_manager || account.system_role !== 'manager') {
    throw badRequest('Only a manager on this team can perform that action.', 403);
  }

  return account;
}

async function ensureTeamAccess(teamId, viewerUserId) {
  const membership = await getMembership(teamId, viewerUserId);
  if (!membership) {
    throw badRequest('User does not belong to this team.', 403);
  }
  return membership;
}

async function ensureUserCanAccessUser(actorUserId, targetUserId) {
  if (Number(actorUserId) === Number(targetUserId)) {
    return;
  }

  const memberships = await all(
    `
      SELECT tm.team_id
      FROM team_memberships tm
      JOIN team_memberships target_tm ON target_tm.team_id = tm.team_id
      WHERE tm.user_id = ? AND tm.is_manager = 1 AND target_tm.user_id = ?
    `,
    [actorUserId, targetUserId]
  );

  if (!memberships.length) {
    throw badRequest('You do not have permission to update this user.', 403);
  }
}

async function ensureUserCanManageAvailability(actorUserId, targetUserId) {
  await ensureUserCanAccessUser(actorUserId, targetUserId);
}

async function ensureUserCanViewSchedule(viewerUserId, targetUserId, teamId = null) {
  if (Number(viewerUserId) === Number(targetUserId)) {
    if (teamId) {
      const membership = await getMembership(teamId, targetUserId);
      if (!membership) {
        throw badRequest('User does not belong to the requested team.', 403);
      }
      return teamId;
    }

    const memberships = await getMembershipsForUser(targetUserId);
    if (!memberships.length) {
      throw badRequest('User does not belong to any team.', 404);
    }

    return memberships[0].teamId;
  }

  const rows = await all(
    `
      SELECT tm.team_id
      FROM team_memberships tm
      JOIN team_memberships target_tm ON target_tm.team_id = tm.team_id
      WHERE tm.user_id = ? AND tm.is_manager = 1 AND target_tm.user_id = ?
    `,
    [viewerUserId, targetUserId]
  );

  if (!rows.length) {
    throw badRequest('You do not have permission to view this schedule.', 403);
  }

  if (teamId) {
    const match = rows.find((row) => Number(row.team_id) === Number(teamId));
    if (!match) {
      throw badRequest('Requested team does not match a shared team.', 403);
    }
    return teamId;
  }

  return rows[0].team_id;
}

async function ensureValidManagerPassword(managerUserId, password) {
  const manager = await ensureAccountExists(managerUserId);
  if (!verifyPassword(password || '', manager.password_hash)) {
    throw badRequest('Manager password is incorrect.', 401);
  }
  return manager;
}

async function generateUniqueUsername(baseUsername) {
  const slug = (baseUsername || 'user')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/(^\.|\.$)/g, '') || 'user';

  let attempt = slug;
  let suffix = 1;

  while (true) {
    const existing = await get(
      `SELECT id FROM accounts WHERE username = ?`,
      [attempt]
    );

    if (!existing) {
      return attempt;
    }

    suffix += 1;
    attempt = `${slug}.${suffix}`;
  }
}

async function upsertAvailability(userId, availability) {
  for (const entry of availability) {
    await run(
      `
        INSERT INTO availability (user_id, day_of_week, is_available, start_time, end_time)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, day_of_week)
        DO UPDATE SET
          is_available = excluded.is_available,
          start_time = excluded.start_time,
          end_time = excluded.end_time
      `,
      [
        userId,
        entry.dayOfWeek,
        entry.isAvailable ? 1 : 0,
        entry.startTime || null,
        entry.endTime || null,
      ]
    );
  }
}

async function getAvailabilityForUser(userId) {
  const rows = await all(
    `
      SELECT day_of_week, is_available, start_time, end_time
      FROM availability
      WHERE user_id = ?
      ORDER BY day_of_week
    `,
    [userId]
  );

  const byDay = new Map(rows.map((row) => [row.day_of_week, row]));
  return Array.from({ length: 7 }, (_, dayOfWeek) => {
    const row = byDay.get(dayOfWeek);
    return {
      dayOfWeek,
      isAvailable: Boolean(row?.is_available),
      startTime: row?.start_time || null,
      endTime: row?.end_time || null,
    };
  });
}

async function getConstraints(teamId) {
  const [constraintRow, businessHours, roleRequirements] = await Promise.all([
    get(
      `
        SELECT *
        FROM schedule_constraints
        WHERE team_id = ?
      `,
      [teamId]
    ),
    all(
      `
        SELECT day_of_week, is_open, start_time, end_time
        FROM business_hours
        WHERE team_id = ?
        ORDER BY day_of_week
      `,
      [teamId]
    ),
    all(
      `
        SELECT id, role_name, day_of_week, start_time, end_time, min_employees
        FROM role_requirements
        WHERE team_id = ?
        ORDER BY role_name, day_of_week
      `,
      [teamId]
    ),
  ]);

  return {
    teamId,
    hoursWindowDays: constraintRow?.hours_window_days || 7,
    minHoursPerWindow: constraintRow?.min_hours_per_window ?? null,
    maxHoursPerWindow: constraintRow?.max_hours_per_window ?? null,
    minStaffPerHour: constraintRow?.min_staff_per_hour ?? null,
    maxStaffPerHour: constraintRow?.max_staff_per_hour ?? null,
    businessHours: Array.from({ length: 7 }, (_, dayOfWeek) => {
      const row = businessHours.find((entry) => entry.day_of_week === dayOfWeek);
      return {
        dayOfWeek,
        isOpen: row ? Boolean(row.is_open) : null,
        startTime: row?.start_time || null,
        endTime: row?.end_time || null,
      };
    }),
    roleRequirements: roleRequirements.map((row) => ({
      id: row.id,
      roleName: row.role_name,
      dayOfWeek: row.day_of_week,
      startTime: row.start_time,
      endTime: row.end_time,
      minEmployees: row.min_employees,
    })),
  };
}

async function getTeamMembers(teamId) {
  const rows = await all(
    `
      SELECT
        a.id,
        a.primary_email,
        a.secondary_email,
        a.username,
        a.phone_number,
        a.full_name,
        a.system_role,
        a.employment_role,
        a.requires_profile_completion,
        a.requires_password_change,
        a.created_at,
        a.updated_at,
        tm.is_manager
      FROM team_memberships tm
      JOIN accounts a ON a.id = tm.user_id
      WHERE tm.team_id = ?
      ORDER BY tm.is_manager DESC, a.full_name
    `,
    [teamId]
  );

  return rows.map((row) => ({
    ...serializeAccount(row),
    isManager: Boolean(row.is_manager),
  }));
}

async function getTeamById(teamId) {
  return get(
    `
      SELECT *
      FROM teams
      WHERE id = ?
    `,
    [teamId]
  );
}

async function getShiftById(shiftId) {
  return get(
    `
      SELECT s.*, a.full_name, a.username
      FROM shifts s
      JOIN accounts a ON a.id = s.user_id
      WHERE s.id = ?
    `,
    [shiftId]
  );
}

async function getShiftsForDate(teamId, date, excludedShiftId = null) {
  let sql = `
    SELECT s.*, a.full_name, a.username
    FROM shifts s
    JOIN accounts a ON a.id = s.user_id
    WHERE s.team_id = ? AND s.shift_date = ?
  `;
  const params = [teamId, date];

  if (excludedShiftId) {
    sql += ` AND s.id != ?`;
    params.push(excludedShiftId);
  }

  return all(sql, params);
}

async function getShiftsInRange(teamId, startDate, endDate) {
  return all(
    `
      SELECT s.*, a.full_name, a.username
      FROM shifts s
      JOIN accounts a ON a.id = s.user_id
      WHERE s.team_id = ? AND s.shift_date BETWEEN ? AND ?
      ORDER BY s.shift_date, s.start_time, a.full_name
    `,
    [teamId, startDate, endDate]
  );
}

function validateShiftInput(shift) {
  assertValidDate(shift.shiftDate);
  assertValidTime(shift.startTime);
  assertValidTime(shift.endTime);

  if (!shift.employmentRole) {
    throw badRequest('An employmentRole is required for each shift.');
  }

  if (calculateDurationHours(shift.startTime, shift.endTime) <= 0) {
    throw badRequest('Shift endTime must be later than startTime.');
  }
}

function getScheduleRangeForDay(dayBusinessHours, shifts) {
  if (
    dayBusinessHours &&
    dayBusinessHours.isOpen &&
    dayBusinessHours.startTime &&
    dayBusinessHours.endTime
  ) {
    return {
      startTime: dayBusinessHours.startTime,
      endTime: dayBusinessHours.endTime,
    };
  }

  if (!shifts.length) {
    return null;
  }

  const sortedStarts = shifts.map((shift) => shift.start_time).sort();
  const sortedEnds = shifts.map((shift) => shift.end_time).sort();

  return {
    startTime: sortedStarts[0],
    endTime: sortedEnds[sortedEnds.length - 1],
  };
}

async function evaluateShiftMutation({
  teamId,
  candidateShift = null,
  excludedShiftId = null,
  removedShift = null,
}) {
  const issues = [];
  const constraints = await getConstraints(teamId);
  const businessHoursByDay = new Map(
    constraints.businessHours
      .filter((entry) => entry.isOpen !== null)
      .map((entry) => [entry.dayOfWeek, entry])
  );

  if (candidateShift) {
    validateShiftInput(candidateShift);

    const dayOfWeek = getDayOfWeek(candidateShift.shiftDate);
    const [availabilityRow, overlappingShift, account] = await Promise.all([
      get(
        `
          SELECT is_available, start_time, end_time
          FROM availability
          WHERE user_id = ? AND day_of_week = ?
        `,
        [candidateShift.userId, dayOfWeek]
      ),
      get(
        `
          SELECT id, shift_date, start_time, end_time
          FROM shifts
          WHERE user_id = ? AND shift_date = ? AND id != COALESCE(?, -1)
            AND (? < end_time AND ? > start_time)
          LIMIT 1
        `,
        [
          candidateShift.userId,
          candidateShift.shiftDate,
          excludedShiftId,
          candidateShift.startTime,
          candidateShift.endTime,
        ]
      ),
      getAccountById(candidateShift.userId),
    ]);

    if (!account) {
      throw badRequest('Shift user was not found.', 404);
    }

    if (availabilityRow) {
      if (!availabilityRow.is_available) {
        issues.push({
          type: 'availability',
          message: `${account.full_name} is marked unavailable on ${candidateShift.shiftDate}.`,
        });
      } else if (
        availabilityRow.start_time &&
        availabilityRow.end_time &&
        !isRangeWithin(
          candidateShift.startTime,
          candidateShift.endTime,
          availabilityRow.start_time,
          availabilityRow.end_time
        )
      ) {
        issues.push({
          type: 'availability',
          message: `${account.full_name} is only available from ${availabilityRow.start_time} to ${availabilityRow.end_time} on ${candidateShift.shiftDate}.`,
        });
      }
    }

    const dayHours = businessHoursByDay.get(dayOfWeek);
    if (dayHours) {
      if (!dayHours.isOpen) {
        issues.push({
          type: 'business_hours',
          message: `The business is marked closed on ${candidateShift.shiftDate}.`,
        });
      } else if (
        dayHours.startTime &&
        dayHours.endTime &&
        !isRangeWithin(
          candidateShift.startTime,
          candidateShift.endTime,
          dayHours.startTime,
          dayHours.endTime
        )
      ) {
        issues.push({
          type: 'business_hours',
          message: `Shift falls outside business hours of ${dayHours.startTime}-${dayHours.endTime} on ${candidateShift.shiftDate}.`,
        });
      }
    }

    if (overlappingShift) {
      issues.push({
        type: 'overlap',
        message: `${account.full_name} already has an overlapping shift on ${candidateShift.shiftDate}.`,
      });
    }

    if (constraints.maxHoursPerWindow !== null && constraints.maxHoursPerWindow !== undefined) {
      const windowStart = getWindowStartDate(
        candidateShift.shiftDate,
        constraints.hoursWindowDays
      );
      const windowEnd = addDays(windowStart, constraints.hoursWindowDays - 1);

      const row = await get(
        `
          SELECT COALESCE(SUM((strftime('%s', '2000-01-01 ' || end_time) - strftime('%s', '2000-01-01 ' || start_time)) / 3600.0), 0) AS hours
          FROM shifts
          WHERE team_id = ?
            AND user_id = ?
            AND shift_date BETWEEN ? AND ?
            AND id != COALESCE(?, -1)
        `,
        [
          teamId,
          candidateShift.userId,
          windowStart,
          windowEnd,
          excludedShiftId,
        ]
      );

      const proposedHours =
        Number(row?.hours || 0) +
        calculateDurationHours(candidateShift.startTime, candidateShift.endTime);

      if (proposedHours > Number(constraints.maxHoursPerWindow)) {
        issues.push({
          type: 'max_hours',
          message: `${account.full_name} would be scheduled for ${proposedHours} hours in a ${constraints.hoursWindowDays}-day window, above the limit of ${constraints.maxHoursPerWindow}.`,
        });
      }
    }
  }

  const affectedDates = Array.from(
    new Set([candidateShift?.shiftDate, removedShift?.shift_date].filter(Boolean))
  );

  for (const date of affectedDates) {
    const dayOfWeek = getDayOfWeek(date);
    const existingShifts = await getShiftsForDate(teamId, date, excludedShiftId);
    const dayShifts = existingShifts
      .filter((shift) => !(removedShift && shift.id === removedShift.id))
      .map((shift) => ({ ...shift }));

    if (candidateShift && candidateShift.shiftDate === date) {
      dayShifts.push({
        id: candidateShift.id || null,
        team_id: teamId,
        user_id: candidateShift.userId,
        shift_date: candidateShift.shiftDate,
        start_time: candidateShift.startTime,
        end_time: candidateShift.endTime,
        employment_role: candidateShift.employmentRole,
      });
    }

    const dayHours = businessHoursByDay.get(dayOfWeek);
    const dayRange = getScheduleRangeForDay(dayHours, dayShifts);

    if (
      dayRange &&
      (constraints.minStaffPerHour !== null ||
        constraints.maxStaffPerHour !== null ||
        constraints.roleRequirements?.length)
    ) {
      const slots = getHourSlots(dayRange.startTime, dayRange.endTime);

      for (const slot of slots) {
        const staffCount = dayShifts.filter((shift) =>
          rangesOverlap(shift.start_time, shift.end_time, slot.start, slot.end)
        ).length;

        if (
          constraints.minStaffPerHour !== null &&
          dayHours &&
          dayHours.isOpen &&
          staffCount < Number(constraints.minStaffPerHour)
        ) {
          issues.push({
            type: 'min_staff',
            message: `Only ${staffCount} employee(s) are scheduled between ${slot.start}-${slot.end} on ${date}, below the minimum of ${constraints.minStaffPerHour}.`,
          });
        }

        if (
          constraints.maxStaffPerHour !== null &&
          staffCount > Number(constraints.maxStaffPerHour)
        ) {
          issues.push({
            type: 'max_staff',
            message: `${staffCount} employee(s) are scheduled between ${slot.start}-${slot.end} on ${date}, above the maximum of ${constraints.maxStaffPerHour}.`,
          });
        }
      }
    }

    for (const requirement of constraints.roleRequirements) {
      if (
        requirement.dayOfWeek !== null &&
        requirement.dayOfWeek !== undefined &&
        Number(requirement.dayOfWeek) !== dayOfWeek
      ) {
        continue;
      }

      const startTime =
        requirement.startTime ||
        dayHours?.startTime ||
        dayRange?.startTime;
      const endTime =
        requirement.endTime ||
        dayHours?.endTime ||
        dayRange?.endTime;

      if (!startTime || !endTime) {
        continue;
      }

      const slots = getHourSlots(startTime, endTime);

      for (const slot of slots) {
        const count = dayShifts.filter(
          (shift) =>
            shift.employment_role === requirement.roleName &&
            rangesOverlap(shift.start_time, shift.end_time, slot.start, slot.end)
        ).length;

        if (count < Number(requirement.minEmployees)) {
          issues.push({
            type: 'role_requirement',
            message: `Role requirement not met for ${requirement.roleName} between ${slot.start}-${slot.end} on ${date}.`,
          });
        }
      }
    }
  }

  return dedupeIssues(issues);
}

async function touchScheduleWeek(teamId, weekStartDate) {
  await run(
    `
      INSERT INTO schedule_weeks (team_id, week_start_date, last_change_at, finalized_at, finalized_by_user_id)
      VALUES (?, ?, CURRENT_TIMESTAMP, NULL, NULL)
      ON CONFLICT(team_id, week_start_date)
      DO UPDATE SET
        last_change_at = CURRENT_TIMESTAMP,
        finalized_at = NULL,
        finalized_by_user_id = NULL
    `,
    [teamId, weekStartDate]
  );
}

async function recordShiftAudit({
  teamId,
  userId,
  shiftId,
  weekStartDate,
  action,
  summary,
  createdByUserId,
}) {
  await run(
    `
      INSERT INTO shift_audit_logs (
        team_id,
        user_id,
        shift_id,
        week_start_date,
        action,
        summary,
        created_by_user_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [teamId, userId, shiftId, weekStartDate, action, summary, createdByUserId]
  );
}

async function getWeeklyHoursByUser(teamId, weekStartDate) {
  const weekEndDate = addDays(weekStartDate, 6);
  const rows = await all(
    `
      SELECT
        s.user_id,
        a.full_name,
        COALESCE(SUM((strftime('%s', '2000-01-01 ' || s.end_time) - strftime('%s', '2000-01-01 ' || s.start_time)) / 3600.0), 0) AS total_hours
      FROM shifts s
      JOIN accounts a ON a.id = s.user_id
      WHERE s.team_id = ? AND s.shift_date BETWEEN ? AND ?
      GROUP BY s.user_id, a.full_name
      ORDER BY a.full_name
    `,
    [teamId, weekStartDate, weekEndDate]
  );

  return rows.map((row) => ({
    userId: row.user_id,
    fullName: row.full_name,
    totalHours: Number(Number(row.total_hours).toFixed(2)),
  }));
}

async function getTeamSchedule(teamId, weekStartDate) {
  const weekEndDate = addDays(weekStartDate, 6);
  const [shifts, totals, week] = await Promise.all([
    getShiftsInRange(teamId, weekStartDate, weekEndDate),
    getWeeklyHoursByUser(teamId, weekStartDate),
    get(
      `
        SELECT finalized_at, finalized_by_user_id, last_change_at
        FROM schedule_weeks
        WHERE team_id = ? AND week_start_date = ?
      `,
      [teamId, weekStartDate]
    ),
  ]);

  return {
    weekStartDate,
    weekEndDate,
    isFinalized: Boolean(week?.finalized_at),
    finalizedAt: week?.finalized_at || null,
    finalizedByUserId: week?.finalized_by_user_id || null,
    lastChangeAt: week?.last_change_at || null,
    shifts: shifts.map(serializeShift),
    totals,
  };
}

async function evaluateWeekForFinalization(teamId, weekStartDate) {
  const issues = [];
  const constraints = await getConstraints(teamId);
  const teamMembers = await getTeamMembers(teamId);
  const weekEndDate = addDays(weekStartDate, 6);
  const shifts = await getShiftsInRange(teamId, weekStartDate, weekEndDate);

  for (const shift of shifts) {
    const shiftIssues = await evaluateShiftMutation({
      teamId,
      candidateShift: {
        id: shift.id,
        userId: shift.user_id,
        shiftDate: shift.shift_date,
        startTime: shift.start_time,
        endTime: shift.end_time,
        employmentRole: shift.employment_role,
      },
      excludedShiftId: shift.id,
    });

    issues.push(...shiftIssues);
  }

  if (constraints.minHoursPerWindow !== null || constraints.maxHoursPerWindow !== null) {
    for (const member of teamMembers) {
      const anchorDate = weekStartDate;
      const windowStart = getWindowStartDate(anchorDate, constraints.hoursWindowDays);
      const windowEnd = addDays(windowStart, constraints.hoursWindowDays - 1);
      const row = await get(
        `
          SELECT COALESCE(SUM((strftime('%s', '2000-01-01 ' || end_time) - strftime('%s', '2000-01-01 ' || start_time)) / 3600.0), 0) AS hours
          FROM shifts
          WHERE team_id = ? AND user_id = ? AND shift_date BETWEEN ? AND ?
        `,
        [teamId, member.id, windowStart, windowEnd]
      );

      const totalHours = Number(Number(row?.hours || 0).toFixed(2));

      if (
        constraints.minHoursPerWindow !== null &&
        totalHours < Number(constraints.minHoursPerWindow)
      ) {
        issues.push({
          type: 'min_hours',
          message: `${member.fullName} is scheduled for ${totalHours} hours in a ${constraints.hoursWindowDays}-day window, below the minimum of ${constraints.minHoursPerWindow}.`,
        });
      }

      if (
        constraints.maxHoursPerWindow !== null &&
        totalHours > Number(constraints.maxHoursPerWindow)
      ) {
        issues.push({
          type: 'max_hours',
          message: `${member.fullName} is scheduled for ${totalHours} hours in a ${constraints.hoursWindowDays}-day window, above the maximum of ${constraints.maxHoursPerWindow}.`,
        });
      }
    }
  }

  return dedupeIssues(issues);
}

module.exports = {
  badRequest,
  serializeAccount,
  serializeMembership,
  serializeShift,
  getAccountById,
  getAccountByIdentifier,
  getMembershipsForUser,
  getMembership,
  ensureAccountExists,
  ensureManagerForTeam,
  ensureTeamAccess,
  ensureUserCanAccessUser,
  ensureUserCanManageAvailability,
  ensureUserCanViewSchedule,
  ensureValidManagerPassword,
  generateUniqueUsername,
  upsertAvailability,
  getAvailabilityForUser,
  getConstraints,
  getTeamMembers,
  getTeamById,
  getShiftById,
  getShiftsInRange,
  validateShiftInput,
  evaluateShiftMutation,
  touchScheduleWeek,
  recordShiftAudit,
  getWeeklyHoursByUser,
  getTeamSchedule,
  evaluateWeekForFinalization,
  getWeekStartDate,
};
