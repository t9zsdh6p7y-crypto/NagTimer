/** Nag evaluation and intensity behavior. Copy comes from the persona layer. */

import { sessionStartDate, sessionEndDate, sessionsOnDate } from "./plan.js";
import { weeklyProgress, checkInFor, pendingCheckIns } from "./checkin.js";
import { localDateISO, combineDateAndTime } from "./util.js";

export const INTENSITY = {
  gentle: {
    id: "gentle",
    label: "Gentle",
    intervalStartMs: 15 * 60 * 1000,
    intervalMinMs: 10 * 60 * 1000,
    intervalFactor: 0.9,
    maxSnoozes: 3,
    snoozeMs: 10 * 60 * 1000,
    sound: false,
    vibrate: false,
    requireInteraction: false,
  },
  moderate: {
    id: "moderate",
    label: "Moderate",
    intervalStartMs: 5 * 60 * 1000,
    intervalMinMs: 2 * 60 * 1000,
    intervalFactor: 0.8,
    maxSnoozes: 2,
    snoozeMs: 5 * 60 * 1000,
    sound: true,
    vibrate: true,
    requireInteraction: true,
  },
  strict: {
    id: "strict",
    label: "Strict",
    intervalStartMs: 90 * 1000,
    intervalMinMs: 30 * 1000,
    intervalFactor: 0.7,
    maxSnoozes: 1,
    snoozeMs: 2 * 60 * 1000,
    sound: true,
    vibrate: true,
    requireInteraction: true,
  },
};

export function intensityConfig(id) {
  return INTENSITY[id] || INTENSITY.moderate;
}

export function nextIntervalMs(current, cfg) {
  if (current == null) return cfg.intervalStartMs;
  return Math.max(cfg.intervalMinMs, Math.round(current * cfg.intervalFactor));
}

export function canSnooze(nagState, cfg) {
  return (nagState?.snoozeCount || 0) < cfg.maxSnoozes;
}

/**
 * Pure evaluator. Returns a nag request or null.
 * Does not decide whether enough time has passed since the last fire
 * (that's applyNagTiming).
 */
export function evaluateNags({
  now,
  activity,
  week,
  checkins,
  timerLogs,
  timer,
  checkInTime,
}) {
  if (!activity || !week) return null;
  const dateISO = localDateISO(now);
  const todays = sessionsOnDate(week, dateISO);
  const running = !!(timer && timer.running);

  // 1) A session block is starting or is underway and the timer isn't running
  //    and it hasn't been checked in.
  for (const s of todays) {
    const start = sessionStartDate(s);
    const end = sessionEndDate(s);
    const checked = checkInFor(checkins, s);
    if (checked?.done) continue;
    const logged = checked?.minutes || 0;
    const windowOpen = now >= start && now <= end;
    const starting = now >= start && now < new Date(start.getTime() + 15 * 60 * 1000);
    if (windowOpen && !running && logged < s.plannedMinutes * 0.5) {
      return {
        type: starting ? "session-start" : "session-active",
        key: `session-start:${s.id}`,
        session: s,
        facts: {
          activityName: activity.name,
          plannedMinutes: s.plannedMinutes,
          loggedMinutes: logged,
          start: s.start,
        },
      };
    }
  }

  // 2) Daily check-in time has arrived and today's blocks aren't logged.
  if (checkInTime) {
    const gate = combineDateAndTime(dateISO, checkInTime);
    const pending = pendingCheckIns(week, checkins, dateISO);
    if (now >= gate && pending.length) {
      return {
        type: "check-in",
        key: `checkin:${dateISO}`,
        session: pending[0],
        pending,
        facts: {
          activityName: activity.name,
          plannedMinutes: pending[0].plannedMinutes,
          loggedMinutes: 0,
        },
      };
    }
  }

  // 3) Behind on the week (after at least one session has started).
  const progress = weeklyProgress(activity, week, checkins, timerLogs, timer, now);
  if (progress.behind && !running) {
    return {
      type: "behind",
      key: `behind:${week.weekId}`,
      facts: {
        activityName: activity.name,
        plannedMinutes: progress.target,
        loggedMinutes: Math.round(progress.logged),
        expectedMinutes: progress.expectedEnded || progress.expected,
      },
    };
  }

  return null;
}

/**
 * Combine evaluation with snooze / ack / repeat timing.
 * Returns { action: 'fire'|'wait'|'idle', nag, intervalMs, reason }
 */
export function applyNagTiming(candidate, nagState, cfg, now) {
  if (!candidate) return { action: "idle", nag: null, intervalMs: nagState?.intervalMs ?? null };
  const t = now.getTime ? now.getTime() : now;
  if (nagState?.snoozeUntil && t < nagState.snoozeUntil) {
    return { action: "wait", nag: candidate, intervalMs: nagState.intervalMs, reason: "snoozed" };
  }
  // Acknowledged this same key — stay quiet until a different key appears.
  if (nagState?.ackKey && nagState.ackKey === candidate.key) {
    return { action: "wait", nag: candidate, intervalMs: nagState.intervalMs, reason: "acked" };
  }
  const last = nagState?.lastFiredAt || 0;
  const interval = nagState?.intervalMs != null && nagState.lastKey === candidate.key
    ? nagState.intervalMs
    : 0; // fire immediately the first time a key appears
  if (nagState?.lastKey === candidate.key && last && t - last < interval) {
    return { action: "wait", nag: candidate, intervalMs: interval, reason: "interval" };
  }
  const next = nagState?.lastKey === candidate.key
    ? nextIntervalMs(nagState.intervalMs, cfg)
    : cfg.intervalStartMs;
  return { action: "fire", nag: candidate, intervalMs: next };
}

export function stateAfterFire(nagState, candidate, intervalMs, now) {
  return {
    lastKey: candidate.key,
    lastFiredAt: now.getTime ? now.getTime() : now,
    intervalMs,
    ackKey: null,
    snoozeUntil: null,
    snoozeCount: nagState?.lastKey === candidate.key ? (nagState.snoozeCount || 0) : 0,
  };
}

export function stateAfterAck(nagState, key) {
  return {
    ...(nagState || {}),
    ackKey: key,
    snoozeUntil: null,
  };
}

export function stateAfterSnooze(nagState, cfg, now) {
  const count = (nagState?.snoozeCount || 0) + 1;
  if (count > cfg.maxSnoozes) return { ok: false, state: nagState };
  return {
    ok: true,
    state: {
      ...(nagState || {}),
      snoozeCount: count,
      snoozeUntil: (now.getTime ? now.getTime() : now) + cfg.snoozeMs,
      ackKey: null,
    },
  };
}
