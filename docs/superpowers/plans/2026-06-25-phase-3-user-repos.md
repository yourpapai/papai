<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 3 — User-Defined Repositories — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user add their own repositories in the settings UI and start coding sessions on them with no operator step — papai owns the repo catalogue, the acp plugin sends an inline `projectSpec` per session, and magi builds an ephemeral project (user repo basics ⊕ operator sandbox defaults), validates it against a host allowlist, and persists the non-secret spec with the session.

**Architecture:** papai gains a plain (non-encrypted) `coding_session_repos` catalogue + CRUD route + a `codingRepos` plugin capability + a "Repositories" settings section. The acp plugin's `list_projects` reads the catalogue and `start_session`/`review_pr` resolve a repo name → spec and send it as `projectSpec`. **magi drops its static registry entirely** (`InMemoryProjectRegistry`/`loadProjects`/`MAGI_PROJECTS`/`GET /projects`): the inline `projectSpec` is the only project source, persisted in the `sessions` table so finish/review run from it; managers take a `MAGI_PROJECT_DEFAULTS` template + a repo-host policy instead of a registry. geofront unchanged.

**Tech Stack:** Bun + `bun:test`, Drizzle (SQLite), Zod v4, Svelte 5 (runes). Two repos: **papai** (`/Users/ki/Projects/yourpapai/papai`) and **magi** (`/Users/ki/Projects/yourpapai/magi`).

**Spec:** `docs/superpowers/specs/2026-06-25-phase-3-user-repos-design.md`

> **Execute on the current branches** (papai `master`, magi `main`). Each task is test-first. **Knip ordering** (Phase-1 lesson): producers bundled with consumers — A1's route consumes its store, A2 bundles `getRepoByName`+capability with the acp plugin, B1 is one atomic magi commit. Use the **next available** papai migration number (check `src/db/migrations/` for the current max — Phase 1 used `061`; the user may have added more).

---

## File Structure

**Part A — papai**

- Add `src/db/coding-repos-schema.ts` + migration; register in `db/index.ts`/`schema.ts`.
- Add `src/coding-repos/{types,store}.ts` — plain (unencrypted) catalogue store.
- Add `src/debug/settings/coding-repos-routes.ts`; register in `settings-api-router.ts`.
- Modify `src/plugins/{runtime-types,tool-runtime}.ts` — `codingRepos` facade.
- Modify `plugins/acp/tools.ts` (+ `plugins/acp/index.ts`) — `list_projects` from catalogue; `start_session`/`review_pr` send `projectSpec`.
- Add `client/settings/sections/ReposSection.svelte`; modify `client/settings/{fetchers,fetcher-schemas}.ts` + `SettingsApp.svelte`; `CLAUDE.md`.

**Part B — magi**

- Modify `src/project/config.ts` — `ProjectSpec`/`ProjectDefaults`/`RepoPolicy`, `buildEphemeralProject`, `validateRepoSpec`, `deriveForgeRepo`; **remove** `InMemoryProjectRegistry`/`ProjectRegistry`/`ProjectSummary`.
- Modify `src/main.ts` — load `MAGI_PROJECT_DEFAULTS` + `MAGI_ALLOWED_REPO_HOSTS`; remove `loadProjects`/`MAGI_PROJECTS`; CLI modes from defaults + a repoUrl arg.
- Modify `src/session/state.ts`, `src/session/manager.ts`, `src/review/manager.ts` — required `projectSpec`, `resolveProjectFor`, drop registry.
- Modify `src/session/store.ts` — `project_spec` column.
- Modify `src/server/router.ts` — require/validate `projectSpec`; remove `GET /projects`.

---

# Part A — papai

## Task A1: `coding_session_repos` catalogue + CRUD route

**Files:** add `src/db/coding-repos-schema.ts`, `src/db/migrations/0NN_coding_session_repos.ts`, `src/coding-repos/{types,store}.ts`, `src/debug/settings/coding-repos-routes.ts`; modify `src/db/index.ts`, `src/db/schema.ts`, `src/debug/settings-api-router.ts`. Tests: `tests/coding-repos/store.test.ts`, `tests/debug/settings/coding-repos-routes.test.ts`.

> Read `src/db/coding-credentials-schema.ts`, `src/db/migrations/061_coding_session_credentials.ts`, and `src/debug/settings/coding-credentials-routes.ts` as the structural templates (this catalogue is **plain text — no `secret-payload-crypto`**, repo URLs are not secrets). Mirror the byok/coding-credentials test harness in the test files.

- [ ] **Step 1: Write the failing store test**

```ts
// tests/coding-repos/store.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { deleteRepo, getRepoByName, listRepos, upsertRepo } from '../../src/coding-repos/store.js'
import { setupTestDb } from '../utils/test-helpers.js' // match the coding-credentials store test's DB bootstrap

const CTX = 'pi:telegram:ctx:u1'

describe('coding-repos store', () => {
  beforeEach(() => setupTestDb())
  afterEach(() => {
    /* match coding-credentials teardown */
  })

  test('upsert + list + getByName round-trip', () => {
    const id = upsertRepo(
      CTX,
      { name: 'demo', repoUrl: 'https://github.com/acme/demo.git', baseBranch: 'main', permissionPreset: 'cautious' },
      'u1',
    )
    expect(listRepos(CTX).map((r) => r.name)).toEqual(['demo'])
    expect(getRepoByName(CTX, 'demo')?.repoUrl).toBe('https://github.com/acme/demo.git')
    expect(typeof id).toBe('string')
  })
  test('rejects non-https url and bad preset', () => {
    expect(() =>
      upsertRepo(CTX, { name: 'x', repoUrl: 'http://h/r.git', baseBranch: 'main', permissionPreset: 'cautious' }, 'u1'),
    ).toThrow()
    expect(() =>
      upsertRepo(
        CTX,
        { name: 'x', repoUrl: 'https://h/r.git', baseBranch: 'main', permissionPreset: 'bogus' as never },
        'u1',
      ),
    ).toThrow()
  })
  test('name is unique per context; upsert by name replaces', () => {
    upsertRepo(
      CTX,
      { name: 'demo', repoUrl: 'https://github.com/a/b.git', baseBranch: 'main', permissionPreset: 'cautious' },
      'u1',
    )
    upsertRepo(
      CTX,
      { name: 'demo', repoUrl: 'https://github.com/a/c.git', baseBranch: 'dev', permissionPreset: 'autonomous' },
      'u1',
    )
    expect(listRepos(CTX)).toHaveLength(1)
    expect(getRepoByName(CTX, 'demo')?.baseBranch).toBe('dev')
  })
  test('delete + context isolation', () => {
    const id = upsertRepo(
      CTX,
      { name: 'demo', repoUrl: 'https://github.com/a/b.git', baseBranch: 'main', permissionPreset: 'cautious' },
      'u1',
    )
    deleteRepo(CTX, id, 'u1')
    expect(listRepos(CTX)).toEqual([])
    upsertRepo(
      CTX,
      { name: 'demo', repoUrl: 'https://github.com/a/b.git', baseBranch: 'main', permissionPreset: 'cautious' },
      'u1',
    )
    expect(listRepos('pi:telegram:ctx:u2')).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/coding-repos/store.test.ts` → FAIL (module missing).

- [ ] **Step 3: Schema** (`src/db/coding-repos-schema.ts`) — mirror `coding-credentials-schema.ts` but plain columns:

```ts
// SPDX-License-Identifier: BUSL-1.1 … (license header like neighbors)
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const codingSessionRepos = sqliteTable(
  'coding_session_repos',
  {
    contextId: text('context_id').notNull(),
    repoId: text('repo_id').notNull(),
    name: text('name').notNull(),
    repoUrl: text('repo_url').notNull(),
    baseBranch: text('base_branch').notNull(),
    permissionPreset: text('permission_preset').notNull(),
    updatedAt: integer('updated_at').notNull(),
    updatedBy: text('updated_by').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.contextId, t.repoId] }),
    index('idx_coding_session_repos_name').on(t.contextId, t.name),
  ],
)
export type CodingSessionRepoRow = typeof codingSessionRepos.$inferSelect
```

- [ ] **Step 4: Migration** `src/db/migrations/0NN_coding_session_repos.ts` (next number; mirror `061`):

```ts
const up = (db: Database): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS coding_session_repos (
      context_id TEXT NOT NULL,
      repo_id TEXT NOT NULL,
      name TEXT NOT NULL,
      repo_url TEXT NOT NULL,
      base_branch TEXT NOT NULL,
      permission_preset TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      updated_by TEXT NOT NULL,
      PRIMARY KEY (context_id, repo_id)
    )
  `)
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS uq_coding_session_repos_name ON coding_session_repos (context_id, name)`)
  log.info('migration 0NN: coding_session_repos table created')
}
```

Register the import + append to the `MIGRATIONS` array in `src/db/index.ts`; re-export `codingSessionRepos`/`CodingSessionRepoRow` from `src/db/schema.ts`.

- [ ] **Step 5: Types + store** (`src/coding-repos/types.ts`, `store.ts`)

```ts
// types.ts
export const REPO_PRESETS = ['autonomous', 'cautious', 'readonly'] as const
export type RepoPreset = (typeof REPO_PRESETS)[number]
export interface RepoInput {
  name: string
  repoUrl: string
  baseBranch: string
  permissionPreset: RepoPreset
}
export interface RepoRecord extends RepoInput {
  repoId: string
}
```

```ts
// store.ts (plain — no encryption)
import { and, eq } from 'drizzle-orm'
import { codingSessionRepos } from '../db/coding-repos-schema.js'
import { getDrizzleDb } from '../db/drizzle.js'
import { logger } from '../logger.js'
import { REPO_PRESETS, type RepoInput, type RepoRecord } from './types.js'
import { randomUUID } from 'node:crypto'

const log = logger.child({ scope: 'coding-repos:store' })
const now = (): number => Date.now()

function assertValid(input: RepoInput): void {
  if (!/^https:\/\//u.test(input.repoUrl)) throw new Error('repo_url must be https')
  if (!(REPO_PRESETS as readonly string[]).includes(input.permissionPreset))
    throw new Error('invalid permission preset')
  if (input.name.trim().length === 0) throw new Error('name is required')
}

export function listRepos(contextId: string): RepoRecord[] {
  return getDrizzleDb()
    .select()
    .from(codingSessionRepos)
    .where(eq(codingSessionRepos.contextId, contextId))
    .all()
    .map(
      (r): RepoRecord => ({
        repoId: r.repoId,
        name: r.name,
        repoUrl: r.repoUrl,
        baseBranch: r.baseBranch,
        permissionPreset: r.permissionPreset as RepoRecord['permissionPreset'],
      }),
    )
}
export function getRepoByName(contextId: string, name: string): RepoRecord | null {
  const r = getDrizzleDb()
    .select()
    .from(codingSessionRepos)
    .where(and(eq(codingSessionRepos.contextId, contextId), eq(codingSessionRepos.name, name)))
    .get()
  return r === undefined
    ? null
    : {
        repoId: r.repoId,
        name: r.name,
        repoUrl: r.repoUrl,
        baseBranch: r.baseBranch,
        permissionPreset: r.permissionPreset as RepoRecord['permissionPreset'],
      }
}
export function upsertRepo(contextId: string, input: RepoInput, updatedBy: string): string {
  assertValid(input)
  const existing = getRepoByName(contextId, input.name)
  const repoId = existing?.repoId ?? randomUUID()
  getDrizzleDb()
    .insert(codingSessionRepos)
    .values({
      contextId,
      repoId,
      name: input.name,
      repoUrl: input.repoUrl,
      baseBranch: input.baseBranch,
      permissionPreset: input.permissionPreset,
      updatedAt: now(),
      updatedBy,
    })
    .onConflictDoUpdate({
      target: [codingSessionRepos.contextId, codingSessionRepos.repoId],
      set: {
        name: input.name,
        repoUrl: input.repoUrl,
        baseBranch: input.baseBranch,
        permissionPreset: input.permissionPreset,
        updatedAt: now(),
        updatedBy,
      },
    })
    .run()
  log.info({ contextId, name: input.name, updatedBy }, 'repo upserted')
  return repoId
}
export function deleteRepo(contextId: string, repoId: string, updatedBy: string): void {
  getDrizzleDb()
    .delete(codingSessionRepos)
    .where(and(eq(codingSessionRepos.contextId, contextId), eq(codingSessionRepos.repoId, repoId)))
    .run()
  log.info({ contextId, repoId, updatedBy }, 'repo deleted')
}
```

> Note: the unique `(context_id, name)` index means a second `upsertRepo` with a new name + same context inserts a new row; `onConflictDoUpdate` keyed on `(context_id, repo_id)` updates when the name already maps to a repoId. Confirm the "upsert by name replaces" test passes; adjust the conflict target if the unique-name index needs an explicit upsert-by-name path.

- [ ] **Step 6: Write the failing route test, then implement the route** (`src/debug/settings/coding-repos-routes.ts`, mirror `coding-credentials-routes.ts` auth/CSRF/scope; `GET` lists, `POST` upserts (Zod-validated), `DELETE ?repoId=` deletes). Register `if (url.pathname === '/settings/api/coding-repos') return handleCodingReposRoutes(req, url)` in `settings-api-router.ts`. Tests: GET lists; POST validates (invalid url/preset → 422); DELETE removes; unmanageable context → 403; CSRF enforced.

- [ ] **Step 7: Run all A1 tests + knip**

Run: `bun test tests/coding-repos/ tests/debug/settings/coding-repos-routes.test.ts` → PASS. `bun run knip` → exit 0 (the route consumes `listRepos`/`upsertRepo`/`deleteRepo`; `getRepoByName` is added in **A2** with its consumer — do **not** add `getRepoByName` to the store yet if knip flags it, OR add it in A2).

> Knip note: if `getRepoByName` is unused after A1, move its definition into A2 (where the capability consumes it). Keep A1 green.

- [ ] **Step 8: Commit**

```bash
git add src/db/coding-repos-schema.ts src/db/migrations/0NN_coding_session_repos.ts src/db/index.ts src/db/schema.ts \
  src/coding-repos/ src/debug/settings/coding-repos-routes.ts src/debug/settings-api-router.ts tests/coding-repos/ tests/debug/settings/coding-repos-routes.test.ts
git commit -m "feat(coding-repos): per-context repo catalogue + CRUD route"
```

---

## Task A2: `codingRepos` plugin capability + acp plugin inline projectSpec

**Bundled** so `getRepoByName` + the capability have consumers in the same commit.

**Files:** modify `src/coding-repos/store.ts` (ensure `getRepoByName` present), `src/plugins/runtime-types.ts`, `src/plugins/tool-runtime.ts`, `plugins/acp/tools.ts`, `plugins/acp/index.ts`. Tests: `tests/plugins/coding-repos-facade.test.ts`, `tests/plugins/acp/*`.

> Read the Phase-2 `buildCodingSecretsFacade` (`tool-runtime.ts`), the `codingSecrets` field (`runtime-types.ts`), and `plugins/acp/{tools,index}.ts` (the current `start_session`/`review_pr`/`list_projects`).

- [ ] **Step 1: Failing tests** — facade `list`/`get` at config-context + permission gate; acp `list_projects` returns the catalogue; `start_session` resolves a repo name → `projectSpec` in the magi body; unknown name → `{ error: 'not_found' }` without calling magi (assert via fetch spy `not.toHaveBeenCalled()`).

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Facade** — `runtime-types.ts`:

```ts
codingRepos: {
  list(): { name: string; baseBranch: string }[]
  get(name: string): { name: string; repoUrl: string; baseBranch: string; permissionPreset: string } | null
}
```

`tool-runtime.ts` — `buildCodingReposFacade(pluginId, storageContextId, hasPermission)` (gated by `coding.secrets` like `buildCodingSecretsFacade`), resolving at `configContextOf(storageContextId)` via `listRepos`/`getRepoByName`. Wire into `buildPluginToolRuntimeContext` alongside `codingSecrets`.

- [ ] **Step 4: acp plugin** (`plugins/acp/tools.ts` + `index.ts`)

- Extend the local `RuntimeContext` with `codingRepos`.
- `list_projects`: a new tool body returning `runtimeContext.codingRepos.list()` (NOT a magi `GET /projects` call). Update `plugins/acp/index.ts` where `list_projects` is registered (it currently uses `getTool('list_projects', …, '/projects', …)` — replace with a catalogue-backed tool).
- `start_session(project, prompt)`: `const repo = runtimeContext.codingRepos.get(project)`; if `null` → `{ error: 'not_found', message: 'No repository named "<project>". Add it in settings → Repositories.' }`; else send `projectSpec: { name: repo.name, repoUrl: repo.repoUrl, baseBranch: repo.baseBranch, permissionPreset: repo.permissionPreset }` in the `/sessions` body (alongside `secrets`, `forgeToken`). Keep the Phase-1/2 agent-key + forge handling.
- `review_pr(project, prNumber)`: same `codingRepos.get` resolution; send `projectSpec` in the `/reviews` body.

- [ ] **Step 5: Run → pass; `bun run knip` exit 0.**

- [ ] **Step 6: Commit**

```bash
git add src/coding-repos/store.ts src/plugins/runtime-types.ts src/plugins/tool-runtime.ts plugins/acp/tools.ts plugins/acp/index.ts \
  tests/plugins/coding-repos-facade.test.ts tests/plugins/acp/
git commit -m "feat(acp): repo catalogue capability — list_projects + inline projectSpec"
```

---

## Task A3: "Repositories" settings section + fetchers

**Files:** add `client/settings/sections/ReposSection.svelte`; modify `client/settings/{fetchers,fetcher-schemas}.ts`, `SettingsApp.svelte`, `CLAUDE.md`. Tests: `tests/client/settings/repos-*.test.ts`.

> Read an existing list-style settings section (e.g. `McpSection.svelte` for an add/list/delete pattern) and the Phase-2 fetcher/section tests for the harness.

- [ ] **Step 1: Failing tests** — fetchers GET/POST/DELETE `/settings/api/coding-repos`; section renders the list + an add form (name, repo URL, base branch, preset select) and issues POST/DELETE.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Fetchers + schema** — `fetchRepos(contextId)`, `addRepo({contextId, ...})`, `deleteRepo({contextId, repoId})` in `fetchers.ts`; `ReposResponseSchema` in `fetcher-schemas.ts`.
- [ ] **Step 4: `ReposSection.svelte`** — list with delete buttons + an add form; section id `repos`, label "Repositories". No masking (not a credential section).
- [ ] **Step 5: Wire `SettingsApp.svelte`** — import + render after `<CodeHostSection>`; `'repos'` in `ADVANCED_IDS`; sidebar item `{ id: 'repos', label: 'Repositories' }`. Update `CLAUDE.md` (repo catalogue + that the acp plugin sends inline projectSpecs; magi has no static registry).
- [ ] **Step 6: Run → pass (`bun test:client …`); `bun run knip` exit 0.**
- [ ] **Step 7: Commit**

```bash
git add client/settings/sections/ReposSection.svelte client/settings/fetchers.ts client/settings/fetcher-schemas.ts client/settings/SettingsApp.svelte CLAUDE.md tests/client/settings/repos-*.test.ts
git commit -m "feat(settings-ui): Repositories catalogue section"
```

---

# Part B — magi (`/Users/ki/Projects/yourpapai/magi`)

## Task B1: Ephemeral projects — drop the static registry (one atomic commit)

The registry removal ripples through manager constructors → `ServerDeps` → `main.ts`, so it lands atomically (magi's pre-commit runs typecheck).

**Files:** `src/project/config.ts`, `src/main.ts`, `src/session/state.ts`, `src/session/manager.ts`, `src/review/manager.ts`, `src/session/store.ts`, `src/server/router.ts`. Tests: `tests/project/ephemeral.test.ts`, `tests/session/*`, `tests/review/manager.test.ts`, `tests/server/router.test.ts`.

> Read the current `src/project/config.ts`, `src/main.ts`, `src/session/{manager,state,store}.ts`, `src/review/manager.ts`, `src/server/router.ts`.

- [ ] **Step 1: Failing tests**

`tests/project/ephemeral.test.ts`:

```ts
import { expect, test } from 'bun:test'
import { buildEphemeralProject, deriveForgeRepo, validateRepoSpec } from '../../src/project/config.js'

const DEFAULTS = {
  workspaceImage: 'node:22-bookworm-slim',
  agentEntrypoint: ['claude-code-acp'],
  egressAllowlistDomains: ['api.anthropic.com'],
  provisioning: { agent: 'claude' as const },
  forge: { kind: 'github' as const, apiBaseUrl: 'https://api.github.com' },
}
const POLICY = { allowedHosts: ['github.com'] as const }

test('deriveForgeRepo strips host/.git', () => {
  expect(deriveForgeRepo('https://github.com/acme/demo.git', 'github')).toBe('acme/demo')
})
test('buildEphemeralProject merges defaults + derives forge.repo', () => {
  const spec = {
    name: 'demo',
    repoUrl: 'https://github.com/acme/demo.git',
    baseBranch: 'main',
    permissionPreset: 'cautious' as const,
  }
  const p = buildEphemeralProject(spec, DEFAULTS)
  expect(p.workspaceImage).toBe('node:22-bookworm-slim')
  expect(p.permissionPreset).toBe('cautious')
  expect(p.forge.repo).toBe('acme/demo')
})
test('validateRepoSpec rejects non-https / disallowed host / bad preset', () => {
  expect(() =>
    validateRepoSpec(
      { name: 'x', repoUrl: 'http://github.com/a/b.git', baseBranch: 'main', permissionPreset: 'cautious' },
      POLICY,
    ),
  ).toThrow()
  expect(() =>
    validateRepoSpec(
      { name: 'x', repoUrl: 'https://evil.com/a/b.git', baseBranch: 'main', permissionPreset: 'cautious' },
      POLICY,
    ),
  ).toThrow()
  expect(() =>
    validateRepoSpec(
      { name: 'x', repoUrl: 'https://github.com/a/b.git', baseBranch: 'main', permissionPreset: 'nope' },
      POLICY,
    ),
  ).toThrow()
  expect(
    validateRepoSpec(
      { name: 'x', repoUrl: 'https://github.com/a/b.git', baseBranch: 'main', permissionPreset: 'cautious' },
      POLICY,
    ).name,
  ).toBe('x')
})
```

Plus: `tests/server/router.test.ts` — `/sessions` + `/reviews` require `projectSpec` (missing → 400; disallowed host → 400); the spec is forwarded. `tests/session/manager.test.ts` / `review/manager.test.ts` — an inline spec runs an ephemeral project, the spec is persisted, and finish resolves it from the store (no registry). `tests/session/store.test.ts` — `project_spec` round-trips.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: `src/project/config.ts`** — add the types + pure functions; **remove** `InMemoryProjectRegistry`/`ProjectRegistry`/`ProjectSummary`:

```ts
export interface ProjectSpec {
  name: string
  repoUrl: string
  baseBranch: string
  permissionPreset: PermissionPreset
}
export interface ProjectDefaults {
  workspaceImage: string
  agentEntrypoint: string[]
  egressAllowlistDomains: string[]
  provisioning?: ProvisioningConfig
  forge: { kind: ForgeKind; apiBaseUrl: string }
}
export interface RepoPolicy {
  allowedHosts: readonly string[]
}

export function deriveForgeRepo(repoUrl: string, _kind: ForgeKind): string {
  return new URL(repoUrl).pathname
    .replace(/^\/+/u, '')
    .replace(/\.git$/u, '')
    .replace(/\/+$/u, '')
}

const PRESETS: readonly string[] = ['autonomous', 'cautious', 'readonly']
function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

export function validateRepoSpec(value: unknown, policy: RepoPolicy): ProjectSpec {
  const o = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const repoUrl = asString(o['repoUrl'])
  const name = asString(o['name'])
  const baseBranch = asString(o['baseBranch'])
  const permissionPreset = asString(o['permissionPreset'])
  let url: URL
  try {
    url = new URL(repoUrl)
  } catch {
    throw new Error('projectSpec.repoUrl is not a valid URL')
  }
  if (url.protocol !== 'https:') throw new Error('projectSpec.repoUrl must be https')
  if (!policy.allowedHosts.includes(url.host)) throw new Error(`repo host not allowed: ${url.host}`)
  if (name.length === 0 || baseBranch.length === 0) throw new Error('projectSpec.name and baseBranch are required')
  if (!PRESETS.includes(permissionPreset)) throw new Error('projectSpec.permissionPreset invalid')
  return { name, repoUrl, baseBranch, permissionPreset: permissionPreset as PermissionPreset }
}

export function buildEphemeralProject(spec: ProjectSpec, defaults: ProjectDefaults): ProjectConfig {
  return {
    name: spec.name,
    repoUrl: spec.repoUrl,
    baseBranch: spec.baseBranch,
    workspaceImage: defaults.workspaceImage,
    agentEntrypoint: defaults.agentEntrypoint,
    egressAllowlistDomains: defaults.egressAllowlistDomains,
    permissionPreset: spec.permissionPreset,
    provisioning: defaults.provisioning,
    forge: {
      kind: defaults.forge.kind,
      apiBaseUrl: defaults.forge.apiBaseUrl,
      repo: deriveForgeRepo(spec.repoUrl, defaults.forge.kind),
      tokenEnv: '',
    },
  }
}

// default allowlist helper for main.ts: strip a leading 'api.' from the forge api host.
export function defaultAllowedHosts(defaults: ProjectDefaults): string[] {
  const host = new URL(defaults.forge.apiBaseUrl).host
  return [host.replace(/^api\./u, '')]
}
```

- [ ] **Step 4: `src/session/store.ts`** — add a `project_spec` TEXT column (nullable) to the `CREATE TABLE`, the INSERT, `SessionRow`, and `rowToSession` (parse JSON → `Session.projectSpec`). `CreateSessionInput` gains `projectSpec: ProjectSpec`.

- [ ] **Step 5: `state.ts` + managers** — `StartSessionInput.projectSpec: ProjectSpec` (required), `StartReviewInput.projectSpec: ProjectSpec`. `SessionManager`/`ReviewManager` constructors drop the `ProjectRegistry` param and take `defaults: ProjectDefaults`. `startSession`/`startReview`: `const project = buildEphemeralProject(input.projectSpec, this.defaults)`; store `input.projectSpec` via `store.create`. Add a private `resolveProjectFor(session)` = `buildEphemeralProject(session.projectSpec, this.defaults)` and use it at every former `this.projects.get(session.project)` site (finish + teardown in `session/manager.ts`, and `review/manager.ts`).

- [ ] **Step 6: `src/server/router.ts`** — in `handleStart`/`handleReview`, `validateRepoSpec(body['projectSpec'], deps.policy)` (catch → `json({error}, 400)`); forward into the input. **Remove** the `GET /projects` route. `ServerDeps` drops `projects`; add `policy`/`defaults` as needed (or thread through the managers). `GET /agents` → return `[{ name: defaults.agentEntrypoint[0] }]` (or remove).

- [ ] **Step 7: `src/main.ts`** — `loadDefaults(process.env['MAGI_PROJECT_DEFAULTS'])` (JSON → `ProjectDefaults`; required for serve); policy from `MAGI_ALLOWED_REPO_HOSTS` (comma-split) ?? `defaultAllowedHosts(defaults)`. Remove `loadProjects`/`MAGI_PROJECTS`/`InMemoryProjectRegistry`. Construct managers with `defaults`. CLI `runStart`/`runReview`: build a `ProjectSpec` from `MAGI_PROJECT_DEFAULTS` + a `repoUrl` argv arg and pass `projectSpec`.

- [ ] **Step 8: Run + quality gates**

Run: `bun test` (magi), then `bun run typecheck && bun run lint`. All green. Confirm `project_spec` (non-secret) is persisted but `secrets`/`forgeToken` remain unpersisted/unlogged.

- [ ] **Step 9: Commit**

```bash
git add src/project/config.ts src/main.ts src/session/ src/review/manager.ts src/server/router.ts tests/
git commit -m "feat(project): user-defined repos via inline projectSpec; drop static registry"
```

---

## Final verification (both repos)

- [ ] **papai:** `bun run check:full` — green.
- [ ] **magi:** `bun run check:full` — green.
- [ ] **Cross-repo contract:** papai's acp plugin sends `projectSpec: { name, repoUrl, baseBranch, permissionPreset }` on `/sessions` + `/reviews`; magi `validateRepoSpec` reads the same shape. A final reviewer verifies the field names + that magi rejects a disallowed host (SSRF gate).
- [ ] **Manual smoke (live magi+geofront):** add a repo in settings → Repositories; `start_session` on it; confirm clone/agent/finish run from the inline spec with **no `MAGI_PROJECTS` on the host**; a repo URL on a non-allowlisted host is rejected.

---

## Spec-coverage self-check

| Spec item                                                                                       | Task   |
| ----------------------------------------------------------------------------------------------- | ------ |
| Repo catalogue (plain table) + store                                                            | A1     |
| CRUD route (scope/CSRF, https+preset validation)                                                | A1     |
| `getRepoByName` + `codingRepos` capability                                                      | A2     |
| acp `list_projects` from catalogue; `start_session`/`review_pr` send `projectSpec`              | A2     |
| Repositories settings section + fetchers                                                        | A3     |
| `ProjectSpec`/`ProjectDefaults`, `buildEphemeralProject`, `validateRepoSpec`, `deriveForgeRepo` | B1     |
| Host allowlist (default = forge host) — SSRF gate                                               | B1     |
| `projectSpec` required + persisted; `resolveProjectFor`                                         | B1     |
| Drop `InMemoryProjectRegistry`/`MAGI_PROJECTS`/`GET /projects`; CLI from defaults               | B1     |
| geofront untouched                                                                              | (none) |

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-25-phase-3-user-repos.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review.
**2. Inline Execution** — execute here with checkpoints.

Suggested order A1 → A2 → A3, then B1 (the magi registry-removal is the broadest single change — give it the atomic commit). **Which approach?**
