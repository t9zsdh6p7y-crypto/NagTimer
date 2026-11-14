import { deriveSessionLength, validatePlan, buildWeekPlan, sessionStartDate, sessionEndDate, expectedMinutesByNow, normalizeActivity } from "../js/plan.js";
import { makeCheckIn, upsertCheckIn, weeklyProgress, loggedMinutesForWeek } from "../js/checkin.js";
import { createTimerState, startTimer, pauseTimer, stopTimer, elapsedMs, remainingMs } from "../js/timer.js";
import { INTENSITY, intensityConfig, nextIntervalMs, evaluateNags, applyNagTiming, stateAfterFire, stateAfterAck, stateAfterSnooze, canSnooze } from "../js/nags.js";
import { parseDurationMinutes, parseTimeInput, weekStartISO, localDateISO, combineDateAndTime, addDays, formatMinutes } from "../js/util.js";
import { RuleBasedCoach, parseDaysList, parseSessionCount, parseTimes, parseIntensity } from "../js/coach/dialogue.js";
import { createCoach, LlmCoachStub } from "../js/coach/engine.js";
import { detectSpeech } from "../js/coach/speech.js";
import { nagCopy, PERSONA } from "../js/coach/persona.js";
import { getOrCreateUserId, generateUserId, persistUserId, ID_KEY } from "../js/identity.js";
import { makeSnapshot, upsertSnapshot, changeOverTime, ensureActivityId, activityKey } from "../js/history.js";
import { ExternalNudgeSource, NudgeBus, normalizeNudge } from "../js/nudge-sources.js";

let passed = 0;
let failed = 0;
const errors = [];

function is(cond, name, detail) {
  if (cond) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    errors.push(name + (detail ? ` — ${detail}` : ""));
    console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
}

function eq(a, b, name) {
  const ok = Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);
  is(ok, name, ok ? "" : `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function mondayOf(d = new Date(2026, 10, 13)) { // Fri Nov 13 2026
  // week start Monday Nov 9
  return new Date(2026, 10, 9, 12, 0, 0);
}

console.log("util");
eq(parseDurationMinutes("3 hours"), 180, "parse 3 hours");
eq(parseDurationMinutes("three hours"), 180, "parse three hours");
eq(parseDurationMinutes("an hour and thirty minutes"), 90, "parse hour and thirty minutes");
eq(parseDurationMinutes("90 minutes"), 90, "parse 90 minutes");
eq(parseDurationMinutes("1h 30m"), 90, "parse 1h 30m");
eq(parseDurationMinutes("45 min"), 45, "parse 45 min");
eq(parseDurationMinutes("90"), 90, "bare 90 is minutes");
eq(parseDurationMinutes("2"), 120, "bare 2 is hours");
eq(parseTimeInput("4:00 pm"), "16:00", "parse 4:00 pm");
eq(parseTimeInput("9am"), "09:00", "parse 9am");
eq(parseTimeInput("16:00"), "16:00", "parse 16:00");
eq(weekStartISO(new Date(2026, 10, 13), 1), "2026-11-09", "week starts Monday");
const tlocal = combineDateAndTime("2026-11-13", "16:00");
eq(tlocal.getFullYear(), 2026, "combine year local");
eq(tlocal.getMonth(), 10, "combine month local");
eq(tlocal.getDate(), 13, "combine date local");
eq(tlocal.getHours(), 16, "combine hour local");

console.log("plan");
eq(deriveSessionLength(180, 3).minutes, 60, "derive 180/3 = 60");
eq(deriveSessionLength(100, 3).minutes, 35, "derive 100/3 rounded to 5");
const good = validatePlan({
  name: "Piano lessons",
  weeklyTargetMinutes: 180,
  sessionsPerWeek: 3,
  sessionLengthMinutes: 60,
  schedule: [
    { weekday: 1, start: "16:00" },
    { weekday: 3, start: "16:00" },
    { weekday: 5, start: "16:00" },
  ],
});
is(good.valid && good.ok, "valid plan 3x60=180");
const mismatch = validatePlan({
  name: "Piano",
  weeklyTargetMinutes: 180,
  sessionsPerWeek: 3,
  sessionLengthMinutes: 30,
  schedule: [
    { weekday: 1, start: "16:00" },
    { weekday: 3, start: "16:00" },
    { weekday: 5, start: "16:00" },
  ],
});
is(mismatch.valid && !mismatch.ok && mismatch.warnings.length > 0, "warns when 3x30 != 180");
const badDays = validatePlan({
  name: "Piano",
  weeklyTargetMinutes: 180,
  sessionsPerWeek: 3,
  sessionLengthMinutes: 60,
  schedule: [{ weekday: 1, start: "16:00" }],
});
is(!badDays.valid, "rejects wrong number of days");

const activity = normalizeActivity({
  name: "Piano lessons",
  weeklyTargetMinutes: 180,
  sessionsPerWeek: 3,
  sessionLengthMinutes: 60,
  schedule: [
    { weekday: 1, start: "16:00" },
    { weekday: 3, start: "16:00" },
    { weekday: 5, start: "16:00" },
  ],
  checkInTime: "20:00",
  intensity: "moderate",
  weekStartsOn: 1,
});
const week = buildWeekPlan(activity, new Date(2026, 10, 13, 10, 0, 0));
eq(week.weekId, "2026-11-09", "week id is Monday");
eq(week.sessions.length, 3, "three sessions scripted");
eq(week.sessions.map((s) => s.date), ["2026-11-09", "2026-11-11", "2026-11-13"], "Mon Wed Fri dates");
eq(week.sessions[2].start, "16:00", "Friday start time");
is(sessionStartDate(week.sessions[2]).getHours() === 16, "Friday 4pm local start");

console.log("timer");
let timer = createTimerState();
const t0 = Date.parse("2026-11-13T15:00:00");
timer = startTimer(timer, t0, week.sessions[2].id);
eq(elapsedMs(timer, t0 + 14 * 60 * 1000), 14 * 60 * 1000, "elapsed 14 min");
timer = pauseTimer(timer, t0 + 14 * 60 * 1000);
eq(timer.running, false, "paused");
eq(elapsedMs(timer, t0 + 20 * 60 * 1000), 14 * 60 * 1000, "pause freezes elapsed");
timer = startTimer(timer, t0 + 20 * 60 * 1000, week.sessions[2].id);
const stopped = stopTimer(timer, t0 + 26 * 60 * 1000);
eq(stopped.finalMs, 20 * 60 * 1000, "stop totals 20 min (14+6)");
eq(stopped.timer.running, false, "stop resets running");
eq(remainingMs(60 * 60 * 1000, 14 * 60 * 1000), 46 * 60 * 1000, "remaining vs 60m target");

console.log("check-in + weekly progress");
const mon = week.sessions[0];
const wed = week.sessions[1];
let checkins = {};
checkins = upsertCheckIn(checkins, makeCheckIn({ session: mon, done: true, minutes: 55, at: new Date(2026, 10, 9, 20) }));
let prog = weeklyProgress(activity, week, checkins, [], createTimerState(), new Date(2026, 10, 13, 10, 0, 0));
// Friday hasn't started (16:00). Mon and Wed have started. expected started = 120, ended = 120 if after Wed session end.
eq(Math.round(prog.logged), 55, "logged 55 from check-in");
is(prog.target === 180, "weekly target 180");
is(prog.behind, true, "behind after 55 of two elapsed sessions");
checkins = upsertCheckIn(checkins, makeCheckIn({ session: wed, done: true, minutes: 70, at: new Date(2026, 10, 11, 20) }));
prog = weeklyProgress(activity, week, checkins, [], createTimerState(), new Date(2026, 10, 13, 10, 0, 0));
eq(Math.round(prog.logged), 125, "logged 125");
is(!prog.behind, "not behind with 125 of 120 ended");

console.log("nags");
const gentle = intensityConfig("gentle");
const moderate = intensityConfig("moderate");
const strict = intensityConfig("strict");
is(gentle.intervalStartMs > moderate.intervalStartMs, "gentle repeats less often than moderate");
is(moderate.intervalStartMs > strict.intervalStartMs, "moderate repeats less often than strict");
is(gentle.maxSnoozes > moderate.maxSnoozes && moderate.maxSnoozes > strict.maxSnoozes, "snooze allowance shrinks with intensity");
is(gentle.snoozeMs > moderate.snoozeMs && moderate.snoozeMs > strict.snoozeMs, "snooze length shrinks with intensity");
is(nextIntervalMs(strict.intervalStartMs, strict) < strict.intervalStartMs, "intervals escalate (shorten)");
is(nextIntervalMs(1, strict) === strict.intervalMinMs, "interval floor");

// session start Friday 16:00, now 16:02, timer not running, no check-in
const fri = week.sessions[2];
const atStart = new Date(2026, 10, 13, 16, 2, 0);
const nagStart = evaluateNags({
  now: atStart,
  activity,
  week,
  checkins, // mon+wed checked, friday not
  timerLogs: [],
  timer: createTimerState(),
  checkInTime: "20:00",
});
is(nagStart && nagStart.type === "session-start", "nag at session start", nagStart && nagStart.type);
eq(nagStart?.key, `session-start:${fri.id}`, "session-start key");

const running = startTimer(createTimerState(), atStart.getTime(), fri.id);
const nagWhileRunning = evaluateNags({
  now: atStart,
  activity,
  week,
  checkins,
  timerLogs: [],
  timer: running,
  checkInTime: "20:00",
});
is(!nagWhileRunning || nagWhileRunning.type !== "session-start", "no session-start nag while timer runs");

// behind: Monday afternoon, nothing logged, first session started
const emptyWeekNag = evaluateNags({
  now: new Date(2026, 10, 9, 17, 30, 0),
  activity,
  week,
  checkins: {},
  timerLogs: [],
  timer: createTimerState(),
  checkInTime: "20:00",
});
is(emptyWeekNag && (emptyWeekNag.type === "session-active" || emptyWeekNag.type === "session-start" || emptyWeekNag.type === "behind"), "nag when session underway and nothing logged", emptyWeekNag && emptyWeekNag.type);

// check-in time Friday 20:00, session over, not logged
const nagCheck = evaluateNags({
  now: new Date(2026, 10, 13, 20, 1, 0),
  activity,
  week,
  checkins,
  timerLogs: [],
  timer: createTimerState(),
  checkInTime: "20:00",
});
is(nagCheck && nagCheck.type === "check-in", "nag at daily check-in time", nagCheck && nagCheck.type);

const first = applyNagTiming(nagStart, {}, moderate, atStart);
eq(first.action, "fire", "first sighting fires immediately");
let nagState = stateAfterFire({}, nagStart, first.intervalMs, atStart);
const tooSoon = applyNagTiming(nagStart, nagState, moderate, new Date(atStart.getTime() + 1000));
eq(tooSoon.action, "wait", "respects repeat interval");
const later = applyNagTiming(nagStart, nagState, moderate, new Date(atStart.getTime() + moderate.intervalStartMs + 1));
eq(later.action, "fire", "fires again after interval");
is(later.intervalMs < first.intervalMs, "repeat interval escalates down");

nagState = stateAfterAck(nagState, nagStart.key);
const afterAck = applyNagTiming(nagStart, nagState, moderate, new Date(atStart.getTime() + 60 * 60 * 1000));
eq(afterAck.reason, "acked", "ack silences the same key");

nagState = stateAfterFire({}, nagStart, first.intervalMs, atStart);
is(canSnooze(nagState, strict), true, "strict allows first snooze");
let sn = stateAfterSnooze(nagState, strict, atStart);
is(sn.ok, "first snooze ok");
sn = stateAfterSnooze(sn.state, strict, atStart);
is(!sn.ok, "strict blocks a second snooze");
const g1 = stateAfterSnooze(nagState, gentle, atStart);
const g2 = stateAfterSnooze(g1.state, gentle, atStart);
const g3 = stateAfterSnooze(g2.state, gentle, atStart);
is(g3.ok, "gentle allows three snoozes");
is(!stateAfterSnooze(g3.state, gentle, atStart).ok, "gentle blocks a fourth");

const gentleCopy = nagCopy("behind", "gentle", { activityName: "piano", plannedMinutes: 180, loggedMinutes: 14 });
const strictCopy = nagCopy("behind", "strict", { activityName: "piano", plannedMinutes: 180, loggedMinutes: 14 });
is(/behind|short session|logged/i.test(gentleCopy), "gentle behind copy is softer");
is(/you said/i.test(strictCopy) && /get back to it/i.test(strictCopy), "strict behind copy is blunt");
is(gentleCopy !== strictCopy, "intensity changes wording");
is(PERSONA.name === "Reed", "coach is named Reed");

console.log("coach dialogue");
const rb = new RuleBasedCoach();
let ctx = {};
let turn = await rb.start({});
eq(turn.step, "askActivity", "starts by asking activity");
is(turn.reply.includes("Reed"), "introduces Reed");
turn = await rb.respond("piano lessons", { draft: turn.draft, step: turn.step });
eq(turn.draft.name, "piano lessons", "captures activity");
eq(turn.step, "askWeekly", "asks weekly total");
turn = await rb.respond("three hours", { draft: turn.draft, step: turn.step });
eq(turn.draft.weeklyTargetMinutes, 180, "captures 3 hours");
turn = await rb.respond("three", { draft: turn.draft, step: turn.step });
eq(turn.draft.sessionsPerWeek, 3, "captures 3 sessions");
eq(turn.draft.sessionLengthMinutes, 60, "derives 60 min sessions");
turn = await rb.respond("Monday, Wednesday and Friday", { draft: turn.draft, step: turn.step });
eq(turn.draft.schedule.map((s) => s.weekday), [1, 3, 5], "captures days");
turn = await rb.respond("4pm", { draft: turn.draft, step: turn.step });
eq(turn.draft.schedule.every((s) => s.start === "16:00"), true, "one time applies to all sessions");
eq(turn.step, "confirmPlan", "confirms plan");
turn = await rb.respond("yes", { draft: turn.draft, step: turn.step });
eq(turn.step, "askCheckIn", "asks check-in time");
turn = await rb.respond("8pm", { draft: turn.draft, step: turn.step });
eq(turn.draft.checkInTime, "20:00", "captures 8pm check-in");
turn = await rb.respond("strict", { draft: turn.draft, step: turn.step });
is(turn.done, "dialogue completes");
eq(turn.activity.intensity, "strict", "saves strict intensity");
eq(turn.activity.sessionLengthMinutes, 60, "final session length");
eq(turn.activity.schedule.length, 3, "final schedule length");

eq(parseDaysList("Mon Wed Fri"), [1, 3, 5], "parse day names");
eq(parseSessionCount("twice"), 2, "parse twice");
eq(parseTimes("9am, 2pm, 6pm", 3), ["09:00", "14:00", "18:00"], "parse three times");
eq(parseIntensity("be gentle please"), "gentle", "parse intensity from sentence");

const stub = new LlmCoachStub();
is(!stub.configured(), "LLM stub is not configured in v1");
const stubTurn = await stub.start({});
is(stubTurn.fallbackToRules, "LLM stub tells caller to fall back");
const auto = createCoach("llm");
is(auto instanceof RuleBasedCoach, "createCoach('llm') falls back to rules without an endpoint");

console.log("voice fallback");
const none = detectSpeech(undefined);
eq(none.recognition, false, "no recognition without window");
eq(none.synthesis, false, "no synthesis without window");
const fake = detectSpeech({ speechSynthesis: {} });
eq(fake.synthesis, true, "detects synthesis");
eq(fake.recognition, false, "hides recognition when missing");
const withRec = detectSpeech({ webkitSpeechRecognition: function () {}, speechSynthesis: {} });
eq(withRec.recognition, true, "detects webkitSpeechRecognition");
eq(withRec.any, true, "any support flag");

console.log("identity + history + external nudges");
const mem = {
  data: {},
  getItem(k) { return this.data[k] ?? null; },
  setItem(k, v) { this.data[k] = String(v); },
};
const id1 = getOrCreateUserId(mem);
const id2 = getOrCreateUserId(mem);
is(/^[-a-f0-9]{36}$/.test(id1), "generates a uuid-shaped user id", id1);
eq(id1, id2, "user id is stable across calls");
const mem2 = { data: {}, getItem(k){return this.data[k]??null;}, setItem(k,v){this.data[k]=String(v);} };
eq(getOrCreateUserId(mem2, id1), id1, "prefers the id already on state");
is(generateUserId() !== generateUserId(), "new ids are unique");

const act = ensureActivityId({ name: "Piano lessons", weeklyTargetMinutes: 180, weekStartsOn: 1 });
is(!!act.id && act.id.startsWith("act_"), "activity gets a stable id");
eq(activityKey(act), act.id, "activityKey uses id");
let hist = [];
const s1 = makeSnapshot({
  period: "week",
  at: new Date(2026, 10, 9, 20),
  weekId: "2026-11-09",
  date: "2026-11-09",
  activity: act,
  loggedMinutes: 55,
  targetMinutes: 180,
});
hist = upsertSnapshot(hist, s1);
const s1b = makeSnapshot({
  period: "week",
  at: new Date(2026, 10, 11, 20),
  weekId: "2026-11-09",
  date: "2026-11-09",
  activity: act,
  loggedMinutes: 125,
  targetMinutes: 180,
});
hist = upsertSnapshot(hist, s1b);
eq(hist.length, 1, "upsert replaces same week snapshot");
eq(hist[0].loggedMinutes, 125, "latest weekly logged minutes kept");
const s2 = makeSnapshot({
  period: "week",
  at: new Date(2026, 10, 16, 20),
  weekId: "2026-11-16",
  date: "2026-11-16",
  activity: act,
  loggedMinutes: 160,
  targetMinutes: 180,
});
hist = upsertSnapshot(hist, s2);
const daySnap = makeSnapshot({
  period: "day",
  at: new Date(2026, 10, 13, 20),
  date: "2026-11-13",
  weekId: "2026-11-09",
  activity: act,
  loggedMinutes: 50,
  targetMinutes: 60,
});
hist = upsertSnapshot(hist, daySnap);
eq(hist.filter((h) => h.period === "week").length, 2, "two week snapshots");
eq(hist.filter((h) => h.period === "day").length, 1, "day snapshot stored separately");
const series = changeOverTime(hist, { activityId: act.id, period: "week" });
eq(series[1].deltaLogged, 35, "change over time is +35 minutes week to week");

const bus = new NudgeBus();
const ext = bus.addSource(new ExternalNudgeSource());
let received = null;
bus.subscribe((n) => { received = n; });
const ingested = ext.ingest({
  type: "friend-nag",
  fromUserId: "friend-abc",
  fromName: "Sam",
  facts: { activityName: "piano lessons", plannedMinutes: 180, loggedMinutes: 14 },
});
eq(ingested.source, "friend", "ingest marks source as friend");
eq(received.fromName, "Sam", "bus delivers friend nag to the same flow");
eq(received.type, "friend-nag", "friend nag type preserved");
is(received.key.includes("friend"), "external nudge has a distinct key");
const friendCopy = nagCopy("friend-nag", "strict", {
  activityName: "piano",
  plannedMinutes: 180,
  loggedMinutes: 14,
  fromName: "Sam",
});
is(/Sam/i.test(friendCopy) && /get back to it/i.test(friendCopy), "friend nag uses the same blunt copy path");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.error(errors.join("\n"));
  process.exit(1);
}
