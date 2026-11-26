# sdd-run-artifact-analysis

## Why

Every defect and friction signal found in this exploration round — the dead skeptic dedup, the never-firing policy ladder, the unreachable plan branch, the ledger collapse behind the one non-converging run, 3 gates pending forever (one for 8+ days), 4 zombie runs, and 5 of 11 completed changes stranded unmerged while the worst artifact merged unimplemented — was invisible until runs were analyzed *across* the corpus by replaying `events.ndjson` and joining sidecars, transcripts, gate files, openspec state, and git. All of that was ad-hoc shell/jq/Bun scripting against 14 run dirs in 8 worktrees; nothing in the repo can answer these questions repeatably. `report.ts` is per-run human presentation; the event log is documented replay-sufficient; the raw material is complete — only the reader is missing.

## What Changes

- A new read-only analysis module (`sdd-runner/src/analyze.ts` + supporting pure folds) that loads runs from one or more workdirs and produces a structured **corpus report**: per-run trajectory (rounds, findings by class, verdicts, skeptic share), finding lifecycle (duplicate-id rate, cross-round cluster persistence, class churn), resolver action mix, gate forensics (latency, veto cycles vs extends, R-rule fired, waiter settles), retry taxonomy (stall vs validation), usage per role/round via the existing reprice seam, and integrity checks (replay-vs-`state.json`, ledger dup-ids, sidecar join gaps).
- A **ground-truth join**: for each run's change folder — tasks done/total, openspec presence, git commits, master-merge status — surfacing stranded-complete and merged-unimplemented changes (the corpus's two failure classes nothing currently watches).
- A CLI surface: `sdd-runner:start -- analyze [workdirs…]` printing the report (plain text; JSON via a flag for scripting). Read-only: the analyzer opens run dirs and the repo, writes nothing but its own stdout.
- The module's folds are pure functions over replayed events + sidecar joins (DI seams for fs/git, hermetic tests) so the queries that motivated it — dup-id rate, R2-eligibility, cluster persistence — become pinned, rerunnable checks instead of one-off forensics.

## Capabilities

### New Capabilities

- `sdd-run-artifact-analysis`: the analysis surface itself — what it reads, what it computes, its read-only contract, and the integrity checks it enforces over a corpus. Without it: run artifacts stay write-only (produced, never read back), the next regression in loop memory or policy behavior is as invisible as the last one, and every improvement claim (thresholds, caps, prompt fixes) stays unmeasurable in practice.

### Modified Capabilities

- `sdd-runner-cli`: the routing verb table gains the analysis invocation (`analyze [workdirs…]`), alongside task-file start and run-id routing. Existing routing behavior unchanged; the analyzer verb takes workdirs, not run ids.

## Impact

- Code: new `sdd-runner/src/{analyze,analyze-*.ts}` + `package.json` script wiring (`sdd-runner:start` arg routing in `cli-routing.ts`) + tests under `tests/sdd-runner/`.
- Scope model: offline, read-only; no chat surfaces, no DB, no config-context state; writes nothing outside stdout/stderr.
- Docs: `docs/architecture/sdd-pipeline.md` (new Analysis section; the /stats-anonymity-style read-only contract statement).
- No new runtime dependencies (analysis folds are stdlib + existing `pricing.ts`/`replay.ts` seams).

## Non-goals

- Fixing anything it measures — the three sibling changes (`sdd-review-loop-memory`, `sdd-policy-metered-budget`, `sdd-oversize-estimator-signals`) own the fixes; the analyzer owns the evidence.
- Continuous monitoring, dashboards, or scheduled runs — it is invoked on demand.
- Transcript deep-mining beyond tool-call histograms and retry forensics (full LLM-response analytics declined; tokens/wallMs cover the measured questions).
- Mutation of any run artifact; the analyzer never writes run dirs (enforced by its DI fs seam lacking write functions).
