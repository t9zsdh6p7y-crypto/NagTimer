/** Daily check-in and weekly progress. */

import { elapsedMs } from "./timer.js";
import { localDateISO, formatMinutes } from "./util.js";
import { expectedMinutesByNow, sessionsOnDate, sessionEndDate } from "./plan.js";

/**
 * Record a check-in for a session. Minutes may come from the user or the timer.
 * If done is true and minutes is omitted, planned length is used.
 */
export function makeCheckIn({ session, done, minutes, at, source = "checkin" }) {
  let mins = minutes == null || minutes === "" ? null : Number(minutes);
  if (done && (mins == null || !Number.isFinite(mins))) {
    mins = session.plannedMinutes;
  }
  if (!done && (mins == null || !Number.isFinite(mins))) mins = 0;
  mins = Math.max(0, Math.round(mins));
  return {
    sessionId: session.id,
    date: session.date,
    done: !!done,
    minutes: mins,
    plannedMinutes: session.plannedMinutes,
    at: (at || new Date()).toISOString(),
    source,
  };
}

export function upsertCheckIn(checkins, entry) {
  const next = { ...checkins };
  const list = [...(next[entry.date] || [])];
  const i = list.findIndex((c) => c.sessionId === entry.sessionId);
  if (i >= 0) list[i] = entry;
  else list.push(entry);
  next[entry.date] = list;
  return next;
}

export function checkInFor(checkins, session) {
  return (checkins[session.date] || []).find((c) => c.sessionId === session.id) || null;
}

export function loggedMinutesForWeek(week, checkins, timerLogs, liveTimer, now) {
  let total = 0;
  const sessionIds = new Set((week?.sessions || []).map((s) => s.id));
  const weekDates = new Set((week?.sessions || []).map((s) => s.date));

  // Prefer explicit check-ins when present; otherwise timer logs.
  const checkedSessions = new Set();
  for (const s of week?.sessions || []) {
    const c = checkInFor(checkins, s);
    if (c) {
      total += c.minutes || 0;
      checkedSessions.add(s.id);
    }
  }

  for (const log of timerLogs || []) {
    if (checkedSessions.has(log.sessionId)) continue;
    if (log.sessionId && sessionIds.has(log.sessionId)) {
      total += (log.ms || 0) / 60000;
    } else if (!log.sessionId && weekDates.has(log.date)) {
      total += (log.ms || 0) / 60000;
    }
  }

  if (liveTimer && (liveTimer.running || liveTimer.accumulatedMs)) {
    const sid = liveTimer.targetId;
    if (!sid || sessionIds.has(sid) || sid === "week") {
      if (!checkedSessions.has(sid)) {
        total += elapsedMs(liveTimer, now) / 60000;
      }
    }
  }

  return Math.max(0, total);
}

export function weeklyProgress(activity, week, checkins, timerLogs, liveTimer, now) {
  const target = week && week.targetMinutes != null
    ? Number(week.targetMinutes) || 0
    : (activity?.weeklyTargetMinutes || 0);
  const logged = loggedMinutesForWeek(week, checkins, timerLogs, liveTimer, now);
  const expected = expectedMinutesByNow(week, now, { onlyEnded: false });
  const expectedEnded = expectedMinutesByNow(week, now, { onlyEnded: true });
  const remaining = Math.max(0, target - logged);
  const ratio = target > 0 ? logged / target : 0;
  const behind = expectedEnded > 0 && logged < expectedEnded * 0.8;
  const behindStarted = expected > 0 && logged < expected * 0.5;
  return {
    target,
    logged,
    remaining,
    ratio,
    expected,
    expectedEnded,
    behind: behind || behindStarted,
    label: `${formatMinutes(logged)} of ${formatMinutes(target)} this week`,
  };
}

export function needsCheckIn(week, checkins, dateISO, checkInTime, now) {
  const todays = sessionsOnDate(week, dateISO);
  if (!todays.length) return { needed: false, sessions: [] };
  const pending = todays.filter((s) => !checkInFor(checkins, s));
  if (!pending.length) return { needed: false, sessions: [] };
  const [h, m] = (checkInTime || "20:00").split(":").map(Number);
  const gate = new Date(now);
  gate.setHours(h, m || 0, 0, 0);
  // Also offer check-in after a session has ended, even before the daily time.
  const anyEnded = todays.some((s) => now >= sessionEndDate(s));
  const reachedTime = now >= gate;
  return { needed: pending.length > 0 && (reachedTime || anyEnded), sessions: pending, reachedTime };
}

export function pendingCheckIns(week, checkins, dateISO) {
  return sessionsOnDate(week, dateISO).filter((s) => !checkInFor(checkins, s));
}

export function todayLoggedMinutes(week, checkins, timerLogs, liveTimer, now, dateISO) {
  const day = dateISO || localDateISO(now);
  const todays = sessionsOnDate(week, day);
  let total = 0;
  let used = false;
  for (const s of todays) {
    const c = checkInFor(checkins, s);
    if (c) {
      total += c.minutes || 0;
      used = true;
    }
  }
  if (!used) {
    for (const log of timerLogs || []) {
      if (log.date === day) total += (log.ms || 0) / 60000;
    }
    if (liveTimer && (liveTimer.running || liveTimer.accumulatedMs)) {
      total += elapsedMs(liveTimer, now) / 60000;
    }
  } else if (liveTimer && liveTimer.running) {
    const sid = liveTimer.targetId;
    const already = todays.some((s) => s.id === sid && checkInFor(checkins, s));
    if (!already) total += elapsedMs(liveTimer, now) / 60000;
  }
  return total;
}
