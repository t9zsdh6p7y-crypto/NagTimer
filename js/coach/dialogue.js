/**
 * Rule-based guided setup dialogue.
 * Fills the same activity fields as the manual form.
 * No network. Swappable via CoachEngine.
 */

import { CoachEngine } from "./interface.js";
import { PERSONA, SETUP_COPY, planSummaryLines, greeting } from "./persona.js";
import {
  dowFromName,
  parseDurationMinutes,
  parseTimeInput,
  parseISODate,
  WEEKDAY_NAMES,
  formatMinutes,
} from "../util.js";
import {
  deriveSessionLength,
  validatePlan,
  normalizeActivity,
  weeklyMinutesFor,
  weekOfMonth,
} from "../plan.js";

const STEPS = [
  "askActivity",
  "askTimeFrame",
  "askGoal",
  "askWeekStyle",
  "askWeekGoals",
  "askSessions",
  "askDays",
  "askStartTimes",
  "confirmPlan",
  "askCheckIn",
  "askIntensity",
  "done",
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function emptyDraft() {
  return {
    name: "",
    timeFrame: null,
    goalMinutes: null,
    weekStyle: "even",
    weekGoals: null,
    weekGoalIndex: 0,
    weeklyTargetMinutes: null,
    sessionsPerWeek: null,
    sessionLengthMinutes: null,
    sessionLengthCustom: false,
    schedule: [],
    checkInTime: "",
    intensity: "moderate",
    weekStartsOn: 1,
  };
}

function cloneDraft(draft) {
  const d = { ...emptyDraft(), ...(draft || {}) };
  d.schedule = (draft?.schedule || []).map((s) => ({ ...s }));
  d.weekGoals = Array.isArray(draft?.weekGoals) ? [...draft.weekGoals] : null;
  return d;
}

/** Steps that apply. Week-by-week questions only appear for a monthly goal. */
export function flowSteps(draft) {
  const steps = ["askActivity", "askTimeFrame", "askGoal"];
  if (draft?.timeFrame === "month") {
    steps.push("askWeekStyle");
    if (draft.weekStyle === "custom") steps.push("askWeekGoals");
  }
  steps.push(
    "askSessions",
    "askDays",
    "askStartTimes",
    "confirmPlan",
    "askCheckIn",
    "askIntensity",
    "done",
  );
  return steps;
}

/**
 * Move to the previous setup step. The draft is copied and kept, including
 * answers for the step you land on, so a wrong answer can be replaced.
 */
export function goBack(step, draft) {
  const d = cloneDraft(draft);
  if (step === "askWeekGoals") {
    const idx = Number.isInteger(d.weekGoalIndex) ? d.weekGoalIndex : 0;
    if (idx > 0) {
      d.weekGoalIndex = idx - 1;
      return { step: "askWeekGoals", draft: d, atStart: false };
    }
  }
  const steps = flowSteps(d);
  let i = steps.indexOf(step);
  if (i < 0) i = 0;
  if (i === 0) return { step: "askActivity", draft: d, atStart: true };
  const prev = steps[i - 1];
  if (prev === "askWeekGoals") {
    const count = Array.isArray(d.weekGoals) ? d.weekGoals.length : 1;
    d.weekGoalIndex = Math.max(0, count - 1);
  }
  return { step: prev, draft: d, atStart: false };
}

function parseYesNo(text) {
  const s = String(text).trim().toLowerCase();
  if (/^(y|yes|yeah|yep|yup|sure|ok|okay|looks good|that's right|thats right|correct|confirm|done|perfect|great)$/.test(s)) {
    return true;
  }
  if (/^(n|no|nope|nah|change|wait|wrong|not quite|edit|adjust)$/.test(s)) {
    return false;
  }
  return null;
}

function parseSessionCount(text) {
  const s = String(text).trim().toLowerCase();
  const words = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
    eight: 8, nine: 9, ten: 10, once: 1, twice: 2,
  };
  if (words[s] != null) return words[s];
  const m = s.match(/(\d+)/);
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 14) return n;
  }
  return null;
}

function parseDaysList(text) {
  const s = String(text).trim().toLowerCase();
  if (/every day|everyday|daily|all week/.test(s)) return [0, 1, 2, 3, 4, 5, 6];
  if (/weekday/.test(s)) return [1, 2, 3, 4, 5];
  if (/weekend/.test(s)) return [0, 6];
  const parts = s.split(/,|&|\band\b|\s+/).map((p) => p.trim()).filter(Boolean);
  const days = [];
  for (const p of parts) {
    const d = dowFromName(p);
    if (d != null && !days.includes(d)) days.push(d);
  }
  return days;
}

function parseTimes(text, count) {
  const s = String(text).trim();
  const chunks = s.split(/,|;|\band\b/i).map((c) => c.trim()).filter(Boolean);
  const times = [];
  for (const c of chunks) {
    const at = c.match(/(?:at\s+)?(.+)$/i);
    const t = parseTimeInput((at ? at[1] : c).replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\s+/i, "").trim());
    if (t) times.push(t);
  }
  if (times.length === 1 && count > 1) {
    return Array(count).fill(times[0]);
  }
  return times;
}

function parseIntensity(text) {
  const s = String(text).trim().toLowerCase();
  if (/gentle|easy|soft|kind|light/.test(s)) return "gentle";
  if (/strict|hard|tough|aggressive|firm|intense/.test(s)) return "strict";
  if (/moderate|medium|default|normal|regular|middle/.test(s)) return "moderate";
  return null;
}

function parseTimeFrame(text) {
  const s = String(text).trim().toLowerCase();
  if (/^(d|day|daily)$/.test(s) || /\bper day\b|\beach day\b|\ba day\b|\bdaily\b|\bevery day\b/.test(s)) return "day";
  if (/^(m|month|monthly)$/.test(s) || /\bper month\b|\beach month\b|\ba month\b|\bmonthly\b/.test(s)) return "month";
  if (/^(w|week|weekly)$/.test(s) || /\bper week\b|\beach week\b|\ba week\b|\bweekly\b/.test(s)) return "week";
  return null;
}

function parseWeekStyle(text) {
  const s = String(text).trim().toLowerCase();
  if (/different|custom|set each|week by week|ramp|vary|each week(?! the same)/.test(s)) return "custom";
  if (/same|even|equal|default|every week|all the same/.test(s)) return "even";
  return null;
}

function parseCheckInTime(text) {
  return parseTimeInput(text);
}

function daysLabel(days) {
  return days.map((d) => WEEKDAY_NAMES[d]).join(", ");
}

function frameLabel(frame) {
  if (frame === "day") return "per day";
  if (frame === "month") return "per month";
  return "per week";
}

function monthInfo(draft, now) {
  return weekOfMonth(now || new Date(), draft.weekStartsOn ?? 1);
}

function weekLabel(iso) {
  if (!iso) return "this week";
  const d = parseISODate(iso);
  return `week of ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function syncDraft(draft, now) {
  const weekly = weeklyMinutesFor(draft, now || new Date());
  if (weekly > 0) draft.weeklyTargetMinutes = weekly;
  if (draft.sessionLengthCustom) return draft;
  if (draft.weeklyTargetMinutes && draft.sessionsPerWeek) {
    const derived = deriveSessionLength(draft.weeklyTargetMinutes, draft.sessionsPerWeek);
    if (derived.ok) draft.sessionLengthMinutes = derived.minutes;
  }
  return draft;
}

function withCurrent(text, current) {
  if (current == null || current === "") return text;
  return `${text}\n\n${SETUP_COPY.keptAnswer(current)}`;
}

export function stepMeta(step, draft, now = new Date()) {
  const d = draft || emptyDraft();
  if (step === "askActivity") {
    return {
      text: withCurrent(SETUP_COPY.askActivity, d.name || null),
      choices: null,
      inputHint: "text",
    };
  }
  if (step === "askTimeFrame") {
    return {
      text: withCurrent(SETUP_COPY.askTimeFrame(d.name || "this"), d.timeFrame ? frameLabel(d.timeFrame) : null),
      choices: ["Per day", "Per week", "Per month"],
      inputHint: "text",
    };
  }
  if (step === "askGoal") {
    const current = d.goalMinutes ? formatMinutes(d.goalMinutes) : null;
    return {
      text: withCurrent(SETUP_COPY.askGoal(d.name || "this", d.timeFrame || "week"), current),
      choices: null,
      inputHint: "duration",
    };
  }
  if (step === "askWeekStyle") {
    const info = monthInfo(d, now);
    const share = info.count ? Math.round((Number(d.goalMinutes) || 0) / info.count) : 0;
    return {
      text: withCurrent(
        SETUP_COPY.askWeekStyle(formatMinutes(share), info.count),
        d.weekStyle === "custom" ? "a different goal each week" : (d.weekStyle === "even" && d.goalMinutes ? "the same goal every week" : null),
      ),
      choices: ["Same every week", "Set each week"],
      inputHint: "text",
    };
  }
  if (step === "askWeekGoals") {
    const info = monthInfo(d, now);
    const idx = Math.max(0, Math.min(info.count - 1, Number.isInteger(d.weekGoalIndex) ? d.weekGoalIndex : 0));
    const label = weekLabel(info.weeks[idx]);
    const current = Array.isArray(d.weekGoals) && d.weekGoals[idx] ? formatMinutes(d.weekGoals[idx]) : null;
    return {
      text: withCurrent(SETUP_COPY.askWeekGoal(idx, info.count, label), current),
      choices: null,
      inputHint: "duration",
    };
  }
  if (step === "askSessions") {
    return {
      text: withCurrent(
        SETUP_COPY.askSessions(d.name || "this", formatMinutes(d.goalMinutes), d.timeFrame || "week"),
        d.sessionsPerWeek || null,
      ),
      choices: null,
      inputHint: "number",
    };
  }
  if (step === "askDays") {
    const current = d.schedule?.length ? daysLabel(d.schedule.map((s) => s.weekday)) : null;
    return {
      text: withCurrent(SETUP_COPY.askDays(d.sessionsPerWeek || 1), current),
      choices: null,
      inputHint: "days",
    };
  }
  if (step === "askStartTimes") {
    const current = d.schedule?.some((s) => s.start) ? d.schedule.map((s) => s.start).filter(Boolean).join(", ") : null;
    return {
      text: withCurrent(SETUP_COPY.askStartAll(daysLabel((d.schedule || []).map((s) => s.weekday))), current),
      choices: null,
      inputHint: "time",
    };
  }
  if (step === "confirmPlan") {
    syncDraft(d, now);
    const summary = planSummaryLines(normalizeActivity(d, now));
    return {
      text: SETUP_COPY.confirmPlan(summary),
      choices: ["Yes", "No"],
      inputHint: "confirm",
    };
  }
  if (step === "askCheckIn") {
    return {
      text: withCurrent(SETUP_COPY.askCheckIn, d.checkInTime || null),
      choices: null,
      inputHint: "time",
    };
  }
  if (step === "askIntensity") {
    return {
      text: withCurrent(SETUP_COPY.askIntensity, d.intensity ? d.intensity[0].toUpperCase() + d.intensity.slice(1) : null),
      choices: ["Gentle", "Moderate", "Strict"],
      inputHint: "intensity",
    };
  }
  return {
    text: SETUP_COPY.done(d.name || "this"),
    choices: null,
    inputHint: null,
  };
}

export function promptForStep(step, draft, now = new Date()) {
  return stepMeta(step, draft, now).text;
}

function turn(reply, draft, step, extras = {}) {
  return {
    reply,
    draft,
    step,
    done: step === "done",
    persona: PERSONA.name,
    engine: "rules",
    ...extras,
  };
}

function ask(step, draft, now, extras = {}) {
  const meta = stepMeta(step, draft, now);
  return turn(meta.text, draft, step, {
    inputHint: meta.inputHint,
    choices: meta.choices,
    prompt: meta.text,
    ...extras,
  });
}

export class RuleBasedCoach extends CoachEngine {
  async start(context = {}) {
    const draft = cloneDraft(context.draft);
    return turn(greeting(true), draft, "askActivity", {
      inputHint: "text",
      prompt: SETUP_COPY.askActivity,
      choices: null,
    });
  }

  async respond(userText, context = {}) {
    const raw = String(userText || "").trim();
    const now = context.now instanceof Date ? context.now : new Date();
    let draft = cloneDraft(context.draft);
    let step = context.step || "askActivity";

    if (!raw) {
      const meta = stepMeta(step, draft, now);
      return turn(SETUP_COPY.fallback, draft, step, { inputHint: meta.inputHint, choices: meta.choices });
    }

    if (/^(back|go back)$/i.test(raw)) {
      const prev = goBack(step, draft);
      if (prev.atStart && step === "askActivity") {
        return ask("askActivity", prev.draft, now);
      }
      return ask(prev.step, prev.draft, now, { wentBack: true });
    }

    if (/^(manual|form|I'll type|ill type|switch)$/i.test(raw)) {
      return turn(SETUP_COPY.useManual, draft, step, { switchToManual: true });
    }

    if (step === "askActivity") {
      const name = raw.replace(/^(i want to |let's (do|plan) |lets (do|plan) |my |practice )/i, "").trim();
      if (name.length < 2) {
        return turn("Give me a short name for the activity, like “piano” or “Spanish.”", draft, step, {
          inputHint: "text",
        });
      }
      draft.name = name.replace(/\.$/, "");
      return ask("askTimeFrame", draft, now);
    }

    if (step === "askTimeFrame") {
      const frame = parseTimeFrame(raw);
      if (!frame) {
        return turn(
          `Tell me per day, per week, or per month.`,
          draft,
          step,
          { inputHint: "text", choices: ["Per day", "Per week", "Per month"] },
        );
      }
      draft.timeFrame = frame;
      if (frame !== "month") {
        draft.weekStyle = "even";
      }
      return ask("askGoal", draft, now);
    }

    if (step === "askGoal") {
      const mins = parseDurationMinutes(raw);
      if (mins == null || mins <= 0) {
        const frame = draft.timeFrame || "week";
        const hint = frame === "day" ? "each day" : frame === "month" ? "each month" : "each week";
        return turn(
          `I need a time for ${hint}, like “three hours” or “90 minutes.”`,
          draft,
          step,
          { inputHint: "duration" },
        );
      }
      draft.goalMinutes = mins;
      syncDraft(draft, now);
      if (draft.timeFrame === "month") return ask("askWeekStyle", draft, now);
      return ask("askSessions", draft, now);
    }

    if (step === "askWeekStyle") {
      const style = parseWeekStyle(raw);
      if (!style) {
        return turn(
          `Say “same every week” or “set each week.”`,
          draft,
          step,
          { inputHint: "text", choices: ["Same every week", "Set each week"] },
        );
      }
      draft.weekStyle = style;
      if (style === "even") {
        draft.weekGoals = null;
        syncDraft(draft, now);
        return ask("askSessions", draft, now);
      }
      draft.weekGoalIndex = 0;
      if (!Array.isArray(draft.weekGoals)) draft.weekGoals = [];
      return ask("askWeekGoals", draft, now);
    }

    if (step === "askWeekGoals") {
      const info = monthInfo(draft, now);
      const idx = Math.max(0, Math.min(info.count - 1, Number.isInteger(draft.weekGoalIndex) ? draft.weekGoalIndex : 0));
      const mins = parseDurationMinutes(raw);
      if (mins == null || mins <= 0) {
        return turn(
          `How many minutes or hours for ${weekLabel(info.weeks[idx])}?`,
          draft,
          step,
          { inputHint: "duration" },
        );
      }
      const goals = Array.isArray(draft.weekGoals) ? [...draft.weekGoals] : [];
      while (goals.length < info.count) goals.push(null);
      goals[idx] = mins;
      draft.weekGoals = goals;
      draft.weekStyle = "custom";
      if (idx < info.count - 1) {
        draft.weekGoalIndex = idx + 1;
        return ask("askWeekGoals", draft, now);
      }
      draft.weekGoalIndex = info.count;
      syncDraft(draft, now);
      return ask("askSessions", draft, now);
    }

    if (step === "askSessions") {
      const n = parseSessionCount(raw);
      if (n == null) {
        return turn("How many sessions per week? A number between 1 and 14.", draft, step, {
          inputHint: "number",
        });
      }
      draft.sessionsPerWeek = n;
      syncDraft(draft, now);
      return ask("askDays", draft, now);
    }

    if (step === "askDays") {
      const days = parseDaysList(raw);
      if (days.length !== draft.sessionsPerWeek) {
        return turn(
          SETUP_COPY.askDaysMismatch(draft.sessionsPerWeek, days.length || "none I recognized"),
          draft,
          step,
          { inputHint: "days" },
        );
      }
      const previous = new Map((draft.schedule || []).map((s) => [s.weekday, s.start || ""]));
      draft.schedule = days.map((weekday) => ({ weekday, start: previous.get(weekday) || "" }));
      return ask("askStartTimes", draft, now);
    }

    if (step === "askStartTimes") {
      const times = parseTimes(raw, draft.schedule.length);
      if (times.length !== draft.schedule.length) {
        return turn(
          `I need ${draft.schedule.length} start time${draft.schedule.length === 1 ? "" : "s"}, or one time to use for every session. Try “4:00 pm” or “9am, 2pm, 6pm.”`,
          draft,
          step,
          { inputHint: "time" },
        );
      }
      draft.schedule = draft.schedule.map((s, i) => ({ ...s, start: times[i] }));
      syncDraft(draft, now);
      return ask("confirmPlan", draft, now);
    }

    if (step === "confirmPlan") {
      const yn = parseYesNo(raw);
      if (yn === false || /day|time|total|length|session|activity|month|frame/.test(raw.toLowerCase())) {
        const l = raw.toLowerCase();
        if (/activity|name/.test(l) && !/time/.test(l)) return ask("askActivity", draft, now);
        if (/per day|per week|per month|time frame|daily|monthly|weekly/.test(l)) return ask("askTimeFrame", draft, now);
        if (/total|hours|minutes|goal/.test(l)) return ask("askGoal", draft, now);
        if (/how many|number of sessions|sessions per/.test(l)) return ask("askSessions", draft, now);
        if (/day/.test(l)) return ask("askDays", draft, now);
        if (/time|start/.test(l)) return ask("askStartTimes", draft, now);
        return turn(SETUP_COPY.adjustPrompt, draft, "confirmPlan", { inputHint: "confirm", choices: ["Yes", "No"] });
      }
      if (yn === true || (yn === null && /yes/.test(raw.toLowerCase()))) {
        return ask("askCheckIn", draft, now);
      }
      if (yn == null) {
        return turn("Say yes if the plan looks right, or tell me what to change.", draft, step, {
          inputHint: "confirm",
          choices: ["Yes", "No"],
        });
      }
    }

    if (step === "askCheckIn") {
      const t = parseCheckInTime(raw);
      if (!t) {
        return turn("What time should I check in? Something like 8:00 pm.", draft, step, { inputHint: "time" });
      }
      draft.checkInTime = t;
      return ask("askIntensity", draft, now);
    }

    if (step === "askIntensity") {
      const inten = parseIntensity(raw) || (raw === "" ? "moderate" : null);
      if (!inten) {
        return turn("Please choose Gentle, Moderate, or Strict.", draft, step, {
          inputHint: "intensity",
          choices: ["Gentle", "Moderate", "Strict"],
        });
      }
      draft.intensity = inten;
      syncDraft(draft, now);
      const activity = normalizeActivity({ ...draft, sessionLengthCustom: false }, now);
      const v = validatePlan({ ...activity, now });
      if (!v.valid) {
        return turn(
          `There's a problem with the plan: ${v.errors.join(" ")} Let's fix that. ${SETUP_COPY.adjustPrompt}`,
          draft,
          "confirmPlan",
          { inputHint: "confirm" },
        );
      }
      let reply = SETUP_COPY.done(draft.name);
      if (v.warnings.length) reply = `${v.warnings[0]} I'll still save this, and you can adjust it on the Week tab.\n\n${reply}`;
      return turn(reply, draft, "done", { done: true, activity, inputHint: null, choices: null });
    }

    if (step === "done") {
      syncDraft(draft, now);
      return turn(SETUP_COPY.done(draft.name || "this"), draft, "done", {
        done: true,
        activity: normalizeActivity({ ...draft, sessionLengthCustom: false }, now),
      });
    }

    return turn(SETUP_COPY.fallback, draft, step, { inputHint: hintFor(step) });
  }
}

function hintFor(step) {
  switch (step) {
    case "askGoal":
    case "askWeekGoals":
      return "duration";
    case "askSessions":
      return "number";
    case "askDays":
      return "days";
    case "askStartTimes":
    case "askCheckIn":
      return "time";
    case "confirmPlan":
      return "confirm";
    case "askIntensity":
      return "intensity";
    default:
      return "text";
  }
}

export {
  STEPS,
  emptyDraft,
  parseDaysList,
  parseSessionCount,
  parseTimes,
  parseIntensity,
  parseYesNo,
  parseTimeFrame,
  parseWeekStyle,
};
