import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
};

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (path === "/") path = "/index.html";
      const file = join(root, path);
      if (!file.startsWith(root)) {
        res.writeHead(403); res.end(); return;
      }
      const st = await stat(file);
      if (!st.isFile()) { res.writeHead(404); res.end(); return; }
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404); res.end("not found");
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function runChrome(url, script) {
  const chrome = process.env.CHROME || "google-chrome";
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--user-data-dir=/tmp/nag-e2e-profile",
    `--app=${url}`,
    `--dump-dom`,
  ];
  // Use chrome remote debugging + a tiny evaluate via the DevTools protocol would be heavier.
  // We'll spawn a node snippet that uses chrome --headless --repl? Not available.
  // Instead write a one-file evaluator with the fetch + chrome's /json? 
  return { chrome, args };
}

// Lightweight CDP client
import net from "node:net";

async function cdpEval(port, expression) {
  const tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
  const page = tabs.find((t) => t.type === "page" && t.webSocketDebuggerUrl && /127\.0\.0\.1|localhost/.test(t.url || ""))
    || tabs.find((t) => t.type === "page" && t.webSocketDebuggerUrl)
    || tabs[0];
  if (!page) throw new Error("no page");
  const wsUrl = page.webSocketDebuggerUrl;
  const WebSocket = (await import("ws")).default;
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
  let id = 0;
  const pending = new Map();
  ws.on("message", (data) => {
    const msg = JSON.parse(data);
    if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, (msg) => {
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  await send("Runtime.enable");
  await send("Page.enable");
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  ws.close();
  if (result.exceptionDetails) {
    const t = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
    throw new Error(t);
  }
  return result.result.value;
}

async function waitFor(fn, ms = 8000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) { last = e; }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("timeout: " + last);
}

const server = await startServer();
const port = server.address().port;
const url = `http://127.0.0.1:${port}/`;
const debugPort = 9222 + Math.floor(Math.random() * 1000);
const chromeBin = process.env.CHROME || "google-chrome";
const chrome = spawn(chromeBin, [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=/tmp/nag-e2e-profile-${debugPort}`,
  url,
], { stdio: ["ignore", "ignore", "pipe"] });

let failed = 0;
let passed = 0;
function is(cond, name, detail) {
  if (cond) { passed++; console.log("  ok  " + name); }
  else { failed++; console.log("  FAIL  " + name + (detail ? " — " + detail : "")); }
}

try {
  await waitFor(async () => {
    const r = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
    return r.ok;
  });
  // make sure page loaded
  await waitFor(() => cdpEval(debugPort, `document.querySelector("#main") && document.querySelector("#main").innerHTML.length > 0`));

  const title = await cdpEval(debugPort, `document.title`);
  is(title === "Nag", "page title is Nag", title);

  const setupVisible = await cdpEval(debugPort, `document.querySelector("#main h2")?.textContent || ""`);
  is(/set this up|set up/i.test(setupVisible), "first visit lands on setup", setupVisible);

  // Open Talk with Reed and confirm voice fallback UI
  await cdpEval(debugPort, `document.querySelector('[data-setup-mode="voice"]').click(); true`);
  await waitFor(() => cdpEval(debugPort, `document.getElementById("chat-log")`));
  const voiceUi = await cdpEval(debugPort, `({
    hasMic: !!document.querySelector("[data-mic]"),
    fallback: document.body.innerText.includes("Voice input isn't available") || !!document.querySelector("[data-mic]"),
    speech: window.__nag.speechSupport,
    hasReed: document.body.innerText.includes("Reed"),
  })`);
  is(voiceUi.hasReed, "coach persona visible");
  is(voiceUi.fallback, "either mic button or fallback message is shown");
  is(voiceUi.speech.recognition ? voiceUi.hasMic : !voiceUi.hasMic, "mic hidden when recognition unsupported");

  // Manual form path
  await cdpEval(debugPort, `document.querySelector('[data-setup-mode="manual"]').click(); true`);
  await waitFor(() => cdpEval(debugPort, `document.querySelector("form[data-manual-setup]")`));
  const saved = await cdpEval(debugPort, `
    (async () => {
      const f = document.querySelector("form[data-manual-setup]");
      f.name.value = "piano lessons";
      f.weeklyTargetMinutes.value = "180";
      f.sessionsPerWeek.value = "3";
      f.sessionLengthMinutes.value = "60";
      f.checkInTime.value = "20:00";
      f.intensity.value = "moderate";
      // clear and set Mon Wed Fri
      f.querySelectorAll("input[name=day]").forEach((c) => { if (c.checked) { c.checked = false; c.dispatchEvent(new Event("change", { bubbles: true })); } });
      return "wired";
    })()
  `);
  // After unchecking, form may have rerendered. Set days properly in one go via __nag
  const plan = await cdpEval(debugPort, `
    (() => {
      window.__nag.applyActivity({
        name: "piano lessons",
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
      window.__nag.tab("week");
      return window.__nag.getState().week.sessions.map(s => s.date + " " + s.start);
    })()
  `);
  is(Array.isArray(plan) && plan.length === 3, "week scripted with 3 sessions", JSON.stringify(plan));
  const weekText = await cdpEval(debugPort, `document.body.innerText`);
  is(/This week/i.test(weekText), "week view heading");
  is(/16:00|4:00/i.test(weekText), "start times shown on week plan");

  // Fill the manual form through the UI as well (re-open setup, save)
  await cdpEval(debugPort, `window.__nag.tab("setup"); document.querySelector('[data-setup-mode="manual"]')?.click(); true`);
  await waitFor(() => cdpEval(debugPort, `document.querySelector("form[data-manual-setup]")`));
  const formSave = await cdpEval(debugPort, `
    (() => {
      const f = document.querySelector("form[data-manual-setup]");
      f.name.value = "piano lessons";
      f.weeklyTargetMinutes.value = "180";
      f.sessionsPerWeek.value = "3";
      f.sessionLengthMinutes.value = "60";
      f.checkInTime.value = "20:00";
      f.intensity.value = "strict";
      f.requestSubmit();
      return window.__nag.getState().activity.intensity;
    })()
  `);
  is(formSave === "strict", "manual form saves intensity", String(formSave));

  // Timer
  await cdpEval(debugPort, `window.__nag.tab("today"); true`);
  await waitFor(() => cdpEval(debugPort, `document.querySelector("[data-timer]")`));
  const timed = await cdpEval(debugPort, `
    (async () => {
      window.__nag.onTimer("start");
      const t0 = window.__nag.getState().timer.startedAt;
      const running = window.__nag.getState().timer.running;
      window.__nag.onTimer("pause");
      const paused = !window.__nag.getState().timer.running;
      window.__nag.onTimer("stop");
      const stopped = !window.__nag.getState().timer.running && window.__nag.getState().timer.accumulatedMs === 0;
      return { running, paused, stopped, t0: !!t0 };
    })()
  `);
  is(timed.running && timed.t0, "timer starts");
  is(timed.paused, "timer pauses");
  is(timed.stopped, "timer stops and resets");

  // Check-in via API + UI presence
  const check = await cdpEval(debugPort, `
    (() => {
      const st = window.__nag.getState();
      const s = st.week.sessions[0];
      window.__nag.submitCheckIn(s.id, true, 50);
      const after = window.__nag.getState();
      const logged = Object.values(after.checkins).flat().find(c => c.sessionId === s.id);
      return logged && logged.minutes === 50 && logged.done === true;
    })()
  `);
  is(check, "check-in records minutes against the week");

  // Test nag overlay
  await cdpEval(debugPort, `window.__nag.tab("settings"); true`);
  await waitFor(() => cdpEval(debugPort, `document.querySelector("[data-test-nag]")`));
  const nag = await cdpEval(debugPort, `
    (() => {
      document.querySelector("[data-test-nag]").click();
      const ov = document.getElementById("nag-overlay");
      return { shown: !ov.hidden, text: ov.innerText, hasAck: !!ov.querySelector("[data-nag-ack]") };
    })()
  `);
  is(nag.shown && nag.hasAck, "test nudge shows overlay");
  is(/you said|behind|get back|logged/i.test(nag.text), "nudge uses coach copy", nag.text.slice(0, 200));
  await cdpEval(debugPort, `document.querySelector("[data-nag-ack]").click(); true`);
  const hidden = await cdpEval(debugPort, `document.getElementById("nag-overlay").hidden`);
  is(hidden, "ack dismisses overlay");

  const socialReady = await cdpEval(debugPort, `
    (() => {
      const st = window.__nag.getState();
      window.__nag.ingestNudge({
        type: "friend-nag",
        fromUserId: "friend-abc",
        fromName: "Sam",
        facts: { activityName: "piano lessons", plannedMinutes: 180, loggedMinutes: 14 },
      });
      const ov = document.getElementById("nag-overlay");
      return {
        userId: st.userId,
        historyLen: (st.history || []).length,
        hasWeek: (st.history || []).some(h => h.period === "week"),
        hasDay: (st.history || []).some(h => h.period === "day"),
        activityId: st.activity && st.activity.id,
        overlay: !ov.hidden && /Sam|friend/i.test(ov.innerText),
      };
    })()
  `);
  is(/^[-a-f0-9]{36}$/.test(socialReady.userId), "stable user id present", socialReady.userId);
  is(socialReady.historyLen > 0 && socialReady.hasWeek && socialReady.hasDay, "progress history has day and week snapshots");
  is(!!socialReady.activityId, "activity has an id");
  is(socialReady.overlay, "external friend nag triggers the same overlay");
  await cdpEval(debugPort, `document.querySelector("[data-nag-ack]")?.click(); true`);

  // Manifest + SW
  const man = await fetch(url + "manifest.json").then((r) => r.json());
  is(man.display === "standalone" && man.short_name === "Nag", "manifest is installable");
  const sw = await cdpEval(debugPort, `
    (async () => {
      if (!navigator.serviceWorker) return { supported: false };
      const r = await navigator.serviceWorker.getRegistration();
      return { supported: true, registered: !!r };
    })()
  `);
  is(sw.supported && sw.registered, "service worker registered");

} catch (err) {
  failed++;
  console.error("e2e error:", err);
} finally {
  chrome.kill("SIGKILL");
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
