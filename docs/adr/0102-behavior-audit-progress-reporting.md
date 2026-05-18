# ADR-0102: Behavior Audit Progress Reporting with Structured Events

## Status

Accepted

## Date

2026-05-18

## Context

The behavior-audit pipeline (Phase 1–3) previously used ad hoc `console.log` writes inside each phase runner and agent helper. Under `p-limit(4)` concurrency in Phase 1 and `p-limit(1)` in later phases, these uncoordinated writes produced split-line corruption and unattributed artifact messages (`wrote N behaviors` floating without a file path). Token usage, throughput, and tool-call counts were invisible at `VERBOSE=0`; the only alternative was `VERBOSE=1` pino JSON spam.

Two predecessor documents defined the desired outcome:

- **Spec** (`2026-04-25-behavior-audit-progress-ux-design.md`) — defined the UX goal: per-item token counts, throughput, tool-call counts inline, followed by aggregate phase summaries.
- **Implementation Plan** (`2026-04-27-behavior-audit-progress-output.md`) — defined the mechanism: an event-based progress reporter abstraction with deterministic text rendering, `listr2` optional interactive rendering, and `BEHAVIOR_AUDIT_PROGRESS_RENDERER` configuration.

The work was implemented between 2026-04-27 and 2026-05-18.

## Decision Drivers

1. **Parallel safety** — Phase 1 processes test files concurrently; per-item output must preserve identity without line interleaving.
2. **Non-TTY first-class** — CI and log captures are primary consumers; output must be deterministic text, not animated spinners.
3. **No helper-visible `console.log`** — All operator-visible progress must route through a single sink.
4. **Renderer decoupling** — The same phase code should work with text mode today and a future `listr2` mode without recompilation.
5. **Spec compliance** — The `AgentUsage`, `PhaseStats`, accumulation API, and formatting rules from the spec must be realized exactly.

## Considered Options

### Option 1: Direct stdout replacement (rejected)

Replace `console.log` calls with a single shared `log()` function that prefixes lines with file/test identifiers.

- **Pros**: Minimal code churn.
- **Cons**: Does not solve interleaving under concurrency; still requires each phase to coordinate its own formatting; no clear path to an interactive renderer.
- **Verdict**: Rejected.

### Option 2: Structured event reporter with typed renderer dispatch (chosen)

Introduce a small event model (`item-start`, `item-finish`, `artifact-write`), a stateful text renderer that matches start metadata to finish events via stable IDs, and a `createProgressReporter` factory that selects renderer based on env/TTY.

- **Pros**: Solves concurrency attribution via stable `itemId`; deterministic text output; `listr2` hook ready; preserves spec's `AgentUsage` and `PhaseStats` accumulation; all phases share one abstraction.
- **Cons**: New files and types to maintain; `item-start` events must be emitted before `item-finish` for identity resolution to work.
- **Verdict**: Accepted.

## Decision

Adopt a structured event-based progress reporter (`BehaviorAuditProgressReporter`) for all behavior-audit phases. Ship with a deterministic text renderer as the default; keep `listr2` as a configuration option that currently falls back to text. Wire one reporter instance per run through the entrypoint and inject it into each phase via dependency interfaces.

## Rationale

- **Identity under concurrency**: `itemId` (test key, behavior ID, feature key, or consolidated ID) plus `phase` + `context` uniquely identifies items even when finish events arrive out of order relative to starts from other phases.
- **Deterministic rendering**: The text renderer uses `reduceReporterState` to buffer `item-start` metadata and emits the complete attributed line only on `item-finish`, ensuring no split writes.
- **Zero phase coupling**: Phases emit semantic events; they do not know whether text or `listr2` will render them.
- **Spec realization**: `AgentUsage`, `AgentResult<T>`, `PhaseStats`, `formatPerItemSuffix`, and `formatPhaseSummary` from the 2026-04-25 spec are implemented in `phase-stats.ts` and consumed by the text renderer.

## Files Added/Modified

### New core files

| File                                                     | Purpose                                                                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `scripts/behavior-audit/progress-reporter.ts`            | Event types, reporter interface, `createTextProgressReporter`, `createProgressReporter`, `resolveProgressRenderer`  |
| `scripts/behavior-audit/progress-reporter-state.ts`      | `reduceReporterState` — deterministic state machine for matching `item-start` to `item-finish` and formatting lines |
| `tests/scripts/behavior-audit/progress-reporter.test.ts` | Unit tests for text rendering, identity, cross-phase deduplication, stale metadata cleanup, `listr2` fallback       |
| `tests/scripts/behavior-audit/phase-stats.test.ts`       | Unit tests for `AgentUsage` accumulation, `formatPerItemSuffix`, `formatPhaseSummary`, wall-time formatting         |

### Modified config

| File                               | Change                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| `scripts/behavior-audit/config.ts` | Added `PROGRESS_RENDERER` with `BEHAVIOR_AUDIT_PROGRESS_RENDERER` env override |

### Modified phases (all now emit events; no direct `console.log` for per-item progress)

| File                                               | Change                                                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `scripts/behavior-audit/extract.ts`                | File-level skip via `log.log` (acceptable, see Divergences); per-item via `extract-reporting.ts`                          |
| `scripts/behavior-audit/extract-reporting.ts`      | Emits `item-start`, `item-finish`, `artifact-write` events; preserves `formatPerItemSuffix` fallback when reporter absent |
| `scripts/behavior-audit/extract-phase1-persist.ts` | After artifact write succeeds, emits `artifact-write` event with file attribution                                         |
| `scripts/behavior-audit/classify.ts`               | Emits `item-start`/`item-finish` via `classify-reporting.ts` keyed by `behaviorId`                                        |
| `scripts/behavior-audit/classify-reporting.ts`     | Classification result → `ProgressEvent` with `done`/`failed`/`reused` outcomes                                            |
| `scripts/behavior-audit/consolidate.ts`            | Emits `item-start`/`item-finish` via `consolidate-reporting.ts` keyed by `featureKey`                                     |
| `scripts/behavior-audit/consolidate-reporting.ts`  | Consolidation result → `ProgressEvent` with `done`/`failed`/`skipped` outcomes                                            |
| `scripts/behavior-audit/evaluate.ts`               | Emits `item-start`/`item-finish` via `evaluate-progress.ts` keyed by `consolidatedId`                                     |
| `scripts/behavior-audit/evaluate-progress.ts`      | Evaluation result → `ProgressEvent` with `done`/`failed` outcomes                                                         |
| `scripts/behavior-audit/index.ts`                  | Creates one `createRunReporter` per run; injects into `runPhase1`, `runPhase2a`, `runPhase2b`, `runPhase3`                |
| `scripts/behavior-audit/entrypoint-helpers.ts`     | Added `createRunReporter`, `toConfiguredProgressRenderer`, `isTestEnvironment`                                            |

### Modified tests

| File                                                        | Change                                                                                       |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `tests/scripts/behavior-audit/entrypoint.test.ts`           | Verifies `auto`/`text`/`listr2` selection, once-per-run creation, injection into all phases  |
| `tests/scripts/behavior-audit/phase1-selection.test.ts`     | Verifies attributed lines, artifact-write with file context, `writeStdout` absence           |
| `tests/scripts/behavior-audit/phase1-write-failure.test.ts` | Verifies failure reporting remains correctly attributed                                      |
| `tests/scripts/behavior-audit/phase3.test.ts`               | Verifies Phase 2a/2b/3 reporter events keyed by stable IDs (behavior, feature, consolidated) |

## Consequences

### Positive

- Parallel-safe per-item output with stable identity (no split-line corruption).
- Deterministic text output works in CI, pipes, and log captures.
- Token/tool/time metrics visible at default `VERBOSE=0`.
- Phase summary blocks aggregate wall time, tokens, and tool breakdown across all items.
- Future `listr2` integration requires only implementing `createListr2Reporter`; phase code is unchanged.
- All phase dependency interfaces (`Phase1Deps`, `Phase2aDeps`, `Phase2bDeps`, `Phase3Deps`) carry `reporter: BehaviorAuditProgressReporter | undefined`, enabling test injection.

### Negative

- `listr2` interactive renderer deferred due to unverified Bun runtime compatibility (see Divergences).
- File-level skip notices in `extract.ts` and early-exit messages in `index.ts` still use direct `log.log` (minor, not subject to concurrent interleaving).
- Agent-level retry-exhaustion error logs (`extract-agent.ts`, `classify-agent.ts`, etc.) still use `console.log` (diagnostics, not phase progress).
- `formatPerItemSuffix` formulas exist in both `phase-stats.ts` and `progress-reporter-state.ts` (minor DRY violation).

### Risks

- **Missed `item-start` before `item-finish`**: If a phase emits only `item-finish`, the renderer falls back to the raw context/title from the finish event. Attribution is maintained, but index numbers may be absent.
  - Mitigation: All phases emit paired start/finish events; enforced by tests.
- **Stale metadata across phases**: If an `itemId` is reused across phases without cleanup, the renderer could match a Phase 1 start to a Phase 3 finish.
  - Mitigation: `reduceReporterState` keys items by `phase\u0000context\u0000itemId`, so same `itemId` in different phases is stored separately.

## Related Decisions

- **ADR-0077** — Behavior Audit Test-Driven UX Evaluation: established the behavior-audit architecture and phase runner pattern.
- **ADR-0073** — Behavior Audit Incremental Runs: established the incremental selection and checkpoint system that the progress reporter now observes.
- **ADR-0097** — Pi Migration Partial Implementation: established the project's Pi-native workflow under which this ADR was implemented.

## References

- Original spec (to be archived): `docs/superpowers/specs/2026-04-25-behavior-audit-progress-ux-design.md`
- Implementation plan (to be archived): `docs/superpowers/plans/2026-04-27-behavior-audit-progress-output.md`
- Divergence notes: `docs/superpowers/notes/0102-behavior-audit-progress-reporting-divergences.md`
- Test results at implementation:
  - 66 test pass / 0 fail across `progress-reporter.test.ts`, `entrypoint.test.ts`, `phase1-selection.test.ts`, `phase1-write-failure.test.ts`, `phase3.test.ts`, `incremental-integration.test.ts`
  - `bun typecheck`: clean
