# Tasks — sdd-runner-open-vs-raised

Every task is red-first: the failing test lands before the implementation, green
before moving on. Tick each checkbox as it lands. Landing order matters — the
predicate (§1) is what every later task reads.

## 1. The two count sets and the three-valued verdict

- [x] 1.1 Openness predicate over a single resolution. Red-first in `tests/sdd-runner/review-model.test.ts`: a new exported predicate reports `dismissed` open; `evidence-answered` closed; `assumed` open when no assumption in the round carries its id and closed when one does; `assumed` closed under the legacy fallback when no assumption in the round carries any `findingId`; `edited` open when the round's file digests are unchanged from the prior round's snapshot and closed when they differ; a missing prior snapshot (round 1) reads `edited` as closed. Then implement it in `review-model.ts` taking the resolution, the round's assumptions, and the two hash snapshots as plain arguments — pure, no I/O. Verify: `bun run test tests/sdd-runner/review-model.test.ts`
- [x] 1.2 `evaluateConvergence` returns both sets and three verdicts. Red-first in the same file: the returned `raised` set is byte-identical to today's counts for every input (pin with the existing fixtures); `open` counts only what 1.1 calls open; verdict is `converged` with an empty open set above nitpick and ≤3 open nitpicks, `open` when anything above a nitpick is open, and `needs-review` when the open set passes the converged test but the round recorded an edit above a nitpick. Then widen `evaluateConvergence` in `review-model.ts`, keeping its existing signature additive so `materialize.ts:59` compiles unchanged. Verify: `bun run test tests/sdd-runner/review-model.test.ts tests/sdd-runner/materialize.test.ts`

## 2. Making `edited` and `assumed` checkable

- [x] 2.1 Optional `findingId` on the assumption record. Red-first in `tests/sdd-runner/agent-layer.test.ts`: `AssumptionRecordSchema` validates records with and without `findingId`; the `A<n>` id regex is unchanged; pre-change sidecar fixtures still parse. Then add the optional field in `agent-layer.ts` and teach the resolver prompt in `review-model.ts` to carry the finding id it assumed against. Verify: `bun run test tests/sdd-runner/agent-layer.test.ts`
- [x] 2.2 Per-round artifact hash snapshot. Red-first in `tests/sdd-runner/materialize.test.ts` (or a new `round-hashes.test.ts` if that file is already at its size limit): closing a round writes `sidecars/round-hashes-<n>.json` over the same file set `recordArtifactHashes` already covers; a round whose change folder did not move produces a snapshot equal to the previous round's; a missing prior snapshot is tolerated. Then call the existing `recordArtifactHashes` from the round-close path — no new hashing code. Verify: `bun run test tests/sdd-runner/materialize.test.ts`

## 3. Event model and replay

- [x] 3.1 Additive `open` counts on the convergence event. Red-first in `tests/sdd-runner/events.test.ts` and `tests/sdd-runner/replay.test.ts`: a `convergence` event stamps and round-trips with and without `open`; a pre-change line parses and folds with `open` reading as `raised`; the `finding` event's action enum is unchanged (pin it, so a later change cannot widen it by accident); `DigestRecord` carries both sets. Then extend `ConvergenceEvent` in `event-schemas.ts` and the fold in `replay.ts`. Verify: `bun run test tests/sdd-runner/events.test.ts tests/sdd-runner/replay.test.ts`

## 4. Review loop wiring

- [x] 4.1 `ReviewLoopResult` carries open and raised. Red-first in `tests/sdd-runner/review-loop.test.ts`: the result exposes the open findings per class (what today's `openBlockers`/`openMaterial`/`openNitpicks` are named for) and the raised counts separately; the convergence event emitted per round carries both sets; a round whose findings were all edited-with-changes reports an empty open set and a `needs-review` verdict. Then wire `review-loop.ts` — it reads the round's assumptions and hash snapshots to apply §1's predicate. Verify: `bun run test tests/sdd-runner/review-loop.test.ts`
- [x] 4.2 Sidecar re-read agrees with the live loop. Red-first in `tests/sdd-runner/gate-digest.test.ts`: `readReviewResultFromSidecars` applies the identical predicate, so a resumed run's gate sees the same open set the live run would have. Then update `gate-digest.ts`. Verify: `bun run test tests/sdd-runner/gate-digest.test.ts`

## 5. Cap-hit routing and the verification round

- [x] 5.1 Routing by three verdicts. Red-first in `tests/sdd-runner/post-review-tail.test.ts`: `converged` at cap flows to decompose with no gate; `open` at cap presents the early gate; `needs-review` at cap runs exactly one further review round and then flows to decompose whatever it records; a second `needs-review` from that round does not buy another. Then widen `isSeverityConverged`/`runPostReviewToGate` in `post-review-tail.ts`, reusing `runExtendRound`. Verify: `bun run test tests/sdd-runner/post-review-tail.test.ts`
- [x] 5.2 The budget guard declines the verification round. Red-first in the same file plus `tests/sdd-runner/gate-prelude.test.ts`: with projected spend at or over budget, a `needs-review` cap-hit flows to decompose without spending the further round, and the decision is recorded. Verify: `bun run test tests/sdd-runner/post-review-tail.test.ts tests/sdd-runner/gate-prelude.test.ts`
- [ ] 5.3 Resume does not skip a pending verification round. Red-first in `tests/sdd-runner/resume-point.test.ts`: a `needs-review` last verdict does not satisfy `reviewSettled`, so resume re-enters review; `converged` still settles it; a pre-change log (no open set) resumes exactly as today. Then update `resume-point.ts`. Verify: `bun run test tests/sdd-runner/resume-point.test.ts`

## 6. The ladder

- [ ] 6.1 R1 and the never-cut blocker pre-check read the open set. Red-first in `tests/sdd-runner/auto-policy.test.ts`: a round that raised and edited-with-changes every finding auto-approves under R1; a dismissed finding of any severity blocks it; a resolved BLOCKER alone no longer forces a gate while a dismissed one still does. Then update `auto-policy.ts`. Verify: `bun run test tests/sdd-runner/auto-policy.test.ts`
- [ ] 6.2 R2 splits its two questions. Red-first in the same file: eligibility reads the open set (a fixed blocker no longer blocks it; an empty open MATERIAL set makes R2 inapplicable) while `strictlyDecreasingLastK` keeps reading raised totals; the budget guard is unchanged. Verify: `bun run test tests/sdd-runner/auto-policy.test.ts`
- [ ] 6.3 The integrity cross-check compares both sets. Red-first in `tests/sdd-runner/gate-prelude.test.ts`: a sidecar/event mismatch in either set synthesizes the `POLICY-INTEGRITY` blocker; agreement in both lets the ladder run; an unparseable sidecar still fails closed. Then update `openCountsFromSidecarsSync`/`guardedReviewResult` in `gate-prelude.ts` to use §1's predicate. Verify: `bun run test tests/sdd-runner/gate-prelude.test.ts`

## 7. Gate evidence

- [ ] 7.1 Export the findings/resolutions joiner. Red-first in `tests/sdd-runner/materialize.test.ts`: the joiner is exported, reads both `findings-<n>.json` and `findings-skeptic-<n>.json`, merges them before pairing with resolutions, and returns each finding's verbatim gap keyed by id; a missing sidecar yields an empty join rather than throwing. Then export it from `materialize.ts` without changing `review.md`'s bytes. Verify: `bun run test tests/sdd-runner/materialize.test.ts`
- [ ] 7.2 Gate rows carry the gap. Red-first in `tests/sdd-runner/gate-digest.test.ts` and `tests/sdd-runner/gate-render.test.ts`: `findingsOf` carries the joined gap instead of `gap: entry.id`; a gap with newlines renders as one truncated line; a gap beginning with a redirect marker does not corrupt the parse; a finding absent from the sidecars degrades to its identifier. Then update `gate-digest.ts`. Verify: `bun run test tests/sdd-runner/gate-digest.test.ts tests/sdd-runner/gate-render.test.ts`
- [ ] 7.3 The write-then-parse self-check covers the new row text. Red-first in `tests/sdd-runner/gate-answers.test.ts`: a gate rendered from answers whose finding rows carry multi-line and arrow-leading gaps parses back to the same response. Verify: `bun run test tests/sdd-runner/gate-answers.test.ts`

## 8. Full verification and docs

- [ ] 8.1 Full gates and documentation. Run one full `bun run test` (never two concurrently), `bun run typecheck`, `bun run lint` — all green, and confirm the sdd-runner suite carries no failures beyond the environment-dependent baseline. Update `docs/architecture/sdd-pipeline.md`: the Stages section's convergence predicate, the Gate protocol's severity-convergence and cap-hit routing (including the one verification round and its budget refusal), the Event model's convergence-event shape, and the gate digest's finding rows now carrying gaps. Verify: all three commands exit green.
