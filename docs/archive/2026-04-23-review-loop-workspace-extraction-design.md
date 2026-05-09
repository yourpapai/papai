# review-loop workspace extraction design

Date: 2026-04-23
Status: Approved (brainstorming)
Author: design captured in collaboration with the user

## Problem

`scripts/review-loop/` is a self-contained subsystem (ACP-based autonomous review-loop runner) that currently sits in the shared `scripts/` bag alongside unrelated tooling. Its tests live at `tests/review-loop/`, its entry point is `scripts/review-loop.ts`, and it is wired into the root package via the `review:loop` script.

The repository already demonstrates the target pattern via `codeindex/`: a root-level Bun workspace with its own `package.json`, `tsconfig.json`, and `CLAUDE.md`, owned-by-workspace dependencies, root-level `<name>:*` delegation scripts, and TDD resolver support for the workspace source tree.

Extracting `review-loop` into the same pattern aligns the project's auxiliary subsystems, isolates their dependencies, opts the code into the full TDD pipeline, and sets the stage for the parallel extraction of `scripts/behavior-audit/` as a follow-up.

## Non-goals

- No behavioral changes to the review-loop runner itself.
- No refactor of review-loop internals beyond what the move requires.
- No changes to `scripts/behavior-audit/` in this spec (tracked as a follow-up).
- No changes to the `codeindex/` workspace.

## Current state (verified)

- `scripts/review-loop.ts` — 4-line shebang entry that calls `runCli(Bun.argv.slice(2))`.
- `scripts/review-loop/` — 15 modules (`cli.ts`, `acp-process-client.ts`, `agent-session.ts`, `available-commands.ts`, `config.ts`, `issue-fingerprint.ts`, `issue-ledger.ts`, `issue-schema.ts`, `loop-controller.ts`, `permission-policy.ts`, `process-lifecycle.ts`, `progress-log.ts`, `prompt-templates.ts`, `run-state.ts`, `summary.ts`) plus `config.example.json`.
- No imports into `src/` or other repo-internal paths outside the subdirectory. Verified via `grep -rn "from '../'" scripts/review-loop/` and equivalent — only relative imports within the subdir.
- External dependencies used: `@agentclientprotocol/sdk` (workspace-only), `p-limit` and `zod` (shared with main `src/`).
- Tests in `tests/review-loop/` (12 files) import impl via `../../scripts/review-loop/*.js`.
- Root `package.json` exposes `bun review:loop` → `scripts/review-loop.ts`.
- `.hooks/tdd/test-resolver.mjs` has path-mapping branches for `scripts/review-loop/ ↔ tests/review-loop/` in `suggestTestPath`, `findTestFile`, and `resolveImplPath`, but `isGateableImplFile` does NOT opt it in — the full TDD pipeline does not run on review-loop impl edits today.

## Target architecture

### Directory layout

```
review-loop/                          (new workspace)
├── package.json                      name: "review-loop", private
├── tsconfig.json                     extends ../tsconfig.json
├── CLAUDE.md                         workspace-scoped conventions
├── config.example.json               moved from scripts/review-loop/
└── src/
    ├── cli.ts                        entry (was scripts/review-loop/cli.ts)
    ├── acp-process-client.ts
    ├── agent-session.ts
    ├── available-commands.ts
    ├── config.ts
    ├── issue-fingerprint.ts
    ├── issue-ledger.ts
    ├── issue-schema.ts
    ├── loop-controller.ts
    ├── permission-policy.ts
    ├── process-lifecycle.ts
    ├── progress-log.ts
    ├── prompt-templates.ts
    ├── run-state.ts
    └── summary.ts

tests/review-loop/                    (location unchanged)
└── *.test.ts                         imports rewritten: ../../scripts/review-loop/ → ../../review-loop/src/

scripts/review-loop.ts                DELETED
scripts/review-loop/                  DELETED (empty after moves)
```

Tests stay at repo-root `tests/review-loop/`, matching the codeindex convention where `codeindex/` is paired with `tests/codeindex/`. Relative-import depth is unchanged, so every import rewrite is a prefix swap.

### Workspace `review-loop/package.json`

```json
{
  "name": "review-loop",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "bun test ../tests/review-loop",
    "typecheck": "tsgo --project tsconfig.json --noEmit",
    "lint": "cd .. && oxlint --config .oxlintrc.json review-loop/src tests/review-loop",
    "format": "cd .. && oxfmt --write review-loop/src tests/review-loop --ignore-path=.oxfmtignore",
    "format:check": "cd .. && oxfmt --check review-loop/src tests/review-loop --ignore-path=.oxfmtignore",
    "start": "bun run src/cli.ts"
  },
  "dependencies": {
    "@agentclientprotocol/sdk": "^0.18.2",
    "p-limit": "^7.3.0",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@typescript/native-preview": "^7.0.0-dev.20260409.1",
    "typescript": "^6.0.0"
  }
}
```

Version numbers mirror root. The structure is deliberately a parallel of `codeindex/package.json`.

### Workspace `review-loop/tsconfig.json`

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "types": ["bun"]
  },
  "include": ["src/**/*.ts"]
}
```

Identical to `codeindex/tsconfig.json`.

### Root `package.json` changes

- `workspaces`: `["codeindex"]` → `["codeindex", "review-loop"]`
- Remove: `"review:loop": "bun scripts/review-loop.ts"`
- Add:
  - `"review-loop:start": "bun run --filter review-loop start"`
  - `"review-loop:test": "bun run --filter review-loop test"`
  - `"review-loop:typecheck": "bun run --filter review-loop typecheck"`
  - `"review-loop:lint": "bun run --filter review-loop lint"`
  - `"review-loop:format:check": "bun run --filter review-loop format:check"`
- `test`: drop `tests/review-loop` from the enumerated test paths (review-loop tests now run via `review-loop:test`, matching how codeindex tests are excluded from the root `test` script).
- `check:verbose`: extend the `--parallel` list with `review-loop:lint review-loop:typecheck review-loop:format:check review-loop:test`.
- Dependency shift:
  - Move `@agentclientprotocol/sdk` from root `devDependencies` to `review-loop/package.json` `dependencies`.
  - `p-limit` and `zod` remain in root dependencies AND are declared in `review-loop/package.json` (bun hoists; codeindex does the same for `zod`).

### TDD resolver (`.hooks/tdd/test-resolver.mjs`) changes

Four coordinated edits, all changing `scripts/review-loop/` references to `review-loop/src/`:

1. `isGateableImplFile`: add an `isReviewLoop = rel.startsWith('review-loop/src/')` branch and include it in the OR chain so impl edits trigger the full TDD pipeline.
2. `suggestTestPath`: rewrite the review-loop branch from `scripts/review-loop/` prefix to `review-loop/src/` prefix; test path target (`tests/review-loop/`) unchanged.
3. `findTestFile`: parallel rewrite — swap the `rel.startsWith(...)` and `rel.replace(...)` arguments from `scripts/review-loop/` to `review-loop/src/`.
4. `resolveImplPath`: rewrite the reverse mapping so `tests/review-loop/foo.test.ts → review-loop/src/foo.ts` (was `scripts/review-loop/foo.ts`).

### Documentation

- New `review-loop/CLAUDE.md` modeled on `codeindex/CLAUDE.md`:
  - Purpose: autonomous ACP-based code-review loop runner; local developer tooling, not a papai runtime dependency.
  - Scripts: the workspace-delegated commands.
  - Storage / artifacts: exact paths for progress logs, issue ledger, run-state files (to be documented by inspecting `run-state.ts` and `progress-log.ts` during implementation).
  - TDD hooks: `review-loop/src/**` is gateable and maps to `tests/review-loop/**`.
  - External contract: `@agentclientprotocol/sdk` is the workspace-specific runtime dep; `config.example.json` documents the expected config shape.
- Root `CLAUDE.md`:
  - Replace `bun review:loop` bullet with `bun review-loop:start`.
  - Add four `review-loop:*` bullets alongside the `codeindex:*` entries.
  - Add a Path-Scoped Conventions row for `review-loop/CLAUDE.md`.
- Grep the tree for other references to `scripts/review-loop` and `review:loop`: `.github/instructions/*.md`, `scripts/check.sh`, knip config, oxlint/oxfmt include paths, Stryker config, CI workflow files, root `README.md` if present. Update every hit.

## Implementation order

Each commit is independently reviewable and keeps the repo green.

1. **Scaffold workspace (no behavior change).** Create `review-loop/` with `package.json`, `tsconfig.json`, and an empty `src/.gitkeep`. Add `review-loop` to root `workspaces`. Run `bun install`. Verify: `bun test`, `bun typecheck`, and `scripts/review-loop.ts` still work.
2. **Move source and re-wire root scripts atomically.** Move every file in `scripts/review-loop/` to `review-loop/src/` via `git mv`; delete the `scripts/review-loop.ts` wrapper; move `config.example.json` up to `review-loop/`. Rewrite test imports (`../../scripts/review-loop/` → `../../review-loop/src/`). Shift `@agentclientprotocol/sdk` into workspace deps; declare `p-limit` and `zod` in workspace. In the same commit, replace the root `review:loop` script with the five `review-loop:*` scripts, drop `tests/review-loop` from root `test`, and extend `check:verbose`. Run `bun install`. Verify: `bun review-loop:test`, `bun review-loop:start --help`, `bun test`, `bun typecheck`, `bun check:verbose`. The repo has no broken intermediate state because the source move and the root-script rename land together.
3. **Update TDD resolver.** Apply the four edits from the Target architecture. Validate by editing a `review-loop/src/*.ts` file (TDD pipeline fires) and a `tests/review-loop/*.test.ts` file (import gate resolves correctly).
4. **Documentation.** Add `review-loop/CLAUDE.md`, update root `CLAUDE.md`, grep for and fix every stale `scripts/review-loop`/`review:loop` reference.

## Validation

Before merge:

- `bun check:verbose` clean
- `bun review-loop:start --help` works
- `bun review-loop:test` passes
- `git log --follow review-loop/src/cli.ts` shows pre-refactor history
- `git grep -n "scripts/review-loop"` empty
- `git grep -n "review:loop"` empty
- Manual TDD hook smoke: edit a review-loop impl file and confirm the gate pipeline runs; edit a test file and confirm the import gate resolves impl.

## Risks and mitigations

- **Bun workspace resolution for `@agentclientprotocol/sdk`** — Bun hoists workspace dependencies, so moving it from root to `review-loop/` should resolve cleanly. Mitigation: clean install (`rm -rf node_modules bun.lockb && bun install`) during commit 2 validation.
- **Knip monorepo awareness** — knip may need workspace registration or a config update. Mitigation: run `bun knip` as part of validation and fix any new unused-export reports arising from the moved files.
- **Resolver migration subtlety** — the four resolver edits must stay consistent with each other. Mitigation: the validation step uses real file edits to drive the pipeline end-to-end, not just unit reasoning over the diff.
- **Reference rot** — stale mentions of `scripts/review-loop` or `review:loop` in CI configs or docs could silently break tooling. Mitigation: `git grep` is authoritative; every hit must be updated or explicitly justified.

## Follow-up

- `scripts/behavior-audit/` extraction is explicitly deferred. Once this spec lands, the behavior-audit extraction can reuse this design as a template, with adaptations for the split entry (`behavior-audit.ts` + `behavior-audit-reset.ts`), its test-file-prefix convention in `tests/scripts/behavior-audit-*.test.ts`, and its lack of an existing resolver mapping.
