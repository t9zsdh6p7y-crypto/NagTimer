/** Shared date/time helpers. Safe in browser and Node. */

export function pad(n, w = 2) {
  return String(n).padStart(w, "0");
}

export function localDateISO(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISODate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function combineDateAndTime(date, hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const x = typeof date === "string" && /^\d{4}-\d{2}-\d{2}/.test(date)
    ? parseISODate(date.slice(0, 10))
    : new Date(date);
  x.setHours(h, m || 0, 0, 0);
  return x;
}

export function formatTime(d) {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function formatHM(totalSeconds) {
  const sign = totalSeconds < 0 ? "-" : "";
  const s = Math.abs(Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${sign}${h}:${pad(m)}:${pad(sec)}`;
  return `${sign}${m}:${pad(sec)}`;
}

export function formatHoursMinutes(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function clamp(n, a, b) {
  return Math.min(b, Math.max(a, n));
}

export function weekdayShort(d) {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
}

/** Parse HH:MM (24h). Returns {h,m} or null. */
export function parseHHMM(s) {
  if (!s || typeof s !== "string") return null;
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return { h, m: min };
}

export function dowFromName(name) {
  const map = {
    su: 0, sun: 0, sunday: 0,
    mo: 1, mon: 1, monday: 1,
    tu: 2, tue: 2, tues: 2, tuesday: 2,
    we: 3, wed: 3, wednesday: 3,
    th: 4, thu: 4, thur: 4, thursday: 4,
    fr: 5, fri: 5, friday: 5,
    sa: 6, sat: 6, saturday: 6,
  };
  return map[String(name).trim().toLowerCase()];
}

/** Normalize habit days: 'daily' | number[] (0=Sun). */
export function normalizeDays(days) {
  if (days == null || days === "" || days === "daily" || days === "every day" || days === "*") {
    return [0, 1, 2, 3, 4, 5, 6];
  }
  if (Array.isArray(days)) {
    return [...new Set(days.map((d) => {
      if (typeof d === "number") return d;
      const n = dowFromName(d);
      if (n != null) return n;
      const num = Number(d);
      return Number.isFinite(num) ? num : null;
    }).filter((n) => n != null && n >= 0 && n <= 6))].sort();
  }
  if (typeof days === "string") {
    const parts = days.split(/[|,;/\s]+/).map((s) => s.trim()).filter(Boolean);
    if (parts.length === 1 && /daily|everyday|every-day/i.test(parts[0])) {
      return [0, 1, 2, 3, 4, 5, 6];
    }
    if (parts.length === 1 && /weekday|weekdays/i.test(parts[0])) {
      return [1, 2, 3, 4, 5];
    }
    if (parts.length === 1 && /weekend/i.test(parts[0])) {
      return [0, 6];
    }
    return normalizeDays(parts);
  }
  return [0, 1, 2, 3, 4, 5, 6];
}

export function isHabitDueOn(habit, date) {
  const days = normalizeDays(habit.days);
  return days.includes(date.getDay());
}

export function daysLabel(days) {
  const d = normalizeDays(days);
  if (d.length === 7) return "Every day";
  if (d.length === 5 && d.join() === "1,2,3,4,5") return "Weekdays";
  if (d.length === 2 && d.join() === "0,6") return "Weekends";
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return d.map((i) => names[i]).join(", ");
}

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function weekStart(date, weekStartsOn = 1) {
  const d = startOfDay(date);
  const back = (d.getDay() - weekStartsOn + 7) % 7;
  return addDays(d, -back);
}

export function weekStartISO(date, weekStartsOn = 1) {
  return localDateISO(weekStart(date, weekStartsOn));
}

export function formatMinutes(mins) {
  const n = Math.round(Number(mins) || 0);
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  const h = Math.floor(a / 60);
  const m = a % 60;
  if (h > 0 && m > 0) return `${sign}${h}h ${m}m`;
  if (h > 0) return `${sign}${h}h`;
  return `${sign}${m}m`;
}

const NUMBER_WORDS = {
  zero: 0, a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/** Turn "three", "twenty five", "1", or "1.5" into a number, or null. */
export function parseNumberWord(text) {
  if (text == null) return null;
  if (typeof text === "number" && Number.isFinite(text)) return text;
  const s = String(text).trim().toLowerCase().replace(/-/g, " ");
  if (!s) return null;
  if (/^\d+(?:\.\d+)?$/.test(s)) return Number(s);
  const parts = s.split(/\s+/);
  let total = 0;
  let current = 0;
  let used = false;
  for (const p of parts) {
    if (p === "and") continue;
    if (p === "hundred") { current = (current || 1) * 100; used = true; continue; }
    if (NUMBER_WORDS[p] == null) return used ? total + current : null;
    const n = NUMBER_WORDS[p];
    if (n >= 20 && n % 10 === 0) current += n;
    else current += n;
    used = true;
  }
  return used ? total + current : null;
}

/** Parse spoken or typed durations like "2 hours", "three hours", "90 min", "1h 30m", "180". */
export function parseDurationMinutes(text) {
  if (text == null) return null;
  if (typeof text === "number" && Number.isFinite(text)) return Math.round(text);
  const raw = String(text).trim().toLowerCase();
  if (!raw) return null;
  const s = raw.replace(/-/g, " ");
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    // bare numbers: 1-9 as hours, >=10 as minutes.
    return n <= 9 ? n * 60 : n;
  }
  const bareWord = parseNumberWord(s);
  if (bareWord != null && /^[a-z\s]+$/.test(s) && !/hour|minute|min|hr/.test(s)) {
    return bareWord <= 9 ? bareWord * 60 : bareWord;
  }
  const words = Object.keys(NUMBER_WORDS).join("|");
  const num = "((?:\\d+(?:\\.\\d+)?)|(?:(?:" + words + ")(?:[\\s-]+(?:and|" + words + "))*))";
  const hourRe = new RegExp(num + "\\s*(h|hr|hrs|hour|hours)\\b");
  const minRe = new RegExp(num + "\\s*(m|min|mins|minute|minutes)\\b");
  let total = 0;
  let matched = false;
  const hour = s.match(hourRe);
  const min = s.match(minRe);
  if (hour) {
    const n = parseNumberWord(hour[1]);
    if (n != null) { total += Math.round(n * 60); matched = true; }
  }
  if (min) {
    const n = parseNumberWord(min[1]);
    if (n != null) { total += Math.round(n); matched = true; }
  }
  if (matched) return total;
  const compact = s.match(/^(\d+)\s*h(?:ours?)?\s*(\d+)\s*m/);
  if (compact) return Number(compact[1]) * 60 + Number(compact[2]);
  return null;
}

export function parseTimeInput(text) {
  if (!text) return null;
  const s = String(text).trim().toLowerCase();
  const direct = parseHHMM(s);
  if (direct) return `${pad(direct.h)}:${pad(direct.m)}`;
  const ampm = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)$/i)
    || s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a.m.|p.m.)$/i);
  if (ampm) {
    let h = Number(ampm[1]);
    const m = Number(ampm[2] || 0);
    const ap = ampm[3].replace(/\./g, "").toLowerCase();
    if (ap === "am") {
      if (h === 12) h = 0;
    } else if (h !== 12) h += 12;
    if (h > 23 || m > 59) return null;
    return `${pad(h)}:${pad(m)}`;
  }
  // "4" or "4 30" as hour, assume pm if 1-7? Too magic. Require : or am/pm.
  const hourOnly = s.match(/^(\d{1,2})$/);
  if (hourOnly) {
    const h = Number(hourOnly[1]);
    if (h >= 0 && h <= 23) return `${pad(h)}:00`;
  }
  return null;
}

export function formatTimeStr(hhmm) {
  const p = parseHHMM(hhmm);
  if (!p) return hhmm || "";
  const d = new Date();
  d.setHours(p.h, p.m, 0, 0);
  return formatTime(d);
}

export function minutesSinceMidnight(d) {
  return d.getHours() * 60 + d.getMinutes();
}
