# agent-turn-limit-headroom

## Goal

Raise the papai runtime agent loop's default per-turn step budget (suspected cap-outs on long multi-tool flows, unconfirmed) and make cap-outs precisely observable so production data can confirm or refute the suspicion. Scope: the papai runtime loop (`llm-orchestrator` family) only — not the verifier sub-loop, not the proactive loop, not opencode-agent budget machinery, and not the #417/#401 empty-generation/delivery-path bug family.

## Where the limit lives

- `src/llm-orchestrator-invoke.ts:35` — `const AGENT_MAX_STEPS = 50`, a module-private constant. **Not configurable** (no env var, no config key): there are no explicit overrides to preserve; changing the constant IS the default change.
- Enforced at `src/llm-orchestrator-invoke.ts:93-96` via `deps.stepCountIs(AGENT_MAX_STEPS)` in the AI SDK `generateText` `stopWhen` array (`deps.stepCountIs` is the DI seam over `isStepCount`, wired in `src/llm-orchestrator.ts:50`).
- Out of scope sibling loops: `VERIFIER_MAX_STEPS = 4` (`src/completion/verified-completion.ts:77`), proactive `stepCountIs(25)` (`src/deferred-prompts/proactive-llm.ts:130`).

## Behaviour change

1. **Default raise**: `AGENT_MAX_STEPS` 50 → **125** (2.5×, mid-range of the requested 2–3×). Export the constant so tests and call sites share one source of truth. No configurability knob is added.
2. **Cap-out marker**: today a cap-out is indistinguishable in traces from a no-progress stall or a user stop — all end with last-step `finishReason: 'tool-calls'` (`llm:end` event carries only `steps` + that ambiguous reason; the `llm-orchestrator-send.ts:113` warn "(step cap reached)" fires for all three). Add a precise marker: a small tracker in a new `src/run-control/turn-limit.ts` that wraps the injected `deps.stepCountIs` condition, flips a flag when it fires, and — on hit — (a) emits a pino `warn` from the invoke boundary (`contextId`, `turnId`, `steps`) and (b) attaches `stopReason: 'turn_limit'` to the turn's `llm:end` debug event. Enforcement stays owned by the SDK condition (the tracker only observes); `deps.stepCountIs` remains the sole predicate. The analytics `llm:end` schema (`LlmEndDataSchema`) is a `looseObject`, so the field flows through validation; it is deliberately **not** mapped into analytics facts/DB (tiny seam, not a metrics project).
3. **User-visible behaviour on cap-out is unchanged in kind**: verdict `truncated` → verifier summary offering "continue"; degraded verifier → fallback stub (unchanged, #417/#401 territory). Turns simply may run up to 125 productive steps before that path; the no-progress guard (3 unproductive steps) still bounds stalls.

## Files to touch

- `src/llm-orchestrator-invoke.ts` — export + bump `AGENT_MAX_STEPS`; build tracker in `callGenerateText` (single consumer: `invokeModel`), use `tracker.condition` in `stopWhen`, surface hit to `invokeModel` for warn + `emitLlmEnd` analytics extension.
- `src/run-control/turn-limit.ts` (new, ~30 lines) — `TURN_LIMIT_STOP_REASON = 'turn_limit'`, `createTurnLimitTracker(stepCountIs, maxSteps)` → `{ condition, hit }`.
- `src/llm-orchestrator-events.ts` — optional `stopReason?: 'turn_limit'` on `emitLlmEnd`'s analytics param, spread into event data.
- `tests/run-control/turn-limit.test.ts` (new) — tracker passthrough + hit semantics.
- `tests/run-control/invoke-wiring.test.ts` — `stepCountArgs` assertions `[50]` → `[AGENT_MAX_STEPS]` (imported constant): proves the new default applies with no explicit config.
- `tests/llm-orchestrator-invoke.test.ts` — real AI SDK loop with `MockLanguageModelV3` returning tool-calls for `AGENT_MAX_STEPS` steps: assert `llm:end` data carries `stopReason: 'turn_limit'`, `steps === AGENT_MAX_STEPS`, and the warn fires; negative case: natural `stop` finish → no `stopReason` field.
- `docs/architecture/behaviors.md` — document the raised cap and the `stopReason: 'turn_limit'` marker next to the existing verified-completion/truncation section.

## Verification

TDD order: failing tracker tests → failing wiring assertion at 125 → failing cap-out marker test → implement → green. Then `bun run test:affected` in the loop; before finishing, full `bun run test` (with coverage ratchet), `bun run typecheck`, `bun run lint`, `bun check:full` all green. New file `src/run-control/turn-limit.ts` is mutation-gateable — keep its tests assertion-rich. MR description states old → new (50 → 125) explicitly.

## Non-goals

- Verifier / proactive / opencode-agent loops and budgets untouched.
- No env/config knob for the limit; no analytics fact or DB schema extension.
- #417/#401 delivery-path bugs and the `sendLlmResponse` heuristic warn stay as-is.
- Capability: new `llm-agent-turn-limits` (nothing under `openspec/specs/` covers the runtime loop).
