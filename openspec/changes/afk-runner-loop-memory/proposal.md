# afk-runner-loop-memory

## Why

afk-runner's review loop keys its memory and control to finding counts and
verbatim ids, and both degrade exactly when runs get long. `mergeLensFindings`
dedupes on exact lowercased `gap|question` text — measured on the ancestor to
**never dedupe in practice**: reviewer and skeptic quote the same gap
differently in ~all 31 skeptic rounds, producing 78 duplicate-id resolutions
across 23 rounds, sometimes with contradictory classes for one id, inflating
convergence counts. The ledger rendered into reviewer prompts is a flat,
round-untagged, duplicate-id list (97 lines by round 10 of the worst run) a
fresh reviewer cannot use, so concerns are re-raised verbatim across rounds (36
of 105 findings formed 15 cross-round clusters, one oscillating
MATERIAL→BLOCKER over rounds 1→10). And there is no thrash detector: that run
burned 10 rounds without converging while gates showed counts, never identities.

## What Changes

- Skeptic finding ids are namespaced (`S1…`) and the resolver output schema
  enforces unique resolution ids per round.
- `mergeLensFindings` dedupes on a **normalized gap fingerprint** (case,
  punctuation, and whitespace-insensitive token set) instead of exact text;
  duplicates merge to the most severe class.
- Ledger lines in reviewer prompts are round-tagged (`r3 [F2] …`) and grouped
  into a capped "Known concerns" digest — one line per concern with last-seen
  round and outcome.
- A concern-cluster fold tracks findings across rounds (same fingerprint in ≥2
  prior rounds, or class oscillation). On recurrence at round close the
  convergence event carries the cluster id and the run presents a
  **concern-history gate** — an early-gate variant listing recurring concerns
  with their round-by-round history — instead of silently running another round.
- Materialization gains a cross-artifact **consistency check**: one decision
  term rendered differently across `proposal.md`/`design.md`/`specs/` becomes a
  MATERIAL finding with file references, before the resolver runs.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `afk-runner-pipeline`: gains requirements for lens-merge integrity
  (namespaced ids, fingerprint dedup, unique resolution ids), round-tagged
  ledger rendering with the capped digest, concern-cluster detection with the
  concern-history gate, and the consistency check at materialization. Without
  them convergence counts stay inflatable by duplicates, the reviewer prompt
  stays a ledger that cannot prevent re-raises, and a thrashing loop's only
  exits remain cap-hit or human vigilance — the ancestor's worst run shows all
  three failing together.

## Impact

- Code: `afk-runner/src/work/{review-model,review,review-loop,materialize,
  gate-render}.ts` plus new concern-model, artifact-consistency, and
  review-prompt modules; the fold gains an additive `concerns` projection, so
  the 26-fixture parity harness, frozen corpus, and memo oracle must stay green
  — parity is the acceptance test. New state: a concerns sidecar keyed by run id.
- Docs: `afk-runner.md`, `sdd-pipeline.md` (review loop, convergence, events).
- Instances/scope: none — offline runner workspace; no DB, no chat surfaces, no
  per-user / group-shared / thread-isolated state; no new dependencies.
- Depends on `afk-runner-spec-home`; lands after `afk-runner-run-analysis` so
  cluster thresholds calibrate from afk's own corpus, not the ancestor's.

## Non-goals

- The R4 deadlock (`afk-runner-metered-budget`) and the raised/open split
  (`afk-runner-open-vs-raised`) — consumed here, owned there.
- Gate checkbox grammar or decision surfaces beyond the concern-history section
  (the existing grammar carries it as findings rows); reviewer/resolver model
  or prompt-lens redesign beyond the digest and consistency-check inputs.
- The decomposition/plan branch — measured never-executed on master (0 `plan`
  events in 14 runs); U2 stays parked pending afk's own evidence.
