# Design: agent-turn-limit-headroom

## Context

The runtime agent loop enforces its per-turn step budget in `callGenerateText` (`src/llm-orchestrator-invoke.ts:93-96`): the `stopWhen` array passed to the AI SDK `generateText` contains `deps.stepCountIs(AGENT_MAX_STEPS)`, where `AGENT_MAX_STEPS = 50` is a module-private constant and `deps.stepCountIs` is the DI seam over the SDK's `isStepCount` (wired in `src/llm-orchestrator.ts:50`). The same array carries the no-progress guard (`src/run-control/no-progress-condition.ts`) and — when a run is active — the `/stop` condition (`src/run-control/stop-condition.ts`).

Nothing today records *which* condition ended a turn. Every non-final ending — cap-out, no-progress stall, `/stop` — surfaces identically: last-step `finishReason: 'tool-calls'`, an `llm:end` debug event carrying only `steps` + that ambiguous reason, and the heuristic warn "(step cap reached)" in `llm-orchestrator-send.ts:113` that fires for all three. `emitLlmEnd` (`src/llm-orchestrator-events.ts`) already spreads a controlled optional analytics param into the event data, and the analytics subscriber validates `llm:end` data with `LlmEndDataSchema`, a `z.looseObject`, so extra keys flow through without schema changes.

Constraints that shape the approach: there are no overrides of `AGENT_MAX_STEPS` to preserve (no env var, no config key exists), the budget has exactly one production call site, and the sibling loops (`VERIFIER_MAX_STEPS = 4` in `src/completion/verified-completion.ts`, proactive `stepCountIs(25)` in `src/deferred-prompts/proactive-llm.ts`) are out of scope. Motivation and scope: see proposal.md; the behavior contract: see `specs/llm-agent-turn-limits/spec.md`.

## Goals / Non-Goals

**Goals:**

- One source of truth for the budget: an exported constant consumed by the call site and the wiring test, so a future bump cannot silently stale the test.
- Precise cap-out observability (marker + warn) produced by *observing* the step-count condition, without changing who enforces the stop.
- Test seams preserved: everything flows through the existing `deps.stepCountIs` DI seam; no new module mocking.

**Non-Goals:**

- No configurability (no env var, no settings-UI field, no per-context config key) — the fixed default is the decision, not a limitation to fix later.
- No analytics facts, no DB schema, no persisted state of any kind.
- No changes to the verifier/proactive loops, the `sendLlmResponse` heuristic warn, or any user-visible text (the #417/#401 delivery-path family stays untouched).

## Decisions

### D1: Bump the constant to 125 and export it — no knob

`AGENT_MAX_STEPS` becomes an exported const `= 125` in `src/llm-orchestrator-invoke.ts`, replacing the literal `[50]` in `tests/run-control/invoke-wiring.test.ts` with the imported constant. Alternatives: an env var or config-context key (rejected — proposal non-goal; a knob would add config surface, validation, and a scope-model question — per-context vs platform-instance vs global — for a need that is currently hypothetical), and a separate constants module (rejected — the invoke file already hosts and re-exports this constant family; one consumer plus tests does not justify a new home). 2.5× is a heuristic headroom choice; the marker makes the next tuning data-driven instead of guess-driven.

### D2: Observation-only tracker in a new `src/run-control/turn-limit.ts`

`createTurnLimitTracker(stepCountIs, maxSteps)` returns `{ condition, hit }`: `condition` calls the *injected* predicate, latches `hit = true` when it first returns true, and passes the verdict through unchanged. Enforcement stays owned by the SDK condition — the tracker only records that the step-count condition fired. Module placement: `src/run-control/` already owns the other two `stopWhen` conditions (`no-progress-condition.ts`, `stop-condition.ts`), so a tracker of stop conditions belongs there; none of the existing modules tracks *which* condition fired, so nothing existing covers the need. Alternatives: (a) infer cap-out post-hoc from `result.steps.length === AGENT_MAX_STEPS && finishReason === 'tool-calls'` — rejected: ambiguous exactly when it matters (the no-progress guard can end an unproductive turn at the same boundary with the same finish reason), and it couples to SDK result shape; (b) replace the predicate with a custom counter — rejected: `deps.stepCountIs` must remain the sole enforcement predicate. The tracker is pure, ~30 lines, and per-invocation (created inside `callGenerateText`), so concurrent turns cannot leak state into each other.

### D3: Wire the tracker at the single consumer; surface the hit through the return value

`callGenerateText` builds the tracker, puts `tracker.condition` in both `stopWhen` branches (run / no-run), and returns `{ result, turnLimitHit }` instead of the bare result; `invokeModel` — its only caller — reads the hit for the warn and the `emitLlmEnd` extension. Alternatives: a module-level mutable flag (rejected: cross-turn leakage under concurrency), stashing the hit on the `runRegistry` entry (rejected: the registry is run-control lifecycle state, not step observability, and no run exists in the no-run branch).

### D4: Marker rides the existing `llm:end` event via the optional analytics param

Add `stopReason?: 'turn_limit'` to the `emitLlmEnd` analytics param and spread it into event data only when present, keeping the existing event shape for all other emitters. No analytics schema change is needed (`LlmEndDataSchema` is a `looseObject`), and the field is deliberately not mapped into analytics facts or the DB — this is a tiny observability seam, not a metrics project. Alternative: a dedicated `llm:turn-limit` debug event — rejected: a cap-out is a property of the turn's end, and a side-channel event fragments the turn timeline for consumers that already correlate on `llm:end`.

### D5: Warn at the invoke boundary, after `generateText` resolves

When `turnLimitHit` is true, `invokeModel` emits one pino `warn` with `{ contextId, turnId, steps: result.steps.length }` — identifiers only, never message content, tool arguments/results, or credentials. Timing rationale: the tracker's condition can flip mid-loop while the SDK is still evaluating sibling conditions; emitting only after the turn has definitively ended keeps the warn truthful ("this turn ended at the cap"). Semantics when the no-progress guard and the step-count condition both return true at the same boundary: the step-count verdict wins, because reaching the budget is the fact being observed and the two are not user-distinguishable. Alternative: warn inside the tracker condition — rejected: fires before the loop has actually ended and lacks the final step count.

## Risks / Trade-offs

- [Worst-case turn wall time grows: a turn can now run 125 steps inside the existing 20-minute `generateText` timeout (1,200,000 ms)] → accepted; the no-progress guard (3 unproductive steps) and `/stop` still bound pathological turns, and the marker makes long-tail turns visible in traces. The timeout itself is unchanged.
- [Higher per-turn token cost before a cap-out] → accepted trade-off of the headroom raise; previously the cost surfaced as repeated "type continue" turns instead.
- [`llm:end` gains a key only on cap-out, so the event shape varies] → the field is additive and optional; the analytics schema is a `looseObject` and no fact/DB consumer reads it.
- [Both stopWhen conditions true at the same boundary] → marker/warn reflect the step-count verdict (D5); rare and with no user-visible difference.
- [New `src/run-control/turn-limit.ts` is mutation-gateable with a thin surface] → keep `tests/run-control/turn-limit.test.ts` assertion-rich (passthrough verdict, one-shot latch, hit-only-on-true) so the mutation floor clears; see proposal.md Verification for the TDD order.

## Migration Plan

Single deploy, no feature flag, no DB migration, no backfill (no persisted state changes — the marker lives only in debug-event data, and the tracker only in per-call memory). Rollout and rollback are both plain revert: the constant returns to 50 and the inert observation code can remain or go with it. Scope-model impact: none — no new persisted state and no new keying; the warn and event reuse the existing ephemeral `contextId`/`turnId` identity of the debug event bus. No new tool surface, so capability gating and `tool_prefs` are unaffected; no new dependencies — pino and the existing `deps.stepCountIs` seam cover everything.

TDD hook interactions (Write/Edit pipeline gates every file below; test-first order per proposal.md Verification):

1. `tests/run-control/turn-limit.test.ts` (new) — red first: tracker passthrough + latch semantics.
2. `tests/run-control/invoke-wiring.test.ts` — flip `stepCountArgs` assertions `[50]` → `[AGENT_MAX_STEPS]` (imported): red until the bump lands, then proves the new default applies with no explicit config.
3. `tests/llm-orchestrator-invoke.test.ts` — red: real SDK loop with a mock model returning tool-calls for `AGENT_MAX_STEPS` steps asserts `llm:end` carries `stopReason: 'turn_limit'`, `steps === AGENT_MAX_STEPS`, and the warn; negative case for a natural `stop` finish.
4. Implement: `src/run-control/turn-limit.ts` (new), `src/llm-orchestrator-invoke.ts` (export + bump + tracker wiring + warn), `src/llm-orchestrator-events.ts` (optional `stopReason` param).
5. `docs/architecture/behaviors.md` — document the raised cap and the marker next to the verified-completion/truncation section (non-code, ungated).

The mutation baseline picks up `src/run-control/turn-limit.ts` from the changed-file run; `AGENT_MAX_STEPS` being exported does not add gateable surface beyond the existing invoke file.

## Open Questions

None. The one ambiguity found while designing — which condition "wins" telemetry when no-progress and the step cap fire on the same boundary — is resolved by D5 and does not change the specs, approach, or task breakdown.
