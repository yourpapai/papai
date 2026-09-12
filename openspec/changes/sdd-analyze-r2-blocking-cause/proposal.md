# sdd-analyze-r2-blocking-cause

## Why

The corpus report's `r2 eligibility` headline (11/29 cap-hit states eligible corpus-wide) measures trajectory eligibility only — the R2 predicate without the R4 budget guard that sits in front of it on the cap-hit ladder. A corpus investigation of the eligibility→fired gap (11 eligible, 0 permitted firings) had to re-join events by hand to learn the split: 9 states blocked by R4's cost-unknown branch (run cost unknown + metered), 2 states R2-decided but emitted as observe-level previews. Both blockers were knowable from the event log alone. The headline as shipped points an operator at policy tuning when the actual lever is cost-knownness or autonomy level — the metric overstates actionable autonomy and hides why.

## What Changes

- `r2 eligibility` becomes blocking-cause-attributed: for every cap-hit gate state, the analyzer reports which of the fates it hit — `r2-fired` (an extend auto_decision naming R2), `cost-unknown` (R4/gate presentation on a cost-unknown run), `over-ceiling` (R4/gate presentation on a cost-known run), `preview` (a preview auto_decision — rule computed, not permitted to act), or `trajectory-blocked` (not eligible — the current metric's complement). Classification joins only events already loaded plus the run's existing `costKnown` from the usage reprice; no new sidecars, no new events, no policy changes.
- The per-run report line gains the breakdown (`r2 eligibility: 2/5 (r2-fired ×1 · cost-unknown ×3 · preview ×1)`), and the corpus aggregate reports the cause mix across all cap-hit states.
- JSON mode carries the same counts per run and in the aggregate, additive over today's `{eligible, gateStates}` shape.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `sdd-run-artifact-analysis`: the corpus-report requirement's gate-forensics coverage extends from "auto-decision rule fired" to naming, per cap-hit state, which gate actually blocked an eligible R2 — the decomposition the gap investigation performed by hand. Without it the eligibility headline stays trajectory-only and misdirects the autonomy lever.

## Impact

- Code: `sdd-runner/src/analyze-findings.ts` (`r2EligibilityRate` — cause classification over convergence pairs joined to gate/auto_decision events and the run's `costKnown`), `sdd-runner/src/analyze-report.ts` (run line + corpus line), `sdd-runner/src/analyze-corpus.ts` (aggregate shape) + tests under `tests/sdd-runner/analyze.test.ts`.
- Scope model: read-only analyzer surface; no runtime pipeline changes, no config, no DB.
- Docs: none beyond the report itself (the metric is self-describing in output).
- Coordination: the capability's main spec does not exist yet — the `sdd-run-artifact-analysis` change is unarchived; this delta targets the same capability path and merges on archive order.

## Non-goals

- Changing the cap-hit ladder, R2's predicate, or R4's ordering (behavior verified correct in the investigation — 11/11 human answers matched R2's hypothetical action).
- New events or sidecar fields to disambiguate R4's cost-unknown vs over-ceiling branches at emit time (classification derives it from `costKnown`; if future runs need emit-time precision, that is a separate change).
- Distinguishing `human-first` (human answered before any ladder evaluation) inside states the ladder never reached — states with no auto_decision at all report under the cause of whatever record exists, and absent records parse as reduced coverage, per the capability's pre-change tolerance contract.
