# review-loop Workspace Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `scripts/review-loop/` into a root-level Bun workspace package named `review-loop`, mirroring the structure of the existing `codeindex/` workspace, and opt it into the full TDD hook pipeline.

**Architecture:** Move 15 source modules from `scripts/review-loop/` to `review-loop/src/`, delete the thin `scripts/review-loop.ts` wrapper, keep 12 test files at `tests/review-loop/` (prefix-only import rewrite), add workspace-local `package.json`/`tsconfig.json`/`CLAUDE.md`, replace the root `review:loop` script with five `review-loop:*` delegation scripts, and update the TDD resolver so `review-loop/src/**` is gateable.

**Tech Stack:** Bun workspaces, oxlint, oxfmt, tsgo, `@agentclientprotocol/sdk`, `p-limit`, `zod`.

**Spec:** `docs/superpowers/specs/2026-04-23-review-loop-workspace-extraction-design.md`

---

## Background knowledge (read before starting)

The repo already has one workspace — `codeindex/` — and this plan copies its pattern exactly. Key invariants of the codeindex pattern that you must preserve for review-loop:

1. Tests live at **repo-root** `tests/<workspace>/`, not inside the workspace. The workspace `test` script runs `bun test ../tests/<workspace>`.
2. Lint/format scripts `cd ..` to repo root and apply oxlint/oxfmt to the workspace's `src/` and `tests/<workspace>/` with the root config files.
3. Typecheck uses `tsgo --project tsconfig.json --noEmit` from the workspace directory; the workspace `tsconfig.json` extends `../tsconfig.json`.
4. Root `package.json` delegates via `bun run --filter <workspace> <script>`.
5. The workspace's `package.json` lists ALL third-party deps it imports, even if shared with root — bun hoists.
6. `.hooks/tdd/test-resolver.mjs` has explicit mapping branches for workspace paths.

**Current state reference** (verified):

- `scripts/review-loop/` contains 15 `.ts` files and 1 `config.example.json`.
- Entry wrapper: `scripts/review-loop.ts` (4 lines, just calls `runCli(Bun.argv.slice(2))`).
- `tests/review-loop/` contains 12 test files (all import via `../../scripts/review-loop/<name>.js`).
- No files under `scripts/review-loop/` import from outside the subdirectory.
- External deps imported by `scripts/review-loop/`: `@agentclientprotocol/sdk` (workspace-only), `p-limit` (shared), `zod` (shared).
- The 15 source files are: `acp-process-client.ts`, `agent-session.ts`, `available-commands.ts`, `cli.ts`, `config.ts`, `issue-fingerprint.ts`, `issue-ledger.ts`, `issue-schema.ts`, `loop-controller.ts`, `permission-policy.ts`, `process-lifecycle.ts`, `progress-log.ts`, `prompt-templates.ts`, `run-state.ts`, `summary.ts`.
- The 12 test files are: `acp-process-client.test.ts`, `available-commands.test.ts`, `cli.test.ts`, `fake-agent-integration.test.ts`, `fake-agent.ts` (helper, not a `.test.ts`), `issue-fingerprint.test.ts`, `issue-ledger.test.ts`, `issue-schema.test.ts`, `loop-controller.test.ts`, `permission-policy.test.ts`, `progress-log.test.ts`, `prompt-templates.test.ts`, `run-state.test.ts`. (13 files total in `tests/review-loop/`; `fake-agent.ts` is a helper shared by the integration test.)
- `tests/review-loop/prompt-templates.test.ts` contains TWO string-literal occurrences of `scripts/review-loop/permission-policy.ts` at lines 19 and 30 — these are fake "file" fields in prompt fixtures. They must be updated to `review-loop/src/permission-policy.ts` to remain truthful.

**References that must NOT be touched** (historical records, intentionally immutable):

- `docs/adr/0064-acp-review-automation.md`
- `docs/archive/**`
- `docs/superpowers/plans/2026-04-21-review-loop-enhancements.md`
- `docs/superpowers/plans/2026-04-22-review-loop-config-and-progress.md`
- `docs/superpowers/specs/2026-04-22-review-loop-config-and-progress-design.md`

These contain `scripts/review-loop` references that reflect the state of the repo **at the time they were written** — treat them as timestamps, not as stragglers. The final `git grep` validation below accepts these hits explicitly.

---

## File Structure

**New files:**

- `review-loop/package.json` — workspace manifest (mirrors `codeindex/package.json`).
- `review-loop/tsconfig.json` — extends `../tsconfig.json` (mirrors `codeindex/tsconfig.json`).
- `review-loop/CLAUDE.md` — workspace-scoped conventions (mirrors `codeindex/CLAUDE.md`).
- `review-loop/src/` — directory; will hold the 15 moved files.
- `review-loop/config.example.json` — moved up from `scripts/review-loop/`.

**Moved files (via `git mv` to preserve history):**

- `scripts/review-loop/*.ts` → `review-loop/src/*.ts` (15 files).
- `scripts/review-loop/config.example.json` → `review-loop/config.example.json`.

**Deleted files:**

- `scripts/review-loop.ts` (4-line wrapper — subsumed by `review-loop/src/cli.ts` via workspace `start` script).
- `scripts/review-loop/` directory (empty after moves).

**Modified files:**

- `package.json` (root) — workspaces array, scripts, dependencies.
- `.hooks/tdd/test-resolver.mjs` — four coordinated path-mapping edits.
- `tests/review-loop/*.test.ts` (12 files) — rewrite import prefix.
- `tests/review-loop/fake-agent.ts` (1 file) — rewrite import prefix (if it imports impl).
- `tests/review-loop/prompt-templates.test.ts` — ALSO rewrite two non-import string literals at lines 19 and 30.
- `CLAUDE.md` (root) — command list and path-scoped conventions table.
- `knip.jsonc` — add review-loop entry and project globs.
- `scripts/check.sh` — add review-loop:\* to the parallel checks array.

---

## Task 1: Scaffold the workspace (no behavior change)

**Goal:** Register `review-loop` as a Bun workspace with empty `src/`. After this task, nothing about review-loop's behavior changes — the old `bun review:loop` still works, the old `tests/review-loop/` tests still pass — but the skeleton of the new workspace exists and `bun install` has wired it up.

**Files:**

- Create: `review-loop/package.json`
- Create: `review-loop/tsconfig.json`
- Create: `review-loop/src/.gitkeep`
- Modify: `package.json` (root) — `workspaces` array only

- [ ] **Step 1: Confirm starting state is clean**

Run:

```bash
git status
```

Expected: working tree clean, branch `master` (or the feature branch for this work). If there are unexpected modifications, stop and address them first — this plan assumes a clean start.

- [ ] **Step 2: Create the workspace directory**

Run:

```bash
mkdir -p review-loop/src
touch review-loop/src/.gitkeep
```

- [ ] **Step 3: Create `review-loop/package.json`**

Create `review-loop/package.json` with exactly this content:

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

Note: version numbers mirror the existing root `package.json` entries (`@agentclientprotocol/sdk: ^0.18.2`, `p-limit: ^7.3.0`, `zod: ^4.0.0`, `@typescript/native-preview: ^7.0.0-dev.20260409.1`, `typescript: ^6.0.0`). If root has different versions at execution time, match root exactly.

- [ ] **Step 4: Create `review-loop/tsconfig.json`**

Create `review-loop/tsconfig.json` with exactly this content:

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "types": ["bun"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 5: Register the workspace in root `package.json`**

Edit `package.json` (root). Change:

```json
"workspaces": ["codeindex"],
```

to:

```json
"workspaces": ["codeindex", "review-loop"],
```

Do NOT touch any other line of root `package.json` in this task.

- [ ] **Step 6: Run `bun install` to register the workspace**

Run:

```bash
bun install
```

Expected: bun reports the new workspace is linked; no errors. A new or updated `bun.lock` (or `bun.lockb`) may result — this is fine.

- [ ] **Step 7: Verify baseline checks still pass**

Run in parallel (or sequentially):

```bash
bun typecheck
bun test
bun review:loop --help 2>&1 | head -5
```

Expected: typecheck clean, test suite green, `bun review:loop --help` prints the same CLI help it always has (the scaffold did not touch the wrapper).

- [ ] **Step 8: Commit**

```bash
git add review-loop/package.json review-loop/tsconfig.json review-loop/src/.gitkeep package.json bun.lock
git commit -m "$(cat <<'EOF'
build(review-loop): scaffold empty workspace

Register review-loop/ as a Bun workspace mirroring codeindex/. No source
or script changes yet — the existing scripts/review-loop/ subsystem still
runs via bun review:loop.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

If `bun.lockb` exists instead of `bun.lock`, stage whichever is present.

---

## Task 2: Atomic source move and root-script re-wire

**Goal:** Move every file from `scripts/review-loop/` to `review-loop/src/`, delete the wrapper, rewrite test imports, shift dependencies, and swap `review:loop` for `review-loop:*` — all in one commit so there is no intermediate state where `bun review:loop` is broken.

**Files:**

- Move (via `git mv`): `scripts/review-loop/*.ts` → `review-loop/src/*.ts` (15 files)
- Move (via `git mv`): `scripts/review-loop/config.example.json` → `review-loop/config.example.json`
- Delete: `scripts/review-loop.ts`
- Delete (verify empty, then remove): `scripts/review-loop/` directory
- Modify: `tests/review-loop/*.test.ts` (12 files) — import prefix rewrite
- Modify: `tests/review-loop/fake-agent.ts` — import prefix rewrite (if applicable)
- Modify: `tests/review-loop/prompt-templates.test.ts` — ALSO rewrite two string literals (lines 19, 30)
- Modify: `package.json` (root) — scripts + dependencies
- Delete: `review-loop/src/.gitkeep` (no longer needed once real files are present)

- [ ] **Step 1: Move the 15 source files**

Run:

```bash
git mv scripts/review-loop/acp-process-client.ts review-loop/src/acp-process-client.ts
git mv scripts/review-loop/agent-session.ts review-loop/src/agent-session.ts
git mv scripts/review-loop/available-commands.ts review-loop/src/available-commands.ts
git mv scripts/review-loop/cli.ts review-loop/src/cli.ts
git mv scripts/review-loop/config.ts review-loop/src/config.ts
git mv scripts/review-loop/issue-fingerprint.ts review-loop/src/issue-fingerprint.ts
git mv scripts/review-loop/issue-ledger.ts review-loop/src/issue-ledger.ts
git mv scripts/review-loop/issue-schema.ts review-loop/src/issue-schema.ts
git mv scripts/review-loop/loop-controller.ts review-loop/src/loop-controller.ts
git mv scripts/review-loop/permission-policy.ts review-loop/src/permission-policy.ts
git mv scripts/review-loop/process-lifecycle.ts review-loop/src/process-lifecycle.ts
git mv scripts/review-loop/progress-log.ts review-loop/src/progress-log.ts
git mv scripts/review-loop/prompt-templates.ts review-loop/src/prompt-templates.ts
git mv scripts/review-loop/run-state.ts review-loop/src/run-state.ts
git mv scripts/review-loop/summary.ts review-loop/src/summary.ts
git mv scripts/review-loop/config.example.json review-loop/config.example.json
```

Note the last move: `config.example.json` goes up one level to `review-loop/` (not into `src/`), matching codeindex's placement of `.codeindex.json.example` at its workspace root.

- [ ] **Step 2: Delete the wrapper and the now-empty subdirectory**

Run:

```bash
git rm scripts/review-loop.ts
rmdir scripts/review-loop
```

Expected: `rmdir` succeeds (directory is empty after git mv). If it fails, run `ls scripts/review-loop/` to see what's still there and move/remove accordingly before proceeding.

- [ ] **Step 3: Remove the now-unneeded `.gitkeep`**

Run:

```bash
git rm review-loop/src/.gitkeep
```

- [ ] **Step 4: Verify no intra-workspace imports broke**

The 15 files only imported from each other via relative paths (`./foo.js`), which are unchanged by the move. Confirm:

```bash
grep -rn "from '\\.\\./" review-loop/src/ 2>&1 | head
```

Expected: no output (no parent-directory relative imports). If any appear, stop and investigate — they represent cross-boundary imports that the design assumed did not exist.

- [ ] **Step 5: Rewrite test imports (prefix swap)**

For every file in `tests/review-loop/`, replace the import prefix. The depth does not change (both `tests/review-loop/` → `scripts/review-loop/` and `tests/review-loop/` → `review-loop/src/` are `../../…`), so this is a pure string replacement.

Run (from repo root):

```bash
# Dry-run first — list files that would change
grep -rln "'\\.\\./\\.\\./scripts/review-loop/" tests/review-loop/
```

Expected: 12 test files plus possibly `fake-agent.ts`. Then apply the replacement:

```bash
# Use a portable in-place edit (works on macOS and Linux)
find tests/review-loop -type f \( -name "*.test.ts" -o -name "fake-agent.ts" \) -print0 | \
  xargs -0 perl -i -pe "s{\\.\\./\\.\\./scripts/review-loop/}{../../review-loop/src/}g"
```

- [ ] **Step 6: Fix the two non-import string literals in `prompt-templates.test.ts`**

Edit `tests/review-loop/prompt-templates.test.ts`.

Change line 19 (inside `reviewerIssue`):

```diff
-  file: 'scripts/review-loop/permission-policy.ts',
+  file: 'review-loop/src/permission-policy.ts',
```

Change line 30 (inside `verifierDecision.targetFiles`):

```diff
-  targetFiles: ['scripts/review-loop/permission-policy.ts'],
+  targetFiles: ['review-loop/src/permission-policy.ts'],
```

These are fake fixture values representing file paths the reviewer cites; they must match where the code actually lives after the move.

- [ ] **Step 7: Verify the rewrite is complete**

Run:

```bash
git grep -n "scripts/review-loop" -- tests/review-loop/
```

Expected: no output.

- [ ] **Step 8: Shift the `@agentclientprotocol/sdk` dependency**

Edit `package.json` (root). Remove this line from `devDependencies`:

```diff
-    "@agentclientprotocol/sdk": "^0.18.2",
```

The corresponding entry already exists in `review-loop/package.json` (added in Task 1).

- [ ] **Step 9: Replace the `review:loop` script with `review-loop:*` delegation scripts**

Edit `package.json` (root). In the `scripts` section:

Remove:

```diff
-    "review:loop": "bun scripts/review-loop.ts",
```

Add (alphabetical ordering — place the `review-loop:*` block between `review:loop`'s old spot and the next existing alphabetical neighbor; a practical choice is to put them right after the `codeindex:*` block for symmetry):

```json
    "review-loop:test": "bun run --filter review-loop test",
    "review-loop:typecheck": "bun run --filter review-loop typecheck",
    "review-loop:lint": "bun run --filter review-loop lint",
    "review-loop:format:check": "bun run --filter review-loop format:check",
    "review-loop:start": "bun run --filter review-loop start",
```

Also update the root `test` script — remove `tests/review-loop` from its path list:

```diff
-    "test": "bun test tests/providers tests/tools tests/web tests/db tests/utils tests/schemas tests/proactive tests/debug tests/review-loop tests/*.test.ts",
+    "test": "bun test tests/providers tests/tools tests/web tests/db tests/utils tests/schemas tests/proactive tests/debug tests/*.test.ts",
```

Also extend `check:verbose`:

```diff
-    "check:verbose": "bun run --parallel lint typecheck format:check knip test duplicates codeindex:lint codeindex:typecheck codeindex:format:check codeindex:test",
+    "check:verbose": "bun run --parallel lint typecheck format:check knip test duplicates codeindex:lint codeindex:typecheck codeindex:format:check codeindex:test review-loop:lint review-loop:typecheck review-loop:format:check review-loop:test",
```

- [ ] **Step 10: Re-run `bun install`**

Run:

```bash
bun install
```

Expected: bun re-resolves the workspace (moving `@agentclientprotocol/sdk` from root dev to workspace runtime changes nothing about hoisted layout for a private workspace — but run it so the lockfile is consistent). No errors.

- [ ] **Step 11: Run the workspace test suite through its new path**

Run:

```bash
bun review-loop:test
```

Expected: all 12 test files run and pass.

- [ ] **Step 12: Run the workspace typecheck**

Run:

```bash
bun review-loop:typecheck
```

Expected: no type errors.

- [ ] **Step 13: Run the CLI smoke check**

Run:

```bash
bun review-loop:start --help
```

Expected: the CLI prints its help text (same text as the old `bun review:loop --help`). If it prints usage and exits cleanly, the `start` → `bun run src/cli.ts` → `runCli(Bun.argv.slice(2))` chain works.

Note: `parseCliArgs` in `review-loop/src/cli.ts` may not explicitly implement `--help`; if `--help` is rejected with a usage error, that's still acceptable as long as the CLI was clearly invoked. The intent here is to prove the entry point fires, not to validate CLI feature parity.

- [ ] **Step 14: Run the broader repo checks**

Run:

```bash
bun typecheck
bun test
```

Expected: both pass. The root `test` script now excludes `tests/review-loop` (those run via `bun review-loop:test`); typecheck still covers everything via the root `tsconfig.json`.

- [ ] **Step 15: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(review-loop): move into root workspace

Move scripts/review-loop/*.ts → review-loop/src/*.ts via git mv (history
preserved) and drop the scripts/review-loop.ts wrapper. Promote
config.example.json to review-loop/. Shift @agentclientprotocol/sdk from
root devDependencies to the workspace's runtime dependencies. Rewrite
test imports in tests/review-loop/ from ../../scripts/review-loop/ to
../../review-loop/src/ (prefix-only change, depth unchanged). Replace
the root review:loop script with five review-loop:* delegation scripts;
drop tests/review-loop from the root test script (now runs through
review-loop:test); extend check:verbose with the four review-loop
parallel checks.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: TDD resolver update

**Goal:** Make `review-loop/src/**` gateable in `.hooks/tdd/test-resolver.mjs` so that edits to review-loop source files run the full Red→Green→Refactor pipeline (like `codeindex/src/**` does today), and update the three path-mapping functions to reference the new location.

**Files:**

- Modify: `.hooks/tdd/test-resolver.mjs`

**Reference:** Read `.hooks/tdd/test-resolver.mjs` end-to-end before starting. The four edits below must be applied together — they are coupled, and a partial update will break the hook flow.

- [ ] **Step 1: Opt review-loop/src into `isGateableImplFile`**

Edit `.hooks/tdd/test-resolver.mjs` around line 27 (inside `isGateableImplFile`).

Current:

```javascript
const isCodeindex = rel.startsWith('codeindex/src/') || rel.startsWith('codeindex\\src\\')
if (!isSrc && !isClient && !isCodeindex) return false
```

Replace with:

```javascript
const isCodeindex = rel.startsWith('codeindex/src/') || rel.startsWith('codeindex\\src\\')
const isReviewLoop = rel.startsWith('review-loop/src/') || rel.startsWith('review-loop\\src\\')
if (!isSrc && !isClient && !isCodeindex && !isReviewLoop) return false
```

- [ ] **Step 2: Rewrite the review-loop branch in `suggestTestPath`**

Edit `.hooks/tdd/test-resolver.mjs` around lines 53–58.

Current:

```javascript
// scripts/review-loop/foo.ts → tests/review-loop/foo.test.ts
if (implRelPath.startsWith('scripts/review-loop/') || implRelPath.startsWith('scripts\\review-loop\\')) {
  const withoutPrefix = implRelPath.replace(/^scripts[/\\]review-loop[/\\]/, '')
  const ext = path.extname(withoutPrefix)
  const base = withoutPrefix.slice(0, -ext.length)
  return path.join('tests', 'review-loop', `${base}.test${ext}`)
}
```

Replace with:

```javascript
// review-loop/src/foo.ts → tests/review-loop/foo.test.ts
if (implRelPath.startsWith('review-loop/src/') || implRelPath.startsWith('review-loop\\src\\')) {
  const withoutPrefix = implRelPath.replace(/^review-loop[/\\]src[/\\]/, '')
  const ext = path.extname(withoutPrefix)
  const base = withoutPrefix.slice(0, -ext.length)
  return path.join('tests', 'review-loop', `${base}.test${ext}`)
}
```

- [ ] **Step 3: Rewrite the review-loop branch in `findTestFile`**

Edit `.hooks/tdd/test-resolver.mjs` around lines 99–109.

Current:

```javascript
// scripts/review-loop/foo.ts → tests/review-loop/foo.test.ts
if (rel.startsWith('scripts/review-loop/') || rel.startsWith('scripts\\review-loop\\')) {
  const withoutPrefix = rel.replace(/^scripts[/\\]review-loop[/\\]/, '')
  const ext = path.extname(withoutPrefix)
  const base = withoutPrefix.slice(0, -ext.length)

  for (const suffix of ['.test', '.spec']) {
    const candidate = path.join(projectRoot, 'tests', 'review-loop', `${base}${suffix}${ext}`)
    if (fs.existsSync(candidate)) return candidate
  }
}
```

Replace with:

```javascript
// review-loop/src/foo.ts → tests/review-loop/foo.test.ts
if (rel.startsWith('review-loop/src/') || rel.startsWith('review-loop\\src\\')) {
  const withoutPrefix = rel.replace(/^review-loop[/\\]src[/\\]/, '')
  const ext = path.extname(withoutPrefix)
  const base = withoutPrefix.slice(0, -ext.length)

  for (const suffix of ['.test', '.spec']) {
    const candidate = path.join(projectRoot, 'tests', 'review-loop', `${base}${suffix}${ext}`)
    if (fs.existsSync(candidate)) return candidate
  }
}
```

- [ ] **Step 4: Rewrite the reverse mapping in `resolveImplPath`**

Edit `.hooks/tdd/test-resolver.mjs` around lines 155–158.

Current:

```javascript
// tests/review-loop/foo.test.ts → scripts/review-loop/foo.ts
if (dir === 'review-loop' || dir.startsWith('review-loop/') || dir.startsWith('review-loop\\')) {
  return path.join('scripts', dir, `${base}${ext}`)
}
```

Replace with:

```javascript
// tests/review-loop/foo.test.ts → review-loop/src/foo.ts
if (dir === 'review-loop' || dir.startsWith('review-loop/') || dir.startsWith('review-loop\\')) {
  const withoutPrefix = dir.replace(/^review-loop[/\\]?/, '')
  return path.join('review-loop', 'src', withoutPrefix, `${base}${ext}`)
}
```

Note: for the typical case (`tests/review-loop/foo.test.ts`), `dir === 'review-loop'`, so `withoutPrefix` is `''` and the result is `review-loop/src/foo.ts`. For a nested case (`tests/review-loop/sub/foo.test.ts`), `dir === 'review-loop/sub'` and the result is `review-loop/src/sub/foo.ts`.

- [ ] **Step 5: Smoke-test the resolver by editing a review-loop impl file**

Pick any small, low-risk file in `review-loop/src/` (e.g., touch whitespace in `review-loop/src/issue-fingerprint.ts` — add a blank line at the end, then remove it) and save via the Edit tool or equivalent. The TDD hook pipeline must fire and must find the corresponding test file at `tests/review-loop/issue-fingerprint.test.ts`.

If running this plan via subagent-driven execution, include a direct observation: after the edit, the hook output should show it ran the targeted test for `tests/review-loop/issue-fingerprint.test.ts` and passed.

If a hook failure is reported, do NOT commit — go back and inspect which branch (steps 1–4) was misapplied, fix it, and retry the smoke.

- [ ] **Step 6: Smoke-test the reverse mapping by editing a test file**

Make a trivial edit to any `tests/review-loop/*.test.ts` file (e.g., add/remove a blank line). The import-gate must resolve its impl to `review-loop/src/…` and pass.

- [ ] **Step 7: Run baseline repo checks**

```bash
bun typecheck
bun test
bun review-loop:test
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add .hooks/tdd/test-resolver.mjs
git commit -m "$(cat <<'EOF'
chore(tdd): point resolver at review-loop workspace

Update .hooks/tdd/test-resolver.mjs so review-loop/src/** is gateable
(full TDD pipeline fires on impl edits) and so the three path-mapping
functions resolve review-loop/src/ ↔ tests/review-loop/ instead of the
now-retired scripts/review-loop/.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Documentation and straggler cleanup

**Goal:** Add a workspace `CLAUDE.md`, update the root `CLAUDE.md` command list and conventions table, update `knip.jsonc` to know about the workspace, update `scripts/check.sh` to include review-loop in its parallel checks array, and verify no non-historical stragglers remain.

**Files:**

- Create: `review-loop/CLAUDE.md`
- Modify: `CLAUDE.md` (root)
- Modify: `knip.jsonc`
- Modify: `scripts/check.sh`

- [ ] **Step 1: Create `review-loop/CLAUDE.md`**

Create `review-loop/CLAUDE.md` with this content:

```markdown
# review-loop Workspace

## Purpose

`review-loop/` is a standalone Bun workspace for the ACP-based autonomous code-review loop runner. It spawns reviewer and fixer ACP agent subprocesses, collects reviewer issues into a durable ledger, and drives multi-round verify/fix cycles. It is local developer tooling, not a papai runtime dependency.

## Storage / Artifacts

- The default `workDir` is `.review-loop/` relative to `repoRoot` (see `config.example.json`). The directory is created on demand via `mkdir`.
- Per-run state lives at `<workDir>/runs/<runId>/state.json` (see `src/run-state.ts`).
- Progress logs and transcripts land alongside the run state (see `src/progress-log.ts`).
- `config.example.json` at the workspace root documents the expected config shape; real configs are loaded from the path passed via `--config` (defaults to `.review-loop/config.json`).

## Scripts

Run workspace commands from the repo root:

- `bun run review-loop:test`
- `bun run review-loop:typecheck`
- `bun run review-loop:lint`
- `bun run review-loop:format:check`
- `bun run review-loop:start -- --config <path> --plan <path>`

## TDD Hooks

The repo TDD resolver treats `review-loop/src/**` as gateable implementation code and maps it to `tests/review-loop/**`. New review-loop work must follow the same test-first flow used under `src/` and `codeindex/src/`.

## Dependencies

- `@agentclientprotocol/sdk` — ACP subprocess protocol (workspace-only).
- `p-limit` — bounded concurrency (shared with root).
- `zod` — runtime config/schema validation (shared with root).
```

- [ ] **Step 2: Update the root `CLAUDE.md` command list**

Edit `CLAUDE.md` (root). Find the bullet:

```markdown
- `bun review:loop` — run the review-loop workflow
```

Replace with:

```markdown
- `bun review-loop:start` — run the review-loop workflow
```

Then, immediately after the `bun codeindex:format:check` bullet, add these four bullets (matching the ordering used for codeindex):

```markdown
- `bun review-loop:test` — run the review-loop workspace test suite
- `bun review-loop:typecheck` — run review-loop workspace TypeScript checks
- `bun review-loop:lint` — lint the review-loop workspace
- `bun review-loop:format:check` — check review-loop workspace formatting
```

- [ ] **Step 3: Update the root `CLAUDE.md` path-scoped conventions table**

Edit `CLAUDE.md` (root). Find the "Path-Scoped Conventions" table. Add a new row after the `codeindex/CLAUDE.md` row:

```markdown
| `review-loop/CLAUDE.md` | review-loop workspace structure, scripts, storage, and TDD rules |
```

Column widths and padding should match surrounding rows.

- [ ] **Step 4: Update `knip.jsonc`**

Edit `knip.jsonc`. In `entry`, add two new entries mirroring the codeindex ones:

```diff
   "entry": [
     "src/scripts/*.ts!",
     "scripts/build-client.ts!",
     "client/debug/index.ts!",
     "tests/providers/youtrack/test-helpers.ts!",
     "codeindex/src/cli.ts!",
     "tests/codeindex/**/*.test.ts!",
+    "review-loop/src/cli.ts!",
+    "tests/review-loop/**/*.test.ts!",
   ],
```

In `project`, add `review-loop/src/**/*.ts!`:

```diff
-  "project": ["src/**/*.ts!", "client/**/*.ts!", "codeindex/src/**/*.ts!"],
+  "project": ["src/**/*.ts!", "client/**/*.ts!", "codeindex/src/**/*.ts!", "review-loop/src/**/*.ts!"],
```

- [ ] **Step 5: Update `scripts/check.sh`**

Edit `scripts/check.sh` around line 140. Find:

```bash
  checks=("lint" "typecheck" "format:check" "knip" "test" "test:client" "duplicates" "codeindex:lint" "codeindex:typecheck" "codeindex:format:check" "codeindex:test")
```

Replace with:

```bash
  checks=("lint" "typecheck" "format:check" "knip" "test" "test:client" "duplicates" "codeindex:lint" "codeindex:typecheck" "codeindex:format:check" "codeindex:test" "review-loop:lint" "review-loop:typecheck" "review-loop:format:check" "review-loop:test")
```

- [ ] **Step 6: Run `bun knip` to verify workspace registration**

Run:

```bash
bun knip
```

Expected: no errors. If knip complains about unused exports in `review-loop/src/` that it didn't complain about before the move, they were always unused and were only invisible because the directory wasn't in the `project` glob — investigate each report on its merits. If knip reports unresolved dependencies for `review-loop/`, double-check that `review-loop/package.json` lists every third-party package actually imported in `review-loop/src/`.

- [ ] **Step 7: Run the full parallel check suite**

Run:

```bash
bun check:verbose
```

Expected: every parallel branch passes, including the four new `review-loop:*` branches.

- [ ] **Step 8: Verify no non-historical stragglers remain**

Run:

```bash
git grep -n "scripts/review-loop" -- ':!docs/adr' ':!docs/archive' ':!docs/superpowers/plans/2026-04-21-review-loop-enhancements.md' ':!docs/superpowers/plans/2026-04-22-review-loop-config-and-progress.md' ':!docs/superpowers/specs/2026-04-22-review-loop-config-and-progress-design.md'
```

Expected: no output.

Run:

```bash
git grep -n "review:loop" -- ':!docs/adr' ':!docs/archive' ':!docs/superpowers/plans/2026-04-21-review-loop-enhancements.md' ':!docs/superpowers/plans/2026-04-22-review-loop-config-and-progress.md' ':!docs/superpowers/specs/2026-04-22-review-loop-config-and-progress-design.md'
```

Expected: no output. If anything appears, fix it in this task (this is the cleanup step).

- [ ] **Step 9: Verify git history is preserved for moved files**

Run:

```bash
git log --follow --oneline review-loop/src/cli.ts | head -5
```

Expected: at least 2–3 commits, including history from before the move (commits that touched `scripts/review-loop/cli.ts`). If only the Task 2 move commit appears, `--follow` failed to track the rename — investigate (git's rename detection needs sufficient similarity; our pure `git mv` with no content change should satisfy it).

- [ ] **Step 10: Commit**

```bash
git add review-loop/CLAUDE.md CLAUDE.md knip.jsonc scripts/check.sh
git commit -m "$(cat <<'EOF'
docs(review-loop): document workspace and wire supporting tooling

Add review-loop/CLAUDE.md modeled on codeindex/CLAUDE.md, update the
root CLAUDE.md command list and path-scoped conventions table, register
review-loop in knip.jsonc (entry + project globs), and extend
scripts/check.sh's parallel checks array with the four review-loop:*
scripts.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Final validation

After Task 4's commit, run all of the following from repo root. Every command must succeed before the branch is considered done.

- [ ] **Full check suite:**

  ```bash
  bun check:verbose
  ```

  Expected: every parallel job green.

- [ ] **CLI smoke:**

  ```bash
  bun review-loop:start --help 2>&1 | head -10
  ```

  Expected: CLI prints help / usage (same behavior as the old `bun review:loop`).

- [ ] **Workspace test suite:**

  ```bash
  bun review-loop:test
  ```

  Expected: all 12 review-loop test files pass.

- [ ] **History preservation:**

  ```bash
  git log --follow --oneline review-loop/src/loop-controller.ts | head -10
  ```

  Expected: shows pre-move commits (not just the Task 2 move commit).

- [ ] **No non-historical stragglers:**

  ```bash
  git grep -n "scripts/review-loop" -- ':!docs/adr' ':!docs/archive' ':!docs/superpowers/plans/2026-04-21-review-loop-enhancements.md' ':!docs/superpowers/plans/2026-04-22-review-loop-config-and-progress.md' ':!docs/superpowers/specs/2026-04-22-review-loop-config-and-progress-design.md'
  git grep -n "review:loop" -- ':!docs/adr' ':!docs/archive' ':!docs/superpowers/plans/2026-04-21-review-loop-enhancements.md' ':!docs/superpowers/plans/2026-04-22-review-loop-config-and-progress.md' ':!docs/superpowers/specs/2026-04-22-review-loop-config-and-progress-design.md'
  ```

  Expected: both return empty.

- [ ] **Manual TDD hook smoke:**
      Make a trivial edit to one file in `review-loop/src/` (e.g., add and remove a blank line in `review-loop/src/summary.ts`). Confirm the TDD hook pipeline fires (write-policy → test-first → targeted test run) and the targeted test is `tests/review-loop/…` (the test may not exist for every source file; use one that does, like `review-loop/src/issue-fingerprint.ts` which maps to `tests/review-loop/issue-fingerprint.test.ts`).

- [ ] **Commit log sanity:**
  ```bash
  git log --oneline HEAD~4..HEAD
  ```
  Expected: four commits in order — scaffold, move/rewire, resolver, docs.

---

## Risk notes

- **Bun workspace hoisting.** Moving `@agentclientprotocol/sdk` from root devDeps to `review-loop/package.json` runtime deps should not break `bun run --filter review-loop start`; bun hoists workspace deps. If resolution fails, nuke `node_modules` and `bun.lock` and re-install fresh.
- **Resolver coupling.** The four edits in Task 3 are tightly coupled — partial application will break the hook flow in subtle ways (e.g., tests can't find impl, or impl edits bypass the gate silently). The Step 5/6 smoke tests exist specifically to catch this.
- **knip error escalation.** `knip.jsonc` treats every rule as `"error"`. If moving files exposes previously-hidden knip errors (e.g., unused exports in `review-loop/src/`), fix them in Task 4 rather than deferring — they won't go away on their own.
- **Historical references.** The final grep excludes five specific historical documents. If a future reviewer objects to those exclusions, the right answer is to leave those historical files alone (they are immutable records) and, if needed, add a top-line editor's note with a link to the new spec — but that is out of scope for this plan.

---

## Self-review notes (author checklist performed pre-publication)

- Spec coverage: every section of the design spec has a task. The `review-loop/CLAUDE.md` fields called out in the spec (Purpose, Storage/Artifacts, Scripts, TDD Hooks, Dependencies) are all filled in concretely in Task 4 Step 1 with details verified against `run-state.ts`, `progress-log.ts`, and `config.example.json`.
- Placeholder scan: no TBD/TODO/fill-in markers. Every code block shows the actual content to write.
- Type consistency: no new types introduced by this plan. All identifiers (`isGateableImplFile`, `suggestTestPath`, `findTestFile`, `resolveImplPath`, `review-loop:test`, `review-loop:typecheck`, `review-loop:lint`, `review-loop:format:check`, `review-loop:start`) are used consistently across tasks.
- Commit boundary: Task 2 is deliberately atomic (source move + root-script rename in one commit) so `bun review:loop` is never half-broken. The plan explicitly calls this out.
