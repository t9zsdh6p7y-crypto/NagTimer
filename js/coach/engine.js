/**
 * Pluggable coach interface.
 *
 * A real LLM backend can implement CoachEngine and be returned from
 * createCoach("llm", { endpoint, apiKey }) later. v1 ships a rule-based
 * guided dialogue and an LLM stub that refuses to run without a configured
 * endpoint (no API keys are embedded).
 */

import { CoachEngine } from "./interface.js";
import { RuleBasedCoach } from "./dialogue.js";
export { CoachEngine };

/**
 * Stub for a future hosted model. Does not call the network in v1.
 */
export class LlmCoachStub extends CoachEngine {
  constructor(options = {}) {
    super();
    this.endpoint = options.endpoint || null;
    this.apiKey = options.apiKey || null;
  }

  configured() {
    return Boolean(this.endpoint);
  }

  async start(context) {
    return this.#unavailable(context);
  }

  async respond(_userText, context) {
    return this.#unavailable(context);
  }

  async #unavailable(context) {
    return {
      reply:
        "A live AI coach isn't wired up in this version (no server, no API keys). I can keep using the built-in guided setup instead.",
      draft: context?.draft || {},
      step: context?.step || "askActivity",
      done: false,
      fallbackToRules: true,
      engine: "llm-stub",
    };
  }
}

export function createCoach(kind = "rules", options = {}) {
  if (kind === "llm") {
    const stub = new LlmCoachStub(options);
    if (!stub.configured()) {
      // Transparent fallback — v1 always uses rules unless an endpoint exists.
      return new RuleBasedCoach();
    }
    return stub;
  }
  return new RuleBasedCoach();
}
