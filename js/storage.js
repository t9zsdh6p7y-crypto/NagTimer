/** Local persistence (localStorage). All app state lives in one document. */

import { createTimerState } from "./timer.js";
import { getOrCreateUserId, persistUserId } from "./identity.js";
import { ensureActivityId } from "./history.js";

const KEY = "nag-v1";

export function defaultState() {
  return {
    version: 1,
    userId: null,
    history: [],
    activity: null,
    week: null,
    checkins: {},
    timer: createTimerState(),
    timerLogs: [],
    nag: {
      lastKey: null,
      lastFiredAt: null,
      intervalMs: null,
      ackKey: null,
      snoozeUntil: null,
      snoozeCount: 0,
    },
    settings: {
      voiceEnabled: true,
      speakReplies: true,
      notificationsEnabled: false,
    },
    coach: {
      step: null,
      draft: null,
      log: [],
    },
  };
}

export function loadState() {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const s = raw ? migrate(JSON.parse(raw)) : defaultState();
    return finalize(s);
  } catch {
    return finalize(defaultState());
  }
}

export function saveState(state) {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.warn("save failed", err);
  }
}

export function clearState() {
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {}
  // Keep the stable user id so a later friend graph still points here.
  return finalize(defaultState());
}

function migrate(parsed) {
  const base = defaultState();
  return {
    ...base,
    ...parsed,
    version: 1,
    timer: { ...base.timer, ...(parsed.timer || {}) },
    settings: { ...base.settings, ...(parsed.settings || {}) },
    nag: { ...base.nag, ...(parsed.nag || {}) },
    checkins: parsed.checkins || {},
    timerLogs: parsed.timerLogs || [],
    history: parsed.history || [],
    userId: parsed.userId || null,
    coach: { ...base.coach, ...(parsed.coach || {}) },
  };
}

function finalize(s) {
  s.userId = getOrCreateUserId(undefined, s.userId);
  persistUserId(s.userId);
  if (s.activity && !s.activity.id) s.activity = ensureActivityId(s.activity);
  if (!Array.isArray(s.history)) s.history = [];
  return s;
}

export function exportState(state) {
  return JSON.stringify(state, null, 2);
}

export function importState(json) {
  const parsed = typeof json === "string" ? JSON.parse(json) : json;
  return migrate(parsed);
}

export { KEY };
