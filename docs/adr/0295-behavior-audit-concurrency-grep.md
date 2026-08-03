<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0295: Behavior Audit — Configurable Concurrency and Pure-JS Grep Replacement (Tier 2)

## Status

Implemented (with divergence)

## Date

2026-07-19

## Context

The behavior-audit pipeline (`scripts/behavior-audit/`, `bun audit:behavior`) serializes its three most LLM-intensive phases with `pLimit(1)`: Phase 2a classification (`classify.ts`), Phase 2b consolidation (`consolidate.ts`), and Phase 3 evaluation (`evaluate-runner.ts`). Only Phase 1 (`extract.ts:135`) ran concurrently, at `pLimit(4)`. At ~800 test files in scope, Phase 2a alone processes hundreds of behaviors end-to-end serialized, so the nightly Tier 1 audit (ADR-0294) was expected to spend most of its wall clock blocked on these three phases.

The `pLimit(1)` calls were not correctness requirements; they were cautious defaults that masked write-race risk in shared state. Each per-item completion did a read-modify-write on shared artifacts:

- **Phase 2a (hardest case)** — `writeClassifiedFile` is a per-test-file read-modify-write (multiple behaviors from the same test file race on the same `classified/{file}.json`), and `saveManifest`/`saveProgress` each write a single shared JSON file. The `currentManifest = result.manifest` assignment back from each task also races at concurrency > 1.
- **Phase 2b** — `writeConsolidatedFile` writes a unique file per `featureKey` (no within-phase file race); only `saveProgress` and `saveConsolidatedManifest` are shared.
- **Phase 3** — `writeEvaluatedFile` writes a unique file per `featureKey`; only `saveProgress` and `saveConsolidatedManifest` are shared.

Separately, the LLM-callable `grep` tool (`tools.ts`) was a shell-out to the system `grep` binary via `Bun.spawn` — fragile on platforms without GNU grep (BSD/macOS `grep -E` differs subtly), inconsistent with the repo's tooling conventions, and untestable without spawning real processes.

The design (`docs/superpowers/specs/2026-07-19-behavior-audit-concurrency-grep-design.md`) and plan (`docs/superpowers/plans/2026-07-19-behavior-audit-concurrency-grep-implementation.md`) — the second of three sequential tiers (Tier 1 → Tier 2 → Tier 3) — chose to remove the `pLimit(1)` serialization by (a) adding a configurable `BEHAVIOR_AUDIT_CONCURRENCY` env var (default 4), (b) refactoring shared-state writes through a per-key async mutex and a manifest-delta merge that eliminates the `currentManifest` shared-state assignment, and (c) replacing the grep shell-out with a portable pure-JS implementation backed by `Bun.Glob` and a module-level text cache.

## Decision Drivers

- **Parallelize the expensive part; serialize only the shared-state writes.** The LLM call is the wall-clock cost and touches no shared state; the read-modify-write artifacts are cheap but race. Concurrency must fan out the LLM calls while serializing writes per key, not per phase.
- **Eliminate the manifest read-modify-write race.** The `currentManifest = result.manifest` assignment is inherently racy at concurrency > 1; the fix must replace it with a per-item manifest delta merged once at phase end, so no task ever mutates shared manifest state.
- **Preserve crash-recovery granularity.** Progress is saved per item today (a crash loses at most one item's work). The refactor must keep per-item progress saves (serialized by a mutex), even though the manifest save moves to phase end.
- **Configurable, conservative default.** A single `BEHAVIOR_AUDIT_CONCURRENCY` knob (default 4, matching Phase 1) must let the operator tune down on restrictive gateways (429s) or up on private/self-hosted ones, with `CONCURRENCY=1` reproducing today's `pLimit(1)` behavior exactly.
- **Portable, testable grep.** The grep tool must produce identical output to GNU grep for the simple patterns the audit agents emit, run without spawning a process, and be testable against a synthetic fixture tree.
- **No schema/artifact/format changes.** The manifest, progress, and output artifact shapes are unchanged; Tier 2 only changes fan-out width, shared-state serialization, and the grep tool's internal implementation.

## Considered Options

### Option 1 — Per-key async mutex + manifest delta-merge + configurable `CONCURRENCY` + pure-JS grep (chosen)

Add a ~30-line per-key async mutex (`async-mutex.ts`). Each phase collects a per-item manifest delta (`{ testKey, entry }`), then merges all deltas into the starting manifest in one serial pass at phase end and saves once — eliminating the `currentManifest` shared-state assignment. Per-test-file classified writes, progress writes, and shared-manifest writes are wrapped in a keyed mutex so only same-key writes serialize. Swap `pLimit(1)` → `pLimit(CONCURRENCY)` in Phases 2a/2b/3. Replace the grep shell-out with a `Bun.Glob`-based pure-JS implementation with a module-level file-text cache.

- **Pros:** the LLM call (the expensive part) runs at full configured concurrency; shared-state races are removed by construction (deltas are immutable per item, merged once); crash-recovery granularity is preserved (progress still saves per item under the mutex); the grep tool becomes portable and unit-testable against a fixture tree; `CONCURRENCY=1` is identical to today.
- **Cons:** the manifest save moves from per-item to per-phase-end (a crash mid-phase loses that phase's manifest delta, though progress is intact so items reprocess); an extra merge pass per phase; the pure-JS grep uses `RegExp(pattern, 'u')` (Unicode), which differs from POSIX ERE on edge cases (backreferences, look-ahead).

### Option 2 — Coarse per-phase lock around all writes (rejected)

Keep per-item progress/manifest saves but guard them with a single global mutex per phase (one key) rather than per-key.

- **Pros:** simplest change — one mutex, no delta-merge refactor.
- **Cons:** does not fix the manifest read-modify-write race (each task still reads the starting manifest and returns a full manifest assigned back to shared state); a single global key serializes the cheap writes across all items, eroding most of the concurrency benefit; strictly dominated by Option 1, which serializes only same-key writes.

### Option 3 — Status quo: keep `pLimit(1)` and the grep shell-out (rejected)

Leave the three phases serialized and the grep tool shelling out to the system `grep`.

- **Pros:** no code change; zero race risk.
- **Cons:** the nightly Tier 1 audit stays dominated by these three serialized phases; the grep tool stays platform-fragile and untestable; the cautious `pLimit(1)` continues to mask rather than address the write-race surface.

## Decision

The chosen Option 1 shipped across the config knob, the new mutex helper, the three phase refactors, and the rewritten grep tool. What shipped:

1. **`CONCURRENCY` config knob.** `config.ts` exports `CONCURRENCY` (default 4); `reloadBehaviorAuditConfig` reads `BEHAVIOR_AUDIT_CONCURRENCY` and falls back to 4 on non-finite or non-positive values.
2. **`async-mutex.ts` created.** A ~25-line per-key serializer: each key chains its task onto the previous acquisition's promise (running on both success and failure, so an error does not break the chain for the next acquisition); return values propagate; distinct keys run in parallel.
3. **Phase 2a refactored (`classify.ts`).** `pLimit(1)` → `pLimit(CONCURRENCY)`; per-test-file classified writes and progress writes are wrapped in a keyed mutex; each task returns a manifest delta instead of a full manifest; deltas are merged via `mergeManifestDeltas` and the manifest is saved once at phase end. The old `currentManifest = result.manifest` assignment is gone.
4. **`classify-manifest-helpers.ts` rewritten.** `buildManifestEntry(manifest, classified, behavior)` builds an immutable `{ testKey, entry }` delta (backed by a new `toManifestEntry` helper that reads the previous entry and `phaseVersions.phase2`); `mergeManifestDeltas(manifest, deltas)` performs the single serial merge. The old `updateManifestForClassification` (which merged into a full manifest) is removed.
5. **Phase 2b refactored (`consolidate.ts`).** `pLimit(1)` → `pLimit(CONCURRENCY)`; `saveProgress` is wrapped in a keyed mutex; each task returns a `ConsolidatedManifestDelta`; deltas are merged via `mergeConsolidatedManifestDeltas` and the consolidated manifest is saved once at phase end. `writeConsolidatedFile` (unique path per `featureKey`) needs no mutex.
6. **Phase 3 refactored (`evaluate-runner.ts`).** `pLimit(1)` → `pLimit(CONCURRENCY)`; a keyed mutex serializes the failed-path `saveProgress`; successful evaluations are collected and their progress marking/reporting is applied in a separate finalize pass after all tasks complete.
7. **Grep tool rewritten as pure JS (`tools.ts`).** `makeGrepToolAt(rootAbs)` enumerates `.ts` files via `Bun.Glob` (`scanSync`), reads each through a module-level `readCached` text cache (`resetGrepCache` clears it), tests `new RegExp(pattern, 'u')` per line, formats output as `file:line:content`, caps at 100 matches, and returns error strings (not throws) on invalid regex / out-of-project directories / enumeration failure. `findFiles`, `readFile`, and `listDir` were likewise refactored to root-aware `makeAuditToolsForRoot(rootAbs)` factories; the exported `makeAuditTools()` defaults the root to `PROJECT_ROOT`.

## Consequences

### Positive

- Phases 2a/2b/3 now run their LLM calls at a configurable width (default 4, tunable via `BEHAVIOR_AUDIT_CONCURRENCY`); the shared-state write races that forced `pLimit(1)` are removed by construction (immutable per-item deltas, merged once).
- `CONCURRENCY=1` reproduces the prior serialized behavior exactly, so the existing 219-test suite remains the regression guarantee.
- The grep tool is portable (no system `grep` dependency), testable against a synthetic fixture tree, and consistent with the repo's no-shell-out tooling convention; repeated calls in one audit process hit a text cache.
- Crash-recovery granularity is unchanged: progress still saves per item under the mutex; only the manifest save is coarsened to phase end (acceptable — items are idempotent and progress is intact, so a mid-phase crash reprocesses only that phase's items).

### Negative

- **The manifest save moves from per-item to per-phase-end.** A crash mid-phase loses that phase's manifest delta (progress is intact, so the next run reprocesses those items and rebuilds the manifest). This is a deliberate, documented trade in both spec and plan.
- **Phase 3 defers successful progress marking to a finalize pass** rather than saving per item (see divergences); a crash after a successful evaluation but before finalize loses that evaluation's progress mark, requiring a re-evaluation.
- **Two of the three planned phase concurrency tests (2b, 3) were not added** (see divergences); regression coverage for the Phase 2b/3 delta-merge relies on the existing suite plus the shared `async-mutex` unit tests rather than explicit `CONCURRENCY=4` phase tests.

### Risks

- **Pure-JS grep diverges from GNU grep on edge cases.** `RegExp(pattern, 'u')` is Unicode JS regex, not POSIX ERE; they differ on backreferences, look-ahead, and some character classes. The audit agents emit simple patterns (`/config`, `function\s+createTask`), so realistic-input divergence risk is low; the grep-replacement test suite covers the realistic surface.
- **Gateway rate limits.** Default `CONCURRENCY=4` is conservative for OpenRouter/OpenAI/Anthropic; the existing per-agent retry/backoff handles transient 429s. A restrictive gateway can set `BEHAVIOR_AUDIT_CONCURRENCY=2` or `1`.
- **The per-key mutex is a correctness dependency for Phase 2a's per-test-file writes.** If the mutex failed to serialize same-key acquisitions, behaviors from the same test file would overwrite each other in `classified/{file}.json`. The `async-mutex` unit tests pin same-key serialization; the Phase 2a `CONCURRENCY=4` test pins the end-to-end behavior.

## Related Decisions

- [ADR-0294](0294-behavior-audit-close-the-loop.md) — Behavior Audit — Close the Loop (Tier 1): the sibling plan that made the audit nightly and visible on an orphan branch. Tier 1 deliberately changed zero audit-pipeline code so this Tier 2 refactor could ship independently; the `CONCURRENCY` default of 4 means Tier 1's nightly workflow needs no change to opt in (a no-op unless tuning is required).
- [ADR-0114](0114-behavior-audit-phase2-redesign.md) — Behavior Audit Phase 2 Redesign: established the Phase 2a (per-behavior classification) → Phase 2b (feature consolidation) split that this ADR parallelizes. The delta-merge refactor here preserves the phase split and artifact shapes 0114 defined.
- [ADR-0103](0103-behavior-audit-keyword-consolidation.md) — Behavior Audit Keyword Consolidation: Phase 1b embedding-based vocabulary dedup, unaffected by Tier 2 (Tier 2 does not touch Phase 1).
- [ADR-0110](0110-behavior-audit-legacy-cleanup.md) — Behavior Audit Legacy Cleanup: removed dead code before this work; Tier 2 reintroduces none.
- [ADR-0102](0102-behavior-audit-progress-reporting.md), [ADR-0107](0107-behavior-audit-progress-ux-plan-execution.md), [ADR-0109](0109-behavior-audit-hybrid-to-artifact-migration.md), [ADR-0111](0111-behavior-audit-mock-module-cleanup.md) — the broader behavior-audit family whose artifact/manifest/progress model and DI-first test conventions this refactor builds on.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `scripts/behavior-audit/config.ts:81` | `export let CONCURRENCY = 4` — the new knob. | `read` confirms. |
| `scripts/behavior-audit/config.ts:143-144` | `reloadBehaviorAuditConfig` reads `BEHAVIOR_AUDIT_CONCURRENCY`, falls back to 4 on non-finite/non-positive. | `read` confirms. |
| `scripts/behavior-audit/async-mutex.ts:8-26` | `createAsyncMutex()` — per-key chain; `prev.then(task, task)` runs the task on success and failure of the prior acquisition, keeping the chain alive; distinct keys run in parallel. | `read` confirms. |
| `scripts/behavior-audit/classify.ts:8,23` | Imports `createAsyncMutex`/`AsyncMutex` and `CONCURRENCY`. | `read` confirms. |
| `scripts/behavior-audit/classify.ts:262-263` | `const mutex = createAsyncMutex()` + `const limit = pLimit(CONCURRENCY)` — Phase 2a fan-out. | `read` confirms. |
| `scripts/behavior-audit/classify.ts:130-132` | `persistSuccessfulClassification` wraps per-test-file write (`mutex('classified:…')`) and progress (`mutex('progress')`); returns a `ManifestDelta`. | `read` confirms. |
| `scripts/behavior-audit/classify.ts:264,283-284,290-291` | Per-task deltas collected into `collectedDeltas`, then `mergeManifestDeltas(manifest, collectedDeltas)` + single `saveManifest` at phase end. | `read` confirms. |
| `scripts/behavior-audit/classify-manifest-helpers.ts:57-70` | `buildManifestEntry(manifest, classified, behavior)` — returns `{ testKey, entry }` delta (reads previous entry + `phaseVersions.phase2` via `toManifestEntry`). | `read` confirms. |
| `scripts/behavior-audit/classify-manifest-helpers.ts:72-84` | `mergeManifestDeltas(manifest, deltas)` — single serial merge into a new `tests` map. | `read` confirms. |
| `scripts/behavior-audit/consolidate.ts:214-215` | `const mutex = createAsyncMutex()` + `const limit = pLimit(CONCURRENCY)` — Phase 2b fan-out. | `read` confirms. |
| `scripts/behavior-audit/consolidate.ts:86,99` | Failed-path and success-path `saveProgress` wrapped in `mutex('progress', …)`; `writeConsolidatedFile` (unique per featureKey) unwrapped. | `read` confirms. |
| `scripts/behavior-audit/consolidate.ts:216,230-231,237-238` | Per-task `ConsolidatedManifestDelta` collected, then `mergeConsolidatedManifestDeltas` + single `saveConsolidatedManifest` at phase end. | `read` confirms. |
| `scripts/behavior-audit/consolidate-helpers.ts:157,198-200` | `ConsolidatedManifestDelta` interface + `mergeConsolidatedManifestDeltas` merger. | `read` confirms. |
| `scripts/behavior-audit/evaluate-runner.ts:8-9,218-219` | Imports mutex + `CONCURRENCY`; `collectNewEvaluations` uses `createAsyncMutex()` + `pLimit(CONCURRENCY)` — Phase 3 fan-out. | `read` confirms. |
| `scripts/behavior-audit/evaluate-runner.ts:59` | Failed-path `saveProgress` wrapped in `mutex('progress', …)`. | `read` confirms. |
| `scripts/behavior-audit/evaluate-runner.ts:242-264` | `finalizeCollectedEvaluations` applies `markBehaviorDone` + reporting for all successful items after `Promise.all` completes. | `read` confirms. |
| `scripts/behavior-audit/tools.ts:15-27` | Module-level `fileCache` + `resetGrepCache()` + `readCached()` text cache. | `read` confirms. |
| `scripts/behavior-audit/tools.ts:40-50` | `enumerateTsFiles` via `new Glob('**/*.ts').scanSync({ cwd, absolute: true })` (pure JS, no `grep` spawn). | `read` confirms. |
| `scripts/behavior-audit/tools.ts:95-134` | `makeGrepToolAt(rootAbs)` — `new RegExp(pattern, 'u')`, `file:line:content` output, 100-match cap, error strings on invalid regex / out-of-project / enumeration failure. | `read` confirms. |
| `scripts/behavior-audit/tools.ts:187-198` | `makeAuditToolsForRoot(rootAbs)` (root-aware factories for all four tools) + `makeAuditTools()` defaulting to `PROJECT_ROOT`. | `read` confirms. |
| `scripts/behavior-audit/tools.ts:144` | `Bun.spawn` remains only in `makeFindFilesToolAt` (`find … -name`); grep no longer spawns. | `read` confirms. |
| `scripts/behavior-audit/extract.ts:135` | Phase 1 unchanged at `pLimit(4)` (spec non-goal). | `read` confirms. |
| `scripts/behavior-audit/extract-phase1-runner.ts:202` | Per-file Phase 1 runner unchanged at `pLimit(1)` (spec non-goal). | `read` confirms. |
| `tests/scripts/behavior-audit/async-mutex.test.ts:10-63` | 5 unit tests: same-key serialization, distinct-key parallelism, return propagation, chain continues after throw, distinct keys unblocked after a throw. | `read` confirms. |
| `tests/scripts/behavior-audit/tools-grep.test.ts:19-72` | 9 grep tests against the fixture tree (cross-dir match, directory filter, no-match, invalid regex, missing directory, out-of-project, 100-cap, cache hit). | `read` confirms. |
| `tests/scripts/behavior-audit/fixtures/grep-sample/{src/bot.ts,src/commands/help.ts,tests/bot.test.ts}` | Synthetic fixture tree (3 `.ts` files). | `glob` confirms. |
| `tests/scripts/behavior-audit-config.test.ts:146-188` | `CONCURRENCY config` suite (4 tests: default 4, env override, non-finite fallback, non-positive fallback). | `read` confirms. |
| `tests/scripts/behavior-audit/phase2a.test.ts:799-800` | `runPhase2a at CONCURRENCY=4 preserves all behaviors from the same test file`. | `read` confirms. |
| `rg "pLimit\(1\)" scripts/behavior-audit/{classify,consolidate,evaluate-runner}.ts` | No `pLimit(1)` remains in the three target phases — **no matches**. | `rg` confirms. |

Plan-vs-implementation notes:

- **Phase 2b and Phase 3 concurrency tests were not added.** The plan (Task 4 Step 2, Task 5 Step 2) required a new `CONCURRENCY=4` test in `phase2b.test.ts` and `phase3.test.ts`. Only Phase 2a received its concurrency test (`phase2a.test.ts:799`). Phase 2b/3 delta-merge correctness is covered indirectly by the existing phase suites plus the `async-mutex` unit tests, not by an explicit high-concurrency phase test. Regression risk on those two phases' concurrency is higher than the plan specified.
- **`updateManifestForClassification` was deleted, not kept for backward compatibility.** The plan (Task 3 Step 2) said to keep `updateManifestForClassification` (existing tests relied on it) and add `buildManifestEntry` alongside. Shipped removed it entirely; `buildManifestEntry` (now `(manifest, classified, behavior)`) plus the new `mergeManifestDeltas` replace it. No caller remains, and the signature gained a `manifest` parameter because the entry builder needs the previous entry and `manifest.phaseVersions.phase2`.
- **`buildManifestEntry` signature changed and `mergeManifestDeltas` was added.** The plan specified `buildManifestEntry(classified, behavior)` returning `{ testKey, entry }` and an inline merge loop in `classify.ts`. Shipped, `buildManifestEntry(manifest, classified, behavior)` reads the previous entry + phase version via a new `toManifestEntry` helper (`classify-manifest-helpers.ts:20-55`), and the merge is a standalone `mergeManifestDeltas(manifest, deltas)` exported from the same module. Intent (per-item delta, single phase-end merge) preserved; the decomposition is finer than the plan.
- **Phase 2b `saveConsolidatedManifest` is saved once at phase end, not mutex-wrapped per task.** The plan (Task 4 Step 4) said to wrap both `saveProgress` and `saveConsolidatedManifest` with the mutex per task. Shipped collects deltas and calls `saveConsolidatedManifest` once after `Promise.all` (`consolidate.ts:237-238`), matching the Phase 2a delta-merge shape; only `saveProgress` is mutex-wrapped per task. This is a refinement consistent with the spec's design section 4 ("apply the same delta-merge fix"), not a regression.
- **Phase 3 defers successful progress marking to a finalize pass.** The plan/spec said to wrap `saveProgress` with the mutex per task. Shipped only the *failed* path mutex-wraps `saveProgress` (`evaluate-runner.ts:59`); successful evaluations are collected into an array and their `markBehaviorDone` + reporting are applied in `finalizeCollectedEvaluations` (`evaluate-runner.ts:242-264`) after all tasks complete. `pLimit(CONCURRENCY)` and a mutex are present as specified, but the per-item progress model for successes became a batched finalize. Crash window for a successful-but-unmarked evaluation is slightly larger than the plan implied.
- **`async-mutex.ts` uses the plan's `prev.then(task, task)` chaining, not the spec's `prev.then(() => task())`.** The plan's spelling runs the task on both fulfillment and rejection of the previous acquisition, guaranteeing the chain continues after an error; the spec's primary sketch ran the task only on success. Shipped matches the plan (the implementation source), which is the stronger contract. The function is also non-`async` (returns `next` directly) rather than `await`-ing it as the spec sketched.
- **`enumerateTsFiles` uses `scanSync`, not the async `scan` iterator.** `tools.ts:44` uses `new Glob('**/*.ts').scanSync({ cwd, absolute: true })` rather than the spec/plan's `for await (... of new Glob(...).scan(...))`. Synchronous enumeration; the file reads that follow are still async via `Promise.all`.
- **grep reads are batched with `Promise.all`, and `resolveGrepDirectoriesAt` reuses `resolveSafeAt`.** Shipped reads all enumerated files in parallel (`tools.ts:115`, `texts = await Promise.all(files.map(readCached))`) rather than the plan's sequential per-file `readCached` inside the match loop, and factors directory sandboxing through the shared `resolveSafeAt` + `relative` helper rather than the plan's inline `startsWith('..')` check. Minor; behavior preserved.
- **No `resetGrepCache` hook in `index.ts`.** The spec's primary suggestion was a small cache-clear hook from `index.ts` at audit start. Shipped relies on process restart (the spec's explicit parenthetical alternative: "each `bun audit:behavior` invocation is a fresh process"). `resetGrepCache` is still exported and used by the test suite.
- **The tools-grep test has 9 cases (not the plan's 8) and an extra "missing directory" assertion.** `tools-grep.test.ts:52-55` adds a `Error enumerating files:` case for a non-existent directory (the plan only covered out-of-project and invalid-regex error paths). Test bodies are also simplified (no `as string` cast; `startsWith` assertion for the enumeration error).
- **`BEHAVIOR_AUDIT_CONCURRENCY` was not added to the CI workflow.** The plan's Task 8 Step 3 was explicitly optional ("Add only if tuning is required"); the default of 4 applies, so the nightly workflow (ADR-0294) needs no change.

The source plan `docs/superpowers/plans/2026-07-19-behavior-audit-concurrency-grep-implementation.md` and design `docs/superpowers/specs/2026-07-19-behavior-audit-concurrency-grep-design.md` are archived alongside this ADR to `docs/archive/`.
