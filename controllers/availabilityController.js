const {
  badRequest,
  ensureAccountExists,
  ensureUserCanManageAvailability,
  getAvailabilityForUser,
  upsertAvailability,
} = require('../services/scheduleService');
const { assertValidTime } = require('../utils/time');

function validateAvailabilityPayload(availability) {
  if (!Array.isArray(availability) || availability.length !== 7) {
    throw badRequest('availability must include exactly 7 day entries.');
  }

  const seenDays = new Set();

  for (const entry of availability) {
    if (
      typeof entry.dayOfWeek !== 'number' ||
      entry.dayOfWeek < 0 ||
      entry.dayOfWeek > 6 ||
      seenDays.has(entry.dayOfWeek)
    ) {
      throw badRequest('Each availability entry must have a unique dayOfWeek between 0 and 6.');
    }

    seenDays.add(entry.dayOfWeek);

    if (entry.startTime) {
      assertValidTime(entry.startTime);
    }

    if (entry.endTime) {
      assertValidTime(entry.endTime);
    }

    if (entry.isAvailable && (!entry.startTime || !entry.endTime)) {
      throw badRequest('Available days must include both startTime and endTime.');
    }
  }
}

exports.getAvailability = async (req, res) => {
  try {
    if (!req.auth) {
      throw badRequest('Authentication required.', 401);
    }

    const userId = Number(req.params.userId);
    await ensureAccountExists(userId);
    await ensureUserCanManageAvailability(req.auth.userId, userId);
    const availability = await getAvailabilityForUser(userId);
    res.send({ userId, availability });
  } catch (error) {
    res.status(error.statusCode || 500).send({ error: error.message });
  }
};

exports.updateAvailability = async (req, res) => {
  try {
    if (!req.auth) {
      throw badRequest('Authentication required.', 401);
    }

    const userId = Number(req.params.userId);
    const { availability } = req.body;

    await ensureAccountExists(userId);
    await ensureUserCanManageAvailability(req.auth.userId, userId);
    validateAvailabilityPayload(availability);
    await upsertAvailability(userId, availability);

    res.send({
      userId,
      availability: await getAvailabilityForUser(userId),
    });
  } catch (error) {
    res.status(error.statusCode || 500).send({ error: error.message });
  }
};
