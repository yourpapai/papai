# Design — afk-runner-open-vs-raised

## Context

Mirror of master's `sdd-runner-open-vs-raised` (17 tasks, five commits
`dc9ae4080`…`2efb39c4a`) into the afk-runner port. The shapes to move,
verified against master history and the afk tree:

- master `review-model.ts` — the openness predicate, the two count sets, the
  three-valued verdict, and the no-context `evaluateConvergence` overload.
- master `agent-layer.ts` — optional `findingId` on the assumption record.
- master `materialize.ts` / master `gate-integrity.ts` — per-round hash
  snapshots reusing the gate's own hashing, and the sidecar-vs-event counts
  cross-check.
- master `post-review-tail.ts` — `routeCapHit` semantics (open gates even
  after a verify round; needs-review buys one round unless verified or over
  budget; converged flows to the tail; refusal records no auto-decision).
- master `gate-review-input.ts` / `gate-answers.ts` — row-gap sanitization
  and writer-side flattening.

**Port differences that reshape the work:**

1. afk has no `post-review-tail.ts` — routing is fold-derived
   (`reviewOutcomeOf`, `presentsGate`). The verify round routes in
   `runReviewWork` and its one-per-cap-hit bound is fold-derived, not linear
   (D5).
2. afk has **no ancestor integrity cross-check** — master's came from
   `cd6d64210`; afk's `verifyGateIntegrity` is gate-bytes drift, not counts.
   The cross-check is introduced fresh, comparing both sets from round one
   (D7).
3. `afk-runner-metered-budget` has landed (HEAD `ad81b0f10`): `r4FailsClosed`
   is metered-conditional and `costCeilingUsd` is `number | null`. The
   verify-round budget guard inherits those semantics (D5).
4. In-flight uncommitted prep on this branch: the spec-home archive (deleted
   change dir + untracked `openspec/specs/afk-runner-*`) and an extract-class
   refactor moving R3 `classifyAssumptions` into `work/assumption-blast.ts`.
   Both land as separate commits **before** this change starts; the
   extraction is the max-lines headroom `auto-policy.ts` needs here.

## Decisions

### D1 — Openness predicate and the three-valued verdict (mirror §1)

Pure function in `review-model.ts` over `(resolution, round's assumptions,
prior and current hash snapshots)`: `dismissed` open; `evidence-answered`
closed; `assumed` open iff some assumption in the round carries a finding id
but none carries this one — the legacy fallback (no finding ids anywhere)
reads closed, so pre-change sidecars resume with no migration; `edited` open
iff the snapshots are equal; round 1 (no prior snapshot) reads closed.
`evaluateConvergence` returns `{ raised, open, verdict }` with `raised`
byte-identical to today's `counts` (pin with existing fixtures) and `verdict`
three-valued — `needs-review` when the open set passes the converged test but
an edit above a nitpick was recorded. A no-context overload keeps the narrow
shape so `materialize.ts:59` compiles and behaves unchanged.

### D2 — Checkability: `findingId` + per-round hash snapshots (mirror §2)

`AssumptionRecordSchema` gains optional `findingId` (`A<n>` regex unchanged);
the resolver prompt requires it for every `assumed` resolution and warns that
a no-op edit counts as unresolved. Round close writes
`sidecars/round-hashes-<n>.json` by calling the gate's own
`recordArtifactHashes` over `listAgentArtifacts` (exported from
`gate-files.ts` — no new hashing code). The artifact set is
`AGENT_ARTIFACT_GLOBS` + `specs/**.md`, which never includes `review.md` /
`assumptions.md` — that exclusion is load-bearing (the runner rewrites both
every round; including them would make every round look changed and the
edited-claim guard would never fire) and gets a pinning test.

### D3 — Event and fold are additive

`ConvergenceEvent.verdict` widens with `needs-review`; an optional `open:
FindingCounts` rides alongside `counts` (which stays raised). The kernel
event union, `flushConvergence`, and `legacy-fold.ts`'s `DigestRecord` widen
in step; `perRound` records stamp `open`. A single reader
(`open ?? counts` — master's `openCountsOf` shape) serves
`reviewOutcomeOf`, the integrity cross-check, and R1/R2, so a pre-change
event folds its open set equal to its raised set and every frozen corpus,
parity fixture, and memo oracle stays green. The `finding` action enum is
pinned unchanged by test.

### D4 — Loop wiring and the sidecar re-read agree (mirror §4)

`ReviewLoopResult` gains `verdict` and `raised` (master's shape); the
`open*` lists become genuinely open via D1 — the loop already holds the
round's assumptions in the resolver output and reads snapshots from
`sidecarDir`. The convergence event carries both sets.
`readReviewResultFromSidecars` (`gate-settle.ts`) applies the identical
predicate — it is already async, so a resumed run's gate sees the open set
the live run would have. `presentsGate` and the early-gate rows consume the
genuinely-open lists unchanged.

### D5 — Verification round routes above the loop, bound in the fold

Master's shape kept routing above the loop; afk's is `runReviewWork`
(`review.ts`), which owns the events the budget question reads:

- **Route**: loop returns `cap-hit` + `needs-review`; `runReviewWork`
  re-enters `runReviewLoop` at `startRound: rounds+1, cap: cap+1` — emitting
  the same `round_open(n+1, cap+1)` shape as the extend mover, guarded by the
  existing round-open owedness rule.
- **Budget**: refuse iff metered-and-unknown-cost, or projected spend
  (`projectedSpend`, exported from `auto-policy.ts`) reaches a non-null
  ceiling. Refusal continues to the tail with **no** auto-decision — master
  emits none (`post-review-tail.test.ts:268`), and the final gate's own
  ladder event is the record.
- **One per cap-hit, resume-safely**: master's linear bound ("routing is
  never re-entered") does not survive afk's resume model — a crash mid-verify
  re-invokes `runReviewWork` and re-runs routing. The bound is derived from
  the fold instead: verify iff the last verdict is `needs-review` at the
  final recorded round **and** `perRound` carries no later round **and**
  budget allows. Master needed its explicit `RouteConditions.verified` flag
  for the same reason.
- **A spent round does not waive the human's call**: after the verify round,
  `presentsGate` reads its genuinely-open lists — open above nitpick still
  gates.
- **Resume**: `reviewOutcomeOf` treats `needs-review` as unsettled (owes the
  later round) instead of satisfying itself on empty open counts; a refused
  verify is resume-safe for free because `stage_enter decompose` settles
  review via the stage map regardless of verdict.

### D6 — The ladder reads the right sets (mirror §6.1/6.2)

`r1Decision` and `r2Decision`'s eligibility keep reading the `open*` lists —
now genuinely open — while `strictlyDecreasingLastK` keeps reading
`record.counts` (raised): the trajectory measures whether reviewers are
running out of things to say, not how the resolver disposed of them. The
never-cut prechecks need no change; their open BLOCKER becomes the real
predicate. Tests pin the split: fixed blockers no longer block R1/R2,
dismissed ones still do, empty open MATERIAL makes R2 inapplicable.

### D7 — Counts integrity cross-check, introduced fresh (mirror §6.3)

New `work/gate-integrity.ts` (no existing afk module covers this —
`verifyGateIntegrity` is gate-file byte drift; master's shape is the
reference): recompute `{ raised, open }` from the round's resolver sidecar +
hash snapshots via D1, compare both against the `perRound` record for the
gate's round (master compared `lastVerdict`; the perRound lookup is the same
answer at presentation time and precision-matched), `open ?? counts` for
pre-split lines. `mismatch` or `unparseable` substitutes the review result's
open blockers with `{ id: 'POLICY-INTEGRITY', class: 'BLOCKER', …, outcome:
why }` — riding the existing never-cut precheck so no rule can fire and the
gate waits for a human; no ladder grammar change. Unlike master's
`readFileSync`-based file (its ladder ran unawaited), afk's prelude awaits,
so the reads are async. Wrapped in `signalsOf` (`gate-prelude.ts`).

### D8 — Gate rows carry sanitized verbatim gaps (mirror §7)

`materialize.ts` exports the joiner: read `findings-<n>.json` and
`findings-skeptic-<n>.json`, merge, return id → verbatim gap; missing or
malformed sidecar answers an empty join (row degrades to the identifier)
and `review.md`'s bytes do not change. A shared sanitizer — collapse to one
line, strip a leading redirect marker, truncate at 200 — is applied by both
row producers (`findingsOf` in `gate-signals.ts`, `expectedContentFor` in
`gate-settle.ts`), which today both write `gap: entry.id`.
`renderGateAnswers` and `responseFromAnswers` flatten every free-text field
they write; a round-trip test over multi-line text carrying the decision
directives pins the write-then-parse contract.

## Goals / Non-Goals

Goals: depth S stops paying two human gates for fully-resolved work; R1/R2
read the number their questions actually ask; `edited`/`assumed` claims
become checkable; gate rows show gaps, sanitized so prose cannot parse as a
decision; every pre-change log, fixture, and oracle stays green.

Non-goals (beyond the proposal's): no artifact snapshots (hashes only); no
prompt/model redesign; no plan-gate surrogate (afk has no plan gates — that
branch was declined with evidence); master's `spendBaselineUsd` / composite
tree budget (other waves).

## Risks / Trade-offs

- [Verdict enum widening touches the frozen corpus] → additive by
  construction; replay tests pin pre-change lines parsing and folding
  `open = raised`.
- [`reviewOutcomeOf` switching from raised counts to the open set changes
  fold behavior for old logs] → for a line with no `open` set the reader
  folds open = raised, so pre-change replay is bit-identical; only
  post-change events can express the difference.
- [Verify routing adds a second re-entry path into the loop] → it reuses the
  extend mover's `round_open(n+1, cap+1)` shape and the existing owedness
  rule; resume-equivalence tests cover crash-mid-verify.
- [`review-loop.ts` (295 lines) and `review.ts` (215) are near max-lines] →
  D5 deliberately puts routing in `review.ts` and keeps the loop untouched
  beyond result shape; if a limit still trips, split the round-close path
  (master split `review-round.ts`) rather than compressing.
- [Synthesized integrity BLOCKER renders as a gate row] → intended: the row's
  outcome text carries the failure reason, matching master.

## Migration Plan

None beyond code. The event grammar only widens; per-round hash sidecars are
new run-local state keyed by run id (sidecar dir), with no scope-model
impact — offline runner workspace, no DB, no chat surfaces, no per-user /
group-shared / thread-isolated state. Rollback is `git revert`.

## TDD / Hook Interactions

The Write/Edit hook pipeline gates every file below, test-first. Order:

1. `tests/afk-runner/work/review-model.test.ts` — predicate (D1) then
   `evaluateConvergence` both sets + three verdicts.
2. `tests/afk-runner/work/agent-layer.test.ts` — `findingId` (D2);
   `tests/afk-runner/work/materialize.test.ts` + a gate-files test — round
   hash snapshots + the regeneration exclusion pin (D2).
3. `tests/afk-runner/event-schemas.test.ts`, kernel fold tests,
   `tests/afk-runner/legacy-fold.test.ts` — additive `open`, verdict
   widening, `open ?? counts` reader, finding-enum pin (D3); then the parity
   harness and memo oracle.
4. `tests/afk-runner/work/review-loop.test.ts` — result shape + emitted
   event (D4); gate-settle tests — sidecar re-read agreement (D4).
5. `tests/afk-runner/work/review-work.test.ts` + `review-outcome.test.ts` —
   verify routing, fold-derived bound, budget refusal, resume (D5).
6. `tests/afk-runner/work/auto-policy.test.ts` — R1/R2 split (D6); new
   `tests/afk-runner/work/gate-integrity.test.ts` + `gate-prelude.test.ts` —
   cross-check fail-closed shapes (D7).
7. `tests/afk-runner/work/materialize.test.ts` — joiner export (D8);
   `gate-signals` / `gate-settle` / `gate-render` tests — sanitized rows;
   `tests/afk-runner/work/gate-answers.test.ts` — write-then-parse
   round-trip.
8. Production edits land per section: `review-model.ts`, `agent-layer.ts`,
   `gate-files.ts`, `event-schemas.ts`, `kernel/machine.ts`,
   `kernel/fold.ts`, `legacy-fold.ts`, `review-loop.ts`, `gate-settle.ts`,
   `review.ts`, `work/gate-integrity.ts` (new), `gate-prelude.ts`,
   `auto-policy.ts`, `materialize.ts`, `gate-signals.ts`, `gate-answers.ts`.
9. Full gate: one serial `bun run test` (parity + memo oracles inside the
   sweep), `bun run typecheck`, `bun run lint`, `format:check`,
   `openspec validate --strict`; docs — `afk-runner.md` (raised-vs-open, the
   verification round, the integrity cross-check, gap rows) and
   `sdd-pipeline.md` (review loop, convergence, gates).
