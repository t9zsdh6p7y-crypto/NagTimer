/**
 * Manual setup steps and back navigation.
 * Pure state: the UI renders whatever step this returns, and drafts are copied
 * so going back does not wipe an earlier answer.
 */

export function emptyManualDraft() {
  return {
    name: "",
    timeFrame: "week",
    goalMinutes: 180,
    weekStyle: "even",
    weekGoals: null,
    weeklyTargetMinutes: 180,
    sessionsPerWeek: 3,
    sessionLengthMinutes: 60,
    sessionLengthCustom: false,
    schedule: [],
    checkInTime: "20:00",
    intensity: "moderate",
    weekStartsOn: 1,
    id: null,
  };
}

export function cloneManualDraft(draft) {
  const base = emptyManualDraft();
  const src = draft || {};
  return {
    ...base,
    ...src,
    schedule: (src.schedule || []).map((s) => ({ ...s })),
    weekGoals: Array.isArray(src.weekGoals) ? [...src.weekGoals] : null,
  };
}

export function draftFromActivity(activity) {
  if (!activity) return emptyManualDraft();
  const goal = activity.goalMinutes != null ? activity.goalMinutes : activity.weeklyTargetMinutes;
  return cloneManualDraft({
    id: activity.id || null,
    name: activity.name || "",
    timeFrame: activity.timeFrame || "week",
    goalMinutes: goal ?? 180,
    weekStyle: activity.weekStyle || (Array.isArray(activity.weekGoals) && activity.weekGoals.length ? "custom" : "even"),
    weekGoals: Array.isArray(activity.weekGoals) ? activity.weekGoals : null,
    weeklyTargetMinutes: activity.weeklyTargetMinutes,
    sessionsPerWeek: activity.sessionsPerWeek || 3,
    sessionLengthMinutes: activity.sessionLengthMinutes || 60,
    sessionLengthCustom: activity.sessionLengthCustom === true,
    schedule: activity.schedule || [],
    checkInTime: activity.checkInTime || "20:00",
    intensity: activity.intensity || "moderate",
    weekStartsOn: activity.weekStartsOn ?? 1,
  });
}

/** Steps that apply to this draft. Month plans add the week-by-week questions. */
export function manualSteps(draft) {
  const frame = draft?.timeFrame || "week";
  const steps = ["name", "timeFrame", "goal"];
  if (frame === "month") {
    steps.push("weekStyle");
    if (draft?.weekStyle === "custom") steps.push("weekGoals");
  }
  steps.push("sessions", "days", "length", "checkIn", "intensity", "review");
  return steps;
}

export function goBackManual(step, draft) {
  const copy = cloneManualDraft(draft);
  const steps = manualSteps(copy);
  const i = steps.indexOf(step);
  if (i <= 0) return { step: steps[0] || "name", draft: copy, atStart: true };
  return { step: steps[i - 1], draft: copy, atStart: false };
}

export function goForwardManual(step, draft) {
  const copy = cloneManualDraft(draft);
  const steps = manualSteps(copy);
  const i = steps.indexOf(step);
  if (i < 0) return { step: "review", draft: copy, done: false };
  if (i >= steps.length - 1) return { step: steps[i], draft: copy, done: true };
  return { step: steps[i + 1], draft: copy, done: false };
}
