/**
 * Rule-based guided setup dialogue.
 * Fills the same activity fields as the manual form.
 * No network. Swappable via CoachEngine.
 */

import { CoachEngine } from "./interface.js";
import { PERSONA, SETUP_COPY, planSummaryLines, greeting } from "./persona.js";
import {
  dowFromName,
  normalizeDays,
  parseDurationMinutes,
  parseTimeInput,
  WEEKDAY_NAMES,
  formatMinutes,
} from "../util.js";
import { deriveSessionLength, validatePlan, normalizeActivity } from "../plan.js";

const STEPS = [
  "askActivity",
  "askWeekly",
  "askSessions",
  "askDays",
  "askStartTimes",
  "confirmPlan",
  "askCheckIn",
  "askIntensity",
  "done",
];

function emptyDraft() {
  return {
    name: "",
    weeklyTargetMinutes: null,
    sessionsPerWeek: null,
    sessionLengthMinutes: null,
    schedule: [],
    checkInTime: "",
    intensity: "moderate",
    weekStartsOn: 1,
  };
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
  // split on comma, and, &
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
  // Split on comma / and / semicolon
  const chunks = s.split(/,|;|\band\b/i).map((c) => c.trim()).filter(Boolean);
  const times = [];
  for (const c of chunks) {
    // "Monday at 4pm" or just "4pm"
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

function parseCheckInTime(text) {
  return parseTimeInput(text);
}

function daysLabel(days) {
  return days.map((d) => WEEKDAY_NAMES[d]).join(", ");
}

function applyDerivedLength(draft) {
  if (draft.weeklyTargetMinutes && draft.sessionsPerWeek) {
    const d = deriveSessionLength(draft.weeklyTargetMinutes, draft.sessionsPerWeek);
    if (d.ok) draft.sessionLengthMinutes = d.minutes;
  }
  return draft;
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

export class RuleBasedCoach extends CoachEngine {
  async start(context = {}) {
    const draft = { ...emptyDraft(), ...(context.draft || {}) };
    return turn(greeting(true), draft, "askActivity", {
      inputHint: "text",
      prompt: SETUP_COPY.askActivity,
    });
  }

  async respond(userText, context = {}) {
    const raw = String(userText || "").trim();
    let draft = { ...emptyDraft(), ...(context.draft || {}) };
    let step = context.step || "askActivity";

    if (!raw) {
      return turn(SETUP_COPY.fallback, draft, step, { inputHint: hintFor(step) });
    }

    // Global escapes
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
      return turn(SETUP_COPY.askWeekly(draft.name), draft, "askWeekly", { inputHint: "duration" });
    }

    if (step === "askWeekly") {
      const mins = parseDurationMinutes(raw);
      if (mins == null || mins <= 0) {
        return turn(
          `I need a weekly total, like “three hours” or “90 minutes.”`,
          draft,
          step,
          { inputHint: "duration" }
        );
      }
      draft.weeklyTargetMinutes = mins;
      applyDerivedLength(draft);
      return turn(
        SETUP_COPY.askSessions(draft.name, formatMinutes(mins)),
        draft,
        "askSessions",
        { inputHint: "number" }
      );
    }

    if (step === "askSessions") {
      const n = parseSessionCount(raw);
      if (n == null) {
        return turn("How many sessions per week? A number between 1 and 14.", draft, step, {
          inputHint: "number",
        });
      }
      draft.sessionsPerWeek = n;
      applyDerivedLength(draft);
      return turn(SETUP_COPY.askDays(n), draft, "askDays", { inputHint: "days" });
    }

    if (step === "askDays") {
      const days = parseDaysList(raw);
      if (days.length !== draft.sessionsPerWeek) {
        return turn(
          SETUP_COPY.askDaysMismatch(draft.sessionsPerWeek, days.length || "none I recognized"),
          draft,
          step,
          { inputHint: "days" }
        );
      }
      draft.schedule = days.map((weekday) => ({ weekday, start: "" }));
      const label = daysLabel(days);
      return turn(SETUP_COPY.askStartAll(label), draft, "askStartTimes", { inputHint: "time" });
    }

    if (step === "askStartTimes") {
      const times = parseTimes(raw, draft.schedule.length);
      if (times.length !== draft.schedule.length) {
        return turn(
          `I need ${draft.schedule.length} start time${draft.schedule.length === 1 ? "" : "s"}, or one time to use for every session. Try “4:00 pm” or “9am, 2pm, 6pm.”`,
          draft,
          step,
          { inputHint: "time" }
        );
      }
      draft.schedule = draft.schedule.map((s, i) => ({ ...s, start: times[i] }));
      applyDerivedLength(draft);
      const activity = normalizeActivity(draft);
      const summary = planSummaryLines(activity);
      return turn(SETUP_COPY.confirmPlan(summary), draft, "confirmPlan", {
        inputHint: "confirm",
        choices: ["Yes", "No"],
      });
    }

    if (step === "confirmPlan") {
      const yn = parseYesNo(raw);
      if (yn === false || /day|time|total|length|session|activity/.test(raw.toLowerCase())) {
        // Light repair: jump back if they name a field
        const l = raw.toLowerCase();
        if (/activity|name/.test(l)) return turn(SETUP_COPY.askActivity, draft, "askActivity", { inputHint: "text" });
        if (/total|week.*time|hours|minutes/.test(l)) {
          return turn(SETUP_COPY.askWeekly(draft.name), draft, "askWeekly", { inputHint: "duration" });
        }
        if (/how many|number of sessions|sessions per/.test(l)) {
          return turn(SETUP_COPY.askSessions(draft.name, formatMinutes(draft.weeklyTargetMinutes)), draft, "askSessions", { inputHint: "number" });
        }
        if (/day/.test(l)) return turn(SETUP_COPY.askDays(draft.sessionsPerWeek), draft, "askDays", { inputHint: "days" });
        if (/time|start/.test(l)) {
          return turn(SETUP_COPY.askStartAll(daysLabel(draft.schedule.map((s) => s.weekday))), draft, "askStartTimes", { inputHint: "time" });
        }
        return turn(SETUP_COPY.adjustPrompt, draft, "confirmPlan", { inputHint: "confirm" });
      }
      if (yn === true || yn === null && /yes/.test(raw.toLowerCase())) {
        return turn(SETUP_COPY.askCheckIn, draft, "askCheckIn", { inputHint: "time" });
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
      return turn(SETUP_COPY.askIntensity, draft, "askIntensity", {
        inputHint: "intensity",
        choices: ["Gentle", "Moderate", "Strict"],
      });
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
      const activity = normalizeActivity(draft);
      const v = validatePlan(activity);
      if (!v.valid) {
        return turn(
          `There's a problem with the plan: ${v.errors.join(" ")} Let's fix that. ${SETUP_COPY.adjustPrompt}`,
          draft,
          "confirmPlan",
          { inputHint: "confirm" }
        );
      }
      let reply = SETUP_COPY.done(draft.name);
      if (v.warnings.length) reply = `${v.warnings[0]} I'll still save this, and you can adjust it on the Week tab.\n\n${reply}`;
      return turn(reply, draft, "done", { done: true, activity, inputHint: null });
    }

    if (step === "done") {
      return turn(SETUP_COPY.done(draft.name || "this"), draft, "done", {
        done: true,
        activity: normalizeActivity(draft),
      });
    }

    return turn(SETUP_COPY.fallback, draft, step, { inputHint: hintFor(step) });
  }
}

function hintFor(step) {
  switch (step) {
    case "askWeekly":
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

export { STEPS, emptyDraft, parseDaysList, parseSessionCount, parseTimes, parseIntensity, parseYesNo };
