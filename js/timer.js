/** Timer math against a target. Pure functions. */

export function createTimerState() {
  return {
    running: false,
    startedAt: null,
    accumulatedMs: 0,
    targetId: null, // 'day' or a task id
  };
}

export function elapsedMs(timer, now) {
  if (!timer) return 0;
  const extra = timer.running && timer.startedAt ? Math.max(0, now - timer.startedAt) : 0;
  return Math.max(0, (timer.accumulatedMs || 0) + extra);
}

export function startTimer(timer, now, targetId) {
  const t = { ...timer };
  if (targetId != null) t.targetId = targetId;
  if (t.running) return t;
  t.running = true;
  t.startedAt = now;
  return t;
}

export function pauseTimer(timer, now) {
  const t = { ...timer };
  if (!t.running) return t;
  t.accumulatedMs = elapsedMs(t, now);
  t.running = false;
  t.startedAt = null;
  return t;
}

export function stopTimer(timer, now) {
  const finalMs = elapsedMs(timer, now);
  const targetId = timer?.targetId ?? null;
  return {
    timer: createTimerState(),
    finalMs,
    targetId,
  };
}

export function switchTarget(timer, now, targetId) {
  // Pause current accumulation into accumulatedMs, keep running against new target
  // Caller should record a session for the old target first.
  let t = timer.running ? pauseTimer(timer, now) : { ...timer };
  t.accumulatedMs = 0;
  t.targetId = targetId;
  if (timer.running) t = startTimer(t, now, targetId);
  return t;
}

export function remainingMs(targetMs, elapsed) {
  return targetMs - elapsed;
}

export function progressRatio(targetMs, elapsed) {
  if (!targetMs || targetMs <= 0) return 0;
  return Math.max(0, elapsed / targetMs);
}

/**
 * Behind pace if remaining work cannot fit before end of day,
 * or if more than half the day has passed and less than 40% of the target is done.
 */
export function isBehindPace({ now, targetMs, elapsedMs, dayStart, dayEnd }) {
  if (!targetMs || targetMs <= 0) return false;
  const remainingWork = Math.max(0, targetMs - elapsedMs);
  if (remainingWork <= 0) return false;
  const leftInDay = Math.max(0, dayEnd - now);
  if (remainingWork > leftInDay) return true;
  const dayLen = Math.max(1, dayEnd - dayStart);
  const dayGone = (now - dayStart) / dayLen;
  const done = elapsedMs / targetMs;
  if (dayGone >= 0.5 && done < 0.4) return true;
  if (dayGone >= 0.75 && done < 0.65) return true;
  return false;
}

export function todayTotalMs(sessions, dateISO, liveTimer, now) {
  let total = 0;
  for (const s of sessions || []) {
    if (s.date === dateISO) total += s.ms || 0;
  }
  if (liveTimer && liveTimer.running) {
    // live elapsed is already all current-run time; accumulatedMs may include
    // unsaved current-target time that hasn't been written as a session yet.
    // We persist segments on pause; while running, add live elapsed for this run
    // plus any accumulated not yet flushed. Sessions include previous segments.
    // accumulatedMs is "unflushed" time for the current target since last stop
    // only if we don't flush on pause into sessions. Our app flushes on pause,
    // so while running only startedAt..now should be added (accumulatedMs is 0
    // after a pause flush). Mid-run accumulatedMs could be non-zero if we
    // didn't flush; include it only when not already in sessions.
    total += elapsedMs(liveTimer, now) - (liveTimer._flushedMs || 0);
  } else if (liveTimer && !liveTimer.running && liveTimer.accumulatedMs) {
    total += liveTimer.accumulatedMs;
  }
  return Math.max(0, total);
}
