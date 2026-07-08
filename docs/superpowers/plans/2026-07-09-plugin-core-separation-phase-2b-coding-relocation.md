<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plugin / Core Separation — Phase 2b: Coding Module Code Relocation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Physically relocate `src/coding-credentials/` and `src/coding-repos/` (and their test directories) into the coding trusted module at `src/modules/coding/{credentials,repos}/`, updating every import path — a pure, behavior-preserving move with no logic, schema, migration, or test-harness changes.

**Architecture:** Two-tier ports & adapters (spec `docs/superpowers/specs/2026-07-02-plugin-core-separation-design.md`). Phase 2 introduced the trusted-module system and the coding module (`src/modules/coding/module.ts`). This phase moves the coding feature's implementation code _under_ that module directory, so the module physically owns its code. DB table **ownership** (moving migrations 061/064/066 into the module) and the required `setupTestDb` change are deliberately deferred to a separate follow-up (Phase 2b-migrations).

**Tech Stack:** Bun + strict TypeScript, `bun:test`. Imports use the `.js` extension. `bun run typecheck` is the exhaustive oracle for import correctness in this relocation.

---

## Scope & Deferred (read first)

**In scope — a pure relocation:**

- Move `src/coding-repos/` → `src/modules/coding/repos/` (2 files) + `tests/coding-repos/` → `tests/modules/coding/repos/` (2 files).
- Move `src/coding-credentials/` → `src/modules/coding/credentials/` (6 files) + `tests/coding-credentials/` → `tests/modules/coding/credentials/` (8 files).
- Update every import path: the moved files' own imports, and all external importers.
- Update the now-stale doc comment in `src/modules/coding/module.ts`.

**Deliberately deferred (do NOT do here):**

- **Migration ownership.** Migrations `061_coding_session_credentials`, `064_coding_session_repos`, `065_coding_identity`, `066_coding_repos_egress` **stay registered in core** (`src/db/index.ts` `MIGRATIONS`). Moving 061/064/066 into `codingModule.migrations` requires changing the shared `setupTestDb`/`buildMigratedSnapshot` harness to run trusted-module migrations (else the coding tables wouldn't exist in tests) — that is a separate, higher-risk plan (Phase 2b-migrations). (`065_coding_identity` must in any case stay in core: it `ALTER`s the core-owned `authorized_groups` table.)
- **Schema files stay in `src/db/`.** `src/db/coding-credentials-schema.ts` and `src/db/coding-repos-schema.ts` do **not** move (repo convention: all Drizzle schemas live in `src/db/`, re-exported from `src/db/schema.ts`). The moved store files keep importing them, only at a deeper relative path.
- **`CredentialVaultPort` + removing the `codingSecrets`/`codingRepos` facades** from `PluginToolRuntimeContext` — Phase 2c.
- **No logic changes.** Not a single function body changes. Only file locations and import specifiers.

**Behavior invariant:** identical behavior before and after. Every export keeps its name and semantics; only its file path changes. The full test suite is the safety net; it must stay green with no test-logic changes (only import-path edits in tests).

**Guard note:** `tests/architecture-guard.test.ts` scans `src/ports/**` (not `src/modules/**`) and asserts `src/llm-orchestrator-tools.ts` names no coding feature. Moving code into `src/modules/coding/` is guard-neutral — modules are permitted to name their own feature — so the guard needs no change.

---

## The two transformation rules (used throughout)

There are exactly two kinds of edits. Apply them mechanically, then let `bun run typecheck` prove completeness (0 errors ⇒ every import resolves).

**Rule A — moved files** (any file that physically moves, `src/` or `tests/`): the file drops **2 directory levels deeper** (`src/coding-repos/…` → `src/modules/coding/repos/…`). So:

- A1. In every import specifier, replace the segment `coding-credentials/` → `modules/coding/credentials/` and `coding-repos/` → `modules/coding/repos/`. (The trailing slash matters: it protects the schema filenames `coding-credentials-schema.js` / `coding-repos-schema.js`, which have no slash after `credentials`/`repos` and must **not** be rewritten.)
- A2. Then prepend `../../` to every relative specifier that starts with `../` (depth +2). Sibling imports starting with `./` are unchanged.

  Worked examples (a moved credentials file):
  - `'../logger.js'` → `'../../../logger.js'`
  - `'../db/coding-credentials-schema.js'` → `'../../../db/coding-credentials-schema.js'` (A1 no-op — no `credentials/` slash; A2 depth only)
  - `'./types.js'` → unchanged
  - (moved test) `'../../src/coding-credentials/store.js'` → A1 → `'../../src/modules/coding/credentials/store.js'` → A2 → `'../../../../src/modules/coding/credentials/store.js'`
  - (moved test) `'../utils/test-helpers.js'` → A2 → `'../../../utils/test-helpers.js'`

**Rule B — external importers** (files that do **not** move but import the moved code): apply **only A1** (segment replace); no depth change. Exact per-file edits are listed in each task.

---

## Task 1: Relocate `coding-repos`

**Files moved:** `src/coding-repos/{types.ts,store.ts}` → `src/modules/coding/repos/`; `tests/coding-repos/{types.test.ts,store.test.ts}` → `tests/modules/coding/repos/`.

**External importers (Rule B):**

- `src/plugins/coding-secrets-facade.ts:17` — `from '../coding-repos/store.js'` → `from '../modules/coding/repos/store.js'`
- `src/debug/settings/coding-repos-routes.ts:8` — `from '../../coding-repos/store.js'` → `from '../../modules/coding/repos/store.js'`
- `src/debug/settings/coding-repos-routes.ts:9` — `from '../../coding-repos/types.js'` → `from '../../modules/coding/repos/types.js'`
- `tests/plugins/coding-repos-facade.test.ts:9` — `from '../../src/coding-repos/store.js'` → `from '../../src/modules/coding/repos/store.js'`

> Not affected: `tests/db/coding-repos-schema.test.ts` and `tests/debug/settings/coding-repos-routes.test.ts` import the schema / the route handler, not `src/coding-repos/*` — leave them alone.

- [ ] **Step 1: Move both directories with git (preserves history, skips the Write/Edit TDD hook)**

The destination parent `src/modules/coding/` already exists (it contains `module.ts`).

```bash
git mv src/coding-repos src/modules/coding/repos
mkdir -p tests/modules/coding
git mv tests/coding-repos tests/modules/coding/repos
```

Moving the test directory alongside the source is required so each moved source file still has its companion test at the mirrored path (`src/modules/coding/repos/store.ts` ↔ `tests/modules/coding/repos/store.test.ts`) — otherwise the TDD pre-write hook blocks the import edits in Step 2.

- [ ] **Step 2: Fix imports in the moved files (Rule A)**

Moved source files:

- `src/modules/coding/repos/store.ts` — apply A2 to its four `../` imports:
  - `'../db/coding-repos-schema.js'` → `'../../../db/coding-repos-schema.js'`
  - `'../db/drizzle.js'` → `'../../../db/drizzle.js'`
  - `'../logger.js'` → `'../../../logger.js'`
  - `'./types.js'` — unchanged (sibling)
- `src/modules/coding/repos/types.ts` — no relative imports; nothing to change.

Moved test files (`tests/modules/coding/repos/store.test.ts`, `types.test.ts`) — apply Rule A (A1 then A2) to every relative import. Concretely: any `'../../src/coding-repos/…'` becomes `'../../../../src/modules/coding/repos/…'`; any `'../utils/…'` becomes `'../../../utils/…'`; any `'../../src/db/…'` becomes `'../../../../src/db/…'`.

- [ ] **Step 3: Fix the external importers (Rule B — exact edits above)**

Edit the four external-importer lines listed above (segment replace only, no depth change).

- [ ] **Step 4: Typecheck to prove all imports resolve**

Run: `bun run typecheck`
Expected: clean (0 errors). Typecheck statically resolves every import — a non-zero result lists any path you missed; fix it (re-applying Rule A/B) and re-run until clean.

- [ ] **Step 5: Run the affected tests**

Run: `bun test tests/modules/coding/repos/ tests/plugins/coding-repos-facade.test.ts tests/debug/settings/coding-repos-routes.test.ts`
Expected: PASS — same tests as before, only relocated / repath'd. No test logic changed.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(modules): relocate coding-repos into src/modules/coding/repos"
```

> `git add -A` is appropriate here because a relocation touches renamed paths (git records them as rename + import edits); confirm with `git status` first that only the intended coding-repos source/test files and the four external importers are staged — nothing unrelated.

---

## Task 2: Relocate `coding-credentials`

**Files moved:** `src/coding-credentials/{types.ts,store.ts,guardrails.ts,mcp-catalog.ts,resolve-agent-secrets.ts,provider-models.ts}` → `src/modules/coding/credentials/`; `tests/coding-credentials/{guardrails,mcp-catalog,provider-models,redaction-log,redaction,resolve-agent-secrets,store,types}.test.ts` (8 files) → `tests/modules/coding/credentials/`.

**External importers (Rule B):**

- `src/modules/coding/module.ts:6` — `from '../../coding-credentials/guardrails.js'` → **`from './credentials/guardrails.js'`** (special case: `module.ts` is the sibling parent of `credentials/`, so use the short `./credentials/` form, not the mechanical `../../modules/coding/credentials/`).
- `src/plugins/coding-secrets-facade.ts:6` — `from '../coding-credentials/resolve-agent-secrets.js'` → `from '../modules/coding/credentials/resolve-agent-secrets.js'`
- `src/debug/settings/coding-credentials-routes.ts` (lines 8, 9, 10, 16, 17 — every `'../../coding-credentials/…'`) → `'../../modules/coding/credentials/…'`
- `src/debug/settings/coding-credentials-fields-meta.ts:6` — `'../../coding-credentials/types.js'` → `'../../modules/coding/credentials/types.js'`
- `src/debug/settings/coding-credentials-models-route.ts` (lines 6, 7) — `'../../coding-credentials/…'` → `'../../modules/coding/credentials/…'`
- `src/debug/settings/admin/coding-guardrails-routes.ts` (lines 8, 14, 19 — every `'../../../coding-credentials/…'`) → `'../../../modules/coding/credentials/…'`
- `src/debug/settings/admin/mcp-catalog-routes.ts:8` — `'../../../coding-credentials/mcp-catalog.js'` → `'../../../modules/coding/credentials/mcp-catalog.js'`
- `tests/plugins/coding-secrets-facade.test.ts` (lines 9, 10) — `'../../src/coding-credentials/…'` → `'../../src/modules/coding/credentials/…'`
- `tests/modules/coding/module.test.ts:8` — `'../../../src/coding-credentials/guardrails.js'` → `'../../../src/modules/coding/credentials/guardrails.js'`
- `tests/debug/settings/coding-credentials-routes.test.ts` (lines 10, 11) — `'../../../src/coding-credentials/…'` → `'../../../src/modules/coding/credentials/…'`
- `tests/debug/settings/coding-credentials-fields-meta.test.ts:8` — `'../../../src/coding-credentials/types.js'` → `'../../../src/modules/coding/credentials/types.js'`

> Not affected (leave alone): `tests/db/coding-credentials-schema.test.ts` (schema import — schema stays), `tests/debug/settings/coding-credentials-models-route.test.ts` (imports the route handler, not `coding-credentials/`), and all `client/**` / `tests/client/**` files (they reference the HTTP URL string `/settings/api/coding-credentials`, not a module path — do **not** change those strings).

- [ ] **Step 1: Move both directories with git**

```bash
git mv src/coding-credentials src/modules/coding/credentials
git mv tests/coding-credentials tests/modules/coding/credentials
```

- [ ] **Step 2: Fix imports in the moved source files (Rule A2 — every `../` gets `../../` prepended; `./` siblings unchanged)**

- `src/modules/coding/credentials/store.ts`:
  - `'../db/coding-credentials-schema.js'` → `'../../../db/coding-credentials-schema.js'`
  - `'../db/drizzle.js'` → `'../../../db/drizzle.js'`
  - `'../logger.js'` → `'../../../logger.js'`
  - `'../secret-payload-crypto.js'` → `'../../../secret-payload-crypto.js'`
  - `'./types.js'` — unchanged
- `src/modules/coding/credentials/guardrails.ts`:
  - `'../cache.js'` → `'../../../cache.js'`
  - `'./types.js'` — unchanged
- `src/modules/coding/credentials/mcp-catalog.ts`:
  - `'../cache.js'` → `'../../../cache.js'`
- `src/modules/coding/credentials/provider-models.ts`:
  - `'../web/safe-fetch.js'` → `'../../../web/safe-fetch.js'`
- `src/modules/coding/credentials/resolve-agent-secrets.ts`:
  - `'../authorized-groups.js'` → `'../../../authorized-groups.js'`
  - `'../chat/scoped-context.js'` → `'../../../chat/scoped-context.js'`
  - `'../logger.js'` → `'../../../logger.js'`
  - `'../tools/tool-preferences.js'` → `'../../../tools/tool-preferences.js'`
  - `'./guardrails.js'`, `'./mcp-catalog.js'`, `'./store.js'`, `'./types.js'` — all unchanged (siblings)
- `src/modules/coding/credentials/types.ts`: no relative imports.

- [ ] **Step 3: Fix imports in the moved test files (Rule A — A1 segment replace + A2 depth prepend)**

For each of the 8 moved test files, apply Rule A to every relative import. The pattern per specifier:

- `'../../src/coding-credentials/X'` → `'../../../../src/modules/coding/credentials/X'`
- `'../../src/db/coding-credentials-schema.js'` → `'../../../../src/db/coding-credentials-schema.js'` (schema stays; depth-only)
- `'../utils/test-helpers.js'` → `'../../../utils/test-helpers.js'`
- any other `'../../src/…'` → `'../../../../src/…'`

**Manual-attention item (typecheck will NOT catch it):** `tests/modules/coding/credentials/redaction-log.test.ts` uses a **runtime dynamic import with a template-literal path** and cache-busting query string, roughly:

```ts
await import(`../../src/coding-credentials/store.js?test=${crypto.randomUUID()}`)
```

Update this template string to:

```ts
await import(`../../../../src/modules/coding/credentials/store.js?test=${crypto.randomUUID()}`)
```

(The sibling `typeof import('../../src/coding-credentials/store.js')` type annotation in the same file _is_ statically checked and will be flagged by typecheck; the template-literal runtime import is not — fix both.)

- [ ] **Step 4: Fix the external importers (Rule B — exact edits listed above)**

Apply the segment replace to every external-importer line enumerated above. Remember the `module.ts` special case (`./credentials/guardrails.js`).

- [ ] **Step 5: Typecheck to prove all imports resolve**

Run: `bun run typecheck`
Expected: clean (0 errors). Fix any reported unresolved path and re-run until clean. (This catches every static import — including the `typeof import(...)` type annotation in `redaction-log.test.ts` — but NOT the runtime template-literal import fixed manually in Step 3.)

- [ ] **Step 6: Run the affected tests**

Run: `bun test tests/modules/coding/ tests/plugins/coding-secrets-facade.test.ts tests/debug/settings/coding-credentials-routes.test.ts tests/debug/settings/coding-credentials-fields-meta.test.ts tests/debug/settings/coding-credentials-models-route.test.ts`
Expected: PASS. Pay special attention to `tests/modules/coding/credentials/redaction-log.test.ts` (the dynamic-import one) — if it fails to load the module, the template-literal path in Step 3 is wrong.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(modules): relocate coding-credentials into src/modules/coding/credentials"
```

> Confirm with `git status` that only the coding-credentials source/test renames and the listed external importers are staged.

---

## Task 3: Doc cleanup + full verification

**Files:** `src/modules/coding/module.ts` (doc comment), optional client Svelte comments.

- [ ] **Step 1: Update the stale doc comment in `src/modules/coding/module.ts`**

The module's doc comment currently says its tables/code relocation is "a later phase". The code has now moved in. Update the comment on `codingModule` so it is accurate — e.g. replace the parenthetical:

> `(It owns no tables yet — coding-credentials/coding-repos relocation is a later phase.)`

with:

> `(Its implementation lives under src/modules/coding/{credentials,repos}/; DB table ownership — moving migrations into the module — is a later phase.)`

Keep the rest of the comment and the code unchanged. (Editing `module.ts` is fine under the TDD hook — its companion `tests/modules/coding/module.test.ts` exists.)

- [ ] **Step 2: (Optional) Update cosmetic path references in client comments**

Two Svelte files have comments referencing the old source path (non-load-bearing):

- `client/settings/sections/CodingCredentialsSection.svelte` (comment mentioning `src/coding-credentials/types.ts`)
- `client/settings/sections/CodeHostSection.svelte` (same)

If present, update the referenced path to `src/modules/coding/credentials/types.ts` for accuracy. Skip if the exact comment isn't found — these are cosmetic only.

- [ ] **Step 3: Confirm the old directories are gone and nothing references the old paths**

Run: `rg -n "coding-credentials/|coding-repos/" src tests --glob '!*-schema.*'`
Expected: **no output** except, if any, references to the DB schema files `db/coding-credentials-schema.js` / `db/coding-repos-schema.js` (those legitimately remain — the `--glob '!*-schema.*'` filter already excludes the schema files themselves, but importers of them still contain the `db/coding-credentials-schema.js` string; that is expected and correct). There must be **zero** references to `coding-credentials/<file>` or `coding-repos/<file>` for any non-schema module file.

Also confirm the directories no longer exist:

Run: `test ! -d src/coding-credentials && test ! -d src/coding-repos && test ! -d tests/coding-credentials && test ! -d tests/coding-repos && echo GONE`
Expected: `GONE`.

- [ ] **Step 4: Full test suite**

The `tests/debug/*` suites need built client bundles. Build them first if needed:

```bash
bun build:client
```

Run: `bun test`
Expected: PASS with the **same** pass count as before this phase (a relocation adds/removes no tests). If `tests/debug/*` fail with "Missing client bundles in public/", run `bun build:client` and re-run.

- [ ] **Step 5: Full check pipeline**

Run: `bun check:full`
Expected: all checks pass (lint, typecheck, format:check, license-headers, knip, tests, client + review-loop checks). Fix formatting with `bun run format` and re-run if needed.

> knip note: the moved files have the same importers as before (just new paths), so no new unused exports should appear. If knip flags a moved file as unused, an external importer's path was not updated — fix the importer, don't delete the export.

- [ ] **Step 6: Commit any remaining changes**

```bash
git add -A
git commit -m "chore(modules): tidy coding-module doc comment + path references after relocation"
```

(If Steps 1–2 produced no changes and everything was already committed in Tasks 1–2, skip this commit.)

---

## Done criteria

- `src/coding-credentials/`, `src/coding-repos/`, `tests/coding-credentials/`, `tests/coding-repos/` no longer exist; their contents live under `src/modules/coding/{credentials,repos}/` and `tests/modules/coding/{credentials,repos}/`.
- `rg "coding-credentials/|coding-repos/" src tests` shows only legitimate `db/*-schema.js` importer references — no other module now lives at the old paths.
- `bun run typecheck` → clean; `bun test` → same pass count as before (behavior-preserving); `bun check:full` → green.
- Migrations (061/064/065/066), the two `src/db/*-schema.ts` files, and `setupTestDb` are **unchanged** — table ownership is untouched.
- The next plan (Phase 2b-migrations) can move migrations 061/064/066 into `codingModule.migrations` (065 stays in core) and update `setupTestDb`/`buildMigratedSnapshot` to run trusted-module migrations as a second pass, now that the coding code physically lives in the module.
