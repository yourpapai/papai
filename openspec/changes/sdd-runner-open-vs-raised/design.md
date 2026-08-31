# Design — separating raised from open

## Context

Every consumer of the review loop's finding counts reads one number today. The
census below is the whole argument for splitting it; it was taken by grepping
each consumer and asking which question it is really posing.

| Consumer | Question it asks | Wants |
| --- | --- | --- |
| `run-view.ts:82`, `watch-view.ts:71` burndown rows | is the loop converging? | raised |
| `renderer.ts:79` `formatDigestBody` | same | raised |
| `gate-render.ts:232` trajectory sparkline | same | raised |
| `auto-policy.ts:128` `openTotal` → `strictlyDecreasingLastK` (R2 trajectory) | same | raised |
| `materialize.ts:64` review.md round record | same | raised |
| `review-model.ts:56` `lensesForRound` (M gains skeptic) | are we still struggling? | raised |
| `auto-policy.ts:192` R1 zero-findings | is anything left for a human? | open |
| `auto-policy.ts:254,269` never-cut open-BLOCKER pre-check | same | open |
| `auto-policy.ts:238` R2 eligibility (`noBlockers`, `hasMaterial`) | same | open |
| `post-review-tail.ts:48` `isSeverityConverged` | same | open |
| `gate-render.ts:169,187,198` nitpick + open-MATERIAL sections | same | open |

R2 straddles the split — its trajectory wants raised, its eligibility wants open.
That is the clearest evidence that one number is doing two jobs.

## Decisions

**D1 — two count sets, one predicate.** `evaluateConvergence` returns
`{ verdict, raised, open }`, both `FindingCounts`. `raised` is today's
computation, unchanged, so every trajectory consumer keeps its current number and
the burndown bytes do not move.

**D2 — what "open" means.** A resolution is open when only a human can settle it:

- `dismissed` — the resolver declined; nothing else can contest it.
- `assumed` **without** a matching assumption record (D5).
- `edited` whose files did not change since the previous round (D4).

`evidence-answered`, a linked `assumed`, and a real `edited` are closed. Note the
asymmetry this creates and why it is the safe direction: to make a finding vanish
from the gate a resolver must claim `edited` or `assumed`, and D4/D5 make both
claims checkable; claiming `dismissed` only ever gates more.

**D3 — three-valued verdict.** `converged` (nothing open above nitpick, ≤3 open
nitpicks) · `needs-review` (nothing open, but the round produced edits no
reviewer has seen) · `open` (something above nitpick needs a human). Today's two
values map onto the ends; `needs-review` is the state the current model cannot
express, which is exactly why a fixed finding reads as open.

**D4 — the verification round, bounded at one.** `needs-review` at the cap runs
exactly one more review round through the existing `runExtendRound`, subject to
the R4 budget guard, then converges regardless of what that round produces. One
decision binds one round of spend — the same shape as the `→ RUN 1 MORE`
directive, the veto resolver pass, and `PLAN_REPLAN_PASSES`. Unbounded
edit→review→edit cycling is the failure mode this bound exists to prevent; the
run still reaches a final gate afterwards, so a human sees the result either way.

**D5 — making `edited` and `assumed` checkable.**
`recordArtifactHashes` (`gate.ts:26`) already computes the change folder's
per-file digests but is called only at gate presentation, so there is no
round-over-round baseline. Call it at round close into
`sidecars/round-hashes-<n>.json`; an `edited` resolution whose files are
byte-identical to the previous round's snapshot is open. `AssumptionRecordSchema`
gains an optional `findingId`; an `assumed` resolution is closed when an
assumption in the same round carries its id. Backward compatibility: a sidecar
whose assumptions carry no `findingId` at all falls back to the round-level check
(at least one assumption logged), so pre-change runs resume without a migration.

**D6 — event model stays additive.** `ConvergenceEvent` gains an optional
`open: FindingCountsSchema`. The `finding` action enum
(`filed|classified|resolved|dismissed`) is **not** widened: `replay.ts:115` folds
`counts` straight from the convergence event payload rather than reconstructing
it from `finding` events, so replay-sufficiency depends on the convergence event
alone. A pre-change log replays with `open` absent, and the fold falls back to
`raised` — today's behavior exactly. Per-finding open-ness stays in the sidecar,
which is already where gate content is sourced (`readReviewResultFromSidecars`,
`gatherAssumptions`), so this introduces no new dependence on sidecars.

**D7 — integrity cross-check covers both.** `guardedReviewResult`
(`gate-prelude.ts:119`) compares sidecar counts against the replayed verdict and
synthesizes a `POLICY-INTEGRITY` blocker on mismatch. It must compare both
triples with the identical predicate the loop used; a drift on either side keeps
failing closed.

**D8 — gate evidence reuses the existing joiner.** `materialize.ts` `readRound`
already reads `findings-<n>.json` and `resolutions-<n>.json` together and renders
the verbatim gap into `review.md`. Export it, consume it from
`readReviewResultFromSidecars`, and let `findingsOf` carry the real gap instead
of `gap: entry.id`. It must also read `findings-skeptic-<n>.json`, or an
L-profile gate shows ids for half its rows. Gap text is single-lined and
truncated before rendering: `VETO_BOX_RE` anchors on `- [x] F3` at line start and
a redirect line starts with `→`, so an unescaped multi-line gap would corrupt the
checkbox grammar.

## No new module

Every change lands in a file that already owns the concern: the predicate in
`review-model.ts`, routing in `post-review-tail.ts`, rules in `auto-policy.ts`,
the join in `materialize.ts`. The only new artifact is a per-round hash sidecar,
which is data, not a module.

## Non-obvious interactions

- **`lensesForRound`** takes `openBlockers` to decide whether M gains the skeptic
  at round 3. It keeps reading raised: the question is "are blockers still being
  found", not "is one waiting for a human".
- **`resume-point.ts:35`** treats `lastVerdict.verdict === 'converged'` as a
  settled review. `needs-review` must not satisfy it, or a run interrupted before
  its verification round would resume as if the loop had finished.
- **Depth S becomes a one-round path in the common case**, which is the point;
  its `ROUND_CAPS.S = 1` is unchanged, and the verification round is the extend
  mechanism rather than a cap change.

## Scope model, gating, storage

None of the papai runtime scope model applies: `sdd-runner/` spawns agents
against a git worktree and has no chat surface, no capability or `tool_prefs`
gating, no persisted per-context state, and no database. There is no drizzle
migration and no new dependency — the count sets are plain arithmetic over
sidecars already on disk.

## Hook / TDD interaction

Every task below is red-first. The Write/Edit TDD hook pipeline gates new files,
so the failing test lands before its implementation in each task; the per-round
hash sidecar and the `findingId` field are both additive schema changes whose
tests assert that pre-change fixtures still parse.

## Risks

- **The verification round costs a round of spend** on runs that would previously
  have gated. R4 declines it when budget is short, and the run then converges —
  it never silently overspends.
- **A resolver could still lie by claiming `evidence-answered`.** D4 and D5 close
  the `edited` and `assumed` doors; `evidence-answered` stays on trust. That is
  the resolver-independence problem, declined to its own change.
