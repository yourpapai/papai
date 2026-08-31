# Design — afk-runner-loop-memory

## Context

Mirror of master's `sdd-review-loop-memory` (tasks 1–4, five commits) into the
afk-runner port. Master's `concern-model.ts` (`fingerprintOf`, `concernDigest`,
`concernRecords`, `detectConcernThrash`, `LEDGER_DIGEST_MAX = 15`) ports
near-verbatim; its constants are confirmed against afk's corpus by
`afk-runner-run-analysis` (see proposal Impact), not re-derived. Current afk
state that constrains the approach, verified on this branch:

- `review-model.ts` (289 lines) — exact-text `dedupeKey` (`gap|question`
  lowercased), `readResolutionsLedger` flattens rounds (the round tag is
  destroyed at `readLedgerRound`), `ledgerLines` renders the flat uncapped
  list, `buildReviewerPrompt`/`buildResolverPrompt` prompt both lenses for
  `F<n>` ids. Source files carry max-lines (tests exempt,
  `.oxlintrc.json:56`), so the prompt builders extract to `work/review-prompt.ts`
  and the concern machinery lands in `work/concern-model.ts` — both already
  named in the proposal.
- `review-loop.ts` (270) — `runRound` recursion; `ReviewLoopResult` carries
  verdict/raised/open lists/gaps (open-vs-raised D4); `ResolverOutputSchema`
  (:28) has no id-uniqueness constraint; lens spawns pass
  `outputSchema: FindingsSidecarSchema` (:125).
- `review-round.ts` — `closeRound` already in master's task-3.2 order:
  digests → convergence event → materialize → `round_close`, the seam where
  the concerns sidecar writes.
- `review.ts` — `owesVerificationRound` (:37) reads exactly `context.round` +
  `context.lastVerdict`; `routeVerificationRound` (:102) checks it before
  `verificationBudgetRefuses` (:108). afk has no `post-review-tail.ts`; routing
  is fold-derived (open-vs-raised D5).
- `agent-schemas.ts` — `FindingSchema.id` is `z.string().min(1)` (no regex);
  schemas are re-exported through `agent-layer.ts`. `runStageAgent<T>` takes
  `outputSchema: z.ZodType<T>` (agent-layer.ts:34), so per-spawn refined
  schemas pass at the call site; the validation-retry path already exists
  (safeParse at agent-layer.ts:168).
- Events: `FindingEvent` (`event-schemas.ts:84`) carries
  `{action, id, round, class?}`; `ConvergenceEvent` (:108) carries
  `counts`/`open?` — the open-vs-raised D3 additive-field playbook
  (`open ?? counts`, pre-change replay bit-identical) is the template for
  every field this change adds.

## Goals / Non-Goals

**Goals:** merge and convergence invariant to lens duplication; a ledger a
fresh reviewer can recognize concerns from; a mechanical exit for thrashing
concerns that denies the verification round and rides history onto whichever
gate follows; cross-artifact disagreement surfaced as a finding. Every
pre-change log, fixture, and oracle stays green (additive fields only).

**Non-goals** (beyond the proposal's): no new gate mode enum value — the
concern history is a section of the existing early/final gate rendering; no
fuzzy/threshold fingerprint matching (master D1 rejected it as tuning debt);
no changes to `reviewOutcomeOf`'s open-set routing — thrash only removes the
verification round, it does not force a gate.

## Decisions

### D1 — `concern-model.ts` ports verbatim; constants confirmed, not derived

`fingerprintOf` (case-fold → strip non-alphanumeric → stopword-prune → dedup →
sort → join; empty-gap fallback key `@<round>:<id>`), `LEDGER_DIGEST_MAX = 15`
with the `… and N older concerns (see sidecars/resolutions-*.json)` overflow
note, `concernDigest` line shape `r<last> [<id>] <class> <resolution> — <note>
(seen r<first>..r<last>)` ordered by last-seen round, `concernRecords`, and
`detectConcernThrash` (thrash iff ≥2 prior resolved/dismissed entries, or ≥1
prior entry at a different class). Master measured re-raises at identical
fingerprints with no distinct-finding collisions; run-analysis confirms on
afk's corpus. The in-progress analyzer's `gapKey` (exact lowercase,
`analyze-findings.ts:14`) is a different, weaker key — run-analysis must adopt
this module's `fingerprintOf` for its lens-overlap and concern-persistence
metrics; that handoff is recorded in the proposal Impact.

### D2 — Namespacing via prompt + per-spawn refine; resolver uniqueness via schema

The reviewer prompt keeps `F<n>`; the skeptic prompt's JSON-shape line names
`S<n>`. `FindingSchema` stays string-keyed; the skeptic spawn passes
`FindingsSidecarSchema.refine(S-prefix)` at its call site (review-loop.ts:125)
— no agent-layer change, mis-namespaced sidecars fail validation and retry
through the existing path. `ResolverOutputSchema` gains a `.refine` for id
uniqueness within `resolutions`. Uniqueness per round is also what makes the
`(round, id)` join in D5 sound.

### D3 — Merge keeps first-wins content, max-severity class

`mergeLensFindings` dedupes by fingerprint; the surviving finding keeps the
first copy's content but the merged class is the most severe. Convergence
counts distinct merged findings — both count sets (`raised`, `open`) and the
verdict are computed over the merged list joined to resolutions, never over
per-lens copies. Alternatives rejected (with master): renaming ids at merge
(`F7` → `F7a`) breaks the resolver's id echo; a run-scoped id allocator
changes the reviewer contract for no measured need.

### D4 — Round-tagged ledger feeds the digest; prompts extract

`readResolutionsLedger` returns round-tagged `LedgerEntry[]`
(`{round, gap, resolution}`) instead of the flattened list — the round tag
exists in the sidecar filenames already; nothing re-reads. `concernDigest`
replaces `ledgerLines` as the `## Previously resolved findings` surface in
`buildReviewerPrompt`. Both prompt builders move to `work/review-prompt.ts`
(review-model.ts is at 289 lines; the additions do not fit).

### D5 — Fold holds the thrash fact; the sidecar holds the history

Additive, per the open-vs-raised D3 playbook:

- `FindingEvent` gains optional `fingerprint`; the `classified` emission
  (review-loop.ts:230) carries it — resolution emissions join by `(round, id)`,
  unique by D2. Fingerprint is computed over the **raw** gap from the findings
  sidecar; the 200-char row sanitizer (`sanitizeRowGap`) is render-only and
  never touches cluster identity.
- `ConvergenceEvent` gains optional `concerns: string[]` (cluster ids);
  `DigestRecord` and `legacy-fold.ts` widen in step (`concerns ?? []`).
- `sidecars/concerns.json` (run-scoped, the `concernRecords` shape) is written
  in `closeRound` after materialize and before the `round_close` event — an
  interrupted boundary still leaves the history the next round compares
  against.

Unlike master's `ReplayState.concerns`, the afk fold stores **only** the
thrash fact (cluster ids on the convergence record) — the full per-fingerprint
history is sidecar state the digest and detector read; nothing in routing
needs it from the fold. A resumed run re-derives "owed no verification round"
from `lastVerdict`'s `concerns` alone. Old logs fold with empty concerns and
unchanged bytes otherwise.

### D6 — Thrash routing: end the loop, deny the verification round, open set still decides

`closeRound` runs `detectConcernThrash` over the prior `concernRecords` and
the round's raised findings; on thrash the convergence event carries the
cluster ids and `runRound` returns `outcome: 'cap-hit'` with
`recurringConcerns` on `ReviewLoopResult` instead of recursing. In
`review.ts`, `owesVerificationRound` gains the conjunct that the last
verdict's `concerns` is empty — a thrash end never buys the verification
round, and the denial sits before `verificationBudgetRefuses` (a denied round
makes the budget question moot). `presentsGate`/`reviewOutcomeOf` are
untouched: the genuinely-open set decides gate versus tail, so a nitpick-only
thrash end flows through exactly as its spec requires. Calm-stop keeps its
position (parks after the in-flight round records). `concernHistory` rides
`presentGate` regardless of mode — whichever gate follows carries the
round-by-round block (gate-signals gathers it; gate-render renders it inside
the existing findings-rows grammar, no new checkbox surface).

### D7 — Consistency check: deterministic, next-round injection

New `work/artifact-consistency.ts` (no existing module extracts terms —
`gate-claims.ts` is settle arbitration, `gate-digest-extract.ts` extracts
sections/bullets for the gate digest): a pure scan over
`readReviewArtifacts`' set (proposal.md, design.md, `specs/**`) for seeded
decision-term vocabulary (migration strategy, interval/ms values, table/column
names, file paths referenced by ≥2 artifacts) whose renderings disagree.
A disagreement becomes a synthesized MATERIAL finding (deterministic `C<n>`
ids, both quotes, both file paths) injected into the **next** round's merged
findings at `runLenses`' merge point — it rides the normal lens→resolver
path, so the resolver's same-round contract is unchanged. No spawn, no
tokens. Generality is declined (master D6): widening is gated on the
run-analysis dry-run rates.

### D8 — Synthesized findings are ordinary findings for thrash purposes

`C<n>` findings carry fingerprints like any other; a persistent artifact
disagreement the resolver dismisses twice therefore ends the loop as thrash on
the third raise. Intended: a resolver repeatedly waving off a real artifact
split is the thrash signature. The cost — a seeded-term false positive forces
a human gate within three rounds — is the accepted trade (Risks).

## Risks / Trade-offs

- [Fingerprint equality misses paraphrased re-raises] → the digest still
  exposes them to the reviewer; run-analysis measures the miss rate before any
  threshold work (none is planned).
- [A seeded-term false positive forces a gate within three rounds] (D8) →
  accepted with eyes open; the vocabulary is compiled and small, the dry-run
  gates widening, and the gate text names both files so a human dismisses in
  one read. Kill path is deleting the term from the compiled list.
- [Additive fields touch the frozen corpus] → same recipe as open-vs-raised
  `open?`: pin tests replay pre-change logs folding `concerns = []`
  byte-identically; the 26-fixture parity harness, memo oracle, and finding
  action enum stay green untouched.
- [`review-loop.ts` and `gate-render.ts` are near max-lines] → the detector
  lives in `concern-model.ts`, prompts in `review-prompt.ts`, the scan in
  `artifact-consistency.ts`; the loop gains only the result field and one
  guard; gate-render gains one block — split rather than compress if a limit
  still trips.
- [Thrash end plus `needs-review` is a shape the verification round never
  sees] → the D6 conjunct is fold-derived and resume-safe (the denial
  re-derives from `lastVerdict.concerns` after a crash); resume-equivalence
  tests cover crash-mid-thash.

## Migration Plan

No DB, no config keys, no event removals: additive sidecar
(`sidecars/concerns.json`, run-scoped — keyed by run id inside the run dir; no
scope-model impact, offline runner workspace), additive event fields
(`finding.fingerprint`, `convergence.concerns`), schema refines that only
reject shapes the corpus shows are defects. Old runs resume unchanged (their
logs fold empty concerns; their sidecars predate `concerns.json`, which the
detector treats as no history). Rollback is `git revert`; no on-disk state
written by this change blocks an older checkout.

## TDD / Hook Interactions

The Write/Edit hook pipeline gates every file below, test-first. Order:

1. `tests/afk-runner/work/concern-model.test.ts` — fingerprint normalization,
  digest grouping/cap/overflow, records, thrash rule (fixtures shaped from
  the ancestor's measured shapes: re-raise clusters, oscillation, empty gap).
2. `tests/afk-runner/work/review-model.test.ts` — merge severity/dedup by
  fingerprint; distinct-count convergence over merged findings.
3. `tests/afk-runner/work/review-loop.test.ts` — S-prefix refine (skeptic
  spawn only), resolver id-uniqueness refine, retry-on-violation;
  `recurringConcerns` on the result; round-tagged ledger read.
4. `tests/afk-runner/event-schemas.test.ts` + kernel fold tests +
  `tests/afk-runner/legacy-fold.test.ts` — additive `fingerprint`/`concerns`,
  `concerns ?? []` reader, old-log pins; then the parity harness and memo
  oracle.
5. `tests/afk-runner/work/review-round.test.ts` — `concerns.json` write
  ordering (after materialize, before `round_close`), detection wiring into
  the convergence event.
6. `tests/afk-runner/work/review-work.test.ts` — thrash denies the
  verification round (fold-derived, resume-safe); nitpick-only thrash flows to
  the tail.
7. `tests/afk-runner/work/materialize.test.ts` + new
  `tests/afk-runner/work/artifact-consistency.test.ts` — seeded-term
  disagreement fixtures (drizzle-vs-hand-written, interval mismatch, name
  mismatch), agreement yields none, next-round injection.
8. `tests/afk-runner/work/gate-signals.test.ts` + `gate-render.test.ts` —
  concern-history block rides any gate mode.
9. Production edits land per section: `work/concern-model.ts` (new),
  `work/review-prompt.ts` (new), `review-model.ts`, `agent-schemas.ts`,
  `review-loop.ts`, `event-schemas.ts`, `kernel/machine.ts`,
  `legacy-fold.ts`, `review-round.ts`, `review.ts`,
  `work/artifact-consistency.ts` (new), `gate-signals.ts`, `gate-render.ts`.
10. Full gates: one serial `bun run test` (parity + memo oracles inside the
  sweep), `bun run typecheck`, `bun run lint`, `format:check`,
  `openspec validate --strict`; docs — `afk-runner.md` (concern memory,
  thrash end, the consistency check) and `sdd-pipeline.md` (review loop,
  convergence, event model).
