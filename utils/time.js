function assertValidDate(dateString) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    throw new Error('Dates must be provided as YYYY-MM-DD.');
  }
}

function assertValidTime(timeString) {
  if (!/^\d{2}:\d{2}$/.test(timeString)) {
    throw new Error('Times must be provided as HH:MM in 24-hour format.');
  }
}

function timeToMinutes(timeString) {
  assertValidTime(timeString);
  const [hours, minutes] = timeString.split(':').map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(totalMinutes) {
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const minutes = String(totalMinutes % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function calculateDurationHours(startTime, endTime) {
  const durationMinutes = timeToMinutes(endTime) - timeToMinutes(startTime);
  return Number((durationMinutes / 60).toFixed(2));
}

function getDayOfWeek(dateString) {
  assertValidDate(dateString);
  return new Date(`${dateString}T00:00:00Z`).getUTCDay();
}

function addDays(dateString, days) {
  assertValidDate(dateString);
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getWeekStartDate(dateString) {
  assertValidDate(dateString);
  const date = new Date(`${dateString}T00:00:00Z`);
  const day = date.getUTCDay();
  const diffFromMonday = (day + 6) % 7;
  date.setUTCDate(date.getUTCDate() - diffFromMonday);
  return date.toISOString().slice(0, 10);
}

function getWindowStartDate(dateString, windowDays = 7) {
  assertValidDate(dateString);

  if (windowDays === 7) {
    return getWeekStartDate(dateString);
  }

  const anchor = new Date('2024-01-01T00:00:00Z');
  const date = new Date(`${dateString}T00:00:00Z`);
  const daysSinceAnchor = Math.floor((date - anchor) / (24 * 60 * 60 * 1000));
  const bucket = Math.floor(daysSinceAnchor / windowDays);
  const windowStart = new Date(anchor);
  windowStart.setUTCDate(anchor.getUTCDate() + bucket * windowDays);
  return windowStart.toISOString().slice(0, 10);
}

function rangesOverlap(startA, endA, startB, endB) {
  const aStart = timeToMinutes(startA);
  const aEnd = timeToMinutes(endA);
  const bStart = timeToMinutes(startB);
  const bEnd = timeToMinutes(endB);
  return aStart < bEnd && bStart < aEnd;
}

function isRangeWithin(innerStart, innerEnd, outerStart, outerEnd) {
  const start = timeToMinutes(innerStart);
  const end = timeToMinutes(innerEnd);
  const outerStartMinutes = timeToMinutes(outerStart);
  const outerEndMinutes = timeToMinutes(outerEnd);

  return start >= outerStartMinutes && end <= outerEndMinutes;
}

function getHourSlots(startTime, endTime) {
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);
  const slots = [];

  let cursor = Math.floor(startMinutes / 60) * 60;

  while (cursor < endMinutes) {
    slots.push({
      start: minutesToTime(cursor),
      end: minutesToTime(Math.min(cursor + 60, 24 * 60)),
    });
    cursor += 60;
  }

  return slots;
}

function buildWeeklyDates(shiftDate, repeatUntil) {
  const dates = [shiftDate];

  if (!repeatUntil) {
    return dates;
  }

  let cursor = shiftDate;

  while (true) {
    cursor = addDays(cursor, 7);
    if (cursor > repeatUntil) {
      break;
    }
    dates.push(cursor);
  }

  return dates;
}

module.exports = {
  assertValidDate,
  assertValidTime,
  timeToMinutes,
  minutesToTime,
  calculateDurationHours,
  getDayOfWeek,
  addDays,
  getWeekStartDate,
  getWindowStartDate,
  rangesOverlap,
  isRangeWithin,
  getHourSlots,
  buildWeeklyDates,
};
