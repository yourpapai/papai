# sdd-review-loop-memory

## Why

Corpus analysis of 14 retained runs shows the review loop's memory and control are keyed to finding counts and verbatim ids, and both degrade exactly when runs get long: the skeptic merge never dedupes in practice (reviewer and skeptic quote the same gaps differently in ~all 31 skeptic rounds), producing 78 duplicate-id resolutions in 23 rounds — sometimes with contradictory classes for one id (`F7` as NITPICK *and* MATERIAL), inflating convergence counts (4 rounds in `using-claude-code-in-review-loop` would flip verdict under dedup); and the resolutions ledger is a flat, round-untagged, dup-id soup (97 lines by round 10 of the knowledge-base run) that a fresh reviewer cannot use, so the same concerns are re-raised verbatim across rounds (36 of 105 findings there form 15 cross-round clusters, one oscillating MATERIAL→BLOCKER over rounds 1→10). The loop has no thrash detector: it burns rounds (the kb run never converged in 10) and gates only ever show counts, never identities.

## What Changes

- Skeptic finding ids are namespaced (`S1…`) and `ResolverOutputSchema` enforces unique resolution ids per round.
- `mergeLensFindings` dedupes on a normalized gap fingerprint (case/punctuation/whitespace-insensitive token set) instead of exact `gap|question` text; duplicates merge to the most severe class.
- Ledger lines rendered into reviewer prompts are round-tagged (`r3 [F2] …`) and grouped into a capped "Known concerns" digest (per-concern one line with last-seen round and outcome), replacing the flat list.
- A concern-cluster tracker folds findings across rounds (same fingerprint seen in ≥2 prior rounds, or class oscillation on the same concern) and, when a concern recurs at round close, the round's convergence event carries the cluster id; the orchestrator presents a **concern-history gate** (early gate variant listing the recurring concerns with their full round-by-round history) instead of silently running another round.
- `materialize` gains a cross-artifact consistency check: the same decision term (migration strategy, schedule interval, naming) rendered differently across `proposal.md`/`design.md`/`specs/` surfaces as a MATERIAL finding with file references, before the resolver runs (kb final state ships `proposal.md` saying "drizzle migration" while `tasks.md` says "hand-written").

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `sdd-runner-pipeline`: adds requirements for lens-merge integrity (namespaced ids, fingerprint dedup, unique resolution ids), round-tagged ledger rendering, concern-cluster detection with a concern-history gate, and the cross-artifact consistency check at materialization. Without them: convergence counts stay inflatable by duplicate findings, the reviewer prompt stays a ledger that cannot prevent re-raises, and a thrashing loop's only exits remain cap-hit or human vigilance — the kb run demonstrates all three failing together.

## Impact

- Code: `sdd-runner/src/{review-model,review-prompts,review-loop,review-round,review-agents,agent-layer,materialize,artifact-consistency,gate-digest,gate-sidecars,gate-render,post-review-tail,events}.ts` and their tests under `tests/sdd-runner/`; the concern-cluster fold extends `replay.ts` (`ReplayState.concerns`, additive — old logs replay unchanged).
- Scope model: no chat surfaces, no platform/task instances, no config-context state; all new persisted state lives in the run dir keyed by run id (sidecar `concerns.json`, additive event fields).
- Docs: `docs/architecture/sdd-pipeline.md` (review loop, convergence, event model sections).
- Ordering: apply/archive `sdd-spec-repair` first — this change deltas into `sdd-runner-pipeline`'s neighboring specs, and the repair reconciles their parents.
- No DB changes; no new dependencies.

## Non-goals

- Fixing the R4/subscription budget deadlock (separate change `sdd-policy-metered-budget`).
- Estimator oversize routing (separate change `sdd-oversize-estimator-signals`).
- Changing gate checkbox grammar or TUI decision surfaces beyond rendering the concern-history section (existing grammar carries it as findings rows).
- Reviewer/resolver model or prompt-lens redesign beyond the ledger digest and consistency-check inputs.
- ~~Per-round artifact snapshot retention~~ — **superseded by `sdd-runner-open-vs-raised`.** This change declined snapshotting as unbounded disk growth for an n=1 measured need, leaving resolver "edited" claims auditable only via transcripts. That change needs the snapshots for a different reason: without them an `edited` resolution cannot be told from a claimed one, which is what its openness predicate turns on. It ships them as `sidecars/round-hashes-<n>.json`, written at round close, so the runner now retains them and this Non-goal no longer holds. The disk-growth objection was never answered on its merits — it was outweighed, not withdrawn.
