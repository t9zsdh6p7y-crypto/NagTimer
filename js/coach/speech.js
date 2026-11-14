/**
 * Web Speech API wrapper. Feature-detects and fails soft.
 * Safe to import when window is missing (tests / Node).
 */

export function detectSpeech(globalObj) {
  const g = globalObj || (typeof window !== "undefined" ? window : undefined);
  if (!g) {
    return { recognition: false, synthesis: false, any: false };
  }
  const Rec = g.SpeechRecognition || g.webkitSpeechRecognition;
  const synthesis = typeof g.speechSynthesis !== "undefined";
  return {
    recognition: Boolean(Rec),
    synthesis,
    any: Boolean(Rec) || synthesis,
  };
}

export function getRecognitionCtor(globalObj) {
  const g = globalObj || (typeof window !== "undefined" ? window : undefined);
  if (!g) return null;
  return g.SpeechRecognition || g.webkitSpeechRecognition || null;
}

/**
 * Create a one-shot or continuous recognizer. Returns null if unsupported.
 * onResult(text, isFinal), onError(err), onEnd()
 */
export function createRecognizer({ onResult, onError, onEnd, lang = "en-US", continuous = false } = {}, globalObj) {
  const Ctor = getRecognitionCtor(globalObj);
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = continuous;
  rec.onresult = (ev) => {
    let text = "";
    let isFinal = false;
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      text += ev.results[i][0].transcript;
      if (ev.results[i].isFinal) isFinal = true;
    }
    onResult && onResult(text.trim(), isFinal);
  };
  rec.onerror = (ev) => {
    onError && onError(ev.error || ev);
  };
  rec.onend = () => onEnd && onEnd();
  return rec;
}

function pickVoice(voices, personaVoice) {
  if (!voices || !voices.length) return null;
  const prefer = personaVoice?.prefer;
  const lang = personaVoice?.lang || "en-US";
  const byLang = voices.filter((v) => (v.lang || "").toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
  const pool = byLang.length ? byLang : voices;
  if (prefer) {
    const hit = pool.find((v) => prefer.test(v.name) || prefer.test(v.lang));
    if (hit) return hit;
  }
  // Best-effort: avoid obviously high cartoon voices; prefer local voices.
  const local = pool.filter((v) => v.localService);
  return (local[0] || pool[0] || null);
}

export function speak(text, { personaVoice, onend } = {}, globalObj) {
  const g = globalObj || (typeof window !== "undefined" ? window : undefined);
  if (!g || !g.speechSynthesis) {
    onend && onend(false);
    return { ok: false, reason: "unsupported" };
  }
  g.speechSynthesis.cancel();
  const u = new g.SpeechSynthesisUtterance(text);
  u.rate = personaVoice?.rate ?? 0.95;
  u.pitch = personaVoice?.pitch ?? 0.95;
  u.lang = personaVoice?.lang ?? "en-US";
  const voices = g.speechSynthesis.getVoices && g.speechSynthesis.getVoices();
  const voice = pickVoice(voices, personaVoice);
  if (voice) u.voice = voice;
  if (onend) {
    u.onend = () => onend(true);
    u.onerror = () => onend(false);
  }
  g.speechSynthesis.speak(u);
  return { ok: true, utterance: u };
}

export function cancelSpeech(globalObj) {
  const g = globalObj || (typeof window !== "undefined" ? window : undefined);
  if (g && g.speechSynthesis) g.speechSynthesis.cancel();
}
