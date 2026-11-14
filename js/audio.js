/** Short cue sounds and vibration. No assets required. */

let ctx;

function getCtx() {
  if (typeof window === "undefined" || !window.AudioContext && !window.webkitAudioContext) {
    return null;
  }
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    ctx = new C();
  }
  return ctx;
}

export function playNagSound(intensity = "moderate") {
  const c = getCtx();
  if (!c) return false;
  if (c.state === "suspended") c.resume();
  const now = c.currentTime;
  const count = intensity === "strict" ? 3 : intensity === "gentle" ? 1 : 2;
  const freq0 = intensity === "gentle" ? 440 : 520;
  for (let i = 0; i < count; i++) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "square";
    osc.frequency.value = freq0 + i * 80;
    const t = now + i * 0.18;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(intensity === "gentle" ? 0.04 : 0.08, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.16);
  }
  return true;
}

export function vibrate(intensity = "moderate") {
  if (typeof navigator === "undefined" || !navigator.vibrate) return false;
  const pattern =
    intensity === "strict"
      ? [200, 80, 200, 80, 400]
      : intensity === "gentle"
        ? [120]
        : [200, 100, 200];
  try {
    navigator.vibrate(pattern);
    return true;
  } catch {
    return false;
  }
}
