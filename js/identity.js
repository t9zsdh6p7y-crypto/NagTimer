/** Stable local user id. Generated once and persisted. No account in v1. */

const ID_KEY = "nag-user-id";

function uuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function generateUserId() {
  return uuid();
}

export function getOrCreateUserId(store = globalThis.localStorage, stateId) {
  if (stateId && typeof stateId === "string" && stateId.length >= 8) return stateId;
  try {
    const existing = store?.getItem?.(ID_KEY);
    if (existing) return existing;
  } catch {}
  const id = generateUserId();
  try { store?.setItem?.(ID_KEY, id); } catch {}
  return id;
}

export function persistUserId(id, store = globalThis.localStorage) {
  try { store?.setItem?.(ID_KEY, id); } catch {}
  return id;
}

export { ID_KEY };
