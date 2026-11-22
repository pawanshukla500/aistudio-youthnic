# Studio analysis: a real fallback window when Meta is slow

Status: implemented (Nov 2026). Code: `supabase/functions/app-api/lib/studioAnalysisFlights.ts`,
`analyze()` in `supabase/functions/app-api/index.ts`, `PRODUCT_TRUTH_PRIMARY_WINDOW_MS` and
`STUDIO_ANALYSIS_FLIGHT_BUDGET_MS` in `lib/aiModelPolicy.ts`, `src/lib/analysisPending.ts`.

## Problem

`studio.analyze` ran the whole product-truth chain inside one HTTP request. Railway's public proxy
closes a request at 300s, so the chain had `ANALYZE_PROXY_BUDGET_MS` (280s). A hop with a fallback
after it kept `PRODUCT_TRUTH_FALLBACK_RESERVE_MS` (60s) back, so Meta got about 215s and, after a Meta
timeout, Z.ai GLM 5.3 Flash got about 36-60s.

Production, last 14 days:

| Model | Completed | Latency | Failures |
| --- | --- | --- | --- |
| Meta Muse Spark (primary) | 338 | 12 over 165s, max 224s | 3 timeouts |
| Z.ai GLM 5.3 Flash (first fallback) | 5 | p50 202s | - |

GLM needs about 200s, so in that window it almost never finished. Shortening Meta's slice to make room
would cut off Meta's slow runs that do succeed. Tuning the split inside 280s cannot work: Meta's tail
(224s) plus GLM's median (202s) is 426s, well past the 300s proxy cut.

## Options

| Option | Verdict |
| --- | --- |
| Re-split the 280s | Rejected. Any split that gives GLM ~200s cuts Meta at ~75s and fails most analyses (Meta typically takes ~100s). |
| (b) Hedged race inside the request: start GLM after a delay | Rejected on its own. To finish GLM's median before 280s it must start by ~75s, so it would run on most analyses, not only the slow ones. |
| (a) Analysis no longer bound to one request | Chosen. The chain can run longer than one request, so Meta keeps its tail and GLM gets a full window. |
| (a) + (b): hedge inside the detached flight (start GLM at ~165s) | Deferred. It would cut the wait after a Meta timeout by ~75s, but only for the ~1% of analyses where Meta times out. In exchange it runs GLM on the ~4% where Meta is slow, needs concurrent hops plus loser cancellation in `runVisionProviderChain`, and needs the cost of an aborted call recorded. It can be added on top of this design later. |

For (a), a durable job table was weighed against the in-memory flight registry that already gave one
analysis per input set (PR #185). The `functions` service runs one replica (`numReplicas: 1`), so the
registry is still the single dedupe point. A restart loses nothing paid for: the Studio's next call finds
no flight and starts the analysis again. A table would add a migration, RLS and type sync without
improving either property. If `functions` ever scales out, this registry (and the existing dedupe)
needs a shared store first.

## Design

1. **Detached flight.** `analyze()` passes the analysis body to `studioAnalysisFlights.acquire(key, …)`
   (key `${orgId}:${pHash}:${rHash}:${ANALYSIS_VERSION}`, unchanged). The flight runs on its own
   budget, `STUDIO_ANALYSIS_FLIGHT_BUDGET_MS` = 600s from the request start. The client connection is
   never its deadline.
2. **Answer before the proxy cut.** The request waits for the flight until
   `requestStarted + ANALYZE_PROXY_BUDGET_MS` (280s). If the flight is still running, it answers
   `{ analysisPending: true, retryAfterMs: 1000 }`. Most analyses finish in one request, exactly as before.
3. **Studio re-joins.** `analyzeUntilSettled` (`src/lib/analysisPending.ts`, used by
   `analysis.analyzeReferences`) calls `studio.analyze` again with the same inputs plus
   `resumeAnalysis: true`, which joins the same flight. It stops after 12 minutes or on cancel.
4. **One analysis per input set.** A flight that finishes while nobody waits (between a pending answer and
   the next call) keeps its outcome for `ANALYSIS_RESULT_HOLD_MS` (10 min). The next call with the same
   key claims it once: the same session, or the same error. A fresh `forceRefresh` drops a held outcome;
   a `resumeAnalysis` retry never does, and neither ever restarts a running flight.
5. **Abandoned flights stop.** When an organization starts a new input set, its other running flights
   are aborted if no request waits on them and no client was told to come back within
   `ANALYSIS_REATTACH_GRACE_MS` (30s). This keeps the old behaviour: changing the photos stops the
   obsolete analysis.
6. **Primary window.** In a detached flight the first hop is capped at
   `PRODUCT_TRUTH_PRIMARY_WINDOW_MS` (240s) when a fallback follows it. That is above Meta's slowest
   completed run (224s), so no observed success is cut. Later hops use the existing rule: a non-last hop
   keeps 60s for the next, and the last hop gets what is left.

Budget after a Meta timeout, with 10s prep and the default chain:

| Hop | Starts | Window | Old window (one request) |
| --- | --- | --- | --- |
| Meta Muse Spark | 10s | 240s | ~215s |
| Z.ai GLM 5.3 Flash | 250s | 285s (medium thinking kept) | ~36s (clamped to low) |
| OpenAI GPT 6.1 Terra, Luna, Gemini | 535s | the last ~60s, shared | ~24s |

A primary that fails fast (404, 429, missing key) still hands the next model nearly the whole flight.

## Unchanged

- The CLAUDE.md rule-1 chain and its reasoning levels: `productTruthRouteChain`,
  `clampProductTruthThinking`, and the `< 60s` low clamp, which now rarely applies to GLM.
- Catalog preflight and QA budgets: only Studio analysis passes `detachedFlight`.
- Cost: there are no extra model calls. Every hop is still recorded in `ai_runs` with its real cost, so
  `lib/providerCost.ts` and job estimates need no change.

## Limits

- After a full Meta timeout, the Studio can wait up to about 9 minutes, where before the analysis failed
  at 280s. This affects the ~1% of analyses where Meta times out.
- A flight holds its `visionLimiter` slot for its whole run (up to 10 min, previously 280s).
- A failure that lands when no client returns is recorded in `ai_runs` (failed hops), but is not
  reported to Sentry by a request.
