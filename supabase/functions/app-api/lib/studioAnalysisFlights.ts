/**
 * Studio analysis flights: one product-truth analysis per organization and input
 * set, detached from the HTTP request that started it.
 *
 * Railway's public proxy closes a request at 300s, and Meta's slow runs plus a
 * real fallback window do not fit in one request
 * (docs/specs/studio-analysis-fallback-window.md). The flight keeps running; a
 * request waits for it until its own deadline, then answers `analysisPending`,
 * and the Studio asks again with the same inputs, which joins the same flight.
 *
 * In memory on purpose: the `functions` service runs one replica, and a restart
 * loses nothing paid for, since the Studio's next call starts the analysis again.
 */

/** A flight that finished while nobody was waiting keeps its outcome this long for the next call. */
export const ANALYSIS_RESULT_HOLD_MS = 10 * 60_000;
/** A client answered "pending" asks again within this window, so its flight is not treated as abandoned. */
export const ANALYSIS_REATTACH_GRACE_MS = 30_000;
export const ANALYSIS_PENDING_RETRY_MS = 1_000;

export type AnalysisPending = { analysisPending: true; retryAfterMs: number };

export type AnalysisFlight<T> = {
  readonly promise: Promise<T>;
  readonly orgId: string;
  readonly controller: AbortController;
  /** Requests waiting on this flight right now. */
  waiters: number;
  /** Studio tabs (client ids) that asked for this flight and have not started other inputs since. */
  readonly owners: Set<string>;
  /** A request without a client id asked for it: only the disconnect rule below can abandon it. */
  unowned: boolean;
  /** A request was answered "pending"; its client asks again before this time. */
  reattachBy: number;
  /** Set when the flight finished with nobody waiting: its outcome is held for the next call. */
  settledAt?: number;
};

export function createAnalysisFlights<T>(now: () => number = Date.now) {
  const flights = new Map<string, AnalysisFlight<T>>();

  /**
   * Joins the running flight for `key`, claims the outcome it finished with while
   * nobody waited, or starts `run`. `discardHeld` (a fresh forceRefresh) drops a
   * held outcome; it never interrupts a running flight.
   *
   * `clientId` names the Studio tab asking. A tab works on one input set at a time,
   * so asking for other inputs gives up its earlier flights, and a flight no tab
   * still wants is aborted at once. The disconnect rule below is not enough in
   * production: the proxy logged the Studio's cancelled requests as 499 while their
   * flights ran to the end (37% of completed analyses, 20-23 Nov 2026).
   */
  const acquire = (
    key: string,
    orgId: string,
    options: { discardHeld?: boolean; clientId?: string },
    run: (signal: AbortSignal) => Promise<T>,
  ): AnalysisFlight<T> => {
    const at = now();
    const clientId = options.clientId || "";
    for (const [otherKey, other] of flights) {
      if (other.settledAt !== undefined && at - other.settledAt > ANALYSIS_RESULT_HOLD_MS) flights.delete(otherKey);
    }
    if (clientId) {
      for (const [otherKey, other] of flights) {
        if (otherKey === key || other.orgId !== orgId || other.settledAt !== undefined) continue;
        if (other.owners.delete(clientId) && other.owners.size === 0 && !other.unowned) {
          other.controller.abort();
          flights.delete(otherKey);
        }
      }
    }
    const existing = flights.get(key);
    if (existing) {
      if (existing.settledAt === undefined) {
        if (clientId) existing.owners.add(clientId);
        else existing.unowned = true;
        return existing;
      }
      flights.delete(key);
      if (!options.discardHeld) return existing;
    }
    // A flight of this organization nobody waits on or will ask for again (its
    // inputs changed) is aborted so it stops spending provider tokens.
    for (const [otherKey, other] of flights) {
      if (other.orgId === orgId && other.settledAt === undefined && other.waiters === 0 && at > other.reattachBy) {
        other.controller.abort();
        flights.delete(otherKey);
      }
    }
    const controller = new AbortController();
    // Registered before `run` starts its first query.
    const promise = Promise.resolve().then(() => run(controller.signal));
    const flight: AnalysisFlight<T> = {
      promise, orgId, controller, waiters: 0, reattachBy: 0,
      owners: new Set(clientId ? [clientId] : []), unowned: !clientId,
    };
    flights.set(key, flight);
    const settle = () => {
      if (flights.get(key) !== flight) return;
      if (flight.waiters > 0) flights.delete(key);
      else flight.settledAt = now();
    };
    // Registered before any waiter, so it runs first and sees who is still waiting.
    promise.then(settle, settle);
    return flight;
  };

  /**
   * Waits for the flight until `deadlineAt` or the client disconnects. At the
   * deadline the answer is `analysisPending` and the flight keeps running.
   */
  const wait = async (
    flight: AnalysisFlight<T>,
    signal: AbortSignal,
    deadlineAt: number,
  ): Promise<T | AnalysisPending> => {
    flight.waiters += 1;
    flight.reattachBy = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      const stop = new Promise<"deadline" | "aborted">((resolve) => {
        timer = setTimeout(() => resolve("deadline"), Math.max(0, deadlineAt - now()));
        onAbort = () => resolve("aborted");
        // A superseded flight ends the wait of the request that was cancelled for it.
        if (signal.aborted || flight.controller.signal.aborted) onAbort();
        else {
          signal.addEventListener("abort", onAbort, { once: true });
          flight.controller.signal.addEventListener("abort", onAbort, { once: true });
        }
      });
      const outcome = await Promise.race([flight.promise.then((value) => ({ value })), stop]);
      if (typeof outcome === "object") return outcome.value;
      if (outcome === "deadline") flight.reattachBy = now() + ANALYSIS_REATTACH_GRACE_MS;
      return { analysisPending: true, retryAfterMs: ANALYSIS_PENDING_RETRY_MS };
    } finally {
      flight.waiters -= 1;
      if (timer !== undefined) clearTimeout(timer);
      if (onAbort) {
        signal.removeEventListener("abort", onAbort);
        flight.controller.signal.removeEventListener("abort", onAbort);
      }
    }
  };

  return { acquire, wait, size: () => flights.size };
}
