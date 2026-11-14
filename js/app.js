import { loadState, saveState, clearState, exportState } from "./storage.js";
import {
  elapsedMs,
  startTimer,
  pauseTimer,
  stopTimer,
  remainingMs,
  progressRatio,
  createTimerState,
} from "./timer.js";
import {
  normalizeActivity,
  validatePlan,
  buildWeekPlan,
  deriveSessionLength,
  sessionStartDate,
  sessionEndDate,
  sessionsOnDate,
  describeWeek,
} from "./plan.js";
import {
  makeCheckIn,
  upsertCheckIn,
  checkInFor,
  weeklyProgress,
  pendingCheckIns,
  todayLoggedMinutes,
} from "./checkin.js";
import {
  INTENSITY,
  intensityConfig,
  evaluateNags,
  applyNagTiming,
  stateAfterFire,
  stateAfterAck,
  stateAfterSnooze,
  canSnooze,
} from "./nags.js";
import { createCoach } from "./coach/engine.js";
import { PERSONA, nagCopy, ackCopy, snoozeCopy, checkInThanks } from "./coach/persona.js";
import { detectSpeech, createRecognizer, speak, cancelSpeech } from "./coach/speech.js";
import { playNagSound, vibrate } from "./audio.js";
import { ensureActivityId, makeSnapshot, upsertSnapshot } from "./history.js";
import { NudgeBus, ExternalNudgeSource } from "./nudge-sources.js";
import {
  localDateISO,
  formatHM,
  formatMinutes,
  formatTime,
  formatTimeStr,
  WEEKDAY_SHORT,
  WEEKDAY_NAMES,
  uid,
  pad,
} from "./util.js";

const speechSupport = detectSpeech();
const coach = createCoach("rules");
const nudgeBus = new NudgeBus();
const externalNudgeSource = nudgeBus.addSource(new ExternalNudgeSource());
nudgeBus.subscribe(onExternalNudge);

let state = loadState();
let tab = "today";
let setupMode = state.activity ? "manual" : "choice";
let nowMs = Date.now();
let recognizer = null;
let listening = false;
let lastNagShownKeyAt = 0;

const main = () => document.getElementById("main");
const overlay = () => document.getElementById("nag-overlay");

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function save() {
  saveState(state);
}

function todayISO(d = new Date(nowMs)) {
  return localDateISO(d);
}

function activity() {
  return state.activity;
}

function ensureWeek(now = new Date(nowMs)) {
  if (!state.activity) return;
  const built = buildWeekPlan(state.activity, now, state.week);
  if (!state.week || state.week.weekId !== built.weekId) {
    state.week = built;
    save();
  } else if (!state.week.sessions?.length && built.sessions.length) {
    state.week = built;
    save();
  }
}

function progress() {
  if (!state.activity || !state.week) return null;
  return weeklyProgress(
    state.activity,
    state.week,
    state.checkins,
    state.timerLogs,
    state.timer,
    new Date(nowMs)
  );
}

function todaysSessions() {
  if (!state.week) return [];
  return sessionsOnDate(state.week, todayISO());
}

/* ---------------- render ---------------- */

function render() {
  ensureWeek();
  const root = main();
  if (!root) return;
  if (tab === "today") root.innerHTML = renderToday();
  else if (tab === "week") root.innerHTML = renderWeek();
  else if (tab === "setup") root.innerHTML = renderSetup();
  else root.innerHTML = renderSettings();

  document.querySelectorAll("nav.tabbar button").forEach((b) => {
    b.setAttribute("aria-current", b.dataset.tab === tab ? "page" : "false");
  });

  const sub = document.getElementById("header-sub");
  if (sub) {
    sub.textContent = state.activity
      ? `${state.activity.name} · ${INTENSITY[state.activity.intensity]?.label || "Moderate"}`
      : `with ${PERSONA.name}`;
  }

  bindView();
  refreshTimerFace();
}

function renderToday() {
  if (!state.activity) {
    return `
      <section class="card">
        <h2>Set up your week</h2>
        <p>Plan an activity, pick your days and times, then I'll check in and nudge you when a session starts or you fall behind.</p>
        <p class="muted">I'm ${esc(PERSONA.name)}, your ${esc(PERSONA.title)}. You can talk to me or fill in the form.</p>
        <button type="button" class="primary" data-go="setup">Set up</button>
      </section>`;
  }

  const now = new Date(nowMs);
  const prog = progress();
  const sessions = todaysSessions();
  const pct = Math.min(100, Math.round((prog.ratio || 0) * 100));
  const sessHtml = sessions.length
    ? `<ul class="session-list">${sessions.map((s) => {
        const c = checkInFor(state.checkins, s);
        const start = sessionStartDate(s);
        const status = c
          ? (c.done ? `Done, ${formatMinutes(c.minutes)}` : `Logged ${formatMinutes(c.minutes)}`)
          : now < start
            ? `Starts ${formatTime(start)}`
            : now <= sessionEndDate(s)
              ? "In progress"
              : "Not checked in";
        return `<li><span>${esc(formatTimeStr(s.start))} · ${esc(formatMinutes(s.plannedMinutes))}</span><span class="muted">${esc(status)}</span></li>`;
      }).join("")}</ul>`
    : `<p class="muted">No session planned today. You can still practice and log time, or adjust the week plan.</p>`;

  const pending = pendingCheckIns(state.week, state.checkins, todayISO());
  const liveMin = Math.round(elapsedMs(state.timer, nowMs) / 60000);
  const checkHtml = pending.length
    ? `<div class="card" id="checkin-card">
        <h2>Daily check-in</h2>
        <p>${esc(PERSONA.name)}: Did you do ${esc(pending[0].activityName || state.activity.name)}? How many minutes? You planned ${esc(formatMinutes(pending[0].plannedMinutes))}.</p>
        ${pending.map((s) => `
          <form data-checkin="${esc(s.id)}" class="stack">
            <div class="row">
              <button type="submit" class="primary" data-done="1">I did it</button>
              <button type="submit" data-done="0">I didn't</button>
            </div>
            <label>Minutes
              <input type="number" name="minutes" min="0" step="1" value="${liveMin || s.plannedMinutes}" />
            </label>
          </form>`).join("")}
      </div>`
    : sessions.length
      ? `<p class="muted">Today's session is logged. You can change it on this card after you check in again from Settings, or edit the week.</p>`
      : "";

  const running = state.timer.running;
  const targetMin = sessions[0]?.plannedMinutes || state.activity.sessionLengthMinutes;
  const remain = remainingMs(targetMin * 60000, elapsedMs(state.timer, nowMs));

  return `
    <section class="card">
      <h2>${esc(state.activity.name)}</h2>
      <p class="muted">${esc(prog.label)}${prog.behind ? " · behind" : ""}</p>
      <div class="progress" aria-hidden="true"><span style="width:${pct}%"></span></div>
      ${sessHtml}
    </section>
    <section class="card">
      <h2>Timer</h2>
      <div class="timer" id="timer-face">${esc(formatHM(Math.floor(elapsedMs(state.timer, nowMs) / 1000)))}</div>
      <p class="muted" id="timer-sub">${remain >= 0 ? esc(formatHM(Math.floor(remain / 1000)) + " remaining") : esc(formatHM(Math.floor(-remain / 1000)) + " over")}</p>
      <div class="row">
        ${running
          ? `<button type="button" class="big" data-timer="pause">Pause</button>`
          : `<button type="button" class="big primary" data-timer="start">Start</button>`}
        <button type="button" class="big" data-timer="stop">Stop</button>
      </div>
    </section>
    ${checkHtml}
  `;
}

function renderWeek() {
  if (!state.activity) {
    return `<section class="card"><h2>Week plan</h2><p>Set up an activity first.</p><button type="button" class="primary" data-go="setup">Set up</button></section>`;
  }
  ensureWeek();
  const rows = describeWeek(state.week);
  const prog = progress();
  const items = rows.map((s) => {
    const c = checkInFor(state.checkins, s);
    const note = c ? (c.done ? `Done · ${formatMinutes(c.minutes)}` : `${formatMinutes(c.minutes)} logged`) : "Planned";
    return `<li>
      <div>
        <strong>${esc(WEEKDAY_SHORT[s.weekday])} ${esc(s.date.slice(5))}</strong>
        <div class="muted">${esc(formatTimeStr(s.start))} · ${esc(formatMinutes(s.plannedMinutes))}</div>
      </div>
      <div>
        <span class="muted">${esc(note)}</span>
        <button type="button" class="link" data-edit-session="${esc(s.id)}">Edit</button>
      </div>
    </li>`;
  }).join("");

  const editor = state._editingSession
    ? renderSessionEditor(state._editingSession)
    : "";

  return `
    <section class="card">
      <h2>This week</h2>
      <p class="muted">Week of ${esc(state.week.weekId)}. ${esc(prog.label)}</p>
      <div class="progress"><span style="width:${Math.min(100, Math.round(prog.ratio * 100))}%"></span></div>
      <ul class="week-list">${items || "<li>No sessions scripted.</li>"}</ul>
    </section>
    ${editor}
    <section class="card">
      <h2>Script the week</h2>
      <p class="muted">Rebuild this week from your activity defaults (days, start times, session length). Existing check-ins are kept if the date still has a session.</p>
      <button type="button" data-rescript>Reset week from setup</button>
    </section>
  `;
}

function renderSessionEditor(id) {
  const s = state.week.sessions.find((x) => x.id === id);
  if (!s) return "";
  return `<section class="card">
    <h2>Edit session</h2>
    <form data-save-session="${esc(id)}" class="stack">
      <label>Start time <input type="time" name="start" value="${esc(s.start)}" required /></label>
      <label>Planned minutes <input type="number" name="minutes" min="1" value="${esc(s.plannedMinutes)}" required /></label>
      <div class="row">
        <button type="submit" class="primary">Save</button>
        <button type="button" data-cancel-edit>Cancel</button>
      </div>
    </form>
  </section>`;
}

function renderSetup() {
  const modeBar = `
    <div class="mode-switch" role="tablist">
      <button type="button" data-setup-mode="voice" aria-pressed="${setupMode === "voice"}">Talk with ${esc(PERSONA.name)}</button>
      <button type="button" data-setup-mode="manual" aria-pressed="${setupMode === "manual"}">Manual form</button>
    </div>`;

  if (setupMode === "choice") {
    return `
      <section class="card">
        <h2>How do you want to set this up?</h2>
        <p>I'm ${esc(PERSONA.name)}. I can walk you through a weekly plan, or you can fill in the form yourself. The app works fully without voice.</p>
        ${modeBar}
      </section>`;
  }

  if (setupMode === "voice") {
    return modeBar + renderCoach();
  }
  return modeBar + renderManualForm();
}

function renderCoach() {
  const log = state.coach.log || [];
  const bubbles = log.map((m) =>
    `<div class="bubble ${m.role}">${esc(m.text)}</div>`
  ).join("");
  const recNote = speechSupport.recognition
    ? ""
    : `<p class="muted">Voice input isn't available in this browser. You can type to ${esc(PERSONA.name)}, or use the manual form.</p>`;
  const speakNote = speechSupport.synthesis ? "" : "";
  const mic = speechSupport.recognition
    ? `<button type="button" data-mic aria-pressed="${listening}" ${listening ? "" : ""}>${listening ? "Listening…" : "Speak"}</button>`
    : "";
  return `
    <section class="card">
      <h2>Talk with ${esc(PERSONA.name)}</h2>
      <p class="muted">${esc(PERSONA.summary)}</p>
      ${recNote}${speakNote}
      <div class="chat" id="chat-log">${bubbles || ""}</div>
      <form data-coach-send class="chat-input">
        <label class="sr-only" for="coach-text">Your reply</label>
        <input type="text" id="coach-text" name="text" autocomplete="off" placeholder="Type a reply" />
        ${mic}
        <button type="submit" class="primary">Send</button>
      </form>
    </section>
  `;
}

function renderManualForm() {
  const a = state._formDraft || state.activity || {
    name: "",
    weeklyTargetMinutes: 180,
    sessionsPerWeek: 3,
    sessionLengthMinutes: 60,
    schedule: [],
    checkInTime: "20:00",
    intensity: "moderate",
    weekStartsOn: 1,
  };
  const selected = new Set((a.schedule || []).map((s) => s.weekday));
  const timeFor = (d) => (a.schedule || []).find((s) => s.weekday === d)?.start || "16:00";
  const dayBoxes = [1, 2, 3, 4, 5, 6, 0].map((d) => `
    <label>
      <input type="checkbox" name="day" value="${d}" ${selected.has(d) ? "checked" : ""} />
      ${WEEKDAY_SHORT[d]}
    </label>
    ${selected.has(d) ? `<label class="sr-only">Start ${WEEKDAY_SHORT[d]}</label><input type="time" name="start-${d}" value="${esc(timeFor(d))}" />` : ""}
  `).join("");

  return `
    <section class="card">
      <h2>Activity setup</h2>
      <form data-manual-setup class="stack">
        <div class="field">
          <label for="act-name">Activity</label>
          <input id="act-name" name="name" type="text" required placeholder="e.g. piano lessons" value="${esc(a.name)}" />
        </div>
        <div class="field">
          <label for="weekly">Total time per week (minutes)</label>
          <input id="weekly" name="weeklyTargetMinutes" type="number" min="1" required value="${esc(a.weeklyTargetMinutes)}" />
        </div>
        <div class="field">
          <label for="count">Sessions per week</label>
          <input id="count" name="sessionsPerWeek" type="number" min="1" max="14" required value="${esc(a.sessionsPerWeek)}" />
        </div>
        <div class="field">
          <label for="length">Session length (minutes)</label>
          <input id="length" name="sessionLengthMinutes" type="number" min="1" value="${esc(a.sessionLengthMinutes)}" />
          <p class="muted">Leave as derived from weekly total ÷ sessions, or set it yourself. We'll warn if the product doesn't match the weekly total.</p>
        </div>
        <div class="field">
          <span class="label">Days and start times</span>
          <div class="days-picker">${dayBoxes}</div>
        </div>
        <div class="field">
          <label for="checkin">Daily check-in time</label>
          <input id="checkin" name="checkInTime" type="time" required value="${esc(a.checkInTime || "20:00")}" />
        </div>
        <div class="field">
          <label for="intensity">Nudge intensity</label>
          <select id="intensity" name="intensity">
            <option value="gentle" ${a.intensity === "gentle" ? "selected" : ""}>Gentle</option>
            <option value="moderate" ${a.intensity === "moderate" || !a.intensity ? "selected" : ""}>Moderate (default)</option>
            <option value="strict" ${a.intensity === "strict" ? "selected" : ""}>Strict</option>
          </select>
        </div>
        <div id="form-errors" class="errors" hidden></div>
        <button type="submit" class="primary">Save plan</button>
      </form>
    </section>
  `;
}

function renderSettings() {
  const a = state.activity;
  const inten = a?.intensity || "moderate";
  const cfg = intensityConfig(inten);
  const notify = state.settings.notificationsEnabled && typeof Notification !== "undefined" && Notification.permission === "granted";
  return `
    <section class="card">
      <h2>Nudges</h2>
      <form data-settings-nudge class="stack">
        <label>Intensity
          <select name="intensity">
            <option value="gentle" ${inten === "gentle" ? "selected" : ""}>Gentle</option>
            <option value="moderate" ${inten === "moderate" ? "selected" : ""}>Moderate</option>
            <option value="strict" ${inten === "strict" ? "selected" : ""}>Strict</option>
          </select>
        </label>
        <p class="muted">Gentle: fewer repeats, ${cfg && inten === "gentle" ? "3" : intensityConfig("gentle").maxSnoozes} snoozes, softer wording. Moderate is the default. Strict: short repeats, one short snooze, firmer wording.</p>
        ${a ? `<label>Daily check-in time
          <input type="time" name="checkInTime" value="${esc(a.checkInTime || "20:00")}" />
        </label>` : ""}
        <button type="submit" class="primary">Save</button>
      </form>
      <div class="stack" style="margin-top: var(--space-4)">
        <button type="button" data-enable-notify>${notify ? "Notifications on" : "Enable notifications"}</button>
        <button type="button" data-test-nag>Test a nudge</button>
        <p class="muted">Notifications can fire while this app (or its service worker) is active. If the app is fully closed, web push would need a server, which v1 does not include. iOS also needs the app added to the home screen, and still will not nag when fully closed.</p>
      </div>
    </section>
    <section class="card">
      <h2>Voice</h2>
      <p class="muted">Recognition: ${speechSupport.recognition ? "available" : "not supported here"}. Spoken replies: ${speechSupport.synthesis ? "available" : "not supported here"}.</p>
      <label><input type="checkbox" data-setting="voiceEnabled" ${state.settings.voiceEnabled ? "checked" : ""} ${speechSupport.recognition ? "" : "disabled"} /> Enable voice input when available</label>
      <label><input type="checkbox" data-setting="speakReplies" ${state.settings.speakReplies ? "checked" : ""} ${speechSupport.synthesis ? "" : "disabled"} /> ${esc(PERSONA.name)} speaks replies</label>
    </section>
    <section class="card">
      <h2>Data</h2>
      <p class="muted">Everything is stored in this browser only.</p>
      <div class="row">
        <button type="button" data-export>Export JSON</button>
        <button type="button" class="danger" data-reset>Clear all data</button>
      </div>
    </section>
    <section class="card">
      <h2>About</h2>
      <p>${esc(PERSONA.name)} is a built-in, rule-based coach. A live model can be plugged in later; this version does not call any AI API and has no keys.</p>
    </section>
  `;
}

/* ---------------- events ---------------- */

function bindView() {
  const root = main();

  root.querySelectorAll("[data-go]").forEach((b) => {
    b.addEventListener("click", () => {
      tab = b.dataset.go;
      if (tab === "setup" && setupMode === "choice" && !state.activity) setupMode = "choice";
      render();
    });
  });

  root.querySelectorAll("[data-timer]").forEach((b) => {
    b.addEventListener("click", () => onTimer(b.dataset.timer));
  });

  root.querySelectorAll("form[data-checkin]").forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const sid = form.getAttribute("data-checkin");
      const done = e.submitter?.dataset.done !== "0";
      const minutes = form.minutes.value;
      submitCheckIn(sid, done, minutes);
    });
  });

  root.querySelectorAll("[data-setup-mode]").forEach((b) => {
    b.addEventListener("click", async () => {
      setupMode = b.dataset.setupMode;
      if (setupMode === "voice" && !(state.coach.log && state.coach.log.length)) {
        await startCoach();
        return;
      }
      render();
      scrollChat();
    });
  });

  const coachForm = root.querySelector("form[data-coach-send]");
  if (coachForm) {
    coachForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = coachForm.querySelector("input[name=text]");
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      await sendToCoach(text);
    });
  }

  const mic = root.querySelector("[data-mic]");
  if (mic) mic.addEventListener("click", toggleMic);

  const manual = root.querySelector("form[data-manual-setup]");
  if (manual) {
    manual.addEventListener("submit", (e) => {
      e.preventDefault();
      saveManualForm(manual);
    });
    manual.querySelectorAll("input[name=day]").forEach((cb) => {
      cb.addEventListener("change", () => {
        // re-render to show/hide time inputs, preserving other fields
        stashManualAndRerender(manual);
      });
    });
    const weekly = manual.weeklyTargetMinutes;
    const count = manual.sessionsPerWeek;
    const length = manual.sessionLengthMinutes;
    const maybeDerive = () => {
      const d = deriveSessionLength(weekly.value, count.value);
      if (d.ok && !length.dataset.touched) length.value = d.minutes;
    };
    weekly?.addEventListener("change", maybeDerive);
    count?.addEventListener("change", maybeDerive);
    length?.addEventListener("input", () => { length.dataset.touched = "1"; });
  }

  root.querySelectorAll("[data-edit-session]").forEach((b) => {
    b.addEventListener("click", () => {
      state._editingSession = b.dataset.editSession;
      render();
    });
  });
  root.querySelector("[data-cancel-edit]")?.addEventListener("click", () => {
    state._editingSession = null;
    render();
  });
  root.querySelector("form[data-save-session]")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const id = e.currentTarget.getAttribute("data-save-session");
    const s = state.week.sessions.find((x) => x.id === id);
    if (!s) return;
    s.start = e.currentTarget.start.value;
    s.plannedMinutes = Number(e.currentTarget.minutes.value);
    state._editingSession = null;
    save();
    render();
  });
  root.querySelector("[data-rescript]")?.addEventListener("click", () => {
    state.week = buildWeekPlan(state.activity, new Date(nowMs), null);
    save();
    render();
  });

  const nudgeForm = root.querySelector("form[data-settings-nudge]");
  if (nudgeForm) {
    nudgeForm.addEventListener("submit", (e) => {
      e.preventDefault();
      if (state.activity) {
        state.activity.intensity = nudgeForm.intensity.value;
        if (nudgeForm.checkInTime) state.activity.checkInTime = nudgeForm.checkInTime.value;
      }
      save();
      render();
    });
  }
  root.querySelector("[data-enable-notify]")?.addEventListener("click", enableNotifications);
  root.querySelector("[data-test-nag]")?.addEventListener("click", testNag);
  root.querySelectorAll("[data-setting]").forEach((el) => {
    el.addEventListener("change", () => {
      state.settings[el.dataset.setting] = el.checked;
      if (!el.checked && el.dataset.setting === "speakReplies") cancelSpeech();
      save();
    });
  });
  root.querySelector("[data-export]")?.addEventListener("click", () => {
    const blob = new Blob([exportState(state)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "nag-backup.json";
    a.click();
  });
  root.querySelector("[data-reset]")?.addEventListener("click", () => {
    if (confirm("Clear all plans, check-ins, and timer data on this device?")) {
      state = clearState();
      setupMode = "choice";
      tab = "setup";
      render();
    }
  });
}

function stashManualAndRerender(form) {
  const fd = new FormData(form);
  const days = fd.getAll("day").map(Number);
  const schedule = days.map((weekday) => ({
    weekday,
    start: form.querySelector(`[name=start-${weekday}]`)?.value || "16:00",
  }));
  state._formDraft = {
    name: fd.get("name"),
    weeklyTargetMinutes: Number(fd.get("weeklyTargetMinutes")),
    sessionsPerWeek: Number(fd.get("sessionsPerWeek")),
    sessionLengthMinutes: Number(fd.get("sessionLengthMinutes")),
    schedule,
    checkInTime: fd.get("checkInTime"),
    intensity: fd.get("intensity"),
    weekStartsOn: 1,
  };
  render();
}

function saveManualForm(form) {
  const fd = new FormData(form);
  const days = [...form.querySelectorAll("input[name=day]:checked")].map((x) => Number(x.value));
  const schedule = days.map((weekday) => ({
    weekday,
    start: form.querySelector(`[name=start-${weekday}]`)?.value || "16:00",
  }));
  let length = Number(fd.get("sessionLengthMinutes"));
  const weekly = Number(fd.get("weeklyTargetMinutes"));
  const count = Number(fd.get("sessionsPerWeek"));
  if (!length) {
    const d = deriveSessionLength(weekly, count);
    if (d.ok) length = d.minutes;
  }
  const input = {
    name: String(fd.get("name") || "").trim(),
    weeklyTargetMinutes: weekly,
    sessionsPerWeek: count,
    sessionLengthMinutes: length,
    schedule,
    checkInTime: fd.get("checkInTime") || "20:00",
    intensity: fd.get("intensity") || "moderate",
    weekStartsOn: 1,
  };
  const v = validatePlan(input);
  const box = form.querySelector("#form-errors") || document.getElementById("form-errors");
  if (!v.valid) {
    if (box) {
      box.hidden = false;
      box.textContent = v.errors.join(" ");
    } else alert(v.errors.join(" "));
    return;
  }
  if (v.warnings.length && box) {
    box.hidden = false;
    box.textContent = v.warnings.join(" ");
  }
  state._formDraft = null;
  applyActivity(normalizeActivity(input));
  tab = "week";
  render();
}

function applyActivity(act) {
  const kept = state.activity?.id;
  state.activity = ensureActivityId(act);
  if (kept) state.activity.id = kept;
  state.week = buildWeekPlan(state.activity, new Date(nowMs), null);
  state._unsaved = false;
  state.coach.step = "done";
  recordProgress();
  save();
}

function recordProgress(at) {
  if (!state.activity || !state.week) return;
  const when = at ? new Date(at) : new Date(nowMs);
  const prog = weeklyProgress(
    state.activity,
    state.week,
    state.checkins,
    state.timerLogs,
    state.timer,
    when
  );
  const day = localDateISO(when);
  const dayLogged = todayLoggedMinutes(
    state.week, state.checkins, state.timerLogs, state.timer, when, day
  );
  const dayTarget = sessionsOnDate(state.week, day).reduce((n, s) => n + (s.plannedMinutes || 0), 0);
  state.history = upsertSnapshot(state.history, makeSnapshot({
    period: "day",
    at: when,
    date: day,
    weekId: state.week.weekId,
    activity: state.activity,
    loggedMinutes: dayLogged,
    targetMinutes: dayTarget,
  }));
  state.history = upsertSnapshot(state.history, makeSnapshot({
    period: "week",
    at: when,
    date: state.week.weekId,
    weekId: state.week.weekId,
    activity: state.activity,
    loggedMinutes: prog.logged,
    targetMinutes: prog.target,
  }));
}

/* ---------------- timer ---------------- */

function currentSessionId() {
  const now = new Date(nowMs);
  const todays = todaysSessions();
  const open = todays.find((s) => now >= sessionStartDate(s) && now <= sessionEndDate(s));
  return (open || todays[0] || {}).id || "week";
}

function onTimer(action) {
  const t = nowMs;
  if (action === "start") {
    const sid = currentSessionId();
    state.timer = startTimer(state.timer, t, sid);
  } else if (action === "pause") {
    flushTimerSegment(t);
    state.timer = pauseTimer(state.timer, t);
  } else if (action === "stop") {
    flushTimerSegment(t);
    const { timer } = stopTimer(state.timer, t);
    state.timer = timer;
  }
  if (action === "pause" || action === "stop") recordProgress(t);
  save();
  refreshTimerFace();
  render();
}

function flushTimerSegment(t) {
  if (!state.timer.running && !state.timer.accumulatedMs) return;
  const ms = elapsedMs(state.timer, t) - (state.timer._flushedMs || 0);
  if (ms <= 0) return;
  state.timerLogs.push({
    id: uid("log"),
    date: todayISO(),
    sessionId: state.timer.targetId,
    ms,
    at: new Date(t).toISOString(),
  });
  state.timer._flushedMs = elapsedMs(state.timer, t);
  if (!state.timer.running) {
    state.timer.accumulatedMs = 0;
    state.timer._flushedMs = 0;
  }
}

function refreshTimerFace() {
  const face = document.getElementById("timer-face");
  if (!face) return;
  const elapsed = elapsedMs(state.timer, nowMs);
  face.textContent = formatHM(Math.floor(elapsed / 1000));
  const sub = document.getElementById("timer-sub");
  if (sub && state.activity) {
    const targetMin = todaysSessions()[0]?.plannedMinutes || state.activity.sessionLengthMinutes;
    const remain = remainingMs(targetMin * 60000, elapsed);
    sub.textContent = remain >= 0
      ? `${formatHM(Math.floor(remain / 1000))} remaining`
      : `${formatHM(Math.floor(-remain / 1000))} over`;
  }
}

/* ---------------- check-in ---------------- */

function submitCheckIn(sessionId, done, minutes) {
  const session = (state.week?.sessions || []).find((s) => s.id === sessionId);
  if (!session) return;
  session.activityName = state.activity?.name;
  const entry = makeCheckIn({
    session,
    done,
    minutes,
    at: new Date(nowMs),
    source: "checkin",
  });
  state.checkins = upsertCheckIn(state.checkins, entry);
  recordProgress();
  save();
  const prog = progress();
  // brief confirmation stays on today
  render();
  const thanks = checkInThanks(entry.minutes, prog?.label || "", state.activity?.intensity);
  maybeSpeak(thanks);
}

/* ---------------- coach ---------------- */

async function startCoach() {
  const turn = await coach.start({ draft: state.coach.draft || {}, step: "askActivity" });
  state.coach.draft = turn.draft;
  state.coach.step = turn.step;
  state.coach.log = [{ role: "coach", text: turn.reply }];
  save();
  render();
  scrollChat();
  maybeSpeak(turn.reply);
}

async function sendToCoach(text) {
  state.coach.log = [...(state.coach.log || []), { role: "user", text }];
  const turn = await coach.respond(text, {
    draft: state.coach.draft,
    step: state.coach.step,
  });
  state.coach.draft = turn.draft;
  state.coach.step = turn.step;
  state.coach.log.push({ role: "coach", text: turn.reply });
  if (turn.switchToManual) setupMode = "manual";
  if (turn.done && turn.activity) {
    applyActivity(turn.activity);
  }
  save();
  render();
  scrollChat();
  maybeSpeak(turn.reply);
}

function scrollChat() {
  const log = document.getElementById("chat-log");
  if (log) log.scrollTop = log.scrollHeight;
}

function maybeSpeak(text) {
  if (!state.settings.speakReplies) return;
  if (!speechSupport.synthesis) return;
  if (setupMode !== "voice" && tab !== "setup") {
    // still speak nag copy when we call maybeSpeak from nags? allow if settings on
  }
  speak(text, { personaVoice: PERSONA.voice });
}

function toggleMic() {
  if (!speechSupport.recognition || !state.settings.voiceEnabled) return;
  if (listening && recognizer) {
    try { recognizer.stop(); } catch {}
    listening = false;
    render();
    return;
  }
  cancelSpeech();
  recognizer = createRecognizer({
    onResult: (text, isFinal) => {
      const input = document.querySelector("form[data-coach-send] input[name=text]");
      if (input) input.value = text;
      if (isFinal && text) {
        listening = false;
        sendToCoach(text);
      }
    },
    onError: () => {
      listening = false;
      render();
    },
    onEnd: () => {
      listening = false;
      const btn = document.querySelector("[data-mic]");
      if (btn) btn.textContent = "Speak";
    },
  });
  if (!recognizer) return;
  try {
    recognizer.start();
    listening = true;
    render();
  } catch {
    listening = false;
  }
}

/* ---------------- nags ---------------- */

function nagFactsNow() {
  return {
    now: new Date(nowMs),
    activity: state.activity,
    week: state.week,
    checkins: state.checkins,
    timerLogs: state.timerLogs,
    timer: state.timer,
    checkInTime: state.activity?.checkInTime,
  };
}

function tickNags() {
  if (!state.activity || !state.week) {
    if (!state._externalNag && !state._testNag) hideOverlay();
    return;
  }
  const cfg = intensityConfig(state.activity.intensity);
  const candidate = evaluateNags(nagFactsNow());
  const decision = applyNagTiming(candidate, state.nag, cfg, new Date(nowMs));
  if (decision.action === "fire") {
    state.nag = stateAfterFire(state.nag, candidate, decision.intervalMs, new Date(nowMs));
    save();
    fireNag(candidate, cfg);
  } else if (decision.action === "idle") {
    if (!state._testNag && !state._externalNag) hideOverlay();
  } else if (state._testNag || state._externalNag) {
    // keep test / friend overlay until dismissed
  } else if (overlay() && !overlay().hidden && state.nag.ackKey) {
    hideOverlay();
  }
}

function onExternalNudge(nudge) {
  if (!nudge || nudge.source === "local") return;
  const cfg = intensityConfig(state.activity?.intensity || "moderate");
  const facts = { ...(nudge.facts || {}) };
  if (state.activity) {
    if (facts.activityName == null) facts.activityName = state.activity.name;
    if (facts.plannedMinutes == null) facts.plannedMinutes = state.activity.weeklyTargetMinutes;
    if (facts.loggedMinutes == null) {
      const prog = progress();
      facts.loggedMinutes = Math.round(prog?.logged || 0);
    }
  }
  const candidate = { ...nudge, type: nudge.type || "friend-nag", facts };
  state._externalNag = candidate;
  fireNag(candidate, cfg);
}

function fireNag(candidate, cfg, { test = false } = {}) {
  const intensity = state.activity?.intensity || "moderate";
  const message = nagCopy(candidate.type, intensity, candidate.facts || {});
  showOverlay(candidate, message, cfg, test);
  if (cfg.sound) playNagSound(intensity);
  if (cfg.vibrate) vibrate(intensity);
  maybeNotify(message, cfg, candidate);
  if (state.settings.speakReplies && !test) maybeSpeak(message);
}

function showOverlay(candidate, message, cfg, test) {
  const el = overlay();
  const snoozeOk = canSnooze(state.nag, cfg);
  const snoozeMin = Math.round(cfg.snoozeMs / 60000);
  el.hidden = false;
  el.innerHTML = `
    <p class="muted">${esc(candidate.source === "friend" && candidate.fromName ? candidate.fromName : PERSONA.name)}</p>
    <h2 id="nag-title">${candidate.type === "check-in" ? "Check in" : candidate.type === "behind" ? "You're behind" : candidate.type === "friend-nag" ? "A friend is nagging you" : "It's time"}</h2>
    <p>${esc(message)}</p>
    <div class="stack">
      <button type="button" class="primary" data-nag-ack>I'm on it</button>
      ${candidate.type === "check-in" ? `<button type="button" data-nag-checkin>Log the session</button>` : ""}
      ${snoozeOk ? `<button type="button" data-nag-snooze>Snooze ${snoozeMin} min</button>` : `<p class="muted">No snoozes left on this reminder.</p>`}
    </div>
  `;
  el.querySelector("[data-nag-ack]").addEventListener("click", () => ackNag(candidate));
  el.querySelector("[data-nag-checkin]")?.addEventListener("click", () => {
    ackNag(candidate);
    tab = "today";
    render();
    document.getElementById("checkin-card")?.scrollIntoView();
  });
  el.querySelector("[data-nag-snooze]")?.addEventListener("click", () => snoozeNag(candidate, cfg));
}

function hideOverlay() {
  const el = overlay();
  if (el) {
    el.hidden = true;
    el.innerHTML = "";
  }
  state._testNag = false;
  state._externalNag = null;
}

function ackNag(candidate) {
  state.nag = stateAfterAck(state.nag, candidate.key);
  save();
  hideOverlay();
  const intensity = state.activity?.intensity || "moderate";
  if (candidate.type === "session-start" || candidate.type === "session-active") {
    if (!state.timer.running) onTimer("start");
  }
  maybeSpeak(ackCopy(intensity));
}

function snoozeNag(candidate, cfg) {
  const res = stateAfterSnooze(state.nag, cfg, new Date(nowMs));
  if (!res.ok) return;
  state.nag = res.state;
  save();
  hideOverlay();
  const left = cfg.maxSnoozes - state.nag.snoozeCount;
  maybeSpeak(snoozeCopy(state.activity?.intensity, Math.round(cfg.snoozeMs / 60000), left));
}

async function enableNotifications() {
  if (typeof Notification === "undefined") {
    alert("Notifications are not available in this browser.");
    return;
  }
  const perm = await Notification.requestPermission();
  state.settings.notificationsEnabled = perm === "granted";
  save();
  render();
}

function maybeNotify(body, cfg, candidate) {
  if (!state.settings.notificationsEnabled) return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const title = "Nag";
  const payload = {
    type: "show-notification",
    title,
    body,
    tag: "nag",
    key: candidate?.key,
    requireInteraction: cfg.requireInteraction,
  };
  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage(payload);
  } else if (navigator.serviceWorker) {
    navigator.serviceWorker.ready.then((reg) => {
      if (reg.showNotification) {
        reg.showNotification(title, {
          body,
          tag: "nag",
          renotify: true,
          requireInteraction: cfg.requireInteraction,
          icon: "./icons/icon-192.png",
        });
      }
    });
  } else {
    try {
      new Notification(title, { body, tag: "nag" });
    } catch {}
  }
}

function testNag() {
  const cfg = intensityConfig(state.activity?.intensity || "moderate");
  const candidate = {
    type: "behind",
    key: "test",
    facts: {
      activityName: state.activity?.name || "your practice",
      plannedMinutes: state.activity?.weeklyTargetMinutes || 180,
      loggedMinutes: 14,
      expectedMinutes: 60,
    },
  };
  state._testNag = true;
  fireNag(candidate, cfg, { test: true });
}

/* ---------------- boot ---------------- */

function tick() {
  nowMs = Date.now();
  refreshTimerFace();
  tickNags();
}

function bindChrome() {
  document.querySelectorAll("nav.tabbar button").forEach((b) => {
    b.addEventListener("click", () => {
      tab = b.dataset.tab;
      render();
    });
  });
  document.addEventListener("visibilitychange", () => {
    nowMs = Date.now();
    tickNags();
    refreshTimerFace();
  });
  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      const data = event.data || {};
      if (data.type === "notification-click") {
        nowMs = Date.now();
        if (data.action === "snooze" && state.activity) {
          const cfg = intensityConfig(state.activity.intensity);
          const candidate = evaluateNags(nagFactsNow());
          if (candidate) snoozeNag(candidate, cfg);
        } else {
          tab = "today";
          render();
        }
      }
    });
  }
}

async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch (err) {
    console.warn("sw failed", err);
  }
}

bindChrome();
ensureWeek();
if (!state.activity) tab = "setup";
render();
setInterval(tick, 1000);
registerSW();

// Expose a small hook for tests
window.__nag = {
  getState: () => state,
  setState: (s) => { state = s; save(); render(); },
  evaluateNags,
  applyActivity,
  submitCheckIn,
  onTimer,
  tickNags,
  ingestNudge: (payload) => externalNudgeSource.ingest(payload),
  tab: (t) => { if (t) { tab = t; render(); } return tab; },
  speechSupport,
};
