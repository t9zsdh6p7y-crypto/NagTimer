/**
 * Coach persona and copy layer.
 * All user-facing coach / nag wording lives here, not in logic modules.
 * Swap tone by intensity without touching timing or plan math.
 */

export const PERSONA = {
  id: "reed",
  name: "Reed",
  title: "practice coach",
  // Warm but firm. Short sentences. No slang pile-up, no cheerleading.
  summary:
    "Reed is a warm but firm practice coach. Encourages clearly, does not sugarcoat missed time, and keeps the focus on the plan the user already made.",
  // Preferred speechSynthesis hints (browser may ignore).
  voice: {
    rate: 0.95,
    pitch: 0.95,
    lang: "en-US",
    prefer: /en-US|en_US|English.*United States/i,
    preferGenderHint: "male", // best-effort only
  },
};

const TONE = {
  gentle: "gentle",
  moderate: "moderate",
  strict: "strict",
};

function pick(intensity, map) {
  return map[intensity] || map.moderate;
}

function n(mins) {
  const m = Math.round(Number(mins) || 0);
  if (m >= 60 && m % 60 === 0) return `${m / 60} hour${m === 60 ? "" : "s"}`;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return `${h} hour${h === 1 ? "" : "s"} ${r} minutes`;
  }
  return `${m} minute${m === 1 ? "" : "s"}`;
}

export function greeting(firstTime = true) {
  if (firstTime) {
    return `Hi, I'm ${PERSONA.name}. I'll help you set up a practice plan, then I'll check in and nudge you when it's time — or when you fall behind. You can talk to me or type. What activity are we planning? For example, piano lessons or studying.`;
  }
  return `It's ${PERSONA.name}. What should we adjust?`;
}

/** Setup dialogue lines. */
export const SETUP_COPY = {
  askActivity: `What activity are we planning?`,
  askTimeFrame: (name) =>
    `Is the time goal for ${name} per day, per week, or per month?`,
  askGoal: (name, frame) => {
    if (frame === "day") {
      return `How much time on each day you practice ${name}? For example, "30 minutes" or "an hour."`;
    }
    if (frame === "month") {
      return `How much total time do you want for ${name} each month? For example, "ten hours."`;
    }
    return `How much total time do you want to spend on ${name} each week? You can say something like "three hours" or "90 minutes."`;
  },
  askWeekStyle: (perWeekLabel, weekCount) =>
    `Spread across ${weekCount} weeks this month, that's about ${perWeekLabel} a week. Use the same goal every week, or set a different goal for each week?`,
  askWeekGoal: (index, count, label) =>
    `How much time in week ${index + 1} of ${count} (${label})?`,
  askSessions: (name, goalLabel, frame) => {
    if (frame === "day") return `${goalLabel} on each day you do ${name}. How many sessions per week?`;
    if (frame === "month") return `${goalLabel} a month on ${name}. How many sessions per week?`;
    return `${goalLabel} a week on ${name}. How many sessions per week?`;
  },
  askDays: (count) =>
    count === 1
      ? `Which day should that session be on?`
      : `Which ${count} days should those sessions be on?`,
  askDaysMismatch: (count, got) =>
    `I need exactly ${count} day${count === 1 ? "" : "s"}, and I heard ${got}. Try again?`,
  askStartOne: (dayName) => `What start time on ${dayName}?`,
  askStartAll: (daysLabel) =>
    `What start time? You can give one time for every session, or a time for each day (${daysLabel}).`,
  confirmPlan: (summary) => `Here's the plan I'm picturing:\n${summary}\nDoes that look right?`,
  adjustPrompt: `What should we change — the activity, the time goal, the days, or the times?`,
  askCheckIn: `What time should I check in with you each day, to log whether you did that day's session and for how many minutes?`,
  askIntensity: `How hard should I nudge you? Gentle, Moderate, or Strict. Moderate is the default.`,
  done: (name) =>
    `You're set. I'll use this plan, check in daily, and nudge you when a session starts or you fall behind. Open Setup any time to edit it, or the Week tab to tweak a day. Let's get to ${name}.`,
  fallback: `I didn't catch that. You can type it instead, use Back, or switch to the manual form.`,
  useManual: `No problem. Use the manual form and I'll stay out of the way.`,
  keptAnswer: (value) => `Current answer: ${value}. Send a new one to change it.`,
};

export function planSummaryLines(activity) {
  const days = (activity.schedule || [])
    .map((s) => {
      const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      return `• ${names[s.weekday]} at ${s.start}, ${n(activity.sessionLengthMinutes)}`;
    })
    .join("\n");
  const frame = activity.timeFrame || "week";
  const goal = n(activity.goalMinutes ?? activity.weeklyTargetMinutes);
  let head;
  if (frame === "day") head = `${goal} on each practice day`;
  else if (frame === "month") {
    if (activity.weekStyle === "custom" && activity.weekGoals?.length) {
      const weeks = activity.weekGoals.map((m, i) => `week ${i + 1} ${n(m)}`).join(", ");
      head = `${weeks}`;
    } else head = `${goal} a month, same goal each week`;
  } else head = `${goal} a week`;
  return `${activity.name}: ${head}, ${activity.sessionsPerWeek} sessions.\n${days}`;
}

/**
 * Nag / nudge copy. Intensity changes tone, not just frequency.
 * `facts` may include activityName, plannedMinutes, loggedMinutes, expectedMinutes, start.
 */
export function nagCopy(type, intensity, facts = {}) {
  const name = facts.activityName || "your session";
  const planned = n(facts.plannedMinutes ?? 0);
  const logged = n(facts.loggedMinutes ?? 0);
  const expected = facts.expectedMinutes != null ? n(facts.expectedMinutes) : null;
  const start = facts.start;

  if (type === "session-start" || type === "session-active") {
    return pick(intensity, {
      gentle: start
        ? `Hey — your ${name} block starts at ${start}. Whenever you're ready, start the timer.`
        : `Your ${name} block is here. Start when you're ready.`,
      moderate: start
        ? `${name} starts at ${start}. Let's get to it.`
        : `${name} is on the calendar now. Start the timer.`,
      strict: `It's time. ${name} starts now. You planned ${planned}. Start the timer.`,
    });
  }

  if (type === "check-in") {
    return pick(intensity, {
      gentle: `Quick check-in: did you get to ${name} today? Tell me how many minutes, even if it was short.`,
      moderate: `Check-in time. Did you do ${name} today, and for how many minutes?`,
      strict: `Check in now. ${name} was on today's plan. Did you do it? How many minutes?`,
    });
  }

  if (type === "friend-nag") {
    const who = facts.fromName || "A friend";
    return pick(intensity, {
      gentle: `${who} sent a nudge about ${name}. Even a short session would help. You've logged ${logged} of ${planned}.`,
      moderate: `${who} is nagging you about ${name}. You said ${planned}. You've done ${logged}.`,
      strict: `${who} hit nag. You said ${planned}. You've done ${logged}. Get back to it.`,
    });
  }

  if (type === "behind") {
    return pick(intensity, {
      gentle: expected
        ? `We're a little behind on ${name}. You'd planned about ${expected} by now, and you've logged ${logged}. Even a short session would help.`
        : `We're a little behind on ${name}. You've logged ${logged} of ${planned}. A short session still counts.`,
      moderate: `You're behind on this week's ${name}. You said ${planned}. You've done ${logged}. Let's close the gap.`,
      strict: `You said ${planned}. You've done ${logged}. Get back to it.`,
    });
  }

  return pick(intensity, {
    gentle: `A gentle reminder to come back to ${name}.`,
    moderate: `Time to come back to ${name}.`,
    strict: `Get back to ${name}.`,
  });
}

export function ackCopy(intensity) {
  return pick(intensity, {
    gentle: "Okay. I'll leave you to it.",
    moderate: "Good. I'm here if you drift.",
    strict: "Don't waste it. Get started.",
  });
}

export function snoozeCopy(intensity, minutes, remaining) {
  if (remaining <= 0) {
    return pick(intensity, {
      gentle: "That's the last snooze I can give you for this one.",
      moderate: "No more snoozes on this reminder.",
      strict: "Snooze is used up. Deal with it now.",
    });
  }
  return pick(intensity, {
    gentle: `Alright. I'll check back in ${minutes} minutes.`,
    moderate: `Snoozed for ${minutes} minutes. ${remaining} left after that.`,
    strict: `${minutes} minutes. That's ${remaining} snooze${remaining === 1 ? "" : "s"} remaining.`,
  });
}

export function checkInPrompt(session, intensity) {
  const name = session.activityName || "your session";
  return pick(intensity, {
    gentle: `Did ${name} happen today? If yes, about how many minutes?`,
    moderate: `Did you do ${name}? How many minutes? You planned ${n(session.plannedMinutes)}.`,
    strict: `${name}: done or not? How many minutes? You committed to ${n(session.plannedMinutes)}.`,
  });
}

export function checkInThanks(minutes, weeklyLabel, intensity) {
  return pick(intensity, {
    gentle: `Logged ${n(minutes)}. ${weeklyLabel}. Thanks for checking in.`,
    moderate: `${n(minutes)} recorded. ${weeklyLabel}.`,
    strict: `${n(minutes)} logged. ${weeklyLabel}. Keep to the plan.`,
  });
}

export { TONE, n as formatSpokenMinutes };
