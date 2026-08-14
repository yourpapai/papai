<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Incremental mutation measurement with a whole-branch gate

## Decisions

### D1: The cache key is a hint; the fingerprint is the guard

Carried-over scores live in a content-addressed store: `sourceFile -> { fingerprint, merged,
measuredAt }`. Nothing about *where the blob came from* is trusted. A restored blob may be from
an older run, a racing run, or a run on rebased history — every entry is still checked against a
fingerprint recomputed from current state at read time, and a mismatch simply means "measure it".

This single invariant answers every transport question at once: `restore-keys` prefix matching,
cache eviction, force-pushes, rebases and overlapping runs of the same PR can all cost runtime,
and none of them can weaken the gate. It is also why the guard lives inside the cache's `get`
(taking the fingerprint as an argument) rather than in the caller — no call site can forget it.

### D2: The fingerprint hashes contents, never metadata

`scripts/test/fingerprint.ts:43-61` (`computeFingerprint`) hashes `size + mtimeMs`. Every CI
checkout is fresh, so every mtime is new — reusing it here would produce a 100% miss rate. The
new `scripts/mutation/score-fingerprint.ts` hashes bytes only, and carries a comment saying so,
because "consolidating the two fingerprint helpers" is an inviting and wrong refactor.

Inputs, in order: `SCORE_FINGERPRINT_VERSION` (bump = force a full re-measure) ∥ toolchain hash
∥ source path ∥ `sha256(source bytes)` ∥ for each candidate test, sorted: path ∥
`sha256(contents)`. An absent file hashes as `sha256('')` rather than throwing.

The candidate test universe reuses `listCandidateTests` (`scripts/mutation/coverage-map.ts:162`,
same-package dir ∪ import-scanned) unioned with the companion from
`.hooks/tdd/test-resolver.mjs` (which covers lanes `scanTestFiles` filters out) and the file's
`overrides.json` entry (which may point outside the candidate universe). This is a *superset* of
the paired test set that `resolveTestFiles` (`scripts/mutation/test-overrides.ts:42`) ends up
using, so it over-invalidates slightly — editing one test re-measures its package neighbours —
and never under-invalidates on the test side. Critically it is computable from fs reads and a
text scan, with no `bun test --coverage` spawns, so deciding what to measure is cheap.

The toolchain hash (`stryker.config.json`, `scripts/mutation/overrides.json`, `bun.lock`,
`package.json` runner versions, every `scripts/mutation/*.ts`, `.hooks/tdd/test-resolver.mjs`) is
computed once per run, not per file.

### D3: Accepted hole — transitive `src/` dependencies are not fingerprinted

Commit A changes `X` (measured 0.90, passes). Commit B changes helper `H` that `X` imports.
`X`'s own content and candidate tests are unchanged, so 0.90 is reused — even though `X`'s real
score against the new `H` might be 0.70. Today that fails; after this change it passes until `X`
is touched again.

This is narrower than it first sounds: `X` is only gated at all because it is already in the
branch diff. It is bounded by the master seed run, which always measures fresh, so the committed
`baseline.json` never inherits a stale score. It is accepted deliberately, not overlooked, and it
belongs in the ADR's Negative Consequences. If revisited, the machinery exists —
`scripts/test/import-graph.ts:63` (`resolveSpecifier`) and `:84` (`buildReverseGraph`) can supply
an N-hop src closure to fold into the fingerprint, at the cost of many more cache misses.

A second, smaller hole: `Timeout` counts in the score numerator
(`scripts/mutation/score-merger.ts:83`) and is machine-load dependent, so a lucky run's score is
pinned for the branch's life. The bias is toward passing; it is bounded by the retention window
and by any edit re-measuring. Also accepted, also documented.

### D4: Gate over the union, with a `PerFileScore`-shaped gate input

`selectChangedMutationTargets` (`scripts/mutation/changed-files.ts:86`) is untouched — the
whole-branch three-dot diff is exactly what keeps the gate whole-branch. `changedFilesRun` then
partitions those targets, calls `pairedRun` on the measure-now subset only, and combines.

A reused entry has no `testFiles` / `configPath` / `reportPath`, so it does not fit
`PairedRunFileResult` (`scripts/mutation/paired-run.ts:59-65`). Rather than synthesise fake
paths, the gate's input becomes `GateInput { merged, perFile: readonly PerFileScore[], skipped,
errored }`. `resolveRatchet` (`scripts/mutation/baseline.ts:94`) and `buildBaselineFromPerFile:48`
already take `PerFileScore`, and `PairedRunFileResult` is structurally assignable to it, so
nothing widens except `changedFilesRun`'s return type.

The aggregate uses a new `combineMergedScores` that **sums the count fields and recomputes**
`score = (killed + timeout) / scored`, exactly as `mergeReports:77-85` pools mutants. Averaging
the per-file `score` values would be wrong — and would pass a test fixture whose two files have
equal mutant counts, so the fixture must not.

Passing a narrow measure-now list has a second payoff: `pairedRun` builds its coverage map from
exactly the files handed to it (`scripts/mutation/paired-run.ts:234`), so the expensive per-test
`bun test --coverage` prelude is skipped for everything reused. When the measure-now list is
empty, `pairedRun` is not called at all.

### D5: Invariants that keep "faster" from becoming "weaker"

- **Errored and skipped files are never recorded.** Neither produces a `perFile` entry, so
  neither can be reused into a pass; `resolveErroredGate` (`scripts/mutation/changed-files.ts:218`)
  keeps failing the run and the next push retries them.
- **The cache is written before gating,** so a *failing* run still persists what it measured.
  This is the mechanism that makes commit A's regression survive into commit B's run — without
  it the feature does not work at all.
- **`--update-baseline` disables reuse entirely,** so the committed baseline is only ever seeded
  from a fresh measurement. Pinned by a test, because a future refactor could silently leak
  reused scores into the ratchet floor.
- **`--no-score-cache`** is the operator escape hatch for re-validating a suspicious green.
- **The cache file is written unconditionally,** including the zero-target early return
  (`scripts/mutation/changed-files.ts:147-150`), so the CI save step always has a path.
- **No read-side TTL.** The fingerprint is exact; retention (~30 days) is write-side size
  control only.

### D6: CI transport — `actions/cache`, saved even when red

`actions/cache/restore` before the run and `actions/cache/save` after it, both SHA-pinned
(dependabot's `patterns: '*'` already covers new actions). Key
`mutation-scores-v1-<pr>-<sha>-<run_id>` with `restore-keys: mutation-scores-v1-<pr>-`: cache
entries are immutable per key, so this is unique-key-write plus newest-prefix-restore.

Two attributes on the save step are load-bearing rather than hygiene:

- `if: always()` — a failing run must still persist its scores, per D5.
- `continue-on-error: true` — fork PRs run with a read-only token and the save will fail. A
  cache save must never turn a green gate red.

The workflow concurrency group is keyed on `pull_request.head.sha` (`.github/workflows/ci.yml:12-14`),
so successive pushes do **not** cancel each other and two runs of the same PR can overlap. The
loser's entries are simply absent from the winner's blob, which costs a re-measure on a later
push and self-heals; `actions/cache` restores exactly one entry, so merging caches is not an
option and is not needed.

`reports/paired/coverage-map.cache.json` rides in the same cache entry — it is content-keyed with
a 24h TTL (`scripts/mutation/coverage-map.ts:121`) and is cold on every runner today, so this is
a free second speedup. The master `mutation-baseline` job gets **no** score cache. Optionally, as
a later phase, it may publish *only* the coverage map under a `mutation-scores-v1-master-` prefix
for PRs to fall back to on a cold start; publishing scores from master would be pointless, since
a PR-diffed file differs from master's content by definition.

### D7: Alternatives rejected

- **Gate only the since-last-push diff.** The anti-pattern this whole change exists to avoid: it
  loses commit A's regression the moment commit B touches something else.
- **Commit scores to the branch.** Turns a PR gate into a write path and lets an author
  self-seed a passing score — the same objection that rejected Option 3 in ADR-0342.
- **`upload-artifact` from the previous run.** Needs an API call plus run-lookup logic to find
  the previous run; `restore-keys` gives "newest on this ref" for free.

### D8: Scope, DB, gating, hooks, line budget

No persisted product state, no drizzle migration, no scope-model impact (nothing keyed by
storage context, config context, platform instance or user), no capability or `tool_prefs`
surface, no settings UI. This is CI tooling under `scripts/` and `.github/`.

Hook/TDD: `scripts/mutation/**` is outside the Write/Edit TDD hook's gateable-impl set
(`.hooks/tdd/test-resolver.mjs:22` covers `src/`, `client/`, `plugins/`, `review-loop/src/`,
`sdd-runner/src/`), so new files here are not hook-gated — but the work is still ordered
test-first by choice, because the headline scenario is the acceptance criterion.

Line budget is binding, not stylistic: oxlint runs `categories.pedantic: error`
(`.oxlintrc.json:5-10`) with `max-lines` disabled only under the `tests/**` override (`:52-57`),
and `scripts/mutation/changed-files.ts` is at 297 of 300. Hence the extraction of `gates.ts`
alongside the new modules, with `reportGates` becoming a pure
`resolveChangedFilesGates(...) -> { exitCode, message }` and `console.error` hoisted to `main` —
which also makes the headline scenario testable without driving `main`.
