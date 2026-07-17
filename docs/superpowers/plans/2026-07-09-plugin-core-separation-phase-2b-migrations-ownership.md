<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plugin / Core Separation — Phase 2b-migrations: Coding Module Table Ownership — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the coding trusted module ownership of the DB tables it uses: move migrations `061_coding_session_credentials`, `064_coding_session_repos`, and `066_coding_repos_egress` from core's static `MIGRATIONS` array into `codingModule.migrations` (run at startup by the already-wired `loadTrustedModules()`), and generalize the shared test harness to run trusted-module migrations as production does. `065_coding_identity` stays in core (it alters the core-owned `authorized_groups` table).

**Architecture:** Two-tier ports & adapters (spec `docs/superpowers/specs/2026-07-02-plugin-core-separation-design.md`). Phase 2 built `applyModuleMigrations` + `loadTrustedModules` (which already runs each module's `migrations` after `initDb()`); Phase 2b moved the coding code into `src/modules/coding/`. This phase populates `codingModule.migrations` so the kernel's `src/db` schema stops declaring those tables — real "module owns its tables". Migration **files** stay in `src/db/migrations/` (append-only history); only their **registration/ownership** moves.

**Tech Stack:** Bun + strict TypeScript, `bun:test`. Imports use the `.js` extension.

---

## Why this is safe (established by analysis — read before starting)

- **Same ids ⇒ no double-apply, no reapply.** `runMigrations` records applied ids in one shared `migrations` bookkeeping table and skips ids already present. Moving `061/064/066` (ids unchanged) from core's array to the module's array — run via a separate `runMigrations` call on the same DB — means: an **already-migrated production DB** skips them (already recorded); a **fresh DB** applies them once. (`src/db/migrate.ts` `runMigrations`/`getAppliedIds`.)
- **Fresh-DB ordering is safe.** Production runs core migrations in `initDb()` then module migrations in `loadTrustedModules()` (which is called immediately after `initDb()`, before plugin discovery/activation and before any chat turn). On a fresh DB the core pass now runs `…060, 062, 063, 065` and the coding pass then runs `061, 064, 066`. Nothing in `062`/`063`/`065` references `coding_session_credentials` or `coding_session_repos`, and `065` alters `authorized_groups` (unrelated). Within the coding pass, `061` (create credentials), `064` (create repos), `066` (alter repos) are ascending and self-consistent. No cross-pass dependency is violated.
- **`065_coding_identity` must stay in core.** It does `ALTER TABLE authorized_groups ADD COLUMN coding_identity` — `authorized_groups` is a core table read/written by core code (`src/authorized-groups.ts`, `src/debug/settings/group-routes.ts`). A trusted module altering a core table would break the ownership model and make a core column's existence depend on an optional module loading. Leave `065` where it is.
- **Test harness must run module migrations too.** `setupTestDb()` builds its in-memory snapshot from core `MIGRATIONS` only. If `061/064/066` leave that array without a harness change, the coding tables wouldn't exist in tests and every coding-store test would fail. Task 1 generalizes the harness to run trusted-module migrations as additional passes (mirroring production) — done **first**, as a no-op (coding has no migrations yet), so the suite stays green; Task 2 then moves the migrations into that ready harness.

**Behavior invariant:** identical runtime behavior. Production applies the same migrations in the same effective order (core then module); an upgraded DB is a no-op; a fresh DB gets identical schema. The test snapshot ends with the identical schema (all tables) it had before.

---

## File Structure

**Modify:**

- `tests/utils/test-helpers.ts` — generalize `buildMigratedSnapshot`/`setupMigratedTestDb` to run an ordered list of migration passes; `setupTestDb` runs `[MIGRATIONS, …trusted-module migration passes]`. (Task 1)
- `src/modules/coding/module.ts` — add `migrations: [061, 064, 066]` importing the migration objects from `src/db/migrations/`; update the doc comment. (Task 2)
- `src/db/index.ts` — remove the `061/064/066` imports and their `MIGRATIONS` entries; keep `065`. (Task 2)
- `tests/db/migration-registration.test.ts` — update the "last migration" assertion and add a core-ownership guard. (Task 2)
- `tests/modules/coding/module.test.ts` — replace the "no migrations" assertion with the owned-migrations assertion. (Task 2)

**Not changed:** the migration files in `src/db/migrations/` (stay put), `src/db/coding-*-schema.ts` (stay), `src/composition/*` and `src/db/index.ts`'s `applyModuleMigrations`/`loadTrustedModules` wiring (already correct — Task 2 only supplies data they consume), per-migration tests `tests/db/migrations/06{1,4,6}_*.test.ts` (import the objects directly; unaffected).

---

## Task 1: Generalize the test harness to run trusted-module migrations (no-op today)

**Files:** `tests/utils/test-helpers.ts`

This is a behavior-preserving refactor: today the coding module has no migrations, so `setupTestDb` still runs exactly `MIGRATIONS`. It must keep the full suite green. It readies the harness so Task 2's ownership move keeps the coding tables present in tests.

Current relevant code (`tests/utils/test-helpers.ts`):

```ts
type MigrationSet = readonly { id: string; up: (db: Database) => void }[]
const migratedSnapshotCache = new Map<MigrationSet, Uint8Array>()

async function buildMigratedSnapshot(migrations: MigrationSet): Promise<Uint8Array> {
  const cached = migratedSnapshotCache.get(migrations)
  if (cached !== undefined) return cached

  const { runMigrations } = await import('../../src/db/migrate.js')
  const template = new Database(':memory:')
  template.run('PRAGMA foreign_keys=ON')
  runMigrations(template, migrations)
  const snapshot = template.serialize()
  template.close()
  migratedSnapshotCache.set(migrations, snapshot)
  return snapshot
}

async function setupMigratedTestDb(migrations: MigrationSet): Promise<ReturnType<typeof drizzle<typeof schema>>> {
  const { userCachesForTesting } = await import('../../src/cache.js')
  userCachesForTesting.clear()
  const { resetPluginRegistryForTesting } = await import('../../src/plugins/registry.js')
  resetPluginRegistryForTesting()

  const snapshot = await buildMigratedSnapshot(migrations)
  testSqlite = Database.deserialize(snapshot)
  testSqlite.run('PRAGMA foreign_keys=ON')
  testDb = drizzle(testSqlite, { schema })
  setDrizzleDbForTesting(testDb)
  return testDb
}

export function setupTestDb(): Promise<ReturnType<typeof drizzle<typeof schema>>> {
  return setupMigratedTestDb(MIGRATIONS)
}

export function setupSettingsAuthTestDb(): Promise<ReturnType<typeof drizzle<typeof schema>>> {
  return import('../../src/db/migrations/050_settings_auth.js').then(({ migration050SettingsAuth }) =>
    setupMigratedTestDb([migration050SettingsAuth]),
  )
}
```

- [ ] **Step 1: Add the composition import**

Near the other `src/` imports at the top of `tests/utils/test-helpers.ts`, add (respecting import ordering so `bun run format:check` stays green):

```ts
import { TRUSTED_MODULES } from '../../src/composition/trusted-modules.js'
```

- [ ] **Step 2: Rewrite the snapshot/setup helpers to take an ordered list of passes**

Replace the block shown above (from the `migratedSnapshotCache` declaration through `setupSettingsAuthTestDb`) with:

```ts
type MigrationSet = readonly { id: string; up: (db: Database) => void }[]
// Cache keyed by the concatenated migration ids across all passes (stable per distinct
// pass-set) so we still migrate-once-and-clone, now supporting multiple passes.
const migratedSnapshotCache = new Map<string, Uint8Array>()

const snapshotCacheKey = (passes: readonly MigrationSet[]): string =>
  passes.map((pass) => pass.map((m) => m.id).join(',')).join('|')

// Trusted-module migration passes, mirroring production: core migrations run first (initDb),
// then each trusted module's own migrations (loadTrustedModules), one pass per module so each
// is validated independently.
const TRUSTED_MODULE_MIGRATION_PASSES: readonly MigrationSet[] = TRUSTED_MODULES.map((m) => m.migrations).filter(
  (migrations): migrations is MigrationSet => migrations !== undefined && migrations.length > 0,
)

async function buildMigratedSnapshot(passes: readonly MigrationSet[]): Promise<Uint8Array> {
  const key = snapshotCacheKey(passes)
  const cached = migratedSnapshotCache.get(key)
  if (cached !== undefined) return cached

  const { runMigrations } = await import('../../src/db/migrate.js')
  const template = new Database(':memory:')
  template.run('PRAGMA foreign_keys=ON')
  for (const pass of passes) runMigrations(template, pass)
  // serialize() copies the schema into a standalone image; deserialize() below
  // copies it back into a fresh private DB, so the cached buffer is never mutated.
  const snapshot = template.serialize()
  template.close()
  migratedSnapshotCache.set(key, snapshot)
  return snapshot
}

async function setupMigratedTestDb(
  passes: readonly MigrationSet[],
): Promise<ReturnType<typeof drizzle<typeof schema>>> {
  const { userCachesForTesting } = await import('../../src/cache.js')
  userCachesForTesting.clear()
  const { resetPluginRegistryForTesting } = await import('../../src/plugins/registry.js')
  resetPluginRegistryForTesting()

  const snapshot = await buildMigratedSnapshot(passes)
  testSqlite = Database.deserialize(snapshot)
  testSqlite.run('PRAGMA foreign_keys=ON')
  testDb = drizzle(testSqlite, { schema })
  setDrizzleDbForTesting(testDb)
  return testDb
}

export function setupTestDb(): Promise<ReturnType<typeof drizzle<typeof schema>>> {
  return setupMigratedTestDb([MIGRATIONS, ...TRUSTED_MODULE_MIGRATION_PASSES])
}

export function setupSettingsAuthTestDb(): Promise<ReturnType<typeof drizzle<typeof schema>>> {
  return import('../../src/db/migrations/050_settings_auth.js').then(({ migration050SettingsAuth }) =>
    setupMigratedTestDb([[migration050SettingsAuth]]),
  )
}
```

Keep the surrounding doc comments; only the cache declaration, the two internal helpers, and the two exported setup functions change. Note `setupSettingsAuthTestDb` now wraps its single migration in a nested array (`[[…]]`) because the parameter is a list of passes.

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: clean. (`TRUSTED_MODULES[n].migrations` is `readonly Migration[] | undefined`; `Migration` is `{ id; up(db) }`, assignable to `MigrationSet`.)

- [ ] **Step 4: Prove it is a no-op — run a broad slice of the suite**

Run: `bun test tests/modules/coding/ tests/coding-credentials 2>/dev/null; bun test tests/db/ tests/plugins/ tests/debug/settings/`
Expected: PASS. (Today `TRUSTED_MODULE_MIGRATION_PASSES` is empty — `codingModule.migrations` is still undefined — so `setupTestDb` runs `[MIGRATIONS]`, identical schema to before. The whole suite is exercised in Task 3; this step is a fast confidence check that the harness refactor changed nothing.)

- [ ] **Step 5: Commit**

```bash
git add tests/utils/test-helpers.ts
git commit -m "test(harness): setupTestDb runs trusted-module migrations as ordered passes"
```

---

## Task 2: Move `061/064/066` ownership into the coding module

**Files:** `src/modules/coding/module.ts`, `src/db/index.ts`, `tests/db/migration-registration.test.ts`, `tests/modules/coding/module.test.ts`

Migration export names (confirmed): `migration061CodingSessionCredentials` (`src/db/migrations/061_coding_session_credentials.ts`), `migration064CodingSessionRepos` (`064_coding_session_repos.ts`), `migration066CodingReposEgress` (`066_coding_repos_egress.ts`), `migration065CodingIdentity` (`065_coding_identity.ts` — stays in core).

- [ ] **Step 1: Update the tests first (they now fail against current code — TDD)**

In `tests/modules/coding/module.test.ts`, replace the existing test:

```ts
test('contributes no migrations in this phase', () => {
  expect(codingModule.migrations).toBeUndefined()
})
```

with:

```ts
test('owns the coding-table migrations (061/064/066), in ascending order', () => {
  expect(codingModule.migrations?.map((m) => m.id)).toEqual([
    '061_coding_session_credentials',
    '064_coding_session_repos',
    '066_coding_repos_egress',
  ])
})
```

In `tests/db/migration-registration.test.ts`, replace the existing test:

```ts
test('066_coding_repos_egress is the last migration', () => {
  const lastMigration = requireDefined(MIGRATIONS.at(-1))
  expect(lastMigration.id).toBe('066_coding_repos_egress')
})
```

with:

```ts
test('065_coding_identity is the last core migration', () => {
  const lastMigration = requireDefined(MIGRATIONS.at(-1))
  expect(lastMigration.id).toBe('065_coding_identity')
})

test('coding-table migrations are owned by the coding module, not core', () => {
  const ids = MIGRATIONS.map((m) => m.id)
  expect(ids).not.toContain('061_coding_session_credentials')
  expect(ids).not.toContain('064_coding_session_repos')
  expect(ids).not.toContain('066_coding_repos_egress')
  // 065 alters the core-owned authorized_groups table, so it stays in core.
  expect(ids).toContain('065_coding_identity')
})
```

- [ ] **Step 2: Run the updated tests to verify they FAIL**

Run: `bun test tests/modules/coding/module.test.ts tests/db/migration-registration.test.ts`
Expected: FAIL — `codingModule.migrations` is still `undefined`; core `MIGRATIONS` still ends with `066` and still contains `061/064/066`.

- [ ] **Step 3: Add the migrations to the coding module**

In `src/modules/coding/module.ts`, add the imports (from `src/db/migrations/` — path `../../db/migrations/` from `src/modules/coding/`):

```ts
import { migration061CodingSessionCredentials } from '../../db/migrations/061_coding_session_credentials.js'
import { migration064CodingSessionRepos } from '../../db/migrations/064_coding_session_repos.js'
import { migration066CodingReposEgress } from '../../db/migrations/066_coding_repos_egress.js'
```

Add the `migrations` field to `codingModule` (ascending order; `onActivate` unchanged) and update the doc comment:

```ts
/**
 * The coding trusted module. It owns the coding-session DB tables via `migrations` (run by the
 * composition root's loadTrustedModules → applyModuleMigrations after core initDb), and on
 * activation registers the operator allowlist resolver so the orchestrator can gate
 * coding-session tools without importing the coding feature. (`065_coding_identity` stays in
 * core — it alters the core-owned `authorized_groups` table.)
 */
export const codingModule: TrustedModule = {
  id: 'coding',
  migrations: [migration061CodingSessionCredentials, migration064CodingSessionRepos, migration066CodingReposEgress],
  onActivate(): void {
    operatorAllowlistPort.register(codingWhoMayUseResolver)
  },
}
```

- [ ] **Step 4: Remove `061/064/066` from core's `MIGRATIONS` (keep `065`)**

In `src/db/index.ts`:

(a) Delete these three import lines (keep the `migration065CodingIdentity` import):

```ts
import { migration061CodingSessionCredentials } from './migrations/061_coding_session_credentials.js'
import { migration064CodingSessionRepos } from './migrations/064_coding_session_repos.js'
import { migration066CodingReposEgress } from './migrations/066_coding_repos_egress.js'
```

(b) Delete these three entries from the `MIGRATIONS` array (keep `migration065CodingIdentity`):

```ts
  migration061CodingSessionCredentials,
  migration064CodingSessionRepos,
  migration066CodingReposEgress,
```

Leave everything else — including `migration065CodingIdentity` (import and array entry) — untouched. After removal, core's array tail is `…, migration063…, migration065CodingIdentity` and `validateOrder` still passes (ascending with gaps at 061/064/066 is allowed).

- [ ] **Step 5: Run the updated tests to verify they PASS**

Run: `bun test tests/modules/coding/module.test.ts tests/db/migration-registration.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the coding-store + migration suites (the real safety net for the harness two-pass)**

Run: `bun test tests/modules/coding/ tests/db/ tests/plugins/coding-secrets-facade.test.ts tests/plugins/coding-repos-facade.test.ts tests/debug/settings/`
Expected: PASS. This exercises `setupTestDb`'s new second pass end-to-end: the coding-store tests read/write `coding_session_credentials` / `coding_session_repos`, which now exist in the test DB **only** because Task 1's harness ran `codingModule.migrations`. Green here proves the ownership move + harness change work together. Also confirms the per-migration tests (`tests/db/migrations/06{1,4,6}_*.test.ts`) still pass (they import the objects directly; unaffected).

- [ ] **Step 7: Typecheck + knip**

Run: `bun run typecheck`
Expected: clean.

Run: `bun run knip`
Expected: clean — the `061/064/066` migration files are now imported by `src/modules/coding/module.ts` instead of `src/db/index.ts`, so they remain reachable (not unused). If knip flags a migration file as unused, an import in `module.ts` is missing/typo'd.

- [ ] **Step 8: Commit**

```bash
git add src/modules/coding/module.ts src/db/index.ts tests/db/migration-registration.test.ts tests/modules/coding/module.test.ts
git commit -m "feat(modules): coding module owns its table migrations (061/064/066)"
```

---

## Task 3: Full verification

- [ ] **Step 1: Build client bundles (needed by the debug suite), then full test suite**

```bash
bun build:client
```

Run: `bun test`
Expected: PASS with **7752/0** — exactly one more than the pre-phase 7751 (the added core-ownership guard test in `migration-registration.test.ts`; the two other edited tests are 1-for-1 replacements). If `tests/debug/*` fail with "Missing client bundles in public/", run `bun build:client` and re-run.

- [ ] **Step 2: Full check pipeline**

Run: `bun check:full`
Expected: all checks pass (lint, typecheck, format:check, license-headers, knip, tests, client + review-loop checks). Fix formatting with `bun run format` and re-run if needed.

- [ ] **Step 3: Fresh-DB production-path sanity check (optional but recommended)**

Confirm a fresh database gets the coding tables via the module pass (not core). In a scratch dir with a throwaway `DB_PATH`, start the app (or a minimal script that calls `initDb()` then `loadTrustedModules()`), then verify the tables exist:

```bash
# example: point at a throwaway DB and confirm the coding tables were created by the module pass
DB_PATH=/tmp/papai-freshdb-check.sqlite bun -e "import('./src/db/index.js').then(async (db) => { db.initDb(); const { loadTrustedModules } = await import('./src/composition/load-trusted-modules.js'); await loadTrustedModules(); const { Database } = await import('bun:sqlite'); const d = new Database('/tmp/papai-freshdb-check.sqlite'); console.log(d.query(\"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('coding_session_credentials','coding_session_repos')\").all()); })" ; rm -f /tmp/papai-freshdb-check.sqlite
```

Expected: both `coding_session_credentials` and `coding_session_repos` present. (If your environment requires other startup env vars, skip this and rely on the test-suite proof from Task 2 Step 6, which already exercises the two-pass schema build.)

- [ ] **Step 4: Final formatting commit (only if `bun run format` changed anything)**

```bash
git add -A
git commit -m "chore: formatting for coding-module migration ownership"
```

---

## Done criteria

- `codingModule.migrations` is `[061_coding_session_credentials, 064_coding_session_repos, 066_coding_repos_egress]`; core `MIGRATIONS` no longer contains those three (asserted by `tests/modules/coding/module.test.ts` and `tests/db/migration-registration.test.ts`).
- `065_coding_identity` remains in core (it alters the core `authorized_groups` table).
- The migration **files** remain in `src/db/migrations/`; the schema files remain in `src/db/`.
- `setupTestDb` runs core migrations then trusted-module migrations as separate passes, so the test DB schema is unchanged; `bun test` passes (count +1 from the added guard test) and `bun check:full` is green.
- Behavior-preserving: upgraded DBs skip the (already-applied) coding migrations; fresh DBs create the coding tables via the module pass (`loadTrustedModules` → `applyModuleMigrations`), verified by the coding-store suite (which now depends on the module pass for those tables) and, optionally, the fresh-DB sanity check.
- The kernel's `src/db/index.ts` no longer declares the coding-session tables — the coding module owns them. The remaining coding leaks in core (`codingSecrets`/`codingRepos` facades on `PluginToolRuntimeContext`, the `coding.secrets` permission, and the various `src/debug/settings/**` coding routes) are the subject of Phase 2c / later phases.
