/**
 * Timestamped progress history, per day and per week, per activity.
 * v1 writes this locally so a later social layer can show change over time
 * (and optionally share a slice with a friend). No social UI in v1.
 */

import { localDateISO, weekStartISO, uid } from "./util.js";

export function activityKey(activity) {
  if (!activity) return "activity";
  if (activity.id) return activity.id;
  const name = String(activity.name || "activity").trim().toLowerCase();
  return `act:${name}`;
}

export function ensureActivityId(activity) {
  if (!activity) return activity;
  if (activity.id) return activity;
  return { ...activity, id: uid("act") };
}

/**
 * Snapshot logged vs target for a day or week.
 * @param {'day'|'week'} period
 */
export function makeSnapshot({
  period,
  at,
  date,
  weekId,
  activity,
  loggedMinutes,
  targetMinutes,
  source = "local",
}) {
  const when = at instanceof Date ? at : new Date(at || Date.now());
  const day = date || localDateISO(when);
  return {
    id: uid("hist"),
    at: when.toISOString(),
    period, // 'day' | 'week'
    date: period === "day" ? day : (weekId || day),
    weekId: weekId || weekStartISO(when, activity?.weekStartsOn ?? 1),
    activityId: activityKey(activity),
    activityName: activity?.name || "",
    loggedMinutes: Math.round(Number(loggedMinutes) || 0),
    targetMinutes: Math.round(Number(targetMinutes) || 0),
    source,
  };
}

/** Replace or insert the latest snapshot for the same period + date + activity. */
export function upsertSnapshot(history, snap) {
  const list = [...(history || [])];
  const i = list.findIndex((h) =>
    h.period === snap.period &&
    h.date === snap.date &&
    h.activityId === snap.activityId
  );
  if (i >= 0) list[i] = { ...list[i], ...snap, id: list[i].id };
  else list.push(snap);
  list.sort((a, b) => a.at.localeCompare(b.at));
  return list;
}

export function snapshotsFor(history, { activityId, period, weekId } = {}) {
  return (history || []).filter((h) => {
    if (activityId && h.activityId !== activityId) return false;
    if (period && h.period !== period) return false;
    if (weekId && h.weekId !== weekId) return false;
    return true;
  });
}

/** Ordered change between consecutive snapshots (for a later friend progress view). */
export function changeOverTime(history, { activityId, period = "week" } = {}) {
  const rows = snapshotsFor(history, { activityId, period })
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at));
  return rows.map((row, i) => {
    const prev = i > 0 ? rows[i - 1] : null;
    return {
      ...row,
      deltaLogged: prev ? row.loggedMinutes - prev.loggedMinutes : null,
      deltaRatio:
        prev && prev.targetMinutes
          ? (row.loggedMinutes / (row.targetMinutes || 1)) - (prev.loggedMinutes / (prev.targetMinutes || 1))
          : null,
    };
  });
}
