# Design — afk-runner-run-analysis

Mirror of master's `sdd-run-artifact-analysis` + `sdd-analyze-r2-blocking-cause`
into afk-runner (source material: `sdd-runner/src/analyze*.ts` + `usage-aggregate.ts`
on origin/master; the workspace was deleted here at R5). See proposal.md for the why;
the specs carry the requirements. Design rules: no scope-model impact (offline,
read-only, no DB, no chat surfaces — nothing keyed by any context id); no new
dependencies (stdlib fs/path + existing seams); no capability gating (not a chat
tool surface).

## Context

Constraints the decisions sit on: `kernel/fold.ts` (`foldEvents(pipelineMachine,
events)`) is the one live fold engine — `legacy-fold.ts` stays the frozen parity
oracle, never an analyzer input; `work/gate-signals.ts` `usageTotalsOf` is the
usage-cost fold and afk has **no pricing module** (costUsd is as-logged); run dirs
are `<workDir>/runs/<runId>/` with `events.ndjson`, derived `state.json` memo,
`sidecars/findings-*.json|findings-skeptic-*.json|resolutions-*.json`, `gate-<v>.md`;
metered-budget delivered the shared `evaluateLadder` (prelude + waiter) with the
metered R4 split, waiter `auto_decision` emission per claimed outcome, and
`pending`/`rearmed` records; attempt-scoped settle claims are released in a
`finally` — **no claim file persists post-hoc**; `afk-runner-open-vs-raised` (in
flight) adds the convergence `open` count set, the `needs-review` verdict, and
repoints R2's inputs; `cli.ts`'s verb table owns routing; the memo schema's D7
fields set the additive-optional precedent ("optional so legacy memos parse
unchanged") and the parity oracle compares field-wise.

## Goals / Non-Goals

**Goals:** one module answering the corpus questions as pinned pure queries;
read-only by construction; multi-workdir; degraded-graceful over inherited logs
(the 26-fixture corpus and foreign dirs); JSON + human output; r2 attribution
exact in every cell of the cause table.

**Non-Goals:** fixes (the sibling mirrors own them), monitoring/scheduling,
LLM-response analytics, writing anything, a pricing DB port (master's
`repriceEvents` join is deliberately not mirrored — see D7).

## Decisions

### D1 — Layer: pure query functions over the kernel fold; no second fold engine

Each metric is `(fold, sidecars, memo) → Metric<T>` where the fold is
`foldEvents(pipelineMachine, events)` — the same engine the drive loop and
`foldRun` use, so analysis and runtime share one truth model. Trajectory reads
folded `context.perRound` directly. The corpus aggregate is a reduce over
per-run results that excludes era-contaminated runs. Master's analyzer consumed
`replay.ts` (its only engine); the afk delta is *which* engine — the kernel fold,
never `legacy-fold` (the oracle must keep judging the engine, not be consumed by
a feature beside it). Alternative rejected: a dedicated analysis fold — duplicates
the kernel, trips the duplicates gate, breaks on old logs the tolerance already
handles.

### D2 — Read-only enforced by seam shape (mirror of master D2)

`AnalyzeFs` exposes only `readFile`/`readdir`/`stat` — no write functions exist
on the type, so the no-write contract is a typecheck pinned by a test asserting
write members absent. Git goes through a wrapper over `ExecGitFn` admitting only
`log`/`ls-tree`, rejecting everything else by name. A corpus smoke run under a
tmpdir copy pins the whole surface. Alternative rejected: chmod/RO-mount —
nonportable theater; types + pins are the repo's DI idiom.

### D3 — Metrics named after the forensics they replace

Master's inventory ports verbatim — `duplicateIdRate`, `lensOverlapRate`,
`concernPersistence` (reports `unknown` until `afk-runner-loop-memory` lands its
`fingerprintOf`; import then, never copy — duplicates gate), `classChurn`,
`resolverActionMix`, `gateLatency` (presented→answered; never-answered carries
age into the aggregate), `extendOrigin`, `r2Eligibility` + `byCause`,
`strandedComplete`/`mergedUnimplemented` — plus two afk-native additions:
`stageFailureTaxonomy` (`stage_failed` events by stage/kind — C6's declared
failures, which master's runner never had) and the settle-origin split of D4.
Every metric is `Metric<T> = known | unknown-with-reason`; pre-change vocabularies
parse to reduced coverage, never errors. A metric without a decision it informs
gets deleted — the growth cap.

### D4 — Settle-origin attribution by emission order (replaces master's claim-file join)

Master joined `expiry-claim` files; afk retired them (attempt-scoped, released in
`finally`). The replacement fingerprint is emission **order**, which is documented
protocol on both producers: the prelude emits its `auto_decision` *before* the
settle seam appends `gate answered` (`gate-prelude.ts` `runGatePrelude`); the
waiter emits *after* its write (`gate-expiry.ts` `settleExpiryDecision` —
metered-budget D3: "appends the standard `auto_decision` … after its write").
Per gate version: settle-kind record before its answered event → policy; after →
waiter; answered with no settle record → human. Unconditional waiter
fingerprints for the non-settling paths: `auto_decision {rule:'none',
decision:'pending'}` records and `gate rearmed` events. The asymmetry is
load-bearing but accidental — both producers' emission order gets pinned by
tests so a future refactor cannot silently break attribution.

### D5 — Metered-ness persisted as one optional memo boolean

R4's cost-unknown branch is metered-only, but `metered` lives only in runtime
config — the log and today's memo cannot answer it. Add `metered:
z.boolean().optional()` to the memo, threaded through `MemoSeed`/`writeRunMemo`
exactly like `repoRoot`/`workDir` (a runtime input riding the seed — not a fold
projection; `memoFieldsOf` is untouched). Legacy memos parse unchanged and the
field-wise parity oracle is unaffected (the D7-field precedent). With the boolean
the cause table closes exactly: metered=true → `costKnown ? over-ceiling :
cost-unknown`; metered=false → an R4 record implies the exceedance branch
(`budget: null` also nulls the ceiling, making R4 unreachable — so any R4 record
on a metered-false run means explicit `metered: false` + numeric ceiling) →
`over-ceiling`. Runs whose memo predates the field degrade their cost-unknown
states to the metric's reduced-coverage unknown. Alternatives rejected: keeping
master's `costKnown`-only mapping — misattributes the unmetered cell, and this
metric exists precisely to name the real lever; degrading all cost-unknown
attribution to unknown — collapses the headline; a new event type — grammar
surface for one bit the memo already hosts, and the memo exists from run birth
(`createRunState` writes it before any event).

### D6 — r2 predicate reads the post-split vocabulary; implementation queues behind open-vs-raised

Eligibility (zero blockers, ≥1 material) reads the convergence record's `open`
count set, absent → raised (the grammar's own additive fallback); trajectory
strict-decrease reads raised; `needs-review` never enumerates a cap-hit gate
state (its verification round precedes any presentation). This spec is written
against the post-split grammar deliberately — an improvement over master's
snapshot, whose `r2EligibilityRate` predates the split and reads `counts` for
everything. Consequence: implementation starts only after
`afk-runner-open-vs-raised` lands — the predicate reads its fields, and
`event-schemas.ts`/`auto-policy`/`gate-prelude` tests collide. Legacy logs and
the 26 fixtures compute via the fallback unchanged.

### D7 — Usage fold without a pricing DB (deliberate delta from master's reprice seam)

Master repriced unpriced `done` events through `pricing.ts`'s DB; afk has no
pricing module and the `runs` footer already reports cost as a lower bound with
the unpriced count — the corpus report inherits that honesty contract instead of
porting repricing. `costKnown` follows `usageTotalsOf` semantics (any `done` with
tokens > 0 and costUsd 0 → unknown). The shared sum helper (`EMPTY_USAGE` /
`plusUsage`, master `bfa4ebedf` shape) homes beside `usageTotalsOf` in
`work/gate-signals.ts` — one home, `accounting.ts` and the analyzer both import
(`usageTotalsOf` itself refactors onto it). Per-role usage joins `spawned` →
role; per-round usage assigns each `done` event to the round whose `round_open`
ts ≤ event ts < the next open (a ts-window join — `done` events carry no round).

### D8 — CLI: `analyze [workdirs…] [--json]` beside `runs`

`cliMain`'s verb table gains `analyze`; remaining args are workdir paths,
defaulting to the configured workdir; `--json` switches output. Human output is
plain sections per metric, no ANSI (analysis output is piped by nature — the
LineRenderer lesson inverted). Alternative rejected: a separate package script —
fragments the single-entry contract the verb table established.

### D9 — Consistency audit around the derived memo

Master audited three independent writers; afk's memo is derived, so the audit's
center of gravity moves: recompute `memoFieldsOf` from the log and compare
against the persisted memo (a stale or divergent memo is a crash window or a
hand edit — flag it and name the diverging fields, never fail), join gate files
against answered events, count within-round duplicate ledger ids and sidecar
join gaps. The inherited-era signatures (answered-without-presented,
completed-after-unsuperseded-abort, `.bak` residue) stay: structurally
impossible on afk-native runs, but the fixture corpus carries its era and the
era-contamination flag is what keeps those runs out of the aggregates.

## Hook / TDD interaction

New `afk-runner/src/**` files gate through the TDD write-hook pipeline.
Red-first order: seam pins (write members absent, git wrapper rejection) →
tolerant loading → trajectory/gate forensics → emission-order pins in the
`gate-prelude`/`gate-expiry` suites (D4) → finding lifecycle → r2 attribution
(incl. the memo `metered` field's own red-first in `run-state`/`run` suites) →
consistency audit → ground-truth join → usage fold → report/renderer → CLI
routing. Fixtures are synthetic minimal logs shaped from the committed corpus
(`fixtures/real`, `fixtures/scenarios`, `fixtures/live`) — never copies of run
dirs.

## Risks / Trade-offs

- [Transcripts contain secrets] → the analyzer reads events, sidecars, memo,
  gate files, and git metadata only; transcripts are summarized by their L0/L1
  events, never re-parsed; the report carries run ids and change names only.
- [Emission-order join is load-bearing but accidental] → pinned on both
  producers (D4); a reorder fails a named test, not a silent metric drift.
- [Cause names drift from ladder vocabulary] → `cost-unknown`/`over-ceiling`
  name `auto-policy.ts`'s branches verbatim; a ladder rename follows in the
  same change.
- [Pre-field memos degrade attribution] → acceptable: afk-native runs carry the
  memo from birth; only inherited corpora hit the unknown.
- [Corpus is thin (`runs/` empty on this branch)] → acceptance runs over the
  committed fixture corpus plus whatever runs the mirror wave itself produces.
- [Collision with open-vs-raised mid-flight] → implementation strictly after it
  (D6); artifact development is independent.

## Migration Plan

Additive module, one CLI route, one optional memo field; no event or config
changes. Deploy = merge; rollback = revert — nothing persisted. The first real
corpus report (committed fixtures + the wave's own runs) is the acceptance run.
