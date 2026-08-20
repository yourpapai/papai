<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Paired mutation runner

Fast, accurate mutation testing per file. Built around the observation that
`@hughescr/stryker-bun-runner`'s eager-import preload puts ~77% of mutants into
the `static` bucket, which `ignoreStatic: true` then discards (see
`docs/research/2026-05-24-mutation-measurement-and-test-quality-findings.md`).

This tool pairs each source file with the **test set that actually exercises it**
(via `bun.testFiles`) and runs Stryker with `ignoreStatic: false`. The test set
is built per batch from a coverage map (see `scripts/mutation/coverage-map.ts`)
and falls back to the companion when no covering test is found. Because the
test set stays small, the accurate mode is cheap.

## Commands

```bash
# Measure the full configured Stryker mutate scope:
bun test:mutate

# Measure specific files on demand:
bun test:mutate:file src/providers/kaneo/label-resource.ts src/tools/update-status.ts

# Measure everything changed vs origin/master (also used by CI):
bun test:mutate:changed

# Re-measure everything, ignoring carried-over scores:
bun test:mutate:changed --no-score-cache

# Optional threshold (exit 1 below it):
bun test:mutate --threshold=0.6
bun test:mutate:file src/foo.ts --threshold=0.6
bun test:mutate:changed --base=origin/master --threshold=0.6

# Show raw Stryker output while still writing paired JSON reports:
bun test:mutate:file src/foo.ts --verbose
```

Default output is concise: paired runs hide raw Stryker reporter chatter and
print per-file plus aggregate summaries from JSON. Add `--verbose` to stream raw
Stryker output. Per-file Stryker JSON reports land in `reports/paired/`.

A file whose Stryker run fails (dry-run timeout, crash, or missing report) is
recorded as errored and excluded from the aggregate score; the run continues so
one bad file never aborts the batch. Errored files appear in the summary as
`errored=N` and carry the captured failure message for diagnosis.

The Stryker binary is resolved by walking up from the working directory to the
nearest ancestor `node_modules/.bin` (`scripts/mutation/stryker-bin.ts`,
mirroring bun's own module resolution), so runs work from nested git worktrees
that have no `node_modules` of their own — e.g. `mutation-improve`'s iteration
worktrees — as long as an ancestor checkout has dependencies installed.

## Test-set resolution

For each source file, `pairedRun` resolves the test set in this priority:

1. **Coverage-derived set (primary)** — per batch, `pairedRun` builds a
   `{sourceFile -> [covering testFiles]}` map via `buildCoverageMap`
   (`scripts/mutation/coverage-map.ts`). For each source, the candidate
   universe is `direct-import tests ∪ same-package tests`:
   - _Direct-import tests_ — tests whose source text references the impl path
     (mirrors `.hooks/tdd/test-resolver.mjs`'s `testFileImportsImpl`).
   - _Same-package tests_ — every test under the source's companion package
     directory (e.g. `src/chat/mattermost/file-helpers.ts` → all
     `tests/chat/mattermost/*.test.ts`). This catches transitive coverage where
     a same-package `index.test.ts` exercises the impl through a re-exporting
     barrel rather than importing it directly.

   Each candidate is then run once with `bun test --coverage` (lane-aware, see
   `scripts/mutation/coverage-runner.ts`): tests under `tests/client/**` run
   with the `test:client` preset (`--conditions=browser --preload
./tests/client-setup.ts --path-ignore-patterns ''`) because bunfig's
   `pathIgnorePatterns` otherwise hides them from discovery; `tests/e2e/**` and
   `tests/stories/**` are excluded from the candidate universe entirely (Docker
   / sandboxed story runner — not spawnable per-file). The source is
   attributed the candidates whose lcov shows `lines-hit > 0`. A 24h
   content-keyed cache (`reports/paired/coverage-map.cache.json`) amortizes
   coverage runs across batches; the cache never throws — a malformed file or
   entry is treated as a miss — and failed runs are never cached, so transient
   spawn failures stay retryable.

2. **Overrides (additive)** — `scripts/mutation/overrides.json` is unioned onto
   the coverage-derived set (or used alone if no covering test was found). Use
   this as the escape hatch for cross-cutting suites the heuristics miss:
   ```json
   {
     "src/providers/factory.ts": ["tests/llm-orchestrator.test.ts", "tests/commands/context.test.ts"]
   }
   ```
3. **Companion (fallback)** — when no covering test was found AND no override
   is registered, the companion from `.hooks/tdd/test-resolver.mjs` is used:
   - `src/foo/bar.ts` -> `tests/foo/bar.test.ts`
   - `client/debug/x.ts` -> `tests/client/debug/x.test.ts`
   - `plugins/task-provider-kaneo/foo.ts` -> `tests/plugins/task-provider-kaneo/foo.test.ts`
   - `review-loop/src/foo.ts` -> `tests/review-loop/foo.test.ts`

A source with no covering test, no override, and no companion is skipped with
a warning — fix it by adding a companion test, registering a cross-cutting
override, or widening the candidate heuristics in `coverage-map.ts`.

## Command mapping

- `bun test:mutate` — accurate full paired run over the configured
  `stryker.config.json` `mutate` scope.
- `bun test:mutate:changed` — accurate paired run over files changed vs the
  selected base branch. The CI gate uses this command.
- `bun test:mutate:file` — accurate paired run for explicitly listed files.
- `bun test:mutate:changed-paired` — descriptive alias for
  `bun test:mutate:changed`.

## Generated modules are not targets

`test:mutate:changed` drops anything under a `generated/` directory. Stryker instruments the file
it mutates inside its sandbox, so a test that reads its own implementation's source text off disk
compares against the instrumented copy and fails the **initial, unmutated** run — which aborts the
file with a `ConfigError` and lands in the gate as `errored`, not as a score.
`tests/analytics/tool-slug-generation.test.ts` reads
`src/analytics/generated/tool-slugs.ts` on purpose, to prove the checked-in bytes still match a
fresh generation; that drift guard is worth more than a mutation score on a file whose content
comes from a generator anyway. Without the exclusion, every PR that adds a tool — and so
regenerates the slug table — fails this gate on a file it never hand-wrote.

## Incremental measurement (carried-over scores)

A run measures only the files whose content changed since the previous run on the same branch —
but it **gates the whole branch diff every time**. Files it did not measure contribute scores
recorded by an earlier run, so a drop introduced in one commit keeps failing later pushes that
touch nothing near it. Measuring incrementally and gating incrementally are different things;
only the first one is safe.

A recorded score is reused only when a fingerprint matches exactly:

- the source file's bytes;
- the paths **and** bytes of its candidate test universe — the companion, the coverage-map
  candidates (same-package directory ∪ import-scanned), and any `overrides.json` entry. This is
  a superset of the test set actually paired with the file, so it over-invalidates a little and
  never under-invalidates;
- a toolchain hash over `stryker.config.json`, `scripts/mutation/overrides.json`, `bun.lock`,
  `package.json`, every `scripts/mutation/*.ts`, and `.hooks/tdd/test-resolver.mjs`.

Contents are hashed, never size or mtime — `scripts/test/fingerprint.ts` deliberately does the
opposite for a different purpose, and reusing it here would miss on every entry because each CI
job checks the repository out fresh. The recorded baseline is deliberately _not_ an input: when
a merge raises a file's floor, the carried-over score is re-judged against the new floor.

**Not tracked:** a change to a `src/` helper the file imports. Its score is carried over even
though the real score may have moved. Bounded by the master seed run, which always measures
fresh — see [ADR-0424](../../docs/adr/0424-incremental-mutation-measurement-with-whole-branch-gate.md).

Scores live in `reports/paired/score-cache.json`, which CI carries between pushes via
`actions/cache`. The save step runs with `if: always()`, because a _failing_ run must still
persist what it measured — otherwise the next push re-measures the regression from scratch and
the gate forgets it. Reads fail open: a missing, malformed or foreign cache simply measures
everything, exactly as before this existed.

Each run prints the split, so a green run is legible as whole-branch rather than partial:

```
Whole-branch mutation targets: 22 file(s) — measured now: 3, reused: 19
  reused src/context-vault/push-route.ts: score 0.6812 (measured 2026-08-13T20:51Z)
```

Two ways to force a full re-measure: pass `--no-score-cache` (also implied by
`--update-baseline`, so a committed floor is only ever seeded from a fresh measurement), or bump
`SCORE_FINGERPRINT_VERSION` in `scripts/mutation/score-fingerprint.ts`. On the CI side, bumping
the `mutation-scores-v1` key prefix in `.github/workflows/ci.yml` does the same.

Files whose run **errored** or was **skipped** are never recorded, so they stay retryable and an
unmeasurable file can never be carried over into a pass.

## Ratchet gate (`scripts/mutation/baseline.json`)

A committed per-file baseline of mutation scores backs a monotonic ratchet:

- **PR gate** (`test:mutate:changed`): a changed file fails only when it has a
  recorded baseline entry and its score drops below it. Files with no baseline
  entry (new or never-baselined) are not regressions — the gate is
  regression-only, so the overall score ratchets upward as files improve without
  blocking routine work on currently-low-scoring or newly-added code. Disable
  with `--no-ratchet`.
- **Master seed** (`test:mutate:changed --base=HEAD~1 --update-baseline`): on
  push to `master`, the CI `mutation-baseline` job measures the files changed
  since the previous master commit and merges them into `baseline.json` via
  `seedMerge`, which takes the per-key max and PRESERVES existing entries
  (unlike the full-run `ratchetMerge`, which drops keys no longer in scope).
  First-touch files — new or never-baselined — get seeded after merge, so the
  baseline accumulates floors for every touched file over time. The committed
  baseline is the floor the PR gate enforces. The run also writes its per-file
  scores to `reports/paired/scores.json` so the commit step can re-seed without
  re-running Stryker. The scores file is always written — even when the run
  measured no gateable files (e.g. a docs- or scripts-only merge) — so the
  commit step no-ops gracefully instead of failing on a missing artifact.
- **Commit-step re-seed** (`test:mutate:seed --scores=reports/paired/scores.json
[--fresh-base=SHA]`): master can move while mutation testing runs (e.g. a
  release bump push), which would reject a naive push and lose the seed. The CI
  commit step instead loops: reset to the fresh `origin/master`, re-apply the
  persisted scores via `seedMerge` (per-key max, so retries never conflict and
  never lose entries from concurrent seeds), commit, push. `--fresh-base` drops
  scores for files that changed on master since the run's checkout, so a score
  is never recorded for content master no longer has; those files are seeded by
  the commit that changed them.

Re-generate the baseline from scratch (discards history) by deleting
`scripts/mutation/baseline.json` and running `bun test:mutate --update-baseline`
(a full run; its `ratchetMerge` drops keys no longer in scope, which is what you
want when rebuilding).

### Migration (one-time catch-up)

The first master run after the changed-files seed shipped measures and seeds
every recently-changed unbaselined file at once — expect a large one-time
`baseline.json` diff; this is expected and correct. Existing companion-only
baseline entries (measured against the companion test set alone, often an
undercount) ratchet upward as their files are re-measured on later master runs
with coverage-derived test sets.
