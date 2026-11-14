/**
 * Nudge source interface.
 *
 * Local evaluation (session start, behind, check-in) is one source.
 * A later social layer can ingest a remote "friend nag" through
 * ExternalNudgeSource.ingest() and the same nag flow will fire.
 * v1 does not network; ingest is the seam.
 */

export class NudgeSource {
  start(_handler) {
    throw new Error("NudgeSource.start is not implemented");
  }
  stop() {}
}

/**
 * Wraps the existing evaluateNags / applyNagTiming loop.
 * The app still calls evaluate() itself; this source exists so local
 * and external nudges share a bus.
 */
export class LocalNudgeSource extends NudgeSource {
  constructor(evaluate) {
    super();
    this.evaluate = evaluate;
    this.handler = null;
  }
  start(handler) {
    this.handler = handler;
  }
  stop() {
    this.handler = null;
  }
  emit(candidate, meta = {}) {
    if (!candidate || !this.handler) return;
    this.handler(normalizeNudge(candidate, { source: "local", ...meta }));
  }
}

/**
 * External / friend nags. Call ingest() when a payload arrives
 * (future: websocket, push message, poll). No transport in v1.
 */
export class ExternalNudgeSource extends NudgeSource {
  constructor() {
    super();
    this.handler = null;
    this.queue = [];
  }
  start(handler) {
    this.handler = handler;
    if (this.queue.length) {
      const pending = this.queue.splice(0);
      for (const n of pending) this.handler(n);
    }
  }
  stop() {
    this.handler = null;
  }
  /** @param {object} payload  friend nag or other remote nudge */
  ingest(payload) {
    const nudge = normalizeNudge(payload, {
      source: payload?.source || "friend",
      fromUserId: payload?.fromUserId || payload?.from || null,
      fromName: payload?.fromName || null,
    });
    if (this.handler) this.handler(nudge);
    else this.queue.push(nudge);
    return nudge;
  }
}

export class NudgeBus {
  constructor() {
    this.listeners = [];
    this.sources = [];
  }
  addSource(source) {
    this.sources.push(source);
    source.start((nudge) => this.publish(nudge));
    return source;
  }
  subscribe(fn) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }
  publish(nudge) {
    for (const fn of this.listeners) fn(nudge);
  }
  stop() {
    for (const s of this.sources) s.stop();
  }
}

export function normalizeNudge(payload, extras = {}) {
  const facts = { ...(payload.facts || {}) };
  if (payload.fromName && !facts.fromName) facts.fromName = payload.fromName;
  if (payload.fromUserId && !facts.fromUserId) facts.fromUserId = payload.fromUserId;
  const type = payload.type || "friend-nag";
  const key = payload.key || `${extras.source || "external"}:${type}:${payload.fromUserId || payload.from || "anon"}:${payload.at || Date.now()}`;
  return {
    type,
    key,
    facts,
    session: payload.session || null,
    pending: payload.pending || null,
    source: extras.source || payload.source || "local",
    fromUserId: extras.fromUserId || payload.fromUserId || null,
    fromName: extras.fromName || payload.fromName || null,
    at: payload.at || new Date().toISOString(),
  };
}
