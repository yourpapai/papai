<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 3a — Membership Table Rename (`kaneo_workspace_members` → `task_provider_members`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the host-owned membership store from the provider-specific `kaneo_workspace_members` to the provider-agnostic `task_provider_members`, via an additive expand-migration (create new + copy rows, keep old), and switch all code to the new table — the first backend-only slice of Phase 3 (task-tracker host separation).

**Architecture:** The table already carries a `provider_name` column in its composite PK (`group_context_id, chat_user_id, provider_name`, default `'kaneo'`), so its _shape_ is already provider-agnostic — only the table _name_ and the Drizzle export name are the leak. This slice is a pure expand-phase rename: migration `068` creates `task_provider_members` with the identical schema and copies existing rows; the Drizzle schema + all four backend consumers switch to it; the old `kaneo_workspace_members` table is left in place (dropped in a later release, per spec §8). Behavior is fully preserved — including the two `providerName: 'kaneo'` _value_ literals in `ensure-member.ts`, which stay untouched here and are removed in Phase 3b when the `MembershipStorePort` makes the provider name flow from the bound instance.

**Tech Stack:** Bun; strict TypeScript (`.js` import extensions); Drizzle ORM over `bun:sqlite`; Zod v4; `bun:test`.

---

## Context for the implementer (read before starting)

- This is a **behavior-preserving rename**, not a redesign. Do NOT change any membership _logic_, do NOT remove or alter the `providerName: 'kaneo'` value literals in `ensure-member.ts` (lines 77 and 105) — those are deferred to Phase 3b. Do NOT touch `src/providers/registry.ts`, provisioning routes, the plugins, or any client code — those are later Phase 3 sub-phases.
- **Expand-only migration:** create `task_provider_members`, copy rows, and **KEEP `kaneo_workspace_members`** (do not drop it — that's a future release). The old Drizzle export is removed from `membership-schema.ts` (no code references it after the switch), but the old _table_ persists in the DB as a one-release rollback escape hatch.
- **Architecture guard:** `tests/architecture-guard.test.ts` scans only `src/ports/**` for `kaneo|youtrack|magi|coding`. This slice touches `src/db/**` and `src/providers/membership/**` and `src/debug/settings/**` — none scanned — so the `'kaneo'` value literal + the `kaneo-credentials-routes.ts` filename can remain. Run the guard anyway (it must stay green).
- **The confusable file:** `src/llm-orchestrator-membership.ts` (+ `tests/llm-orchestrator-membership.test.ts`) is the guest-mode backstop predicate `shouldBackstopGroupMembership` — a DIFFERENT, unrelated file that does NOT import the membership table. Do NOT touch it. (The real membership store is `src/providers/membership/`.)
- **Provider default:** keep the new table's `provider_name` column `DEFAULT 'kaneo'` identical to the old one (behavior-preserving); Phase 3b revisits the default.

### Verified consumers of the Drizzle export `kaneoWorkspaceMembers` / type `KaneoWorkspaceMember` (all switch)

- `src/db/membership-schema.ts` — the table definition + `$inferSelect` type (renamed).
- `src/db/schema.ts:288` — `export { kaneoWorkspaceMembers, type KaneoWorkspaceMember } from './membership-schema.js'` (re-export, renamed).
- `src/providers/membership/ensure-member.ts` — 5 query sites (lines ~50-51, 68-73, 101-118, 239-243); keep the `providerName: 'kaneo'` VALUE at lines 77, 105.
- `src/debug/settings/kaneo-credentials-routes.ts` — `getKaneoMemberRow` (lines ~19-27), `clearStoredPassword` (lines ~90-96), and the `KaneoWorkspaceMember` type import (line 10).
- Tests: `tests/db/membership-schema.test.ts`, `tests/providers/membership/ensure-member.test.ts`, `tests/debug/settings/kaneo-credentials-routes.test.ts` — import the Drizzle export; switch to the new name.

`src/providers/membership/backfill.ts` and `subscriber.ts` do NOT import the table (backfill imports only `MemberOutcome`) — leave them. No client code touches the table.

### Migration numbering

Highest existing migration file is `067_acp_tool_prefs_rename.ts`. New migration = **`068_task_provider_members`**. It is a CORE migration (registered in the core `MIGRATIONS` array in `src/db/index.ts`, alongside `060_kaneo_workspace_members`). (Phase 3b, which introduces the `task-tracker` trusted module, will move the _reference_ for the membership migrations into the module's `migrations` array — the coding-module precedent — but that is out of scope here.)

---

## File Structure

- Create: `src/db/migrations/068_task_provider_members.ts`, `tests/db/migrations/068_task_provider_members.test.ts`
- Modify: `src/db/index.ts` (register migration 068), `src/db/membership-schema.ts`, `src/db/schema.ts`, `src/providers/membership/ensure-member.ts`, `src/debug/settings/kaneo-credentials-routes.ts`, and the 3 consumer test files.

---

## Task 1: Migration 068 — create `task_provider_members` + copy rows

**Files:**

- Create: `src/db/migrations/068_task_provider_members.ts`
- Create: `tests/db/migrations/068_task_provider_members.test.ts`
- Modify: `src/db/index.ts` (register in the core `MIGRATIONS` array)

- [ ] **Step 1: Write `tests/db/migrations/068_task_provider_members.test.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'

import { migration068TaskProviderMembers } from '../../../src/db/migrations/068_task_provider_members.js'

const OLD_DDL = `
  CREATE TABLE kaneo_workspace_members (
    group_context_id TEXT NOT NULL,
    chat_user_id     TEXT NOT NULL,
    provider_name    TEXT NOT NULL DEFAULT 'kaneo',
    provider_user_id TEXT NOT NULL,
    login            TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'active',
    encrypted_password TEXT,
    created_at       TEXT NOT NULL,
    PRIMARY KEY (group_context_id, chat_user_id, provider_name)
  )`

const seedRow = (db: Database, chatUserId: string): void => {
  db.run(
    `INSERT INTO kaneo_workspace_members (group_context_id, chat_user_id, provider_name, provider_user_id, login, status, encrypted_password, created_at) VALUES (?, ?, 'kaneo', ?, ?, 'active', ?, ?)`,
    ['grp-1', chatUserId, `pu-${chatUserId}`, `login-${chatUserId}`, 'enc', '2026-01-01T00:00:00.000Z'],
  )
}

const rows = (db: Database): Array<{ chat_user_id: string; provider_name: string; login: string }> =>
  db
    .query<
      { chat_user_id: string; provider_name: string; login: string },
      []
    >(`SELECT chat_user_id, provider_name, login FROM task_provider_members ORDER BY chat_user_id`)
    .all()

describe('migration 068 task_provider_members', () => {
  it('creates task_provider_members and copies existing kaneo_workspace_members rows', () => {
    const db = new Database(':memory:')
    db.run(OLD_DDL)
    seedRow(db, 'u1')
    seedRow(db, 'u2')
    migration068TaskProviderMembers.up(db)
    expect(rows(db)).toEqual([
      { chat_user_id: 'u1', provider_name: 'kaneo', login: 'login-u1' },
      { chat_user_id: 'u2', provider_name: 'kaneo', login: 'login-u2' },
    ])
    // old table is preserved (expand phase — dropped a later release)
    expect(db.query<{ n: number }, []>(`SELECT count(*) AS n FROM kaneo_workspace_members`).get()?.n).toBe(2)
  })

  it('is a no-op-safe create when the old table is absent (fresh install)', () => {
    const db = new Database(':memory:')
    expect(() => migration068TaskProviderMembers.up(db)).not.toThrow()
    expect(rows(db)).toEqual([])
  })

  it('does not duplicate rows if run again (idempotent copy)', () => {
    const db = new Database(':memory:')
    db.run(OLD_DDL)
    seedRow(db, 'u1')
    migration068TaskProviderMembers.up(db)
    migration068TaskProviderMembers.up(db)
    expect(rows(db)).toEqual([{ chat_user_id: 'u1', provider_name: 'kaneo', login: 'login-u1' }])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/db/migrations/068_task_provider_members.test.ts`
Expected: FAIL — the migration module does not exist yet.

- [ ] **Step 3: Create `src/db/migrations/068_task_provider_members.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:068' })

const tableExists = (db: Database, table: string): boolean =>
  db.query<{ name: string }, [string]>(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table) !==
  null

/**
 * Expand-phase rename of the host-owned membership store: create the provider-agnostic
 * `task_provider_members` with the identical schema and copy existing `kaneo_workspace_members`
 * rows. The old table is intentionally KEPT (dropped in a later release) as a rollback escape
 * hatch; code switches to the new table in the same slice.
 */
const up = (db: Database): void => {
  if (!tableExists(db, 'task_provider_members')) {
    db.run(`
      CREATE TABLE task_provider_members (
        group_context_id TEXT NOT NULL,
        chat_user_id     TEXT NOT NULL,
        provider_name    TEXT NOT NULL DEFAULT 'kaneo',
        provider_user_id TEXT NOT NULL,
        login            TEXT NOT NULL,
        status              TEXT NOT NULL DEFAULT 'active',
        encrypted_password  TEXT,
        created_at          TEXT NOT NULL,
        PRIMARY KEY (group_context_id, chat_user_id, provider_name)
      )
    `)
  }
  if (tableExists(db, 'kaneo_workspace_members')) {
    // `WHERE true` disambiguates the SELECT…ON CONFLICT upsert parse in SQLite.
    db.run(`
      INSERT INTO task_provider_members
        (group_context_id, chat_user_id, provider_name, provider_user_id, login, status, encrypted_password, created_at)
      SELECT group_context_id, chat_user_id, provider_name, provider_user_id, login, status, encrypted_password, created_at
      FROM kaneo_workspace_members
      WHERE true
      ON CONFLICT (group_context_id, chat_user_id, provider_name) DO NOTHING
    `)
  }
  log.info('migration 068: task_provider_members created + rows copied from kaneo_workspace_members')
}

export const migration068TaskProviderMembers: Migration = { id: '068_task_provider_members', up }
export default migration068TaskProviderMembers
```

- [ ] **Step 4: Register migration 068 in `src/db/index.ts`**

Find the core `MIGRATIONS` array in `src/db/index.ts` (where `migration060KaneoWorkspaceMembers` is registered — confirm via `rg -n "migration060KaneoWorkspaceMembers|MIGRATIONS" src/db/index.ts`). Add an import for `migration068TaskProviderMembers` and append it to the `MIGRATIONS` array in numeric order (after the last core migration entry). Match the existing import + array style exactly.

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test tests/db/migrations/068_task_provider_members.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Verify migration wiring didn't break DB bootstrap**

Run: `bun test tests/db/` and `bun run typecheck`
Expected: green — the new migration runs cleanly in the standard bootstrap.

- [ ] **Step 7: Commit**

```bash
git add src/db/migrations/068_task_provider_members.ts tests/db/migrations/068_task_provider_members.test.ts src/db/index.ts
git commit -m "feat(db): migration 068 — expand kaneo_workspace_members into task_provider_members"
```

---

## Task 2: Rename the Drizzle schema + switch all consumers

**Files:**

- Modify: `src/db/membership-schema.ts`, `src/db/schema.ts`, `src/providers/membership/ensure-member.ts`, `src/debug/settings/kaneo-credentials-routes.ts`
- Modify (tests): `tests/db/membership-schema.test.ts`, `tests/providers/membership/ensure-member.test.ts`, `tests/debug/settings/kaneo-credentials-routes.test.ts`

- [ ] **Step 1: Baseline — confirm the membership suites are green before the rename (characterization)**

Run: `bun test tests/providers/membership/ tests/db/membership-schema.test.ts tests/debug/settings/kaneo-credentials-routes.test.ts`
Expected: PASS. These suites are the behavior characterization (§10) — they must stay green through the rename with only import-name changes.

- [ ] **Step 2: Rename the table in `src/db/membership-schema.ts`**

Replace the `kaneoWorkspaceMembers` table definition + type export with the renamed, provider-agnostic version (identical columns/PK, table name `task_provider_members`):

```ts
export const taskProviderMembers = sqliteTable(
  'task_provider_members',
  {
    groupContextId: text('group_context_id').notNull(),
    chatUserId: text('chat_user_id').notNull(),
    providerName: text('provider_name').notNull().default('kaneo'),
    providerUserId: text('provider_user_id').notNull(),
    login: text('login').notNull(),
    status: text('status', { enum: ['active', 'inactive', 'failed'] })
      .notNull()
      .default('active'),
    encryptedPassword: text('encrypted_password'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.groupContextId, table.chatUserId, table.providerName] })],
)
export type TaskProviderMember = typeof taskProviderMembers.$inferSelect
```

Preserve the file's existing imports (`sqliteTable`, `text`, `primaryKey`) and any surrounding content. Remove the old `kaneoWorkspaceMembers`/`KaneoWorkspaceMember` names entirely (nothing references them after this task).

- [ ] **Step 3: Update the re-export in `src/db/schema.ts`**

Change line 288 from:

```ts
export { kaneoWorkspaceMembers, type KaneoWorkspaceMember } from './membership-schema.js'
```

to:

```ts
export { taskProviderMembers, type TaskProviderMember } from './membership-schema.js'
```

- [ ] **Step 4: Switch `src/providers/membership/ensure-member.ts`**

- Change the import (line 9) `import { kaneoWorkspaceMembers } from '../../db/schema.js'` → `import { taskProviderMembers } from '../../db/schema.js'`.
- Replace every `kaneoWorkspaceMembers` reference with `taskProviderMembers` (the 5 query sites: `findActiveExistingMemberRow` select/from/where, `findStoredCredentialsAcrossGroups` select/from/where, `writeMemberRow` insert/onConflict target, `markMemberInactive` update/where). Use a find-replace of the identifier — there are no other occurrences.
- **DO NOT change the two `providerName: 'kaneo'` VALUE literals** (line 77 `eq(taskProviderMembers.providerName, 'kaneo')` and line 105 `providerName: 'kaneo'`). These are behavior and are deferred to Phase 3b. (After the rename they read `eq(taskProviderMembers.providerName, 'kaneo')` — correct and intentional.)

- [ ] **Step 5: Switch `src/debug/settings/kaneo-credentials-routes.ts`**

- Change the import (line 10) `import { kaneoWorkspaceMembers, type KaneoWorkspaceMember } from '../../db/schema.js'` → `import { taskProviderMembers, type TaskProviderMember } from '../../db/schema.js'`.
- In `getKaneoMemberRow`: change the return type `KaneoWorkspaceMember` → `TaskProviderMember` and the `.from(kaneoWorkspaceMembers)` / `.where(and(eq(kaneoWorkspaceMembers.groupContextId, …), eq(kaneoWorkspaceMembers.chatUserId, …)))` → `taskProviderMembers`.
- In `clearStoredPassword`: `.update(kaneoWorkspaceMembers)` / the `where` `eq(kaneoWorkspaceMembers.*)` → `taskProviderMembers`.
- Leave everything else in this file unchanged (the `getKaneoPublicUrl` `instance.type !== 'kaneo'` check, the route logic, the `kaneoUrl` response field — all deferred to Phase 3c). This file keeps its name for now.

- [ ] **Step 6: Update the three consumer test files**

In `tests/db/membership-schema.test.ts`, `tests/providers/membership/ensure-member.test.ts`, and `tests/debug/settings/kaneo-credentials-routes.test.ts`: replace `kaneoWorkspaceMembers` → `taskProviderMembers` and `KaneoWorkspaceMember` → `TaskProviderMember` in imports and usages. Do NOT change any assertion values or test intent — these are the characterization suites; only the Drizzle identifier changes. (If a test inserts seed rows via the Drizzle export, it now targets `task_provider_members`, which `setupTestDb()` creates via migration 068.)

- [ ] **Step 7: Typecheck + the switched suites**

Run: `bun run typecheck` (clean — proves no dangling `kaneoWorkspaceMembers` reference remains).
Run: `bun test tests/providers/membership/ tests/db/membership-schema.test.ts tests/debug/settings/kaneo-credentials-routes.test.ts`
Expected: PASS — identical behavior, now against `task_provider_members`.

- [ ] **Step 8: Confirm the Drizzle export is fully switched**

Run: `rg -n "kaneoWorkspaceMembers|KaneoWorkspaceMember" src tests`
Expected: ZERO hits (the identifier is gone everywhere). The string `kaneo_workspace_members` should remain ONLY in `src/db/migrations/060_*.ts` and `068_*.ts` (raw SQL referencing the old table by name) and their tests — that's correct and intended.

- [ ] **Step 9: Full suite + guard + knip**

Run: `bun test` — full suite green (report counts).
Run: `bun test tests/architecture-guard.test.ts` — PASS.
Run: `bun run knip` — clean (the old export is gone with no orphan; the new one is consumed).
Run: `bun run lint` + `bun run format:check` (run `bun run format` if needed).

- [ ] **Step 10: Full verification gate**

Run: `bun check:full`
Expected: 12/12 green.

- [ ] **Step 11: Commit**

```bash
git add src/db/membership-schema.ts src/db/schema.ts src/providers/membership/ensure-member.ts \
  src/debug/settings/kaneo-credentials-routes.ts tests/db/membership-schema.test.ts \
  tests/providers/membership/ensure-member.test.ts tests/debug/settings/kaneo-credentials-routes.test.ts
git commit -m "refactor(db): switch membership store to task_provider_members (rename kaneoWorkspaceMembers)"
```

---

## Self-Review notes (author)

- **Spec coverage:** implements the `MembershipStorePort` prerequisite from §9.4/§6.1 (the table rename + provider-agnostic naming) as an additive expand-migration (§8: "create new, copy rows (keep `provider_name`); drop old next release" — the drop is deliberately NOT done here).
- **Behavior-preserving:** no membership logic changes; the `providerName: 'kaneo'` value literals are explicitly retained (deferred to 3b). The characterization suites (`ensure-member`, `membership-schema`, `kaneo-credentials-routes`) pass before and after with only identifier renames.
- **Expand-phase safety:** old `kaneo_workspace_members` table kept (rollback escape hatch); the migration is idempotent (`tableExists` guard + `ON CONFLICT DO NOTHING`).
- **Scope discipline:** does NOT touch `registry.ts`, provisioning routes, `kaneoUrl`, the plugins, client code, `KANEO_PLUGIN_*`, `kaneo-legacy-repair`, or `llm-orchestrator-membership.ts` — each is a later sub-phase or explicitly deferred.
- **Guard:** unchanged/green — nothing added under `src/ports/**`; the `'kaneo'` value literal and `kaneo-credentials-routes.ts` filename live in non-scanned paths and are handled in later sub-phases.
- **Migration ownership:** 068 lands in the core `MIGRATIONS` array now (no task-tracker module yet); 3b will move the reference into the module, per the coding precedent.
