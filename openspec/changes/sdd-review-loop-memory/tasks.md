## 1. Merge integrity (fingerprint, severity, schema uniqueness)

- [x] 1.1 Red-first `tests/sdd-runner/review-model.test.ts`: `fingerprintOf` normalization (case/punct/whitespace/stopwords), merge dedupes reviewer/skeptic copies of the same fingerprint, merged class is the most severe, distinct fingerprints keep both findings — fixtures shaped from `opencode-agent-fix-command` r3 sidecars — `bun test tests/sdd-runner/review-model.test.ts`
- [x] 1.2 Implement `fingerprintOf` + rework `mergeLensFindings` severity/dedup in `sdd-runner/src/review-model.ts` to green — `bun test tests/sdd-runner/review-model.test.ts`
- [x] 1.3 Red-first uniqueness: `ResolverOutputSchema` rejects duplicate resolution ids; skeptic `FindingsSidecarSchema` refine enforces `S`-prefixed ids — `bun test tests/sdd-runner/review-loop.test.ts`
- [x] 1.4 Update the reviewer/skeptic prompt JSON-shape lines (skeptic `"id": "S<n>"`) and implement the schema refines — `bun test tests/sdd-runner/review-loop.test.ts`
- [x] 1.5 Red-first convergence distinctness: `evaluateConvergence` counts distinct merged ids (dup-entry fixture verdicts flip to distinct counts) — extend `tests/sdd-runner/review-model.test.ts` — `bun test tests/sdd-runner/review-model.test.ts`
- [x] 1.6 Red-first gate finding-row text: `findingsOf` (`gate-digest.ts`) hardcodes `gap: entry.id` — every gate file renders `- [x] F13 F13` (corpus fixture: the trilogy run's `gate-6.md`). Join each resolution back to its finding's gap text by id — sound under 1.3's uniqueness — rendering `- [x] <id> <gap excerpt>`; write-then-parse self-check still passes — `bun test tests/sdd-runner/gate-digest.test.ts`

## 2. Known-concerns ledger digest

- [x] 2.1 Red-first `concernDigest`: groups resolutions by fingerprint, renders round-tagged one-line-per-concern (`r<last> [id] class resolution — note (seen r<first>..r<last>)`), caps at `LEDGER_DIGEST_MAX` with overflow note; replaces `ledgerLines` in `buildReviewerPrompt` — `bun test tests/sdd-runner/review-model.test.ts`
- [x] 2.2 Pin prompt rendering: reviewer prompt embeds the digest, never the flat list; empty ledger renders no section — `bun test tests/sdd-runner/review-model.test.ts`

## 3. Concern tracking and the concern-history gate

- [x] 3.1 Red-first `tests/sdd-runner/replay.test.ts`: `finding` events carry optional `fingerprint`; `ReplayState.concerns` folds per-fingerprint history; pre-change logs fold to empty concerns byte-identically otherwise — `bun test tests/sdd-runner/replay.test.ts`
- [x] 3.2 Implement the fold + `stampEvent` additive field in `sdd-runner/src/{events,replay}.ts`; maintain `sidecars/concerns.json` at round close in `review-loop.ts` — `bun test tests/sdd-runner/replay.test.ts`
- [x] 3.3 Red-first detection: a fingerprint with ≥2 prior resolved/dismissed entries raised again, or re-raised at a different class, yields a concern-history gate outcome in the orchestrator's post-review routing (no new gate mode; early-gate variant with history block) — `bun test tests/sdd-runner/orchestrator.test.ts`
- [x] 3.4 Red-first digest rendering: concern-history section renders round-by-round entries (round, id, class, resolution, outcome) in `gate-digest.ts`/`gate-render.ts`, with both file and TUI front-ends sharing the copy source — `bun test tests/sdd-runner/gate-digest.test.ts`

## 4. Cross-artifact consistency check

- [x] 4.1 Red-first `tests/sdd-runner/materialize.test.ts`: seeded-term disagreement (drizzle-vs-hand-written fixture; interval-ms mismatch; table-name mismatch) across proposal/design/specs yields a synthesized MATERIAL finding naming both files and renderings; agreement yields none — `bun test tests/sdd-runner/materialize.test.ts`
- [x] 4.2 Implement the deterministic scan + synthesized-finding injection into the next round's findings in `materialize.ts`/`review-loop.ts` — `bun test tests/sdd-runner/materialize.test.ts`

## 5. Verification and docs

- [x] 5.1 One full `bun run test` (never two full suites concurrently), `bun run typecheck`, `bun run lint` — all green
- [x] 5.2 Update `docs/architecture/sdd-pipeline.md` (review loop lens merge, ledger digest, concern-history gate, consistency check, event-model additive fields) in the same commit as the final code — `bun run workflows:lint` if workflows touched (not expected)
