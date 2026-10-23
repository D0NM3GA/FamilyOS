/**
 * Decides which camera detections become an addItemByBarcode call (Phase 10.5). That action
 * is deliberately non-idempotent (a repeat call bumps quantity), and a detection loop sees
 * the same barcode many times a second, so without this one scan would fill the cart.
 *
 * Rules:
 * - A code must be read identically in `confirmReads` detections in a row before it
 *   counts. A frame with no code, or a different code, starts over. This filters one-frame
 *   misreads.
 * - Only one submission at a time: nothing is accepted between accept() and settle().
 * - After a submission settles, the same code is ignored for `cooldownMs`, measured from
 *   when the result came back, not when it was sent (a slow lookup mustn't eat the
 *   cooldown). A different code is accepted straight away.
 *
 * Plain class, no React or DOM. The scanner keeps one for its whole lifetime, across camera
 * restarts, so a Resume can't re-add the can that's still in view.
 */
export class ScanGate {
  private candidate: string | null = null;
  private hits = 0;
  private inFlight = false;
  private lastCode: string | null = null;
  private cooldownUntil = 0;

  constructor(
    private readonly confirmReads = 2,
    private readonly cooldownMs = 3000,
  ) {}

  /**
   * Feed one detection (a normalized code, or null for a frame with none). Returns the code
   * to submit, or null. A returned code puts the gate in flight until settle().
   */
  observe(code: string | null, now: number): string | null {
    if (code === null || code !== this.candidate) {
      this.candidate = code;
      this.hits = code === null ? 0 : 1;
    } else {
      this.hits++;
    }
    if (code === null || this.inFlight || this.hits < this.confirmReads) return null;
    if (code === this.lastCode && now < this.cooldownUntil) return null;

    this.inFlight = true;
    this.candidate = null;
    this.hits = 0;
    return code;
  }

  /** The submission for `code` came back having done something (added, or asked for a name). */
  settle(code: string, now: number): void {
    this.inFlight = false;
    this.lastCode = code;
    this.cooldownUntil = now + this.cooldownMs;
  }

  /**
   * The submission failed (nothing was added): accept again right away, with no cooldown,
   * since the scanner is telling the user to try again.
   */
  release(): void {
    this.inFlight = false;
  }

  get busy(): boolean {
    return this.inFlight;
  }
}
