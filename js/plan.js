/** Week scripting, session length derivation, and plan validation. */

import {
  addDays,
  localDateISO,
  combineDateAndTime,
  weekStart,
  weekStartISO,
  formatMinutes,
  uid,
  WEEKDAY_SHORT,
  WEEKDAY_NAMES,
} from "./util.js";

export function deriveSessionLength(weeklyMinutes, sessionsPerWeek) {
  const weekly = Number(weeklyMinutes);
  const count = Number(sessionsPerWeek);
  if (!Number.isFinite(weekly) || weekly <= 0) {
    return { ok: false, error: "Set a weekly time total greater than zero." };
  }
  if (!Number.isFinite(count) || count < 1 || count > 14) {
    return { ok: false, error: "Sessions per week must be between 1 and 14." };
  }
  const exact = weekly / count;
  const minutes = Math.max(1, Math.round(exact / 5) * 5 || Math.round(exact));
  return { ok: true, minutes, exact };
}

/**
 * Validate that sessions × length roughly equals the weekly total.
 * Default tolerance: 15% or 10 minutes, whichever is larger.
 */
export function validatePlan(input, tolerance) {
  const errors = [];
  const warnings = [];
  const name = (input.name || "").trim();
  if (!name) errors.push("Pick an activity name.");

  const weekly = Number(input.weeklyTargetMinutes);
  if (!Number.isFinite(weekly) || weekly <= 0) {
    errors.push("Set total time per week.");
  }

  const count = Number(input.sessionsPerWeek);
  if (!Number.isFinite(count) || count < 1) {
    errors.push("Set the number of sessions per week.");
  }

  let length = Number(input.sessionLengthMinutes);
  if (!Number.isFinite(length) || length <= 0) {
    const derived = deriveSessionLength(weekly, count);
    if (derived.ok) length = derived.minutes;
    else if (!errors.length) errors.push(derived.error);
  }

  const schedule = Array.isArray(input.schedule) ? input.schedule : [];
  if (count && schedule.length !== count) {
    errors.push(
      `Choose ${count} session day${count === 1 ? "" : "s"} (you have ${schedule.length}).`
    );
  }
  for (const slot of schedule) {
    if (slot.weekday == null || slot.weekday < 0 || slot.weekday > 6) {
      errors.push("Each session needs a day of the week.");
    }
    if (!slot.start) errors.push("Each session needs a start time.");
  }

  const product = (count || 0) * (length || 0);
  const drift = Number.isFinite(weekly) ? Math.abs(product - weekly) : 0;
  const tol = tolerance ?? Math.max(10, weekly * 0.15);
  if (errors.length === 0 && drift > tol) {
    warnings.push(
      `${count} × ${formatMinutes(length)} = ${formatMinutes(product)}, but the weekly total is ${formatMinutes(weekly)}. Adjust the total, the session length, or the number of sessions.`
    );
  }

  return {
    ok: errors.length === 0 && warnings.length === 0,
    valid: errors.length === 0,
    errors,
    warnings,
    weeklyMinutes: weekly,
    sessionsPerWeek: count,
    sessionLengthMinutes: length,
    product,
    drift,
  };
}

export function normalizeActivity(input) {
  const derived = deriveSessionLength(input.weeklyTargetMinutes, input.sessionsPerWeek);
  const length = Number(input.sessionLengthMinutes) > 0
    ? Math.round(Number(input.sessionLengthMinutes))
    : (derived.ok ? derived.minutes : 0);
  const schedule = (input.schedule || []).map((s) => ({
    weekday: Number(s.weekday),
    start: s.start,
  }));
  return {
    id: input.id || null,
    name: (input.name || "").trim(),
    weeklyTargetMinutes: Number(input.weeklyTargetMinutes),
    sessionsPerWeek: Number(input.sessionsPerWeek),
    sessionLengthMinutes: length,
    schedule,
    checkInTime: input.checkInTime || "20:00",
    intensity: input.intensity || "moderate",
    weekStartsOn: input.weekStartsOn ?? 1,
  };
}

/** Build this week's session list from the activity template. */
export function buildWeekPlan(activity, now = new Date(), existingWeek = null) {
  const start = weekStart(now, activity.weekStartsOn ?? 1);
  const weekId = localDateISO(start);
  if (existingWeek && existingWeek.weekId === weekId && existingWeek.sessions?.length) {
    return existingWeek;
  }
  const sessions = (activity.schedule || []).map((slot) => {
    const offset = (slot.weekday - (activity.weekStartsOn ?? 1) + 7) % 7;
    const date = addDays(start, offset);
    return {
      id: uid("ses"),
      date: localDateISO(date),
      weekday: slot.weekday,
      start: slot.start,
      plannedMinutes: activity.sessionLengthMinutes,
      activityName: activity.name,
    };
  });
  sessions.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  return {
    weekId,
    weekStartsOn: activity.weekStartsOn ?? 1,
    sessions,
    scriptedAt: now.toISOString(),
  };
}

export function sessionStartDate(session) {
  return combineDateAndTime(session.date, session.start);
}

export function sessionEndDate(session) {
  return new Date(sessionStartDate(session).getTime() + session.plannedMinutes * 60 * 1000);
}

export function sessionsOnDate(week, dateISO) {
  return (week?.sessions || []).filter((s) => s.date === dateISO);
}

/** Planned minutes for sessions that have already started (or ended). */
export function expectedMinutesByNow(week, now, { onlyEnded = false } = {}) {
  let total = 0;
  for (const s of week?.sessions || []) {
    const start = sessionStartDate(s);
    const end = sessionEndDate(s);
    const t = onlyEnded ? end : start;
    if (now >= t) total += s.plannedMinutes;
  }
  return total;
}

export function describeSlot(slot) {
  return `${WEEKDAY_NAMES[slot.weekday]} at ${slot.start}`;
}

export function describeWeek(week) {
  return (week?.sessions || []).map((s) => ({
    ...s,
    label: `${WEEKDAY_SHORT[s.weekday]} ${s.date.slice(5)} · ${s.start} · ${formatMinutes(s.plannedMinutes)}`,
  }));
}

export { weekStart, weekStartISO };
