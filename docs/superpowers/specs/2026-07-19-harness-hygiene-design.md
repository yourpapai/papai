<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Hermetic harness hygiene batch

**Status:** approved

**Date:** 2026-07-19

## Context

The `codex/hermetic-e2e-harness` branch analysis (2026-07-19) found the harness
mechanically sound — sandboxed runs green, compat gate verified, a real production
bug caught — but flagged six hygiene findings that erode trust in its evidence or
leave the branch unmergeable as-is. This spec covers the non-coverage findings as
one batch of eight small, independently verifiable fixes. Coverage expansion is a
separate program (`2026-07-19-story-coverage-expansion-roadmap-design.md`).

None of these fixes changes story behavior, scenario counts, or the sandbox
boundary. The stories suite must show the identical 40 scenarios before and after.

## Fixes

### 1. Commit the uncommitted documentation

ADR-0225 (`docs/adr/0225-hermetic-story-execution-docker-sandbox.md`) and its
`docs/adr/README.md` row are uncommitted working-tree changes on the branch. They
become one commit: `docs(adr): record hermetic story docker sandbox decision`.

The `.opencode/package.json` / `.opencode/package-lock.json` opencode-plugin bump
is unrelated tooling drift. It is reverted on this branch and, if still wanted,
re-applied as its own commit on a separate branch.

### 2. Accurate `verifiedAt` stamps

`tests/stories/catalog/coverage.ts` stamps every record with the blanket date
`'2026-07-13'`, including settings records added on 2026-07-18. Replace the single
constant with per-record dates: ACP entries `2026-07-13`, settings entries
`2026-07-18`. The catalog contract test asserts every executable record carries a
non-empty date; no shared blanket constant remains.

### 3. Map the unambiguous core story

`tests/stories/context/guest-readonly.story.test.ts` is an exact semantic match
for `SCN-task-guest-readonly` ("guest group turns can read tasks but cannot
advertise writes") yet the catalog id still reads pending. Add the mapping to
`QUALIFICATION_STORY_IDS`. Its `verifiedAt` is the date the mapping lands:
`verifiedAt` records when coverage was verified, not when the story was
authored.

The other three core stories (`create-and-read-task`, `thread-scope`,
`group-users`) are only partial matches for their nearest catalog ids (e.g.
create-and-read does not exercise update, so it does not satisfy
`SCN-task-create-update`). Classifying them honestly requires audit judgment and
is explicitly deferred to the coverage roadmap's audit deliverable — no
force-mapping here.

### 4. Windows honesty

The README and `docs/architecture/commands.md` claim Windows support via Docker
Desktop, but `resolveLinuxStorySandboxUser` (`scripts/story/sandbox.ts`) requires
`process.getuid/getgid`, so Windows hosts always fail. Decision (confirmed during
design): correct the documentation, do not build Windows support now.

- README + `commands.md` state: Linux and macOS supported; Windows unsupported
  for now, with a tracked follow-up noted.
- `selectStorySandboxBackend` gains an explicit `win32` rejection with an
  actionable error message naming the follow-up, replacing the cryptic `getuid`
  failure. Fail-closed behavior is preserved.

### 5. Single-source the pinned image digest

The pinned sandbox image reference is currently duplicated in five places:
`scripts/story/sandbox.ts` and twice each in `.github/workflows/ci.yml` and
`.github/workflows/story-stress.yml`. Move it to one checked-in file,
`scripts/story/sandbox-image.txt`. `sandbox.ts` reads it at load; both workflows
read it via a shell step. A contract test asserts the code and both workflows
agree with the file, so a future bump is a one-file edit and drift fails CI.

### 6. Dependency-cache eviction

The sealed dependency cache (`~/.cache/papai-story-dependencies`) grows by ~1.2 GB
per lockfile/platform change with no eviction. On successful acquire, prune
entries beyond the newest 3 by entry-manifest creation time; override via
`PAPAI_STORY_DEPENDENCY_CACHE_KEEP`. Pruning is fail-safe: errors warn and never
fail the run (a cache GC problem must not block testing). Covered by unit tests
against a fake cache root, including the keep-override and prune-failure paths.

### 7. `user_identity_mappings` scoping footgun

`src/db/migrations/scoped-context-owned-columns.ts:30` lists
`user_identity_mappings` with `threadScoped: true`, contradicting the `'user'`
scope declared in `src/chat/context-scope.ts:50`. Migration 067 cleans the
orphaned rows, but the stale entry remains for fresh and upgrading databases.

This is a research-then-fix task: trace all consumers of
`scoped-context-owned-columns.ts`. Expected outcome — remove the stale
`user_identity_mappings` entry so no database ever receives scoped identity keys
again. If a consumer proves the entry is immutable migration history, annotate it
with a pointer to migration 067 and the `'user'`-scope declaration instead.
Acceptance: `context-scope.ts` and the migration column list agree, pinned by a
test that fails if `user_identity_mappings` re-enters the thread-scoped list.

### 8. Seam-API contract documentation

The compat proof freezes harness bytes, but the harness consumes production DI
seams. The proof is therefore **behavioral + seam-API**, not purely behavioral —
a fact currently implicit. Document it in `docs/architecture/commands.md`
("Hermetic story qualification" section) with a pointer from `tests/CLAUDE.md`:

- A refactor must preserve the TypeScript signatures of the consumed seams:
  `createPapaiRuntime`, `createProductionRuntimeDeps`, the `web.route`,
  `setupBot`, and `buildModel` DI points, and the capability catalog contract.
- Seam-shape changes must land on master _before_ a baseline is recorded,
  because candidate-side harness changes are forbidden by the frozen-tree rule.
- The exact override points in `tests/stories/harness/world.ts` are listed as
  the contract surface.

## Verification

| Fix  | Check                                                                |
| ---- | -------------------------------------------------------------------- |
| 2, 3 | catalog contract test extended (dates, new mapping, counts)          |
| 4    | docs review; win32 rejection path unit-tested                        |
| 5    | digest-agreement contract test (file vs code vs both workflows)      |
| 6    | cache-eviction unit tests, including keep-override and prune-failure |
| 7    | scope-agreement test                                                 |
| 1, 8 | review only                                                          |

Gate: `bun test:stories`, `bun test:stories:contracts`, `bun test tests/scripts/`,
typecheck, and lint all green. The stories suite reports the identical 40
scenarios; the manifest scenario set is unchanged.

## Out of scope

- Any change to story behavior, scenario counts, or the sandbox boundary.
- Real Windows support (tracked follow-up).
- Coverage expansion of any kind, including the remaining core-story mappings
  (roadmap audit deliverable).
- The `.opencode` tooling bump (split off, not decided here).
