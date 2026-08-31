<!-- SPDX-License-Identifier: BUSL-1.1 -->

## Context

`scripts/mutation/baseline.json` is a committed `Record<string, number>`: one aggregate ratio per file. The PR ratchet (`resolveRatchet`, `scripts/mutation/baseline.ts`) fails any baselined file whose new score falls below that number, and the improvement runner (`mutation-improve/src/baseline.ts`, `bumpScore`) reads and bumps the same file with the same shape. The score is computed by Stryker's formula `(killed + timeout) / scored` (`scripts/mutation/score-merger.ts`), so a ratio alone cannot distinguish "tests got weaker" (numerator dropped) from "file got bigger" (denominator grew) — see proposal.md — Why.

Facts that shape the approach:

- The per-file measurement type (`MergedScore`) already carries every raw count, and the score cache (`reports/paired/score-cache.json`) already persists a full `MergedScore` per file — so counts are available at every ratchet comparison point today, including for carried-over scores. Only the committed baseline throws them away.
- The baseline has two independent writers (CI master seed via `seedMerge`/`seed-from.ts`, and the improvement runner via `bumpScore`/`skip-ratchet.ts`, which commits on the integration branch) and two independent readers (PR gate, runner). Any shape change must keep those writes mergeable and both readers in agreement.
- Most baseline entries cannot be re-measured on demand: the master seed measures only changed files, and a full-suite run is hours. Whatever migration is chosen must work under changed-files-only cadence.
- The spec delta (`specs/mutation-gate/spec.md`) already fixes the verdict rule (fail only on score-below-floor AND kills-below-record; dilution warns), the monotonic merge contract, and the requirement that a score-only legacy record stays enforceable. This design decides the on-disk shape, the module split, and the migration mechanics.

## Goals / Non-Goals

**Goals:**

- A committed record that pins score and its producing counts together, so the gate can tell true regression from new-code dilution and a corrupted/merge-mangled record is detectable.
- One record shape + one set of parse/guard/verdict functions shared by the PR gate and the improvement runner.
- A migration that requires no big-bang re-measure: mixed legacy/rich entries coexist in one committed file, and enforcement never weakens during migration.

**Non-Goals:**

- Changing Stryker's score formula, the score fingerprint (ADR-0424), or the score cache — the cache already stores counts and needs no change.
- Per-region or mutant-id-level baselines, and quality floors on dilution — declined in the proposal.
- New runtime/tool surface, DB, or dependencies — this is CI/tooling only (see Project Impacts below).

## Decisions

### D1 — Record shape: `{score, killed, timeout, scored}`; top-level file stays a bare sorted map

Each rich entry is an object with the three counts behind the score plus the score itself:

```json
{
  "src/foo.ts": { "score": 0.85, "killed": 16, "timeout": 1, "scored": 20 },
  "src/legacy.ts": 0.5
}
```

- **`killed` and `timeout` stored separately, not pre-summed.** The score's numerator is `killed + timeout`; storing the decomposition keeps field names identical to `MergedScore` (zero translation at write/read time) and makes the score exactly recomputable from the record. The verdict compares numerators — "kills" means `killed + timeout` — so a killed→timeout reclassification (slower tests, same killing power) is not misreported as a regression. A shared helper (`recordNumerator(record)` / `measurementNumerator(merged)`) exports the sum so no consumer hand-rolls it against the wrong fields.
- **`score` committed even though derivable.** It keeps git diffs human-readable, keeps the runner's SELECT prompt and summaries stable, and a bare-number legacy entry degrades gracefully to "score-only floor" without a second legacy type.
- **Bare top-level map, no `{"version": N, "entries": …}` wrapper.** Decisive reason: migration is lazy (D2), so one committed file must hold legacy numbers and rich objects side by side — a file-level version cannot express that, only per-entry shape sniffing can. It also keeps the four write sites diff-compatible and the merge story (sorted keys, per-key max) unchanged.

*Alternatives considered:* numerator-only `{killed, scored}` — rejected: hides the timeout contribution, breaks exact score recomputation, and reuses the name `killed` with a different meaning than `MergedScore.killed`, a standing bug farm. Full `MergedScore` per entry — rejected: couples the committed floor to Stryker's bucket taxonomy (`compileError`, `pending`, …) and bloats a ~600-entry file for counts the verdict never reads. Versioned wrapper with a dual-version reader — rejected: cannot represent mixed-shape migration and complicates both consumers for no enforcement gain.

### D2 — Migration: dual-shape read + lazy conversion; no one-time reseed

Readers accept a bare number (legacy) or a record (rich) per entry. Writers always emit rich records. A legacy entry keeps its score-only floor and is judged by score alone (the stricter rule — it cannot classify dilution), and gains counts the next time a seeding run measures its file at or above its recorded score — exactly as the spec requires. The equal case is the ordinary one: the seed re-measures merged code the passing PR gate already scored, and mutation scoring is deterministic, so marginal merges tie. An equal measurement therefore upgrades the bare entry to a rich record at an unchanged floor — a one-time shape gain, not a floor change; this is the single carve-out from the leave-unchanged merge rule (D4). A measurement below the recorded floor leaves the legacy entry untouched: the floor must not drop, and counts cannot be paired with a score they did not produce (D3).

- **Why not a one-time full reseed** (delete `baseline.json`, `bun test:mutate --update-baseline`): it needs a full-suite mutation run (hours), it re-floors every file from a single fresh measurement — transient flakes would seed permanently low floors — and it discards the tuned history the ratchet exists to preserve. It remains available as an *optional* operator command to convert everything at once, documented in `scripts/mutation/README.md`, but nothing requires it: under changed-files master seeding, every entry converts as its file is next touched at or above its recorded score — the common case; a below-floor measurement (master-side dilution after a warned PR) waits for the score to recover to the floor or for a hand-adjusted floor (D3).

### D3 — Record integrity: arithmetic validation at load, failing loud

A rich record must satisfy: the three counts `killed`, `timeout`, `scored` finite non-negative integers, with `scored > 0`; `score` a finite number in [0, 1]; `killed + timeout ≤ scored`; and `score ≈ (killed + timeout) / scored` within a tight epsilon (1e-9 — JSON round-trips doubles exactly for values we write, and small-integer divisions round-trip hand edits correctly). Violations throw at load with a message naming the file and the expected relation.

- Rationale: the spec forbids pairing a score from one measurement with counts from another; provenance is unverifiable, but arithmetic consistency is, and it is precisely what a badly auto-resolved merge conflict or hand edit breaks. The baseline is an enforcement floor — unlike the fail-open score cache, a corrupt floor must fail the run loudly rather than silently gate on nonsense. Cost: a hand-tuned floor must keep its counts consistent (compute the counts from the intended score, or re-measure) — acceptable and self-documenting via the error message.

### D4 — Verdict in `resolveRatchet`; `GateVerdict` gains a warnings channel

`resolveRatchet` (scripts/mutation/baseline.ts) returns `{ exitCode, regressions, dilutions }`, where a dilution is a baselined file whose measured score < recorded score while measured numerator ≥ recorded numerator. Verdict order per file: score ≥ floor → pass silently; score < floor ∧ numerator < recorded → regression (fail); score < floor ∧ numerator ≥ recorded → dilution (warn, exit 0). First-touch and `scored === 0` files stay skipped; a legacy score-only record produces the score-only judgment with no dilution classification. The failure channel carries the kills the spec's regression scenario requires: `RatchetRegression` gains measured and recorded numerators alongside its existing `{sourceFile, score, threshold}` fields, and the gates.ts regression message renders them (`file score < floor, kills m < n recorded`) — so a failing run names the file with its measured score and kill count against the recorded ones. `GateVerdict` (scripts/mutation/gates.ts) gains `warnings: readonly string[]` (default `[]`); `changed-files.ts` prints each as a `WARN` log line naming the file, held kill count, and both scores. Plain log lines, not CI annotations — the gate's failure surface stays exactly one exit code.

- Monotonic merges keep their contract with counts riding along: `seedMerge`/`ratchetMerge` and the runner's `bumpScore`→record-level bump replace a record wholesale only when the new score is *strictly* higher — an equal or lower measurement of an already-rich record leaves score and counts untouched (no flake churn, no score/counts mixing). One carve-out serves the D2 migration: a legacy score-only entry measured at exactly its recorded score converts to a rich record carrying that measurement's counts — the score is unchanged, so the floor does not loosen, and the one-time shape upgrade is not churn. That conversion changes the map, so `skip-ratchet.ts`'s `bumped[file] === baseline[file]` early-return correctly lets it commit; over an existing rich record the bump still preserves reference identity on a no-op — a not-strictly-higher score returns the same map with the previous record object untouched — so the early-return keeps suppressing the no-op commit it guards today (covered in `tests/mutation-improve/skip-ratchet.test.ts`).

### D5 — Module split: extend `scripts/mutation/baseline.ts`; the runner imports the record contract

No new module — `scripts/mutation/baseline.ts` already owns the baseline and gains the record type, guards, and verdict. (Apply note: the 300-line lint ceiling forced one mechanical carve-out — the record type, guards, numerators, and arithmetic validation live in `scripts/mutation/baseline-record.ts`, re-exported verbatim through `baseline.ts`, so every consumer import surface named below is unchanged.) `mutation-improve/src/baseline.ts` keeps its own IO (async fs, ENOENT → `{}`) but imports the record type and parse guards from `../../scripts/mutation/baseline.js` — the same relative-import pattern the runner already uses for `scripts/mutation/json-readers.js` and `score-merger.js` (score-reader.ts). Both consumers therefore interpret records identically by construction, which is the spec's "consumers interpret records identically" scenario, rather than by two hand-synced copies. The runner's selection gate (`baseline[file] === undefined`) and the SELECT prompt's embedded baseline dump (`JSON.stringify(baseline)` in pipeline.ts) work unchanged against the richer map — the agent additionally sees counts, a free ROI signal. The prompt *text* does not stay unchanged: `prompt-templates.ts` describes the map as `{filePath: score}` and instructs `beforeScore: number (your read of baseline[file], 0..1)`, both stale once entries become records — and that file's own header warns a stale shape statement costs a whole iteration to a validation error. Those two strings are updated to describe the map the agent actually sees under D2's lazy migration: entries are either a bare score number (a not-yet-converted legacy entry) or a `{score, killed, timeout, scored}` record, and the instruction becomes `beforeScore: number (your read of the entry's score — the bare number itself for a legacy entry, otherwise the entry's score field, 0..1)`; `SelectionSchema` is untouched, since `beforeScore` remains the numeric score the agent reports — the bare number itself for a legacy entry, the record's `score` field (0..1) under the rich shape.

The record-level bump needs the counts behind the measured score, so the runner's measurement path joins the changed surface: `mergeReports` already computes `killed`/`timeout`/`scored`, but `measureMutationScore` keeps only `.score`, so `MeasuredScore` (score-reader.ts) widens to carry the `MergedScore` counts next to `score`/`survivingMutantIds`; `GateOutcome` (gate.ts) carries those counts alongside `afterScore`; and the two bump call sites — `commitRatchet` in `pipeline.ts` and `ratchetVerifiedSkip` in `skip-ratchet.ts` — pass the full measurement to the record-level `bumpScore`. No extra measurement or report re-read is involved: the counts come from the same report the after-score is computed from.

### D6 — No change to score cache, scores.json snapshot, or CI workflows

`ReusedScore`/`PerFileScore` already carry full `MergedScore`, so carried-over scores get the full verdict for free. `writeScoresFile` and `seed-from.ts` build on `buildBaselineFromPerFile`/`loadBaseline`, which become record-aware once — so the `scores.json` re-seed artifact and the fresh-base replay convert shape automatically. The same covers `all-files.ts`, the `test:mutate` full-run writer behind D2's optional conversion (Migration step 3): it touches baseline entries only through those shared helpers and never reads a value, so it converts shape automatically and needs no direct edit. The CI jobs run the same commands; only the committed file's shape evolves. No DB, no new dependency (plain JSON over existing modules), no tool/capability surface (nothing registers a tool; `tool_prefs` gating is untouched), and no scope-model state (the baseline is repo-committed CI state keyed by repo-relative source path — no storage context, config context, platform-instance, or user ids).

## Risks / Trade-offs

- [Rollback pairs code and data: old `loadBaseline` rejects rich entries, so reverting the code while keeping the new `baseline.json` bricks the gate] → Revert the commit *and* restore the pre-change `baseline.json` blob (git history holds it); document the pairing in the new ADR and `scripts/mutation/README.md`.
- [Legacy score-only entries keep the stricter judgment — a diluting-but-not-weakening PR still fails on not-yet-converted files, the very false positive being fixed] → Bounded and self-healing: each file converts at its next equal-or-higher master-seed measurement — the common case, since deterministic scoring makes marginal merges tie — while a below-floor measurement (master-side dilution after a warned PR) leaves the entry until its score recovers to the floor or the floor is hand-adjusted (D3); the optional full-run conversion closes the window immediately for teams that prefer it.
- [A hand-edited floor that doesn't keep `score`, counts, and formula consistent now fails the gate at load] → Intended (D3); the error message states the required relation so the fix is mechanical.
- [Merge conflicts on `baseline.json` between a runner `skip-ratchet` commit and a concurrent CI seed become record-shaped] → Unchanged risk class with richer payloads; both sides write sorted bare maps and per-key max, so `git checkout --theirs` + re-seed replay resolves as before.
- [Dilution warnings could be noisy on a large feature PR touching many baselined files] → One line per file, only for files whose score actually dropped below floor; the warning is the feature, not a defect.
- [Per-entry shape sniffing means a typo'd record (e.g. a string) throws instead of degrading] → Load-time validation (D3) fails with the file and field named; a wrong record was never safe to gate on.
- [Deleting covered code shrinks the population and drops the absolute numerator (fewer mutants to kill), so a score dip with fewer kills is classified as a regression and fails] → Accepted: identical to today's score-only ratchet (nothing new fails), and consistent with the pure-regression-ratchet rule — dilution is surfaced, removal is not excused. Floors only tighten per ADR-0342, so removing well-tested code is resolved the way it is today: a hand-adjusted floor (kept count-consistent per D3) rather than a seed lowering it.

## Migration Plan

1. Land, in one change set: record type + dual-shape reader/writer + verdict + warning channel in `scripts/mutation/` (`baseline.ts`, `gates.ts`, `changed-files.ts`, `seed-from.ts` via shared helpers), the runner's record-aware `baseline.ts`/bump, the measurement path feeding the bump its counts (`score-reader.ts` `MeasuredScore`, `gate.ts` `GateOutcome`, the `pipeline.ts`/`skip-ratchet.ts` call sites), and SELECT-prompt shape strings (`prompt-templates.ts`), tests, ADR, and docs (`scripts/mutation/README.md`, `docs/architecture/commands.md`, AGENTS.md Testing Notes).
2. No CI workflow edit and no operator action required: the next master seed starts writing rich records for the files it touches at or above their recorded scores; legacy entries keep enforcing score-only floors until then.
3. Optional one-time conversion: run `bun test:mutate --update-baseline` as a full run (or delete + regenerate per the existing README recipe) to give every entry counts immediately.
4. Rollback: revert the change-set commit and `git checkout <pre-change> -- scripts/mutation/baseline.json` together (D1/D3 make the two inseparable). A partially-converted baseline rolls back cleanly to score-only floors — scores are identical in both shapes, so no floor is lost.

## Open Questions

None. The remaining unknowns (the ADR number) are mechanical and cannot change the approach or the specs; the epsilon is already pinned at 1e-9 in D3.

## Project-rule notes

- **Tool/capability gating**: no new tool surface; nothing is registered with the tool executor or `tool_prefs`.
- **Scope model**: no new persisted runtime state; `baseline.json`/`scores.json`/score cache remain repo-committed CI artifacts keyed by repo-relative file paths.
- **DB**: none.
- **Dependencies**: none — the need is plain JSON shape + shared TypeScript guards; the existing stack covers it.
- **Module reuse**: extends `scripts/mutation/baseline.ts` (existing owner of the baseline); no new module introduced.
- **Hook/TDD interactions**: the Write/Edit TDD hook pipeline does **not** gate this change's files. Its resolver (`.hooks/tdd/test-resolver.mjs` `isGateableImplFile`) accepts only `src/`, `client/`, `plugins/`, `review-loop/src/`, and `sdd-runner/src/` — `scripts/mutation/*.ts` and `mutation-improve/src/**` get no nudge or block (only the once-per-session stop hooks notice `scripts/` writes, as review reminders). `mutation-improve/AGENTS.md` claims the resolver maps `mutation-improve/src/**` to `tests/mutation-improve/**` — that contradicts the resolver code and its own test pin (`.hooks/tests/tdd/test-resolver.test.ts` pins `scripts/foo.ts` as non-gateable); do not carry that claim into `docs/architecture/commands.md` in this change. The test-first order below is therefore discipline, with CI as the hard gate: `tests/scripts/mutation/baseline.test.ts` (record guards, dual-shape parse/serialize, arithmetic validation, merge monotonicity, verdict classification), then `tests/scripts/mutation/gates.test.ts` (warnings channel, pass-with-dilution), then `tests/scripts/mutation/changed-files.test.ts` (WARN dilution log lines and the kills-rendering regression message it currently pins verbatim), then `tests/scripts/mutation/seed-from.test.ts` (rich snapshot round-trip), then `tests/mutation-improve/prompt-templates.test.ts` (prompt shape strings match the mixed-shape map), then `tests/mutation-improve/baseline.test.ts` (record-level bump, unchanged IO semantics, no-op reference identity), then `tests/mutation-improve/score-reader.test.ts` / `gate.test.ts` / `skip-ratchet.test.ts` (measurement path carries counts to the bump) — each red before its implementation edit.
