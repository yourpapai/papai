# afk-runner-run-analysis

## Why

Every defect this mirror wave fixes — the never-firing policy ladder, the dead
skeptic dedup, the ledger collapse behind one non-converging run, gates pending
8+ days, zombie runs, 5 of 11 completed changes stranded unmerged while the
worst artifact merged unimplemented — was **invisible until runs were analyzed
across a corpus**. On the ancestor that was ad-hoc shell and jq over 14 run dirs
in 8 worktrees; nothing in the repo answers those questions repeatably.
afk-runner has `accounting.ts` and the passive `runs` verb: a tokens-and-cost
roster, not a reader of what happened inside a run. The raw material is complete
— the event log is replay-sufficient and byte-compatible with the grammar the
parity harness pins — only the reader is missing, so every claim the sibling
changes make about afk's own runs stays unmeasurable.

## What Changes

- A read-only analysis surface over one or more workdirs producing a **corpus
  report**: per-run trajectory, finding lifecycle (duplicate-id rate, cluster
  persistence, class churn), resolver action mix, gate forensics (latency, veto
  cycles vs extends, R-rule fired, waiter settles), retry/failure taxonomy,
  usage per role and round via the existing reprice seam, and integrity checks
  (fold-vs-memo, ledger duplicate ids, sidecar join gaps). Field-level detail
  belongs to design.md.
- A **ground-truth join**: per run, the change folder's tasks done/total,
  openspec presence, git commits, and master-merge status — surfacing
  stranded-complete and merged-unimplemented changes, the two failure classes
  nothing watches.
- `r2 eligibility` reported **by blocking cause** per cap-hit state
  (`r2-fired`, `cost-unknown`, `over-ceiling`, `preview`, `trajectory-blocked`),
  so the metric names the actual lever instead of pointing at policy tuning.
- A CLI verb `analyze [workdirs…]` beside `runs`, plain text with JSON via a
  flag. The read-only contract is structural: the fs seam carries no write
  functions and the analyzer writes nothing but its own stdout.

## Capabilities

### New Capabilities

- `afk-runner-analysis`: the corpus-analysis surface — what it reads, what it
  computes, its read-only contract, and the integrity checks it enforces.
  Separate from `afk-runner-output` (per-run presentation of a live run) and
  from `afk-runner-cli`'s `runs` roster (a portfolio ledger over memos, not a
  fold over event logs). Without it afk run artifacts stay write-only, and the
  next regression in loop memory or policy is as invisible as the last one.

### Modified Capabilities

- `afk-runner-cli`: the routing verb table gains `analyze [workdirs…]`
  alongside task-file start, run-id routing, and `runs`. Existing routing
  behavior unchanged; the analyzer takes workdirs, not run ids. Without it the
  surface exists but nothing specs how it is invoked.

## Impact

- Code: new `afk-runner/src/analyze*.ts` folds plus CLI routing over the
  existing fold, pricing, and accounting seams; tests under `tests/afk-runner/`.
  No new dependencies. Docs: `afk-runner.md` analysis section. Usage folds
  share one `AgentUsage` sum helper (`EMPTY_USAGE`/`plusUsage`, master
  `bfa4ebedf`) instead of duplicating the accumulation.
- Instances/scope: none — offline, read-only; no DB, no chat surfaces, no
  per-user / group-shared / thread-isolated state; mutates no run artifact.
- Depends on `afk-runner-spec-home`; lands before `afk-runner-loop-memory` so
  that change's cluster thresholds calibrate against afk's own corpus.

## Non-goals

- Fixing anything it measures — siblings own the fixes, the analyzer owns the
  evidence. No dashboards, monitoring, or scheduled runs; invoked on demand.
- Transcript deep-mining beyond tool-call histograms and retry forensics.
- Oversize-routing signals — the natural companion to the decomposition
  question, declined here with it: master built the plan branch and measured it
  never executed (0 `plan` events in 14 runs), so this change stays purely
  read-only over what afk already logs and U2 is explored later on its own.
