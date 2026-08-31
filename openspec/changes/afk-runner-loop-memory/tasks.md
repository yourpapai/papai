# Tasks — afk-runner-loop-memory

## 1. Concern model (fingerprint, digest, records, thrash rule)

- [ ] 1.1 Red-first `tests/afk-runner/work/concern-model.test.ts`: `fingerprintOf` normalization (case/punctuation/whitespace/stopwords, sorted token set, empty-gap fallback key `@<round>:<id>`); `concernDigest` groups round-tagged entries by fingerprint, renders `r<last> [<id>] <class> <resolution> — <note> (seen r<first>..r<last>)` most-recent-first, caps at `LEDGER_DIGEST_MAX = 15` with the overflow note — `bun test tests/afk-runner/work/concern-model.test.ts`
- [ ] 1.2 Red-first `concernRecords` (the `sidecars/concerns.json` shape: fingerprint, firstRound, lastRound, entries) and `detectConcernThrash` — ≥2 prior resolved/dismissed entries raised again, or ≥1 prior entry at a different class — `bun test tests/afk-runner/work/concern-model.test.ts`
- [ ] 1.3 Implement `work/concern-model.ts` to green — `bun test tests/afk-runner/work/concern-model.test.ts`

## 2. Merge integrity and distinct-count convergence

- [ ] 2.1 Red-first `tests/afk-runner/work/review-model.test.ts`: `mergeLensFindings` dedupes reviewer/skeptic copies by fingerprint, merged class is the most severe, distinct fingerprints keep both findings — `bun test tests/afk-runner/work/review-model.test.ts`
- [ ] 2.2 Red-first convergence counts distinct merged findings: both count sets (`raised`, `open`) and the verdict are invariant to how many lenses quoted a gap — `bun test tests/afk-runner/work/review-model.test.ts`
- [ ] 2.3 Implement the merge rework and the distinct-count evaluation in `review-model.ts` to green — `bun test tests/afk-runner/work/review-model.test.ts`

## 3. Round-tagged ledger and prompt extraction

- [ ] 3.1 Red-first `readResolutionsLedger` returns round-tagged ledger entries instead of the flattened list; `buildReviewerPrompt` renders the capped `concernDigest` in place of the flat `## Previously resolved findings` lines — `bun test tests/afk-runner/work/review-prompt.test.ts`
- [ ] 3.2 Extract `buildReviewerPrompt`/`buildResolverPrompt` to `work/review-prompt.ts` (review-model.ts is at the max-lines edge); reviewer keeps `F<n>`, skeptic prompt names `S<n>` — `bun test tests/afk-runner/work/review-prompt.test.ts`

## 4. Namespacing and resolver uniqueness (schema refines)

- [ ] 4.1 Red-first skeptic spawn validates against the S-prefix-refined sidecar schema (mis-namespaced ids fail and retry through the existing validation path); reviewer spawn unchanged — `bun test tests/afk-runner/work/review-loop.test.ts`
- [ ] 4.2 Red-first `ResolverOutputSchema` rejects duplicate resolution ids within a round — `bun test tests/afk-runner/work/review-loop.test.ts`
- [ ] 4.3 Implement the per-spawn refine (skeptic call site, review-loop.ts) and the resolver `.refine` — `bun test tests/afk-runner/work/review-loop.test.ts`

## 5. Additive events, fold, and the concerns sidecar

- [ ] 5.1 Red-first `tests/afk-runner/event-schemas.test.ts` + kernel fold tests + `tests/afk-runner/legacy-fold.test.ts`: `finding` events carry optional `fingerprint` (classified emission), `convergence` carries optional `concerns: string[]`, `DigestRecord` widens with the `concerns ?? []` reader; pre-change logs fold byte-identically with empty concerns; finding action enum pinned unchanged — `bun test tests/afk-runner/event-schemas.test.ts tests/afk-runner/legacy-fold.test.ts`
- [ ] 5.2 Red-first `tests/afk-runner/work/review-round.test.ts`: `closeRound` writes `sidecars/concerns.json` after materialize and before the `round_close` event; a pre-`concerns.json` sidecar dir reads as no history — `bun test tests/afk-runner/work/review-round.test.ts`
- [ ] 5.3 Implement the additive fields and the sidecar write; run the parity harness and memo oracle green — `bun test tests/afk-runner`

## 6. Thrash wiring: loop end, routing denial, resume safety

- [ ] 6.1 Red-first detection wiring: on thrash at round close the convergence event carries the cluster ids and `runRound` returns `cap-hit` with `recurringConcerns` on `ReviewLoopResult` instead of recursing — `bun test tests/afk-runner/work/review-round.test.ts tests/afk-runner/work/review-loop.test.ts`
- [ ] 6.2 Red-first `tests/afk-runner/work/review-work.test.ts`: `owesVerificationRound` denies the verification round for a thrash-ended last verdict (fold-derived — the denial re-derives after a crash mid-thrash); a nitpick-only thrash end flows to the tail; the denial precedes the budget question — `bun test tests/afk-runner/work/review-work.test.ts`
- [ ] 6.3 Implement the `owesVerificationRound` conjunct over `lastVerdict`'s concerns in `review.ts` — `bun test tests/afk-runner/work/review-work.test.ts`

## 7. Gate concern-history block

- [ ] 7.1 Red-first `tests/afk-runner/work/gate-signals.test.ts` + `gate-render.test.ts`: the concern-history block (round, class, resolution, outcome per entry) rides whichever gate follows a thrash end, in both early and final modes, inside the existing findings-rows grammar — `bun test tests/afk-runner/work/gate-signals.test.ts tests/afk-runner/work/gate-render.test.ts`
- [ ] 7.2 Implement the signals join and the render block — `bun test tests/afk-runner/work/gate-signals.test.ts tests/afk-runner/work/gate-render.test.ts`

## 8. Cross-artifact consistency check

- [ ] 8.1 Red-first new `tests/afk-runner/work/artifact-consistency.test.ts`: seeded-term disagreement (drizzle-vs-hand-written fixture, interval-ms mismatch, name mismatch) across proposal/design/specs yields a synthesized MATERIAL finding naming both files and renderings; agreement yields none — `bun test tests/afk-runner/work/artifact-consistency.test.ts`
- [ ] 8.2 Red-first next-round injection: synthesized `C<n>` findings join the next round's merged findings at the merge point and carry fingerprints (a twice-dismissed disagreement ends the loop as thrash on the third raise) — `bun test tests/afk-runner/work/review-loop.test.ts`
- [ ] 8.3 Implement `work/artifact-consistency.ts` and the injection in `review-loop.ts` — `bun test tests/afk-runner/work/artifact-consistency.test.ts tests/afk-runner/work/review-loop.test.ts`

## 9. Full gates and documentation

- [ ] 9.1 One serial full `bun run test` (parity harness, frozen corpus, memo oracle inside the sweep) plus `bun run typecheck`, `bun run lint`, `format:check`, `openspec validate afk-runner-loop-memory --strict` — `bun run test`
- [ ] 9.2 Docs: `afk-runner.md` (concern memory, the thrash end and verification-round denial, the consistency check) and `sdd-pipeline.md` (review loop, convergence, event model — the two new event fields)
