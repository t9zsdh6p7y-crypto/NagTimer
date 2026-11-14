/** Shared coach interface. Kept separate to avoid circular imports. */

export class CoachEngine {
  async start(_context) {
    throw new Error("CoachEngine.start is not implemented");
  }
  async respond(_userText, _context) {
    throw new Error("CoachEngine.respond is not implemented");
  }
}
