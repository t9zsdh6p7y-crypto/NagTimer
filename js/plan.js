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

export const TIME_FRAMES = ["day", "week", "month"];

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
 * Old saves only have weeklyTargetMinutes. Treat those as a per-week goal.
 * Already-migrated activities keep their time frame.
 */
export function migrateActivityTimeFrame(activity) {
  if (!activity || typeof activity !== "object") return activity;
  const frame = activity.timeFrame;
  if (frame === "day" || frame === "week" || frame === "month") {
    const goal = Number(activity.goalMinutes);
    const weekly = Number(activity.weeklyTargetMinutes);
    const goalMinutes = Number.isFinite(goal) && goal > 0
      ? goal
      : (frame === "week" && Number.isFinite(weekly) ? weekly : (Number.isFinite(goal) ? goal : 0));
    const custom = frame === "month" && (
      activity.weekStyle === "custom" ||
      (activity.weekStyle !== "even" && Array.isArray(activity.weekGoals) && activity.weekGoals.length > 0)
    );
    return {
      ...activity,
      timeFrame: frame,
      goalMinutes,
      weekStyle: frame === "month" ? (custom ? "custom" : "even") : "even",
      weekGoals: custom
        ? activity.weekGoals.map((n) => Math.round(Number(n) || 0))
        : null,
    };
  }
  const weekly = Number(activity.weeklyTargetMinutes);
  return {
    ...activity,
    timeFrame: "week",
    goalMinutes: Number.isFinite(weekly) ? weekly : 0,
    weekStyle: "even",
    weekGoals: null,
  };
}

/** Which calendar month owns a week: the month with the most days in it. */
function majorityMonth(weekStartDate) {
  const tally = new Map();
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStartDate, i);
    const key = d.getFullYear() * 12 + d.getMonth();
    tally.set(key, (tally.get(key) || 0) + 1);
  }
  let best = null;
  let bestN = -1;
  for (const [key, n] of tally) {
    if (n > bestN) {
      best = key;
      bestN = n;
    }
  }
  return { year: Math.floor(best / 12), month: best % 12, days: bestN };
}

/**
 * Calendar weeks (weekStartsOn) whose majority of days fall in this month.
 * A month therefore has 4 or 5 weeks, and each week belongs to one month.
 */
export function weeksInMonth(year, month, weekStartsOn = 1) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  let cursor = weekStart(first, weekStartsOn);
  const end = weekStart(last, weekStartsOn);
  const owned = [];
  while (cursor.getTime() <= end.getTime()) {
    const maj = majorityMonth(cursor);
    if (maj.year === year && maj.month === month) owned.push(new Date(cursor.getTime()));
    cursor = addDays(cursor, 7);
  }
  return owned;
}

/** Index of the week containing `date` inside the month that owns that week. */
export function weekOfMonth(date, weekStartsOn = 1) {
  const start = weekStart(date, weekStartsOn);
  const maj = majorityMonth(start);
  const weeks = weeksInMonth(maj.year, maj.month, weekStartsOn);
  const weekId = localDateISO(start);
  let index = weeks.findIndex((w) => localDateISO(w) === weekId);
  if (index < 0) index = 0;
  return {
    index,
    count: Math.max(1, weeks.length),
    weekId,
    year: maj.year,
    month: maj.month,
    weeks: weeks.map((w) => localDateISO(w)),
  };
}

/** Split a monthly total into whole minutes that add back up to the total. */
export function evenWeekGoals(monthlyMinutes, weekCount) {
  const total = Math.max(0, Math.round(Number(monthlyMinutes) || 0));
  const n = Math.max(1, Math.round(Number(weekCount)) || 1);
  const base = Math.floor(total / n);
  const rem = total - base * n;
  const out = Array(n).fill(base);
  for (let i = n - rem; i < n; i++) out[i] += 1;
  return out;
}

/**
 * Fit a custom week-goal list to a month that has `count` weeks.
 * Extra weeks repeat the last goal. A shorter month keeps the earlier weeks.
 */
export function alignWeekGoals(goals, count, monthlyMinutes) {
  const n = Math.max(1, Math.round(Number(count)) || 1);
  const clean = (Array.isArray(goals) ? goals : [])
    .map((g) => Math.round(Number(g) || 0))
    .filter((g) => g > 0);
  if (!clean.length) return evenWeekGoals(monthlyMinutes, n);
  if (clean.length === n) return clean;
  if (clean.length > n) return clean.slice(0, n);
  const out = clean.slice();
  while (out.length < n) out.push(clean[clean.length - 1]);
  return out;
}

/**
 * Weekly minutes the rest of the app should use for the week containing `date`.
 * Day goals apply to each chosen day. Month goals spread across that month's weeks.
 */
export function weeklyMinutesFor(activity, date = new Date()) {
  if (!activity) return 0;
  const a = migrateActivityTimeFrame(activity);
  const frame = a.timeFrame || "week";
  const goal = Number(a.goalMinutes);
  if (frame === "week") {
    if (Number.isFinite(goal) && goal > 0) return Math.round(goal);
    return Math.max(0, Math.round(Number(a.weeklyTargetMinutes) || 0));
  }
  if (frame === "day") {
    const perDay = Number.isFinite(goal) && goal > 0 ? goal : 0;
    const days = Number(a.sessionsPerWeek) || (Array.isArray(a.schedule) ? a.schedule.length : 0) || 0;
    return Math.round(perDay * days);
  }
  const info = weekOfMonth(date, a.weekStartsOn ?? 1);
  const custom = a.weekStyle === "custom" && Array.isArray(a.weekGoals) && a.weekGoals.length > 0;
  const goals = custom
    ? alignWeekGoals(a.weekGoals, info.count, goal)
    : evenWeekGoals(goal, info.count);
  const index = Math.min(Math.max(0, info.index), goals.length - 1);
  return Math.round(goals[index] || 0);
}

export function plannedSessionMinutes(activity, weeklyMinutes) {
  const stored = Math.round(Number(activity?.sessionLengthMinutes) || 0);
  if (activity?.sessionLengthCustom === false) {
    const derived = deriveSessionLength(weeklyMinutes, activity.sessionsPerWeek);
    if (derived.ok) return derived.minutes;
    return stored;
  }
  if (stored > 0) return stored;
  const derived = deriveSessionLength(weeklyMinutes, activity?.sessionsPerWeek);
  return derived.ok ? derived.minutes : 0;
}

function planNumbers(input, now) {
  const when = input?.now instanceof Date ? input.now : now;
  const seeded = {
    ...input,
    goalMinutes: input.goalMinutes != null && input.goalMinutes !== ""
      ? input.goalMinutes
      : (!input.timeFrame || input.timeFrame === "week" ? input.weeklyTargetMinutes : input.goalMinutes),
  };
  const migrated = migrateActivityTimeFrame(seeded);
  const timeFrame = migrated.timeFrame || "week";
  const draft = {
    ...migrated,
    timeFrame,
    sessionsPerWeek: Number(input.sessionsPerWeek),
    schedule: input.schedule || [],
    weekStartsOn: input.weekStartsOn ?? 1,
  };
  const info = timeFrame === "month" ? weekOfMonth(when, draft.weekStartsOn) : null;
  return {
    timeFrame,
    goalMinutes: Math.round(Number(draft.goalMinutes) || 0),
    weekly: weeklyMinutesFor(draft, when),
    info,
    weekStyle: draft.weekStyle || "even",
    weekGoals: draft.weekGoals,
    when,
  };
}

/**
 * Validate that sessions × length roughly equals the weekly total.
 * Default tolerance: 15% or 10 minutes, whichever is larger.
 * The weekly total is the converted goal for the week of `input.now` (or today).
 */
export function validatePlan(input, tolerance) {
  const errors = [];
  const warnings = [];
  const name = (input.name || "").trim();
  if (!name) errors.push("Pick an activity name.");

  const numbers = planNumbers(input, input.now instanceof Date ? input.now : new Date());
  const frame = numbers.timeFrame;
  let weekly = numbers.weekly;

  if (frame === "day") {
    if (!(numbers.goalMinutes > 0)) errors.push("Set the minutes for each chosen day.");
  } else if (frame === "month") {
    const custom = numbers.weekStyle === "custom" && Array.isArray(input.weekGoals) && input.weekGoals.length > 0;
    if (!(numbers.goalMinutes > 0) && !custom) errors.push("Set total time per month.");
    if (custom && input.weekGoals.some((g) => !(Number(g) > 0))) {
      errors.push("Each week needs a goal greater than zero.");
    }
    if (!(weekly > 0) && !errors.length) errors.push("Set total time per month.");
  } else if (!Number.isFinite(weekly) || weekly <= 0) {
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
  const tol = tolerance ?? Math.max(10, (weekly || 0) * 0.15);
  if (errors.length === 0 && drift > tol) {
    warnings.push(
      `${count} × ${formatMinutes(length)} = ${formatMinutes(product)}, but this week's goal is ${formatMinutes(weekly)}. Adjust the goal, the session length, or the number of sessions.`
    );
  }

  return {
    ok: errors.length === 0 && warnings.length === 0,
    valid: errors.length === 0,
    errors,
    warnings,
    weeklyMinutes: weekly,
    timeFrame: frame,
    goalMinutes: numbers.goalMinutes,
    sessionsPerWeek: count,
    sessionLengthMinutes: length,
    product,
    drift,
  };
}

export function normalizeActivity(input, now = new Date()) {
  const numbers = planNumbers(input, now);
  const weekly = numbers.weekly;
  const derived = deriveSessionLength(weekly, input.sessionsPerWeek);
  const explicit = Number(input.sessionLengthMinutes);
  let sessionLengthCustom;
  if (input.sessionLengthCustom === true) sessionLengthCustom = true;
  else if (input.sessionLengthCustom === false) sessionLengthCustom = false;
  else sessionLengthCustom = explicit > 0;
  const length = sessionLengthCustom
    ? Math.round(explicit)
    : (derived.ok ? derived.minutes : (explicit > 0 ? Math.round(explicit) : 0));
  const schedule = (input.schedule || []).map((s) => ({
    weekday: Number(s.weekday),
    start: s.start,
  }));
  const timeFrame = numbers.timeFrame;
  const weekStyle = timeFrame === "month" && numbers.weekStyle === "custom" ? "custom" : "even";
  const weekGoals = timeFrame === "month" && weekStyle === "custom"
    ? (Array.isArray(input.weekGoals) ? input.weekGoals : numbers.weekGoals || []).map((n) => Math.round(Number(n) || 0))
    : null;
  return {
    id: input.id || null,
    name: (input.name || "").trim(),
    timeFrame,
    goalMinutes: numbers.goalMinutes,
    weekStyle,
    weekGoals,
    weeklyTargetMinutes: Math.round(weekly) || 0,
    sessionsPerWeek: Number(input.sessionsPerWeek),
    sessionLengthMinutes: length,
    sessionLengthCustom,
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
  const targetMinutes = weeklyMinutesFor(activity, now);
  const planned = plannedSessionMinutes(activity, targetMinutes);
  const sessions = (activity.schedule || []).map((slot) => {
    const offset = (slot.weekday - (activity.weekStartsOn ?? 1) + 7) % 7;
    const date = addDays(start, offset);
    return {
      id: uid("ses"),
      date: localDateISO(date),
      weekday: slot.weekday,
      start: slot.start,
      plannedMinutes: planned,
      activityName: activity.name,
    };
  });
  sessions.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  return {
    weekId,
    weekStartsOn: activity.weekStartsOn ?? 1,
    sessions,
    targetMinutes,
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
