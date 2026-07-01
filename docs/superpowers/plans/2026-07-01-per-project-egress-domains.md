<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Per-Project Additional Egress Domains Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user add, per coding project, a list of extra egress domains that the sandbox may reach — unioned into the per-session egress magi already derives, never replacing it.

**Architecture:** A new `additionalEgressDomains: string[]` field rides the existing papai→magi seam that `providerHost`/`model` already use. papai persists it per repo (`coding_session_repos`), validates it at the store + HTTP boundary, forwards it inside `projectSpec`, and magi unions it into `deriveEgress`. The external geofront org ceiling is unchanged and remains the hard bound (a domain outside it is silently clamped — documented, not enforced here). **Image override is out of scope** (deferred).

**Tech Stack:** Bun, TypeScript (strict, `.js` import paths), Zod v4, Drizzle (SQLite), Svelte 5 (runes), `bun:test`. Spec: `docs/superpowers/specs/2026-07-01-per-project-egress-domains-design.md`.

**Two repos:** Tasks 1–7 land in **papai** (`/Users/ki/Projects/yourpapai/papai`), with docs in Task 7. Tasks 8–9 land in **magi** (`/Users/ki/Projects/yourpapai/magi`) as a companion commit.

---

## File Structure

**papai — modify**

- `src/coding-repos/types.ts` — add `additionalEgressDomains: string[]` to `RepoInput`.
- `src/db/coding-repos-schema.ts` — add the `additional_egress_domains` column.
- `src/db/index.ts` — register the new migration.
- `src/coding-repos/store.ts` — normalize, validate, persist, and read back the field.
- `src/debug/settings/coding-repos-routes.ts` — accept + thread the field.
- `src/plugins/runtime-types.ts` — extend the `codingRepos.get()` facade type.
- `src/plugins/tool-runtime.ts` — extend the facade `get()` projection.
- `plugins/acp/tools.ts` — extend `RepoEntry`, the inline `codingRepos.get()` type, and `buildProjectSpec`.
- `client/settings/fetcher-schemas-repos.ts` — add the field to `RepoRecordSchema`.
- `client/settings/repos-fetchers.ts` — add the field to the `addRepo` input type.
- `client/settings/sections/ReposSection.svelte` — add the domains input + parsing.
- `client/stories/msw/settings-handlers.ts` — add the field to the sample fixture.

**papai — create**

- `src/db/migrations/066_coding_repos_egress.ts` — `ALTER TABLE ... ADD COLUMN`.

**magi — modify**

- `src/project/config.ts` — add the `ProjectSpec` field, union in `deriveEgress`, parse in `validateRepoSpec`.

**Tests touched:** `tests/coding-repos/store.test.ts`, `tests/debug/settings/coding-repos-routes.test.ts`, `tests/plugins/coding-repos-facade.test.ts`, `tests/plugins/acp/tools.test.ts`, `tests/client/settings/fetcher-schemas-repos.test.ts`, `tests/client/settings/repos-section.test.ts` (papai); `tests/project/config.test.ts`, `tests/project/ephemeral.test.ts` (magi).

---

## Naming & rules (apply consistently)

- Field name everywhere: **`additionalEgressDomains`** (camelCase in code, `additional_egress_domains` as the SQLite column).
- **Bare host** regex, identical to magi's existing `isBareHost`: `/^[a-z0-9._-]+(:[0-9]+)?$/iu`.
- **Normalize on save:** trim, lowercase, drop empties, dedupe.
- **Count cap 20**; **per-entry length ≤ 253**.
- papai **rejects** invalid input (422); magi **filters silently** (drops malformed, caps).

---

# Part A — papai

## Task 1: Add the DB column + migration (infrastructure only)

**Files:**

- Modify: `src/db/coding-repos-schema.ts:8-24`
- Create: `src/db/migrations/066_coding_repos_egress.ts`
- Modify: `src/db/index.ts:78` (import) and `:178` (registration array)

- [ ] **Step 1: Add the column to the Drizzle table**

In `src/db/coding-repos-schema.ts`, add the column after `permissionPreset`:

```typescript
export const codingSessionRepos = sqliteTable(
  'coding_session_repos',
  {
    contextId: text('context_id').notNull(),
    repoId: text('repo_id').notNull(),
    name: text('name').notNull(),
    repoUrl: text('repo_url').notNull(),
    baseBranch: text('base_branch').notNull(),
    permissionPreset: text('permission_preset').notNull(),
    additionalEgressDomains: text('additional_egress_domains').notNull().default('[]'),
    updatedAt: integer('updated_at').notNull(),
    updatedBy: text('updated_by').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.contextId, t.repoId] }),
    uniqueIndex('uq_coding_session_repos_name').on(t.contextId, t.name),
  ],
)
```

- [ ] **Step 2: Create the migration file**

Create `src/db/migrations/066_coding_repos_egress.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:066' })

const up = (db: Database): void => {
  db.run(`ALTER TABLE coding_session_repos ADD COLUMN additional_egress_domains TEXT NOT NULL DEFAULT '[]'`)
  log.info('migration 066: coding_session_repos.additional_egress_domains column added')
}

export const migration066CodingReposEgress: Migration = {
  id: '066_coding_repos_egress',
  up,
}

export default migration066CodingReposEgress
```

- [ ] **Step 3: Register the migration**

In `src/db/index.ts`, add the import next to `migration065CodingIdentity` (~line 78):

```typescript
import { migration066CodingReposEgress } from './migrations/066_coding_repos_egress.js'
```

And add it to the migrations array immediately after `migration065CodingIdentity` (~line 178):

```typescript
  migration064CodingSessionRepos,
  migration065CodingIdentity,
  migration066CodingReposEgress,
```

- [ ] **Step 4: Verify typecheck + existing repo tests still pass**

Run: `bun run typecheck && bun test tests/coding-repos/store.test.ts`
Expected: PASS (no behavior change yet; the column defaults to `'[]'`).

- [ ] **Step 5: Commit**

```bash
git add src/db/coding-repos-schema.ts src/db/migrations/066_coding_repos_egress.ts src/db/index.ts
git commit -m "feat(coding-repos): add additional_egress_domains column + migration"
```

---

## Task 2: Persist + validate the field in the store

**Files:**

- Modify: `src/coding-repos/types.ts:9-14`
- Modify: `src/coding-repos/store.ts`
- Test: `tests/coding-repos/store.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/coding-repos/store.test.ts` inside the `describe` block:

```typescript
test('round-trips additionalEgressDomains, normalized', () => {
  upsertRepo(
    CTX,
    {
      name: 'demo',
      repoUrl: 'https://github.com/a/b.git',
      baseBranch: 'main',
      permissionPreset: 'cautious',
      additionalEgressDomains: [' Example.com ', 'example.com', 'npm.pkg.dev', ''],
    },
    'u1',
  )
  const repo = listRepos(CTX)[0]
  expect(repo?.additionalEgressDomains).toEqual(['example.com', 'npm.pkg.dev'])
})

test('defaults additionalEgressDomains to [] when omitted-empty', () => {
  upsertRepo(
    CTX,
    {
      name: 'demo',
      repoUrl: 'https://github.com/a/b.git',
      baseBranch: 'main',
      permissionPreset: 'cautious',
      additionalEgressDomains: [],
    },
    'u1',
  )
  expect(listRepos(CTX)[0]?.additionalEgressDomains).toEqual([])
})

test('rejects a non-bare-host egress domain', () => {
  expect(() =>
    upsertRepo(
      CTX,
      {
        name: 'demo',
        repoUrl: 'https://github.com/a/b.git',
        baseBranch: 'main',
        permissionPreset: 'cautious',
        additionalEgressDomains: ['https://evil.com/path'],
      },
      'u1',
    ),
  ).toThrow()
})

test('rejects more than 20 egress domains', () => {
  const many = Array.from({ length: 21 }, (_v, i) => `h${i}.example.com`)
  expect(() =>
    upsertRepo(
      CTX,
      {
        name: 'demo',
        repoUrl: 'https://github.com/a/b.git',
        baseBranch: 'main',
        permissionPreset: 'cautious',
        additionalEgressDomains: many,
      },
      'u1',
    ),
  ).toThrow()
})
```

Then update the five **existing** `upsertRepo` calls in this file (the ones in `upsert + list round-trip`, `rejects non-https url`, `rejects empty name`, `name is unique per context...`, `delete + context isolation`) to add `additionalEgressDomains: []` to each input object, so they still typecheck against the new required field. Example for the first:

```typescript
const id = upsertRepo(
  CTX,
  {
    name: 'demo',
    repoUrl: 'https://github.com/acme/demo.git',
    baseBranch: 'main',
    permissionPreset: 'cautious',
    additionalEgressDomains: [],
  },
  'u1',
)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/coding-repos/store.test.ts`
Expected: FAIL — TypeScript error `additionalEgressDomains` is not a property of `RepoInput` (and the new assertions fail).

- [ ] **Step 3: Add the field to the types**

In `src/coding-repos/types.ts`, add the field to `RepoInput`:

```typescript
export interface RepoInput {
  name: string
  repoUrl: string
  baseBranch: string
  permissionPreset: RepoPreset
  additionalEgressDomains: string[]
}
```

(`RepoRecord extends RepoInput`, so it inherits the field.)

- [ ] **Step 4: Implement normalize + validate + persist + read in the store**

In `src/coding-repos/store.ts`:

Add these helpers below `isRepoPreset` (line 19):

```typescript
const EGRESS_MAX = 20
const EGRESS_HOST_MAXLEN = 253
const isBareHost = (h: string): boolean => /^[a-z0-9._-]+(:[0-9]+)?$/iu.test(h)

function normalizeEgress(domains: string[]): string[] {
  const cleaned = domains.map((d) => d.trim().toLowerCase()).filter((d) => d.length > 0)
  return [...new Set(cleaned)]
}

function parseEgress(raw: string | null | undefined): string[] {
  if (typeof raw !== 'string' || raw.length === 0) return []
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
```

Extend `assertValid` (lines 21-25):

```typescript
function assertValid(input: RepoInput): void {
  if (!/^https:\/\//u.test(input.repoUrl)) throw new Error('repo_url must be https')
  if (!isRepoPreset(input.permissionPreset)) throw new Error('invalid permission preset')
  if (input.name.trim().length === 0) throw new Error('name is required')
  if (input.additionalEgressDomains.length > EGRESS_MAX) throw new Error(`too many egress domains (max ${EGRESS_MAX})`)
  for (const d of input.additionalEgressDomains) {
    if (d.length > EGRESS_HOST_MAXLEN) throw new Error(`egress domain too long: ${d}`)
    if (!isBareHost(d)) throw new Error(`invalid egress domain: ${d}`)
  }
}
```

Extend the `rowToRecord` param type and return (lines 27-42):

```typescript
const rowToRecord = (r: {
  repoId: string
  name: string
  repoUrl: string
  baseBranch: string
  permissionPreset: string
  additionalEgressDomains: string
}): RepoRecord => {
  const preset = isRepoPreset(r.permissionPreset) ? r.permissionPreset : 'readonly'
  return {
    repoId: r.repoId,
    name: r.name,
    repoUrl: r.repoUrl,
    baseBranch: r.baseBranch,
    permissionPreset: preset,
    additionalEgressDomains: parseEgress(r.additionalEgressDomains),
  }
}
```

In `upsertRepo` (lines 62-97), normalize first, validate the normalized input, and persist the JSON in both `values` and the `onConflictDoUpdate.set` blocks:

```typescript
export function upsertRepo(contextId: string, input: RepoInput, updatedBy: string): string {
  const normalized: RepoInput = { ...input, additionalEgressDomains: normalizeEgress(input.additionalEgressDomains) }
  assertValid(normalized)
  const egressJson = JSON.stringify(normalized.additionalEgressDomains)
  // Find the existing repo by name (unique per context) to get its repoId for upsert
  const existing = getDrizzleDb()
    .select()
    .from(codingSessionRepos)
    .where(and(eq(codingSessionRepos.contextId, contextId), eq(codingSessionRepos.name, normalized.name)))
    .get()
  const repoId = existing?.repoId ?? randomUUID()
  getDrizzleDb()
    .insert(codingSessionRepos)
    .values({
      contextId,
      repoId,
      name: normalized.name,
      repoUrl: normalized.repoUrl,
      baseBranch: normalized.baseBranch,
      permissionPreset: normalized.permissionPreset,
      additionalEgressDomains: egressJson,
      updatedAt: now(),
      updatedBy,
    })
    .onConflictDoUpdate({
      target: [codingSessionRepos.contextId, codingSessionRepos.repoId],
      set: {
        name: normalized.name,
        repoUrl: normalized.repoUrl,
        baseBranch: normalized.baseBranch,
        permissionPreset: normalized.permissionPreset,
        additionalEgressDomains: egressJson,
        updatedAt: now(),
        updatedBy,
      },
    })
    .run()
  log.info({ contextId, name: normalized.name, updatedBy }, 'repo upserted')
  return repoId
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test tests/coding-repos/store.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/coding-repos/types.ts src/coding-repos/store.ts tests/coding-repos/store.test.ts
git commit -m "feat(coding-repos): persist + validate additionalEgressDomains in store"
```

---

## Task 3: Accept the field at the HTTP route

**Files:**

- Modify: `src/debug/settings/coding-repos-routes.ts:19-52`
- Test: `tests/debug/settings/coding-repos-routes.test.ts`

- [ ] **Step 1: Write the failing tests**

Open `tests/debug/settings/coding-repos-routes.test.ts` and add two tests inside its top-level `describe` (match the file's existing request-building helpers — reuse whatever POST helper it already defines; the two assertions are what matter):

```typescript
test('POST accepts additionalEgressDomains and persists them', async () => {
  const res = await postRepo({
    name: 'demo',
    repoUrl: 'https://github.com/acme/demo.git',
    baseBranch: 'main',
    permissionPreset: 'cautious',
    additionalEgressDomains: ['pypi.org', 'files.pythonhosted.org'],
  })
  expect(res.status).toBe(200)
  const listed = await getRepos()
  expect(listed.repos[0]?.additionalEgressDomains).toEqual(['pypi.org', 'files.pythonhosted.org'])
})

test('POST rejects an invalid egress domain with 422', async () => {
  const res = await postRepo({
    name: 'demo',
    repoUrl: 'https://github.com/acme/demo.git',
    baseBranch: 'main',
    permissionPreset: 'cautious',
    additionalEgressDomains: ['http://evil.com/x'],
  })
  expect(res.status).toBe(422)
})
```

> If the existing test file does not already expose `postRepo`/`getRepos` helpers, model these on the file's existing POST/GET test cases (build a `Request` with the CSRF header + JSON body and call `handleCodingReposRoutes`). Assert the same status codes shown above.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/debug/settings/coding-repos-routes.test.ts`
Expected: FAIL — `.strict()` schema rejects the unknown `additionalEgressDomains` key → 422 for the first test (which expects 200).

- [ ] **Step 3: Extend the schema and thread the field**

In `src/debug/settings/coding-repos-routes.ts`, extend `PostBodySchema` (lines 19-27):

```typescript
const PostBodySchema = z
  .object({
    contextId: z.string().optional(),
    name: z.string(),
    repoUrl: z.string(),
    baseBranch: z.string(),
    permissionPreset: z.enum(REPO_PRESETS),
    additionalEgressDomains: z.array(z.string()).max(20).optional(),
  })
  .strict()
```

Thread it into the `upsertRepo` input object (lines 42-47):

```typescript
      {
        name: body.data.name,
        repoUrl: body.data.repoUrl,
        baseBranch: body.data.baseBranch,
        permissionPreset: body.data.permissionPreset,
        additionalEgressDomains: body.data.additionalEgressDomains ?? [],
      },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/debug/settings/coding-repos-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/debug/settings/coding-repos-routes.ts tests/debug/settings/coding-repos-routes.test.ts
git commit -m "feat(coding-repos): accept additionalEgressDomains at settings route"
```

---

## Task 4: Forward the field through the acp seam to magi

**Files:**

- Modify: `src/plugins/runtime-types.ts:55-58`
- Modify: `src/plugins/tool-runtime.ts:197-203`
- Modify: `plugins/acp/tools.ts:29-32, 37, 57-74`
- Test: `tests/plugins/coding-repos-facade.test.ts`, `tests/plugins/acp/tools.test.ts`

- [ ] **Step 1: Write the failing facade test**

Add to `tests/plugins/coding-repos-facade.test.ts` (inside its `describe`; it already sets up a DB + facade — reuse that harness):

```typescript
test('get() surfaces additionalEgressDomains', () => {
  upsertRepo(
    CONTEXT,
    {
      name: 'demo',
      repoUrl: 'https://github.com/a/b.git',
      baseBranch: 'main',
      permissionPreset: 'cautious',
      additionalEgressDomains: ['pypi.org'],
    },
    'u1',
  )
  const facade = buildCodingReposFacade('acp', STORAGE_CTX, true)
  expect(facade.get('demo')?.additionalEgressDomains).toEqual(['pypi.org'])
})
```

> Reuse the file's existing imports/context constants (`upsertRepo`, `buildCodingReposFacade`, and its context-id constants). If it imports `upsertRepo` already, add `additionalEgressDomains` to any existing `upsertRepo` calls in that file so they typecheck.

- [ ] **Step 2: Write the failing buildProjectSpec test**

Add to `tests/plugins/acp/tools.test.ts` (it already imports `buildProjectSpec`/`buildSessionProjectSpec`; reuse the local `RepoEntry`-shaped fixtures — add `additionalEgressDomains` to them):

```typescript
test('buildProjectSpec includes additionalEgressDomains when non-empty', () => {
  const spec = buildProjectSpec(
    {
      name: 'demo',
      repoUrl: 'https://github.com/a/b.git',
      baseBranch: 'main',
      permissionPreset: 'cautious',
      additionalEgressDomains: ['pypi.org'],
    },
    'claude',
  )
  expect(spec).toMatchObject({ additionalEgressDomains: ['pypi.org'] })
})

test('buildProjectSpec omits additionalEgressDomains when empty', () => {
  const spec = buildProjectSpec(
    {
      name: 'demo',
      repoUrl: 'https://github.com/a/b.git',
      baseBranch: 'main',
      permissionPreset: 'cautious',
      additionalEgressDomains: [],
    },
    'claude',
  )
  expect('additionalEgressDomains' in spec).toBe(false)
})
```

> Also add `additionalEgressDomains: []` to any pre-existing `RepoEntry` fixtures in `tools.test.ts` so they still typecheck.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test tests/plugins/coding-repos-facade.test.ts tests/plugins/acp/tools.test.ts`
Expected: FAIL — type errors (field missing on the facade/`RepoEntry` types) and the new assertions fail.

- [ ] **Step 4: Extend the facade type**

In `src/plugins/runtime-types.ts`, update the `codingRepos.get()` signature (lines 55-58):

```typescript
  codingRepos: {
    list(): { name: string; baseBranch: string }[]
    get(
      name: string,
    ): { name: string; repoUrl: string; baseBranch: string; permissionPreset: string; additionalEgressDomains: string[] } | null
  }
```

- [ ] **Step 5: Extend the facade implementation**

In `src/plugins/tool-runtime.ts`, update `buildCodingReposFacade.get()` (lines 197-203):

```typescript
    get(
      name: string,
    ): { name: string; repoUrl: string; baseBranch: string; permissionPreset: string; additionalEgressDomains: string[] } | null {
      if (!hasPermission) deny(pluginId, 'coding.secrets')
      const contextId = configContextOf(storageContextId)
      const r = getRepoByName(contextId, name)
      if (r === null) return null
      return {
        name: r.name,
        repoUrl: r.repoUrl,
        baseBranch: r.baseBranch,
        permissionPreset: r.permissionPreset,
        additionalEgressDomains: r.additionalEgressDomains,
      }
    },
```

- [ ] **Step 6: Extend `RepoEntry`, the inline facade type, and `buildProjectSpec`**

In `plugins/acp/tools.ts`:

Update the inline `codingRepos.get()` type in `RuntimeContext` (lines 29-32):

```typescript
  codingRepos: {
    list(): { name: string; baseBranch: string }[]
    get(
      name: string,
    ): { name: string; repoUrl: string; baseBranch: string; permissionPreset: string; additionalEgressDomains: string[] } | null
  }
```

Update `RepoEntry` (line 37):

```typescript
export type RepoEntry = {
  name: string
  repoUrl: string
  baseBranch: string
  permissionPreset: string
  additionalEgressDomains: string[]
}
```

Update `buildProjectSpec` (lines 57-74) to conditionally include the field:

```typescript
export function buildProjectSpec(
  repo: RepoEntry,
  agent: string,
): {
  name: string
  repoUrl: string
  baseBranch: string
  permissionPreset: string
  agent: string
  additionalEgressDomains?: string[]
} {
  return {
    name: repo.name,
    repoUrl: repo.repoUrl,
    baseBranch: repo.baseBranch,
    permissionPreset: repo.permissionPreset,
    agent,
    ...(repo.additionalEgressDomains.length > 0 ? { additionalEgressDomains: repo.additionalEgressDomains } : {}),
  }
}
```

(`buildSessionProjectSpec` spreads `buildProjectSpec`'s result, so it forwards the field automatically — no change needed there.)

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun test tests/plugins/coding-repos-facade.test.ts tests/plugins/acp/tools.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/plugins/runtime-types.ts src/plugins/tool-runtime.ts plugins/acp/tools.ts tests/plugins/coding-repos-facade.test.ts tests/plugins/acp/tools.test.ts
git commit -m "feat(acp): forward additionalEgressDomains in projectSpec"
```

---

## Task 5: Parse the field in the client response schema + fetcher

**Files:**

- Modify: `client/settings/fetcher-schemas-repos.ts:10-16`
- Modify: `client/settings/repos-fetchers.ts:19-25`
- Test: `tests/client/settings/fetcher-schemas-repos.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/client/settings/fetcher-schemas-repos.test.ts`:

```typescript
test('RepoRecordSchema parses additionalEgressDomains', () => {
  const result = RepoRecordSchema.parse({
    repoId: 'r1',
    name: 'demo',
    repoUrl: 'https://github.com/acme/demo.git',
    baseBranch: 'main',
    permissionPreset: 'cautious',
    additionalEgressDomains: ['pypi.org'],
  })
  expect(result.additionalEgressDomains).toEqual(['pypi.org'])
})

test('RepoRecordSchema defaults additionalEgressDomains to [] when absent', () => {
  const result = RepoRecordSchema.parse({
    repoId: 'r1',
    name: 'demo',
    repoUrl: 'https://github.com/acme/demo.git',
    baseBranch: 'main',
    permissionPreset: 'cautious',
  })
  expect(result.additionalEgressDomains).toEqual([])
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/client/settings/fetcher-schemas-repos.test.ts`
Expected: FAIL — `additionalEgressDomains` is `undefined` (not on the schema).

- [ ] **Step 3: Add the field to the schema**

In `client/settings/fetcher-schemas-repos.ts`:

```typescript
export const RepoRecordSchema = z.object({
  repoId: z.string(),
  name: z.string(),
  repoUrl: z.string(),
  baseBranch: z.string(),
  permissionPreset: z.string(),
  additionalEgressDomains: z.array(z.string()).default([]),
})
```

- [ ] **Step 4: Add the field to the `addRepo` fetcher input type**

In `client/settings/repos-fetchers.ts` (lines 19-25):

```typescript
export const addRepo = (input: {
  contextId: string
  name: string
  repoUrl: string
  baseBranch: string
  permissionPreset: string
  additionalEgressDomains: string[]
}): Promise<unknown> => writeJson('/settings/api/coding-repos', 'POST', input, (b) => b)
```

- [ ] **Step 5: Run to verify it passes**

Run: `bun test tests/client/settings/fetcher-schemas-repos.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/settings/fetcher-schemas-repos.ts client/settings/repos-fetchers.ts tests/client/settings/fetcher-schemas-repos.test.ts
git commit -m "feat(settings-client): parse additionalEgressDomains in repos schema + fetcher"
```

---

## Task 6: Add the domains input to the settings form

**Files:**

- Modify: `client/settings/sections/ReposSection.svelte`
- Modify: `client/stories/msw/settings-handlers.ts:22-37`
- Test: `tests/client/settings/repos-section.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/client/settings/repos-section.test.ts`, extend the `add form POSTs...` test's expected body and add a rendering assertion. Add this new test inside the `describe`:

```typescript
test('add form parses newline/comma domains and POSTs additionalEgressDomains', async () => {
  setCsrfToken('csrf-t')
  setMockFetch(routeMock)
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(ReposSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

  await drain()

  const set = (testid: string, value: string): void => {
    const el = target.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-testid="${testid}"]`)!
    el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  set('repos-add-name', 'my-project')
  set('repos-add-url', 'https://github.com/acme/my-project.git')
  set('repos-add-branch', 'main')
  set('repos-add-egress', 'pypi.org, files.pythonhosted.org\nnpm.pkg.dev')

  flushSync()
  target.querySelector<HTMLButtonElement>('[data-testid="repos-add-submit"]')!.click()
  await drain()

  expect(JSON.parse(capturedPostBody).additionalEgressDomains).toEqual([
    'pypi.org',
    'files.pythonhosted.org',
    'npm.pkg.dev',
  ])
  void unmount(component)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/client/settings/repos-section.test.ts`
Expected: FAIL — no element with testid `repos-add-egress`.

- [ ] **Step 3: Add the state, parsing, field, and reset to the component**

In `client/settings/sections/ReposSection.svelte`:

Add state next to `addPreset` (after line 32):

```typescript
let addEgress = $state('')
```

Add a parse helper below the state block (after line 32, before `load`):

```typescript
const parseEgress = (raw: string): string[] => {
  const seen = new Set<string>()
  for (const part of raw.split(/[\n,]/u)) {
    const host = part.trim().toLowerCase()
    if (host.length > 0) seen.add(host)
  }
  return [...seen]
}
```

In `handleAdd`, pass the parsed domains and reset the field (lines 52-62):

```typescript
await addRepo({
  contextId,
  name: addName,
  repoUrl: addUrl,
  baseBranch: addBranch,
  permissionPreset: addPreset,
  additionalEgressDomains: parseEgress(addEgress),
})
addName = ''
addUrl = ''
addBranch = ''
addPreset = 'cautious'
addEgress = ''
```

Add the input field to the add form, immediately after the Permission preset `Field` (after line 159, before the submit `Btn`):

```svelte
        <Field label="Additional egress domains">
          <textarea
            class="settings-repos__egress-input"
            data-testid="repos-add-egress"
            value={addEgress}
            oninput={(e) => (addEgress = (e.target as HTMLTextAreaElement).value)}
            placeholder="pypi.org, files.pythonhosted.org"></textarea>
          <p class="settings-repos__egress-help">
            Extra domains this project's sessions may reach, added to the defaults. One per line or comma-separated. A
            domain may still be blocked if your operator's egress policy doesn't include it.
          </p>
        </Field>
```

Optionally surface saved domains in each list row — extend the meta line (line 111):

```svelte
            <span class="settings-repos__meta"
              >{repo.baseBranch} · {repo.permissionPreset}{repo.additionalEgressDomains.length > 0
                ? ` · egress: ${repo.additionalEgressDomains.join(', ')}`
                : ''}</span>
```

Add styles inside the `<style>` block (after the `.settings-repos__preset-select` rule):

```css
.settings-repos__egress-input {
  width: 100%;
  min-height: 52px;
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--fg1);
  resize: vertical;
}
.settings-repos__egress-help {
  font-size: 11px;
  color: var(--fg3);
  margin: 4px 0 0;
}
```

- [ ] **Step 4: Update the MSW fixture**

In `client/stories/msw/settings-handlers.ts`, add the field to the first sample repo (lines 22-29):

```typescript
  {
    repoId: 'repo_abc123',
    name: 'my-project',
    repoUrl: 'https://github.com/org/my-project.git',
    baseBranch: 'main',
    permissionPreset: 'cautious',
    additionalEgressDomains: ['pypi.org'],
  },
```

- [ ] **Step 5: Run to verify it passes**

Run: `bun test tests/client/settings/repos-section.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/settings/sections/ReposSection.svelte client/stories/msw/settings-handlers.ts tests/client/settings/repos-section.test.ts
git commit -m "feat(settings-client): add per-project egress domains input"
```

---

## Task 7: Full papai check + docs

**Files:**

- Modify: `docs/architecture/coding-sessions.md`

- [ ] **Step 1: Add a doc note**

In `docs/architecture/coding-sessions.md`, add a short paragraph in the egress/projectSpec section:

```markdown
Each project may carry `additionalEgressDomains` (set in settings → Repositories):
bare hostnames that are **added to** the derived per-session egress (operator base ∪
providerHost ∪ agent-infra). They are additive only and cannot remove the derived
set. Note: a domain is still subject to the operator's geofront egress **ceiling**
(`[egress.policy.ceiling]` in `org.toml`) — one outside the ceiling is silently
dropped, so the operator must widen the ceiling to admit it.
```

- [ ] **Step 2: Run the full papai check**

Run: `bun run check` (or `bun test` + `bun run typecheck` if `check` is heavy)
Expected: PASS — lint, typecheck, format, license headers, and the full suite green.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/coding-sessions.md
git commit -m "docs(coding-sessions): document per-project additionalEgressDomains"
```

---

# Part B — magi (companion commit, separate repo)

> All magi steps run in `/Users/ki/Projects/yourpapai/magi`. Use that repo's own git.

## Task 8: Accept + union the field in magi

**Files:**

- Modify: `src/project/config.ts:65-74` (`ProjectSpec`), `:86-89` (`deriveEgress`), `:207-248` (`validateRepoSpec`)
- Test: `tests/project/config.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/project/config.test.ts` (reuse the file's existing `deriveEgress`/`validateRepoSpec` imports, a `ProjectDefaults` fixture, and a `RepoPolicy` fixture — match the local helpers already used in that suite):

```typescript
test('deriveEgress unions additionalEgressDomains, deduped, malformed dropped', () => {
  const defaults = { workspaceImage: 'img', agentEntrypoint: ['x'], egressAllowlistDomains: ['npmjs.org'] }
  const spec = {
    name: 'n',
    repoUrl: 'https://github.com/a/b.git',
    baseBranch: 'main',
    permissionPreset: 'cautious' as const,
    agent: 'claude' as const,
    additionalEgressDomains: ['pypi.org', 'npmjs.org', 'https://evil.com/x'],
  }
  const egress = deriveEgress(spec, defaults)
  expect(egress).toContain('pypi.org')
  expect(egress).toContain('npmjs.org')
  expect(egress).toContain('api.anthropic.com')
  expect(egress).not.toContain('https://evil.com/x')
  expect(egress.filter((d) => d === 'npmjs.org')).toHaveLength(1)
})

test('validateRepoSpec parses + caps additionalEgressDomains', () => {
  const policy = { allowedHosts: ['github.com'] }
  const spec = validateRepoSpec(
    {
      name: 'n',
      repoUrl: 'https://github.com/a/b.git',
      baseBranch: 'main',
      permissionPreset: 'cautious',
      additionalEgressDomains: [
        ' PyPI.org ',
        'pypi.org',
        'http://bad/x',
        ...Array.from({ length: 25 }, (_v, i) => `h${i}.example.com`),
      ],
    },
    policy,
  )
  expect(spec.additionalEgressDomains).toContain('pypi.org')
  expect(spec.additionalEgressDomains).not.toContain('http://bad/x')
  expect(spec.additionalEgressDomains?.length).toBeLessThanOrEqual(20)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/project/config.test.ts`
Expected: FAIL — `additionalEgressDomains` not on `ProjectSpec`, not unioned, not parsed.

- [ ] **Step 3: Add the field to `ProjectSpec`**

In `src/project/config.ts`, extend `ProjectSpec` (lines 65-74):

```typescript
export interface ProjectSpec {
  name: string
  repoUrl: string
  baseBranch: string
  permissionPreset: PermissionPreset
  agent: Exclude<ProvisioningAgent, 'custom'>
  forge?: { kind: ForgeKind; apiBaseUrl: string }
  providerHost?: string
  model?: string
  additionalEgressDomains?: string[]
}
```

- [ ] **Step 4: Union the field in `deriveEgress`**

Replace `deriveEgress` (lines 86-89):

```typescript
export function deriveEgress(spec: ProjectSpec, defaults: ProjectDefaults): string[] {
  const provider = typeof spec.providerHost === 'string' && isBareHost(spec.providerHost) ? [spec.providerHost] : []
  const extra = Array.isArray(spec.additionalEgressDomains) ? spec.additionalEgressDomains.filter(isBareHost) : []
  return [...new Set([...defaults.egressAllowlistDomains, ...provider, ...agentInfraEgress(spec.agent), ...extra])]
}
```

- [ ] **Step 5: Parse the field in `validateRepoSpec`**

Add a helper next to `parseModel` (after line 205):

```typescript
function parseAdditionalEgress(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const hosts = v
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim().toLowerCase())
    .filter((x) => x.length > 0 && isBareHost(x))
  const unique = [...new Set(hosts)].slice(0, 20)
  return unique.length > 0 ? unique : undefined
}
```

In `validateRepoSpec`, compute it and include it in the returned object (lines 244-247):

```typescript
const providerHostRaw = o['providerHost']
const providerHost = typeof providerHostRaw === 'string' && providerHostRaw.length > 0 ? providerHostRaw : undefined
const model = parseModel(o['model'])
const additionalEgressDomains = parseAdditionalEgress(o['additionalEgressDomains'])
return {
  name,
  repoUrl,
  baseBranch,
  permissionPreset,
  agent: agentRaw,
  forge,
  providerHost,
  model,
  additionalEgressDomains,
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `bun test tests/project/config.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit (in the magi repo)**

```bash
git add src/project/config.ts tests/project/config.test.ts
git commit -m "feat(project): union per-project additionalEgressDomains into derived egress"
```

---

## Task 9: Verify the field reaches the ephemeral project's egress

**Files:**

- Test: `tests/project/ephemeral.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/project/ephemeral.test.ts` (reuse the file's existing `buildEphemeralProject` import + `ProjectDefaults` fixture):

```typescript
test('additionalEgressDomains flow into the ephemeral project egress', () => {
  const defaults = { workspaceImage: 'img', agentEntrypoint: ['x'], egressAllowlistDomains: ['npmjs.org'] }
  const project = buildEphemeralProject(
    {
      name: 'n',
      repoUrl: 'https://github.com/a/b.git',
      baseBranch: 'main',
      permissionPreset: 'cautious',
      agent: 'claude',
      additionalEgressDomains: ['pypi.org'],
    },
    defaults,
  )
  expect(project.egressAllowlistDomains).toContain('pypi.org')
  expect(project.egressAllowlistDomains).toContain('npmjs.org')
})
```

- [ ] **Step 2: Run to verify it fails, then passes**

Run: `bun test tests/project/ephemeral.test.ts`
Expected: This should **PASS immediately** — `buildEphemeralProject` already calls `deriveEgress`, which Task 8 taught to union the field. If it fails, the union in Task 8 is wrong; fix `deriveEgress` before continuing. (This task is a guard test proving the end-to-end wiring, no production code change.)

- [ ] **Step 3: Run the full magi check**

Run: `bun run check` (or the magi repo's equivalent lint+typecheck+test script)
Expected: PASS.

- [ ] **Step 4: Commit (in the magi repo)**

```bash
git add tests/project/ephemeral.test.ts
git commit -m "test(project): guard additionalEgressDomains end-to-end egress wiring"
```

---

## Final verification (both repos)

- [ ] papai: `bun run check` green.
- [ ] magi: `bun run check` green.
- [ ] Manual sanity (optional): start a session for a repo with `additionalEgressDomains: ['pypi.org']`; confirm the emitted `geofront.toml` `[egress.policy.allowlist]` contains `pypi.org` (subject to the org ceiling).

---

## Self-Review

**Spec coverage:**

- Per-project additive egress field → Tasks 1–6 (papai) + Task 8 (magi). ✅
- Additive union, never replacement → `deriveEgress` union in Task 8; `buildProjectSpec` forwards; nothing removes the derived set. ✅
- Bare-host format, trim/lowercase/dedupe, cap 20, len ≤ 253 → Task 2 (store) + Task 8 (magi parse). ✅
- papai rejects (422), magi filters silently → Task 3 (route `.max(20)` + store throw → 422) + Task 8 (`parseAdditionalEgress` drops/caps). ✅
- Document-only ceiling handling; no new magi env, no ceiling awareness → Task 7 doc note + Task 6 UI helper text; no ceiling code added. ✅
- Image override deferred → not present in any task. ✅
- magi `buildEphemeralProject`/`resolvePlan`/`geofront-toml` unchanged → confirmed; Task 9 guards the wiring without touching them. ✅

**Placeholder scan:** No TBD/TODO; every code step shows full code. The two route-test helpers (`postRepo`/`getRepos`) are flagged as "reuse the file's existing helpers" because that harness already exists — not a placeholder for new logic. ✅

**Type consistency:** `additionalEgressDomains: string[]` is the property name in `RepoInput`, `RepoRecord`, both facade type copies, `RepoEntry`, and the Svelte/fetcher/schema layers. `ProjectSpec.additionalEgressDomains?: string[]` (optional) in magi. `buildProjectSpec` returns it optional and omits when empty; the DB column is `additional_egress_domains` (snake_case) mapped to camelCase by Drizzle. All consistent. ✅
