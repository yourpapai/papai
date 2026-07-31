<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0301: Hermetic Story Harness Hygiene Batch — Catalog Stamps, Windows Fail-Closed, Sandbox Image Single-Sourcing, Dependency-Cache Eviction, and Compatibility-Proof Documentation

## Status

Implemented (with divergence)

## Date

2026-07-19

## Context

The `codex/hermetic-e2e-harness` branch analysis (2026-07-19) found the hermetic story harness (`tests/stories/harness/`, `scripts/story/**`, the scenario catalog) mechanically sound — sandboxed runs green, the compatibility gate verified, a real production bug caught — but flagged six hygiene findings that eroded trust in its evidence or left the branch unmergeable as-is. The design (`docs/superpowers/specs/2026-07-19-harness-hygiene-design.md`) and plan (`docs/superpowers/plans/2026-07-19-harness-hygiene.md`) consolidated them into a batch of eight small, independently committable fixes that change **no story behavior, scenario counts, or the sandbox boundary**:

1. **Stranded documentation** — ADR-0225 and its `docs/adr/README.md` row were uncommitted working-tree drift, and an unrelated `.opencode/package.json` bump was riding the branch.
2. **Inaccurate `verifiedAt` stamps** — `tests/stories/catalog/coverage.ts` blanket-stamped every record `'2026-07-13'` via a single literal-locked type field and one shared constant, including settings records added 2026-07-18. Per-record dates had to be carried so a record's stamp reflects when its coverage was actually verified.
3. **Unmapped unambiguous core story** — `tests/stories/context/guest-readonly.story.test.ts` is an exact semantic match for `SCN-task-guest-readonly`, yet the catalog id still read `pending`. (The other three core stories are only partial matches and were explicitly deferred to the coverage-roadmap audit.)
4. **Windows honesty** — the README and `docs/architecture/commands.md` claimed Windows support via Docker Desktop, but `resolveLinuxStorySandboxUser` requires `process.getuid`/`getgid`, so Windows hosts always failed with a cryptic error. Decision (confirmed during design): correct the documentation and fail closed with an actionable error; do not build Windows support now.
5. **Duplicated pinned image digest** — the sandbox image reference was hardcoded in five places (`scripts/story/sandbox.ts` plus twice each in `.github/workflows/ci.yml` and `story-stress.yml`); a bump was a five-file edit and drift was invisible.
6. **Unbounded dependency cache** — `~/.cache/papai-story-dependencies` grew ~1.2 GB per lockfile/platform change with no eviction.
7. **`user_identity_mappings` scoping footgun** — `scoped-context-owned-columns.ts` listed the table `threadScoped: true`, contradicting the `'user'` scope in `context-scope.ts`; research traced it as immutable migration history, so the fix is an annotation plus a ratchet test, not a removal.
8. **Implicit seam-API contract** — the compatibility proof freezes harness bytes, but the harness consumes production DI seams, so the proof is behavioral + seam-API, a fact that was implicit and undocumented.

Coverage expansion is explicitly out of scope and handled by a separate program (`2026-07-19-story-coverage-expansion-roadmap-design.md`); real Windows support is a tracked follow-up.

## Decision Drivers

- **Trust the evidence; do not change behavior.** Every fix must leave the 40-scenario suite and the sandbox boundary identical, so the harness's regression-gate credibility is preserved. The frozen-tree rule (`tests/stories/**` and `scripts/story/**` are frozen compat inputs) means edits there require a fresh baseline manifest.
- **One unambiguous catalog mapping; defer judgment calls.** Only map a core story when it is an exact semantic match (`SCN-task-guest-readonly`); partial matches (`create-and-read-task`, `thread-scope`, `group-users`) stay pending for the roadmap audit rather than being force-mapped.
- **Fail closed with an actionable error; correct the docs, do not build it.** Windows support is refused explicitly at `selectStorySandboxBackend` with a message naming the POSIX-uid requirement and the follow-up, replacing a cryptic `getuid` failure; documentation is corrected to match the implementation rather than the implementation broadened.
- **Single-source the digest; drift fails CI.** The pinned OCI image reference moves to one checked-in file that is both a frozen enforcement input (so the sealed snapshot captures it) and the single read site for runner + both workflows, with a contract test asserting agreement.
- **Best-effort, fail-safe cache GC.** Pruning keeps the newest three entries by mtime plus the just-acquired key, is overridable via `PAPAI_STORY_DEPENDENCY_CACHE_KEEP`, and never fails a run — a cache housekeeping problem must not block testing.
- **Annotate immutable history; ratchet the rule.** Where a stale `threadScoped` entry is consumed only by historical migrations, annotate it with the pointer to migration 067/068 and the `'user'`-scope declaration, and add a ratchet test that fails if a *future* user-scoped table re-enters the context-owned list.
- **Make the seam-API contract explicit.** Document the consumed DI seams so a refactorer knows the TypeScript shapes they must preserve (or land on master before baselining).

## Considered Options

### Option 1 — Eight-fix hygiene batch: annotate-not-remove, single-source, fail-closed, best-effort prune, document the seam contract (chosen)

Commit the stranded ADR and revert the unrelated `.opencode` drift; restructure the catalog mapping into one per-record-dated table and add the guest-readonly mapping; correct the README/commands docs and make `selectStorySandboxBackend('win32')` throw an actionable error; single-source the digest in a checked-in frozen file read by runner and workflows; prune the dependency cache best-effort after each acquire; annotate the historical identity entry and ratchet the user-scope rule; document the seam-API contract in `commands.md` with a pointer from `tests/CLAUDE.md`.

- **Pros:** preserves all behavior and the sandbox boundary; every fix is independently verifiable and reversibly small; the catalog dates, image source, and seam contract become self-consistent sources of truth; the cache stops growing unbounded; the Windows failure mode becomes diagnosable instead of cryptic.
- **Cons:** touches the frozen tree (`scripts/story/sandbox.ts`, `inputs.ts`) and `tests/stories/catalog/coverage.ts`, forcing a baseline re-record; the seam contract documentation raises the bar a refactor must clear; an annotation leaves a stale-looking entry in place rather than removing it.

### Option 2 — Defer the whole batch to the coverage-roadmap audit (rejected)

Roll all six findings into the separate coverage-expansion program's audit deliverable and ship the branch as-is.

- **Pros:** smallest immediate diff; the unmergeable docs and the `.opencode` drift are the only blockers, and those could be committed alone.
- **Pros:** keeps the harness tree untouched, avoiding the baseline re-record.
- **Cons:** the branch ships with dishonest documentation (Windows), a five-way-duplicated digest, an unbounded cache, and an implicit seam contract — every one of which erodes the evidence the harness exists to produce. The coverage roadmap is a different concern (new scenarios); conflating hygiene with expansion delays the fixes and couples unrelated work.

### Option 3 — More invasive: build real Windows support, remove the stale identity entry, aggressively re-baseline (rejected)

Implement Windows UID:GID synthesis so `linux-docker` runs on Windows; delete the `user_identity_mappings` entry outright; re-baseline on every concurrent change.

- **Pros:** maximally "correct" end state — no unsupported host, no stale entry, always-fresh baseline.
- **Cons:** real Windows support is a large, out-of-scope feature (tracked follow-up); deleting the identity entry breaks the historical migrations that consume it (043/051), so the researched fallback (annotate) is mandatory; re-baselining on every concurrent change forfeits the compat gate's value as a regression signal. Each invasive move either exceeds the batch's scope or contradicts its research outcome.

## Decision

The chosen Option 1 shipped across the catalog, the sandbox launcher, the dependency cache, the scope-consistency test, and two documentation surfaces. What shipped:

1. **Catalog mapping restructured and date-stamped.** `tests/stories/catalog/coverage.ts` replaces the `ACP_COMMAND_STORY_IDS` / `QUALIFICATION_STORY_IDS` constants and the `executableStoryIdsFor` function with a single `EXECUTABLE_STORY_MAPPINGS` table whose each entry carries its real `verifiedAt` (ACP entries `2026-07-13`, settings entries `2026-07-18`); the `CatalogCoverage` type widened `verifiedAt` from the literal `'2026-07-13'` to `string`. `SCN-task-guest-readonly` is mapped to its executable story with `verifiedAt: '2026-07-19'`.
2. **Windows fail-closed with an actionable error.** `scripts/story/sandbox.ts` `selectStorySandboxBackend` rejects `win32` with a message naming the POSIX host uid/gid requirement and the commands-doc pointer, replacing the cryptic `getuid` failure; the unsupported-platform fallthrough is preserved.
3. **Pinned image single-sourced.** `scripts/story/sandbox-image.txt` is the one checked-in digest; `sandbox.ts` loads it via `loadStorySandboxLinuxImage` at module load and exports `STORY_SANDBOX_LINUX_IMAGE`; `scripts/story/inputs.ts` `isFrozenEnforcementPath` matches `sandbox-image.txt` so the sealed snapshot captures it; both GitHub workflows read it via `cat scripts/story/sandbox-image.txt`; the commands documentation points at the file instead of inlining the digest.
4. **Dependency-cache eviction.** Best-effort pruning after every successful acquire keeps the newest three entries by directory mtime plus the just-acquired key; `resolveDependencyCacheKeep` reads `PAPAI_STORY_DEPENDENCY_CACHE_KEEP` (positive integers only, else default 3); pruning swallows errors to a `warn` and never fails the run.
5. **Historical identity-scoping entry annotated and the user-scope rule pinned.** `src/db/migrations/scoped-context-owned-columns.ts` annotates the `user_identity_mappings` entry with the pointer to migrations 043/051 and the cleanup migration and the `'user'`-scope declaration; a ratchet test in `tests/chat/context-scope-consistency.test.ts` fails if any non-grandfathered user-scoped table is context-owned.
6. **Seam-API contract documented.** `docs/architecture/commands.md` records that the compatibility proof is behavioral + seam-API and enumerates the consumed seams (`createPapaiRuntime`, `createProductionRuntimeDeps`, the `web.route` / `application.setupBot` / `buildModel` / `capabilities.resolve` DI points, the capability-catalog contract); `tests/CLAUDE.md` carries the pointer.

## Consequences

### Positive

- The catalog's `verifiedAt` is now per-record and truthful: a record's stamp reflects when its coverage was verified, not a blanket constant, so the coverage ledger is a trustworthy audit trail.
- The pinned sandbox image is a one-file edit; the runner, both workflows, and the documentation all agree by construction, and a contract test makes drift fail CI. The file is a frozen enforcement input, so the sealed session snapshot captures it and the sandboxed child loads it from the read-only copy.
- Windows hosts get a diagnosable, actionable failure instead of a cryptic `getuid` crash, and the documentation no longer claims support that does not exist.
- The dependency cache stops growing unbounded; pruning is best-effort and overridable, and a cache housekeeping fault never blocks a test run.
- The stale `user_identity_mappings` scoping entry is documented in place with its migration-history rationale, and a ratchet test guards against the footgun recurring for new tables.
- The compatibility proof's seam-API dimension is explicit, so a refactorer knows the TypeScript shapes they must preserve or land on master before baselining.

### Negative

- **The frozen tree was edited**, so a fresh baseline manifest must be recorded (the plan's Task 8) and the branch's HEAD becomes the new compat baseline ref; a baseline recorded before these changes will (correctly) report `scripts/story/sandbox-image.txt` as added and `scripts/story/sandbox.ts` / `inputs.ts` as changed.
- **The catalog type widened** (`verifiedAt: string`, plus the concurrent `provingTier` / `audit` fields), so any consumer that relied on the literal `'2026-07-13'` type narrowing must adjust; the contract test is the new source of truth for the date invariants.
- **Windows remains unsupported.** The fix is honesty plus a better error, not support; real Windows execution is a tracked follow-up that requires a UID:GID synthesis strategy.

### Risks

- **Best-effort pruning can mask a real cache fault.** Because pruning swallows errors to a `warn`, a persistent permission or disk failure silently leaves the cache unbounded; the trade is that testing is never blocked by housekeeping. The warn is observable in logs for diagnosis.
- **The ratchet test only bites on future additions.** The grandfathered set is an allow-list; a new user-scoped context-owned table that *should* be there would fail the test until explicitly grandfathered, which is the intended friction but can read as a false positive.
- **The seam-API documentation raises the refactor bar.** Listing the consumed seams makes a previously-implicit constraint enforceable by review; a refactor that legitimately reshapes a seam must now land on master before the baseline is recorded or it breaks the compat proof by design.

## Related Decisions

- [ADR-0284](0284-scenario-catalog-hermetic-stories.md) — Scenario Catalog Hermetic Story Coverage Ledger: established the `catalogCoverage` / `CatalogCoverage` structure and the coverage ledger this ADR's Task 2 refines (per-record `verifiedAt`, the unified mapping table, the guest-readonly mapping). The `provingTier` and `audit` fields that now sit alongside the date stamps are 0284's tier-aware-ledger evolution, not this batch.
- [ADR-0225](0225-hermetic-story-execution-docker-sandbox.md) — Hermetic Story Execution — Docker-Only OS Sandbox with Immutable Snapshots: established the Docker-only `linux-docker` launcher and the sealed-snapshot model whose launcher this ADR's Tasks 3 and 4 harden (Windows fail-closed, image single-sourcing as a frozen input).
- [ADR-0286](0286-hermetic-story-docker-all-hosts.md) — Docker-Only Hermetic Story Execution on All Supported Hosts: recorded the `win32` throw as an open divergence/follow-up in its own Implementation Notes; this ADR's Task 3 resolves that follow-up by making the Windows rejection explicit and the documentation honest.
- [ADR-0282](0282-hermetic-e2e-master-baseline.md) — Hermetic E2E Master Baseline — Shared Lifecycle Runtime and Story Harness: established the frozen-tree compatibility proof whose inputs this ADR extends (`sandbox-image.txt` as a frozen enforcement input) and whose seam-API contract this ADR's Task 7 documents.
- The sibling story-family coverage batch — [ADR-0293](0293-settings-story-family.md) (settings), [ADR-0297](0297-f1-command-meta-story-family.md) (F1 command/meta), [ADR-0298](0298-f2a-task-lifecycle-story-family.md) (F2a task lifecycle), [ADR-0299](0299-f2b1-task-provider-surface-story-family.md) (F2b-1 provider surface), [ADR-0300](0300-f2b2-task-integration-surface-story-family.md) (F2b-2 integration surface) — filled `EXECUTABLE_STORY_MAPPINGS` far beyond the ~30 records this batch's plan specified, which is why the shipped table and contract-test counts are an order of magnitude larger than the plan's (see Implementation Notes).
- [ADR-0054](README.md) and [ADR-0057](README.md) — Guardrail-First Mock Isolation and Incremental Dependency Injection for Test Isolation: the test-harness hygiene lineage this batch continues (referenced via the index; 0054/0057 source files were pruned with the 0001-0100 batch).

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `tests/stories/catalog/coverage.ts:88-103` | `CatalogCoverage` union — `verifiedAt: string` (widened from the literal `'2026-07-13'`); executable arm carries `provingTier`, pending arm carries `audit: AuditRecord` (both concurrent tier/audit additions, see notes). | `read` confirms. |
| `tests/stories/catalog/coverage.ts:309-316` | `ExecutableStoryMapping` type (`{ verifiedAt: string; provingTier?; storyIds }`) replacing the plan's `ACP_COMMAND_STORY_IDS` / `QUALIFICATION_STORY_IDS` / `executableStoryIdsFor`. | `read` confirms. |
| `tests/stories/catalog/coverage.ts:316-1160` | `EXECUTABLE_STORY_MAPPINGS` — single per-record-dated table; ACP entries stamp `2026-07-13`, settings entries stamp `2026-07-18`; `SCN-task-guest-readonly` mapped at `2026-07-19` (`:497-502`). Shipped table holds ~140 executable records vs the plan's ~30 (concurrent coverage expansion). | `read` confirms. |
| `tests/stories/catalog/coverage.ts:1281-1305` | `catalogCoverage` builder reads `EXECUTABLE_STORY_MAPPINGS[scenarioId]`; pending branch stamps `verifiedAt: '2026-07-19'` (the plan specified `'2026-07-13'`, see notes) and carries `audit` instead of the plan's `reason`/`requiredSeam`. | `read` confirms. |
| `tests/stories/harness/catalog-coverage.test.ts:197-216` | Contract tests: settings coverage dated `2026-07-18` (MCP subset `2026-07-22`), `SCN-task-guest-readonly` mapped with `provingTier: '0'` / `verifiedAt: '2026-07-19'`, executable total `140` (plan asserted `11` settings / total `30`; counts grew with the coverage batch). | `read` confirms. |
| `scripts/story/sandbox.ts:25-33` | `selectStorySandboxBackend('win32')` throws the actionable unsupported-host error; unsupported-platform fallthrough preserved. | `read` confirms. |
| `scripts/story/sandbox.ts:35-41` | `loadStorySandboxLinuxImage` reads `sandbox-image.txt` at load and exports `STORY_SANDBOX_LINUX_IMAGE`; no hardcoded digest in the module. | `read` confirms. |
| `scripts/story/sandbox-image.txt` | The single-sourced pinned digest (`docker.io/oven/bun:1.3.13@sha256:…`). | `glob` + `read` confirm. |
| `scripts/story/inputs.ts:18-20` | `isFrozenEnforcementPath` matches `scripts/story/(*.ts|sandbox-image.txt)` — the image file is a frozen enforcement input. | `read` confirms. |
| `scripts/story/dependencies-cache.ts:70-108` | `resolveDependencyCacheKeep` (default 3, positive-int override) and `pruneDependencyCacheEntries` (keep-newest-by-mtime + current key, HASH filter excludes staging, errors swallowed to `warn`). Lives in a **separate module**, not inline in `dependencies.ts` (see notes). | `read` confirms. |
| `scripts/story/dependencies.ts:24,44-45,248-256` | Imports/re-exports the prune API; `acquireStoryDependencySnapshot` delegates to `acquireSnapshotEntry` then calls `pruneDependencyCacheEntries` (the plan's exact wrapper refactor). | `read` confirms. |
| `tests/scripts/story-dependency-cache-prune.test.ts` | Keep-resolution + pruning unit tests (default/override, keep-limit, staging exclusion). | `glob` confirms. |
| `tests/scripts/story-sandbox-image.test.ts` | Digest-agreement contract test (file ↔ export ↔ both workflows ↔ docs). | `glob` confirms. |
| `tests/scripts/story-sandbox.test.ts:150` | win32 rejection assertion matching the actionable error message. | `grep` confirms. |
| `src/db/migrations/scoped-context-owned-columns.ts:30-34` | Annotation above `user_identity_mappings` explaining the 043/051 rewrite, the `'user'`-scope keyspace, and the cleanup migration; entry left in place (annotate-not-remove). | `read` confirms. |
| `tests/chat/context-scope-consistency.test.ts:32-39,54-56` | `GRANDFATHERED_USER_SCOPED_OWNED` set + ratchet test "no user-scoped table beyond the grandfathered entries is context-owned". Set holds **two** entries, not the plan's one (see notes). | `read` confirms. |
| `docs/architecture/commands.md:31` | Hermetic-qualification paragraph: image digest single-sourced in `sandbox-image.txt`; "Linux, and macOS via Docker Desktop; Windows is not supported yet and fails closed with an actionable error"; cache-prune sentence. | `read` confirms. |
| `docs/architecture/commands.md:48-53` | Seam-API contract paragraph enumerating `createPapaiRuntime`, `createProductionRuntimeDeps`, the `web.route`/`application.setupBot`/`buildModel`/`capabilities.resolve` DI points, and the capability-catalog contract. | `read` confirms. |
| `README.md:572-581` | Hermetic Story Tests section: image digest single-sourced; Linux/macOS supported, Windows unsupported-and-fail-closed; dependency-cache prune documented (newest 3, `PAPAI_STORY_DEPENDENCY_CACHE_KEEP`). | `read` confirms. |
| `tests/CLAUDE.md:125` | Pointer to the behavioral + seam-API proof and the consumed DI seams. | `read` confirms. |

Plan-vs-implementation notes:

- **The catalog structure was reshaped by concurrent tier/coverage work, subsuming the plan's narrow table restructure.** The plan restructured three constants into one `EXECUTABLE_STORY_MAPPINGS` and widened `verifiedAt` — both landed. But `CatalogCoverage` (`coverage.ts:88-103`) now carries a `provingTier` field on the executable arm and an `audit: AuditRecord` field on the pending arm (the plan had `reason` / `requiredSeam`), and `EXECUTABLE_STORY_MAPPINGS` holds ~140 records (the plan mapped ~30). The sibling story-family batch (ADR-0293, 0297-0300) and the tier-expansion roadmap filled the table far beyond this plan; the date-stamping and the single-table restructure this plan specified are one layer of that larger redesign. The pending branch also stamps `verifiedAt: '2026-07-19'` (`coverage.ts:1301`), not the plan's `'2026-07-13'`.
- **The catalog contract-test assertions evolved with the coverage batch.** The plan's tests asserted 11 settings records and an executable total of 30; shipped asserts 13 settings records (line 197) and an executable total of 140 (line 216), and the guest-readonly `toEqual` includes the added `provingTier: '0'` field. The date invariants the plan specified (`2026-07-18` for settings, `2026-07-19` for guest-readonly) are preserved.
- **The dependency-cache prune was extracted into its own module.** The plan added `resolveDependencyCacheKeep` / `pruneDependencyCacheEntries` inline in `scripts/story/dependencies.ts`. Shipped they live in `scripts/story/dependencies-cache.ts` and are imported/re-exported by `dependencies.ts`; the prune signature, the keep-resolution rules, the mtime-sort + current-key preservation, the HASH staging filter, and the fail-safe `warn` are all faithful to the plan. The `acquireStoryDependencySnapshot` → `acquireSnapshotEntry` + prune wrapper (`dependencies.ts:248-256`) matches the plan's refactor exactly.
- **The grandfathered user-scoped set has a second entry.** The plan's `GRANDFATHERED_USER_SCOPED_OWNED` held only `user_identity_mappings.context_id`. Shipped (`context-scope-consistency.test.ts:32`) it also holds `web_rate_limit.actor_id`, because `web_rate_limit` (`scoped-context-owned-columns.ts:54`) is `'user'`-scoped and context-owned; the test name is correspondingly plural ("grandfathered entries"). Additive — the identity entry the plan targeted is still grandfathered, and the ratchet still bites on any non-listed user-scoped table.
- **The annotation's cleanup-migration reference is inherited from the plan.** The annotation (`scoped-context-owned-columns.ts:30-34`) and the spec both say "migration 067 deletes the orphaned scoped rows"; the shipped migration performing the `DELETE FROM user_identity_mappings WHERE context_id LIKE 'pi:%:ctx:%'` is `068_identity_scoped_key_cleanup.ts`. The comment is copied verbatim from the plan, so the inaccuracy is plan-faithful, not a new divergence.

The source plan `docs/superpowers/plans/2026-07-19-harness-hygiene.md` and design `docs/superpowers/specs/2026-07-19-harness-hygiene-design.md` are archived alongside this ADR to `docs/archive/`.
