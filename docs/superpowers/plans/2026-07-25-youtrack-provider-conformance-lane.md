<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# YouTrack provider-conformance lane — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind the real `YouTrackProvider` to a stateful in-memory fake YouTrack REST server and run the shared `PARITY_GROUPS` (plus a YouTrack custom-field extension) against it, proving request-building + response-mapping + `TaskProvider` contract conformance — fully hermetic, uncatalogued, no frozen-tree change.

**Architecture:** A `Bun.serve` fake on an OS-assigned port models YouTrack's issues/projects/comments/links/custom-field surface. `YouTrackProvider` is constructed with `baseUrl = fake.url`. A binding runner iterates `PARITY_GROUPS` (imported outward from the frozen `tests/stories/harness/parity/` module) minus a YouTrack exclusion set, plus YouTrack-only custom-field groups. The fake is authored to the exact `fields=`/custom-field/bundle shapes the provider requests and parses, pinned by its own unit tests so fake drift fails locally.

**Tech Stack:** Bun test runner (`bun:test`), `Bun.serve`, TypeScript (strict), Zod v4 (only indirectly, via the provider's own schemas). No Docker, no network egress, no new deps.

## Global Constraints

- **License header** on every new file: `.ts` → the 4-line `//` SPDX/BUSL block; `.md` → the HTML-comment block. Copy the header verbatim from any existing file in `tests/stories/harness/parity/`.
- **Runtime Bun**; **Zod v4**; **use `.js` extension in all import paths** (e.g. `./fake-youtrack-server.js`).
- **Strict TypeScript**; `explicit-function-return-type` and `explicit-module-boundary-types` are lint errors — annotate every function's return type.
- **Never add lint-disable or type-ignore comments** — the Write/Edit hook blocks them; fix the underlying issue. The hook also runs lint/typecheck/format/license-headers on every save and will reject violations, so keep each edit green.
- **No `any`** (`typescript/no-explicit-any` is error) — use `unknown` + narrowing.
- **Error extraction:** `error instanceof Error ? error.message : String(error)`.
- **`max-lines` / `max-lines-per-function` are OFF under `tests/**`** (`.oxlintrc.json` override), so the fake may live in one file; still keep functions focused.
- **Placement:** everything lives under `tests/plugins/task-provider-youtrack/parity/`. Nothing under `tests/stories/**`, `scripts/story/**`, `bunfig.toml`, or the other frozen inputs changes — the `treeHash` must not move. No catalog record, no `test:*` script, no CI job.
- **No production change:** do not touch `src/**` or `plugins/**`. The lane is test-only.
- **Import direction is `frozen ← candidate`:** this suite imports `PARITY_GROUPS`, `ParityGroup`, `ParityHarness`, `required`, `canonicalize`, `VOLATILE`, `VOLATILE_KEYS` **outward** from `tests/stories/harness/parity/`. Never edit those frozen files.
- **Isolation-clean** (`tests/CLAUDE.md`): OS-assigned port (`port: 0`), no fixed-wall-clock timing asserts, full teardown in `afterAll`, no net `process.env` mutation.

**Path reference (import depth from `tests/plugins/task-provider-youtrack/parity/`):**
- Provider: `../../../../plugins/task-provider-youtrack/provider.js`
- Frozen harness: `../../../stories/harness/parity/expectations.js` and `../../../stories/harness/parity/group.js`

---

## File Structure

| File | Responsibility |
| ---- | -------------- |
| `tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.ts` | Stateful in-memory fake YouTrack; `startFakeYouTrackServer()` + all route handlers. |
| `tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.test.ts` | Unit tests pinning the fake's projection/custom-field/error shapes independently of the provider. |
| `tests/plugins/task-provider-youtrack/parity/youtrack-parity-exclusions.ts` | `YOUTRACK_PARITY_EXCLUSIONS` — shared groups that cannot map to YouTrack, each with a reason. |
| `tests/plugins/task-provider-youtrack/parity/youtrack-parity-exclusions.test.ts` | Exclusion-integrity tests (ids real, unique, run-set arithmetic). |
| `tests/plugins/task-provider-youtrack/parity/youtrack-custom-field-groups.ts` | YouTrack-only `ParityGroup`s for status/priority custom-field round-tripping. |
| `tests/plugins/task-provider-youtrack/parity/provider-conformance.test.ts` | Binding runner: `YouTrackProvider` vs the fake over included shared groups + extension groups. |

---

### Task 1: Fake server skeleton — projects, custom-field schema, bundle values

**Files:**
- Create: `tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.ts`
- Test: `tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks; `Bun.serve`, `import type { Server } from 'bun'`.
- Produces:
  - `export type FakeYouTrackServer = { url: string; stop(): Promise<void>; reset(): void }`
  - `export const startFakeYouTrackServer: () => FakeYouTrackServer`
  - Internal (same-file, consumed by later tasks): the `State`/`Ctx` types, `createState`, `nextId`, `nextTs`, `json`, `noContent`, `errorResponse`, `matchPath`, and the module-scope `handlers` registration inside `startFakeYouTrackServer`. Later tasks add handler functions and register them.

- [ ] **Step 1: Write the failing test**

Create `tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { startFakeYouTrackServer, type FakeYouTrackServer } from './fake-youtrack-server.js'

const postJson = async (fake: FakeYouTrackServer, path: string, body: unknown): Promise<Response> =>
  fetch(`${fake.url}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake-token' },
    body: JSON.stringify(body),
  })

const createProject = async (fake: FakeYouTrackServer, name: string, shortName: string): Promise<{ id: string; shortName: string }> => {
  const res = await postJson(fake, '/api/admin/projects', { name, shortName })
  return (await res.json()) as { id: string; shortName: string }
}

describe('fake YouTrack server — projects & custom-field schema', () => {
  let fake: FakeYouTrackServer

  beforeAll(() => {
    fake = startFakeYouTrackServer()
  })

  afterAll(async () => {
    await fake.stop()
  })

  test('creates then gets a project by db id', async () => {
    fake.reset()
    const project = await createProject(fake, 'Fake P', 'FP')
    expect(project.shortName).toBe('FP')
    const got = await fetch(`${fake.url}/api/admin/projects/${project.id}?fields=id,shortName`)
    expect(got.status).toBe(200)
    const body = (await got.json()) as { id: string; shortName: string }
    expect(body.id).toBe(project.id)
    expect(body.shortName).toBe('FP')
  })

  test('serves State and Priority as bundle-typed project custom fields', async () => {
    fake.reset()
    const project = await createProject(fake, 'Schema P', 'SP')
    const res = await fetch(`${fake.url}/api/admin/projects/${project.id}/customFields?fields=id`)
    expect(res.status).toBe(200)
    const fields = (await res.json()) as Array<{
      field: { name: string; fieldType: { id: string } }
      bundle?: { id: string; $type: string }
      canBeEmpty?: boolean
    }>
    const byName = new Map(fields.map((f) => [f.field.name, f]))
    expect(byName.get('State')?.field.fieldType.id).toBe('state[1]')
    expect(byName.get('State')?.bundle?.$type).toBe('StateBundle')
    expect(byName.get('Priority')?.field.fieldType.id).toBe('enum[1]')
    expect(byName.get('Priority')?.bundle?.$type).toBe('EnumBundle')
    // canBeEmpty must be true so a title-only createTask never trips required-field validation.
    for (const f of fields) expect(f.canBeEmpty).toBe(true)
  })

  test('serves state bundle values including "In Progress"', async () => {
    const res = await fetch(
      `${fake.url}/api/admin/customFieldSettings/bundles/state/state-bundle-1/values?fields=name,localizedName,ordinal`,
    )
    expect(res.status).toBe(200)
    const values = (await res.json()) as Array<{ name: string }>
    expect(values.map((v) => v.name)).toContain('In Progress')
  })

  test('lists projects and reset() clears state', async () => {
    fake.reset()
    await createProject(fake, 'L', 'L1')
    const listed = (await (await fetch(`${fake.url}/api/admin/projects?fields=id,name`)).json()) as unknown[]
    expect(listed.length).toBe(1)
    fake.reset()
    const after = (await (await fetch(`${fake.url}/api/admin/projects?fields=id,name`)).json()) as unknown[]
    expect(after.length).toBe(0)
  })

  test('unknown route returns 404 with a YouTrack-shaped error body', async () => {
    const res = await fetch(`${fake.url}/api/nonsense`)
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error?: string; error_description?: string }
    expect(typeof body.error).toBe('string')
    expect(typeof body.error_description).toBe('string')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.test.ts`
Expected: FAIL — `Cannot find module './fake-youtrack-server.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Server } from 'bun'

/**
 * A stateful in-memory fake YouTrack REST server. It models exactly the request
 * shapes YouTrackProvider builds and the `fields=` projection shapes its mappers
 * parse (plugins/task-provider-youtrack/mappers.ts). It is NOT a fidelity model
 * of a real YouTrack — both this fake and the parity expectations are authored
 * here, so this lane proves request-building + response-mapping + contract
 * conformance, never drift against a live YouTrack.
 */

export type FakeYouTrackServer = {
  url: string
  stop(): Promise<void>
  reset(): void
}

// ---------- Stored entities ----------

type StoredProject = {
  id: string
  name: string
  shortName: string
  description: string | undefined
  archived: boolean
}

type StoredIssue = {
  id: string
  idReadable: string
  numberInProject: number
  summary: string
  description: string | undefined
  projectDbId: string
  created: number
  updated: number
  state: string | undefined
  priority: string | undefined
  dueDateMs: number | undefined
  assigneeLogin: string | undefined
}

type StoredComment = {
  id: string
  issueId: string
  text: string
  created: number
  updated: number | undefined
}

type StoredLink = {
  id: string
  ownerIssueId: string
  targetIssueId: string
  typeName: string
  direction: string
}

type State = {
  projects: Map<string, StoredProject>
  issues: Map<string, StoredIssue>
  issuesByReadable: Map<string, string>
  comments: Map<string, StoredComment>
  links: Map<string, StoredLink>
  seq: number
}

type Ctx = {
  method: string
  path: string
  query: URLSearchParams
  body: unknown
  state: State
}

// ---------- Bundle seeds (values the provider resolves status/priority against) ----------

const STATE_BUNDLE_ID = 'state-bundle-1'
const PRIORITY_BUNDLE_ID = 'enum-bundle-1'
const STATE_VALUES: readonly string[] = ['Open', 'In Progress', 'Done']
const PRIORITY_VALUES: readonly string[] = ['high', 'normal', 'low']

// ---------- State + id helpers ----------

const createState = (): State => ({
  projects: new Map(),
  issues: new Map(),
  issuesByReadable: new Map(),
  comments: new Map(),
  links: new Map(),
  seq: 0,
})

const nextId = (state: State, prefix: string): string => {
  state.seq += 1
  return `${prefix}-${state.seq}`
}

const nextTs = (state: State): number => {
  state.seq += 1
  return 1_700_000_000_000 + state.seq
}

// ---------- Response helpers ----------

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

const noContent = (): Response => new Response(null, { status: 204 })

const errorResponse = (status: number, message: string): Response =>
  json({ error: message, error_description: message }, status)

// ---------- Path matcher ----------

const matchPath = (pattern: string, path: string): Record<string, string> | null => {
  const pp = pattern.split('/')
  const ap = path.split('/')
  if (pp.length !== ap.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < pp.length; i += 1) {
    const seg = pp[i] ?? ''
    const val = ap[i] ?? ''
    if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(val)
    else if (seg !== val) return null
  }
  return params
}

// ---------- Projection helpers ----------

const projectFields = (p: StoredProject): Record<string, unknown> => ({
  id: p.id,
  $type: 'Project',
  name: p.name,
  shortName: p.shortName,
  description: p.description ?? null,
  archived: p.archived,
})

const projectCustomFieldsResponse = (): unknown => [
  {
    $type: 'StateProjectCustomField',
    canBeEmpty: true,
    isPublic: true,
    field: { id: 'f-state', name: 'State', fieldType: { id: 'state[1]', presentation: 'state' } },
    bundle: { id: STATE_BUNDLE_ID, $type: 'StateBundle' },
  },
  {
    $type: 'EnumProjectCustomField',
    canBeEmpty: true,
    isPublic: true,
    field: { id: 'f-priority', name: 'Priority', fieldType: { id: 'enum[1]', presentation: 'enum' } },
    bundle: { id: PRIORITY_BUNDLE_ID, $type: 'EnumBundle' },
  },
  {
    $type: 'SimpleProjectCustomField',
    canBeEmpty: true,
    isPublic: true,
    field: { id: 'f-due', name: 'Due Date', fieldType: { id: 'date[1]', presentation: 'date' } },
  },
]

const bundleValuesResponse = (segment: string): unknown => {
  const source = segment === 'state' ? STATE_VALUES : segment === 'enum' ? PRIORITY_VALUES : []
  return source.map((name, index) => ({ name, ordinal: index }))
}

// ---------- Project + custom-field-schema handler ----------

const handleProjects = (ctx: Ctx): Response | undefined => {
  const { method, path, state, query } = ctx

  const cfPath = matchPath('/api/admin/projects/:id/customFields', path)
  if (cfPath !== null && method === 'GET') {
    const project = state.projects.get(cfPath['id'] ?? '')
    if (project === undefined) return errorResponse(404, 'project not found')
    return json(projectCustomFieldsResponse())
  }

  const bundlePath = matchPath('/api/admin/customFieldSettings/bundles/:segment/:bundleId/values', path)
  if (bundlePath !== null && method === 'GET') {
    return json(bundleValuesResponse(bundlePath['segment'] ?? ''))
  }

  const onePath = matchPath('/api/admin/projects/:id', path)
  if (onePath !== null) {
    const id = onePath['id'] ?? ''
    const project = state.projects.get(id)
    if (method === 'GET') {
      return project === undefined ? errorResponse(404, 'project not found') : json(projectFields(project))
    }
    if (method === 'POST') {
      if (project === undefined) return errorResponse(404, 'project not found')
      const body = (ctx.body ?? {}) as { name?: string; description?: string }
      if (body.name !== undefined) project.name = body.name
      if (body.description !== undefined) project.description = body.description
      return json(projectFields(project))
    }
    if (method === 'DELETE') {
      return state.projects.delete(id) ? noContent() : errorResponse(404, 'project not found')
    }
  }

  if (path === '/api/admin/projects') {
    if (method === 'POST') {
      const body = (ctx.body ?? {}) as { name: string; shortName: string; description?: string }
      const used = new Set([...state.projects.values()].map((p) => p.shortName))
      let shortName = body.shortName
      while (used.has(shortName)) shortName = `${body.shortName}${nextId(state, 's').slice(-2)}`
      const id = nextId(state, 'project')
      const project: StoredProject = {
        id,
        name: body.name,
        shortName,
        description: body.description,
        archived: false,
      }
      state.projects.set(id, project)
      return json(projectFields(project))
    }
    if (method === 'GET') {
      const all = [...state.projects.values()].map(projectFields)
      const top = Number(query.get('$top') ?? '100')
      const skip = Number(query.get('$skip') ?? '0')
      return json(all.slice(skip, skip + top))
    }
  }

  return undefined
}

// ---------- Server bootstrap ----------

export const startFakeYouTrackServer = (): FakeYouTrackServer => {
  const state = createState()
  const handlers: Array<(ctx: Ctx) => Response | undefined> = [handleProjects]

  const server: Server = Bun.serve({
    port: 0,
    async fetch(req): Promise<Response> {
      const url = new URL(req.url)
      const hasBody = req.method === 'POST' || req.method === 'PUT'
      const bodyText = hasBody ? await req.text() : ''
      const body: unknown = bodyText.length > 0 ? JSON.parse(bodyText) : undefined
      const ctx: Ctx = { method: req.method, path: url.pathname, query: url.searchParams, body, state }
      for (const handler of handlers) {
        const res = handler(ctx)
        if (res !== undefined) return res
      }
      return errorResponse(404, `no route for ${req.method} ${url.pathname}`)
    },
  })

  return {
    url: `http://localhost:${server.port}`,
    stop: async (): Promise<void> => {
      await server.stop(true)
    },
    reset: (): void => {
      state.projects.clear()
      state.issues.clear()
      state.issuesByReadable.clear()
      state.comments.clear()
      state.links.clear()
      state.seq = 0
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.ts tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.test.ts
git commit -m "test(youtrack-parity): fake server skeleton with project + custom-field schema"
```

---

### Task 2: Issue create / get / delete + custom-field read/write

**Files:**
- Modify: `tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.ts`
- Test: `tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.test.ts`

**Interfaces:**
- Consumes: `State`, `Ctx`, `nextId`, `nextTs`, `json`, `noContent`, `errorResponse`, `matchPath`, `StoredIssue`, `StoredLink`, the `handlers` array (Task 1).
- Produces (same-file, for Tasks 3–5): `findIssue(state, ref)`, `issueProjection(state, issue)`, `issueListProjection(state, issue)`, `applyCustomFieldPayload(issue, payload)`, and registers `handleIssues` in `handlers`. `handleIssues` handles the per-issue custom-fields GET, single-issue GET/POST/DELETE, and `POST /api/issues` (create). The collection `GET /api/issues` is added in Task 3.

- [ ] **Step 1: Write the failing test**

Append to `tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.test.ts` (inside the file, after the existing `describe`):

```typescript
describe('fake YouTrack server — issues & custom fields', () => {
  let fake: FakeYouTrackServer

  beforeAll(() => {
    fake = startFakeYouTrackServer()
  })

  afterAll(async () => {
    await fake.stop()
  })

  test('creates an issue and echoes State/Priority/Due Date on GET', async () => {
    fake.reset()
    const project = await createProject(fake, 'Issue P', 'IP')
    const created = (await (
      await postJson(fake, '/api/issues', {
        project: { id: project.id },
        summary: 'Hello',
        customFields: [
          { name: 'State', $type: 'StateIssueCustomField', value: { name: 'In Progress' } },
          { name: 'Priority', $type: 'SingleEnumIssueCustomField', value: { name: 'high' } },
          { name: 'Due Date', $type: 'DateIssueCustomField', value: 1_800_000_000_000 },
        ],
      })
    ).json()) as { id: string; idReadable: string; customFields: Array<{ name: string; value: unknown }> }

    expect(created.idReadable).toBe('IP-1')
    const got = (await (await fetch(`${fake.url}/api/issues/${created.idReadable}?fields=id`)).json()) as {
      customFields: Array<{ name: string; value: { name?: string } | number }>
    }
    const byName = new Map(got.customFields.map((f) => [f.name, f.value]))
    expect((byName.get('State') as { name?: string }).name).toBe('In Progress')
    expect((byName.get('Priority') as { name?: string }).name).toBe('high')
    expect(byName.get('Due Date')).toBe(1_800_000_000_000)
  })

  test('per-issue customFields endpoint returns Due Date as a number for enrich', async () => {
    fake.reset()
    const project = await createProject(fake, 'Enrich P', 'EP')
    const created = (await (
      await postJson(fake, '/api/issues', {
        project: { id: project.id },
        summary: 'Due',
        customFields: [{ name: 'Due Date', $type: 'DateIssueCustomField', value: 1_800_000_000_000 }],
      })
    ).json()) as { idReadable: string }
    const res = await fetch(`${fake.url}/api/issues/${created.idReadable}/customFields?fields=name,value`)
    const fields = (await res.json()) as Array<{ name: string; value: unknown }>
    const due = fields.find((f) => f.name === 'Due Date')
    expect(due?.value).toBe(1_800_000_000_000)
  })

  test('delete removes the issue; subsequent GET is 404', async () => {
    fake.reset()
    const project = await createProject(fake, 'Del P', 'DP')
    const created = (await (
      await postJson(fake, '/api/issues', { project: { id: project.id }, summary: 'Bye' })
    ).json()) as { idReadable: string }
    const del = await fetch(`${fake.url}/api/issues/${created.idReadable}`, { method: 'DELETE' })
    expect(del.status).toBe(204)
    const after = await fetch(`${fake.url}/api/issues/${created.idReadable}?fields=id`)
    expect(after.status).toBe(404)
  })

  test('creating an issue in a missing project is 404', async () => {
    fake.reset()
    const res = await postJson(fake, '/api/issues', { project: { id: 'nope' }, summary: 'x' })
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.test.ts`
Expected: FAIL — the new `issues & custom fields` describe fails (create returns the 404 fallback; no issue routes registered).

- [ ] **Step 3: Write minimal implementation**

In `fake-youtrack-server.ts`, add these functions after `handleProjects` and before `startFakeYouTrackServer`:

```typescript
// ---------- Custom-field payload parsing (write path) ----------

const readName = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value
  if (value !== null && typeof value === 'object' && typeof (value as { name?: unknown }).name === 'string') {
    return (value as { name: string }).name
  }
  return undefined
}

const readLogin = (value: unknown): string | undefined => {
  if (value !== null && typeof value === 'object' && typeof (value as { login?: unknown }).login === 'string') {
    return (value as { login: string }).login
  }
  return undefined
}

const applyCustomFieldPayload = (issue: StoredIssue, payload: unknown): void => {
  if (!Array.isArray(payload)) return
  for (const raw of payload) {
    const item = raw as { name?: string; value?: unknown }
    if (item.name === 'State') issue.state = readName(item.value)
    else if (item.name === 'Priority') issue.priority = readName(item.value)
    else if (item.name === 'Due Date') issue.dueDateMs = typeof item.value === 'number' ? item.value : undefined
    else if (item.name === 'Assignee') issue.assigneeLogin = readLogin(item.value)
  }
}

// ---------- Issue projections (read path) ----------

const findIssue = (state: State, ref: string): StoredIssue | undefined => {
  const direct = state.issues.get(ref)
  if (direct !== undefined) return direct
  const dbId = state.issuesByReadable.get(ref)
  return dbId === undefined ? undefined : state.issues.get(dbId)
}

const issueCustomFields = (issue: StoredIssue): unknown[] => {
  const fields: unknown[] = []
  if (issue.state !== undefined) {
    fields.push({ $type: 'StateIssueCustomField', name: 'State', value: { $type: 'StateBundleElement', name: issue.state } })
  }
  if (issue.priority !== undefined) {
    fields.push({
      $type: 'SingleEnumIssueCustomField',
      name: 'Priority',
      value: { $type: 'EnumBundleElement', name: issue.priority },
    })
  }
  if (issue.dueDateMs !== undefined) {
    fields.push({ $type: 'DateIssueCustomField', name: 'Due Date', value: issue.dueDateMs })
  }
  if (issue.assigneeLogin !== undefined) {
    fields.push({ $type: 'SingleUserIssueCustomField', name: 'Assignee', value: { login: issue.assigneeLogin } })
  }
  return fields
}

const issueLinksProjection = (state: State, issue: StoredIssue): unknown[] => {
  const out: unknown[] = []
  for (const link of state.links.values()) {
    if (link.ownerIssueId !== issue.id) continue
    const target = state.issues.get(link.targetIssueId)
    if (target === undefined) continue
    out.push({
      id: link.id,
      direction: link.direction,
      linkType: { id: `lt-${link.typeName}`, name: link.typeName },
      issues: [{ id: target.id, idReadable: target.idReadable, summary: target.summary, resolved: null }],
    })
  }
  return out
}

const issueProjection = (state: State, issue: StoredIssue): Record<string, unknown> => {
  const project = state.projects.get(issue.projectDbId)
  return {
    id: issue.id,
    $type: 'Issue',
    idReadable: issue.idReadable,
    numberInProject: issue.numberInProject,
    summary: issue.summary,
    description: issue.description ?? null,
    created: issue.created,
    updated: issue.updated,
    resolved: null,
    project: { id: issue.projectDbId, shortName: project?.shortName, name: project?.name },
    customFields: issueCustomFields(issue),
    links: issueLinksProjection(state, issue),
    tags: [],
    commentsCount: [...state.comments.values()].filter((c) => c.issueId === issue.id).length,
    votes: 0,
  }
}

const issueListProjection = (state: State, issue: StoredIssue): Record<string, unknown> => {
  const project = state.projects.get(issue.projectDbId)
  const customFields: unknown[] = []
  if (issue.state !== undefined) {
    customFields.push({ $type: 'StateIssueCustomField', name: 'State', value: { name: issue.state } })
  }
  if (issue.priority !== undefined) {
    customFields.push({ $type: 'SingleEnumIssueCustomField', name: 'Priority', value: { name: issue.priority } })
  }
  return {
    id: issue.id,
    idReadable: issue.idReadable,
    numberInProject: issue.numberInProject,
    summary: issue.summary,
    resolved: null,
    created: issue.created,
    project: { id: issue.projectDbId, shortName: project?.shortName },
    customFields,
  }
}

// ---------- Issue handler ----------

const handleIssues = (ctx: Ctx): Response | undefined => {
  const { method, path, state } = ctx

  const cfPath = matchPath('/api/issues/:id/customFields', path)
  if (cfPath !== null && method === 'GET') {
    const issue = findIssue(state, cfPath['id'] ?? '')
    if (issue === undefined) return errorResponse(404, 'issue not found')
    const out = issue.dueDateMs === undefined ? [] : [{ name: 'Due Date', value: issue.dueDateMs }]
    return json(out)
  }

  const onePath = matchPath('/api/issues/:id', path)
  if (onePath !== null) {
    const issue = findIssue(state, onePath['id'] ?? '')
    if (method === 'GET') {
      return issue === undefined ? errorResponse(404, 'issue not found') : json(issueProjection(state, issue))
    }
    if (method === 'POST') {
      if (issue === undefined) return errorResponse(404, 'issue not found')
      const body = (ctx.body ?? {}) as { summary?: string; description?: string; customFields?: unknown }
      if (body.summary !== undefined) issue.summary = body.summary
      if (body.description !== undefined) issue.description = body.description
      if (body.customFields !== undefined) applyCustomFieldPayload(issue, body.customFields)
      issue.updated = nextTs(state)
      return json(issueProjection(state, issue))
    }
    if (method === 'DELETE') {
      if (issue === undefined) return errorResponse(404, 'issue not found')
      state.issues.delete(issue.id)
      state.issuesByReadable.delete(issue.idReadable)
      return noContent()
    }
  }

  if (path === '/api/issues' && method === 'POST') {
    const body = (ctx.body ?? {}) as { project: { id: string }; summary: string; description?: string; customFields?: unknown }
    const project = state.projects.get(body.project.id)
    if (project === undefined) return errorResponse(404, 'project not found')
    const dbId = nextId(state, 'issue')
    const number = [...state.issues.values()].filter((i) => i.projectDbId === project.id).length + 1
    const issue: StoredIssue = {
      id: dbId,
      idReadable: `${project.shortName}-${number}`,
      numberInProject: number,
      summary: body.summary,
      description: body.description,
      projectDbId: project.id,
      created: nextTs(state),
      updated: nextTs(state),
      state: undefined,
      priority: undefined,
      dueDateMs: undefined,
      assigneeLogin: undefined,
    }
    applyCustomFieldPayload(issue, body.customFields)
    state.issues.set(dbId, issue)
    state.issuesByReadable.set(issue.idReadable, dbId)
    return json(issueProjection(state, issue))
  }

  return undefined
}
```

Then register the handler — change the `handlers` line inside `startFakeYouTrackServer`:

```typescript
  const handlers: Array<(ctx: Ctx) => Response | undefined> = [handleProjects, handleIssues]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.test.ts`
Expected: PASS (both describes).

- [ ] **Step 5: Commit**

```bash
git add tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.ts tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.test.ts
git commit -m "test(youtrack-parity): fake issue CRUD + custom-field read/write"
```

---

### Task 3: Issue update, list (sort/paging), and search

**Files:**
- Modify: `tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.ts`
- Test: `tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.test.ts`

**Interfaces:**
- Consumes: `Ctx`, `State`, `json`, `issueListProjection`, `findIssue`, `handleIssues` (Task 2).
- Produces (same-file): `interpretQuery(raw)`, `handleIssueQuery(ctx)`; wires the collection `GET /api/issues` into `handleIssues`. Update is already served by the single-issue `POST` from Task 2 — this task adds a test proving it.

- [ ] **Step 1: Write the failing test**

Append a new describe to `fake-youtrack-server.test.ts`:

```typescript
describe('fake YouTrack server — list, sort, paging, search', () => {
  let fake: FakeYouTrackServer

  beforeAll(() => {
    fake = startFakeYouTrackServer()
  })

  afterAll(async () => {
    await fake.stop()
  })

  const seed = async (project: { id: string }, summary: string): Promise<void> => {
    await postJson(fake, '/api/issues', { project: { id: project.id }, summary })
  }

  test('sorts by title ascending when the query carries a sort-by clause', async () => {
    fake.reset()
    const project = await createProject(fake, 'Sort P', 'SORT')
    await seed(project, 'Sort B')
    await seed(project, 'Sort C')
    await seed(project, 'Sort A')
    const q = encodeURIComponent('project: {SORT} sort by: title asc')
    const res = await fetch(`${fake.url}/api/issues?query=${q}&$top=100`)
    const items = (await res.json()) as Array<{ summary: string }>
    expect(items.map((i) => i.summary)).toEqual(['Sort A', 'Sort B', 'Sort C'])
  })

  test('pages by $top/$skip in insertion order', async () => {
    fake.reset()
    const project = await createProject(fake, 'Page P', 'PAGE')
    await seed(project, 'Page A')
    await seed(project, 'Page B')
    await seed(project, 'Page C')
    const q = encodeURIComponent('project: {PAGE}')
    const first = (await (await fetch(`${fake.url}/api/issues?query=${q}&$top=2`)).json()) as Array<{ summary: string }>
    const second = (await (await fetch(`${fake.url}/api/issues?query=${q}&$top=2&$skip=2`)).json()) as Array<{ summary: string }>
    expect(first.map((i) => i.summary)).toEqual(['Page A', 'Page B'])
    expect(second.map((i) => i.summary)).toEqual(['Page C'])
  })

  test('search matches free-text within a project and excludes other projects', async () => {
    fake.reset()
    const a = await createProject(fake, 'Search A', 'SA')
    const b = await createProject(fake, 'Search B', 'SB')
    await seed(a, 'Searchable Falcon')
    await seed(a, 'Unrelated Item')
    await seed(b, 'Searchable Outsider')
    const q = encodeURIComponent('project: {SA} Searchable')
    const res = await fetch(`${fake.url}/api/issues?query=${q}&$top=100`)
    const items = (await res.json()) as Array<{ summary: string }>
    expect(items.map((i) => i.summary)).toEqual(['Searchable Falcon'])
  })

  test('search returns empty for a non-matching query', async () => {
    fake.reset()
    const project = await createProject(fake, 'Empty P', 'EMP')
    await seed(project, 'Present Task')
    const q = encodeURIComponent('project: {EMP} zzz-no-such-token-qxqx')
    const res = await fetch(`${fake.url}/api/issues?query=${q}&$top=100`)
    expect((await res.json()) as unknown[]).toEqual([])
  })

  test('update via POST /api/issues/{id} changes summary and State', async () => {
    fake.reset()
    const project = await createProject(fake, 'Upd P', 'UP')
    const created = (await (
      await postJson(fake, '/api/issues', { project: { id: project.id }, summary: 'Before' })
    ).json()) as { idReadable: string }
    await postJson(fake, `/api/issues/${created.idReadable}`, {
      summary: 'After',
      customFields: [{ name: 'State', $type: 'StateIssueCustomField', value: { name: 'Done' } }],
    })
    const got = (await (await fetch(`${fake.url}/api/issues/${created.idReadable}?fields=id`)).json()) as {
      summary: string
      customFields: Array<{ name: string; value: { name?: string } }>
    }
    expect(got.summary).toBe('After')
    expect(got.customFields.find((f) => f.name === 'State')?.value.name).toBe('Done')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.test.ts`
Expected: FAIL — the list/sort/search describe fails (collection GET returns the 404 fallback). The update test may already pass (single-issue POST exists from Task 2); the list tests will not.

- [ ] **Step 3: Write minimal implementation**

In `fake-youtrack-server.ts`, add before `handleIssues`:

```typescript
// ---------- YouTrack query interpreter (list + search) ----------

type ParsedQuery = { shortName: string | undefined; freeText: string; sortField: string | undefined; sortDir: string | undefined }

const interpretQuery = (raw: string): ParsedQuery => {
  let rest = raw
  let shortName: string | undefined
  const projectMatch = /project:\s*\{([^}]+)\}/u.exec(rest)
  if (projectMatch !== null) {
    shortName = projectMatch[1]
    rest = rest.replace(projectMatch[0], ' ')
  }
  let sortField: string | undefined
  let sortDir: string | undefined
  const sortMatch = /sort by:\s*(\S+)\s+(asc|desc)/u.exec(rest)
  if (sortMatch !== null) {
    sortField = sortMatch[1]
    sortDir = sortMatch[2]
    rest = rest.replace(sortMatch[0], ' ')
  }
  // Strip any remaining `Field: {..}` and `Due date: <..` directives so only free text remains.
  rest = rest.replace(/[A-Za-z ]+:\s*\{[^}]*\}/gu, ' ').replace(/Due date:\s*[<>]\S+/giu, ' ')
  return { shortName, freeText: rest.trim(), sortField, sortDir }
}

const handleIssueQuery = (ctx: Ctx): Response => {
  const { state, query } = ctx
  const parsed = interpretQuery(query.get('query') ?? '')
  let issues = [...state.issues.values()]
  if (parsed.shortName !== undefined) {
    issues = issues.filter((i) => state.projects.get(i.projectDbId)?.shortName === parsed.shortName)
  }
  if (parsed.freeText.length > 0) {
    const needle = parsed.freeText.toLowerCase()
    issues = issues.filter((i) => i.summary.toLowerCase().includes(needle))
  }
  const byTitle = parsed.sortField === 'title' || parsed.sortField === 'summary'
  issues.sort((a, b) => {
    if (byTitle) {
      const cmp = a.summary.localeCompare(b.summary)
      return parsed.sortDir === 'desc' ? -cmp : cmp
    }
    return a.created - b.created
  })
  const top = Number(query.get('$top') ?? '100')
  const skip = Number(query.get('$skip') ?? '0')
  return json(issues.slice(skip, skip + top).map((i) => issueListProjection(state, i)))
}
```

Then wire the collection GET into `handleIssues` — change the create block guard from:

```typescript
  if (path === '/api/issues' && method === 'POST') {
```

to add a preceding GET branch (insert this block immediately before that `if`):

```typescript
  if (path === '/api/issues' && method === 'GET') {
    return handleIssueQuery(ctx)
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.test.ts`
Expected: PASS (all four describes).

- [ ] **Step 5: Commit**

```bash
git add tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.ts tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.test.ts
git commit -m "test(youtrack-parity): fake issue list/sort/paging/search + update"
```

---

### Task 4: Comments

**Files:**
- Modify: `tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.ts`
- Test: `tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.test.ts`

**Interfaces:**
- Consumes: `Ctx`, `State`, `StoredComment`, `nextId`, `nextTs`, `json`, `noContent`, `errorResponse`, `matchPath`, `findIssue`.
- Produces (same-file): `commentProjection(c)`, `handleComments(ctx)`; registers `handleComments` in `handlers`.

- [ ] **Step 1: Write the failing test**

Append a describe to `fake-youtrack-server.test.ts`:

```typescript
describe('fake YouTrack server — comments', () => {
  let fake: FakeYouTrackServer

  beforeAll(() => {
    fake = startFakeYouTrackServer()
  })

  afterAll(async () => {
    await fake.stop()
  })

  test('add, list, update, remove a comment', async () => {
    fake.reset()
    const project = await createProject(fake, 'Comment P', 'CP')
    const issue = (await (
      await postJson(fake, '/api/issues', { project: { id: project.id }, summary: 'Host' })
    ).json()) as { idReadable: string }

    const added = (await (
      await postJson(fake, `/api/issues/${issue.idReadable}/comments`, { text: 'first note' })
    ).json()) as { id: string; text: string; author: { id: string; login: string }; created: number }
    expect(added.text).toBe('first note')
    expect(typeof added.author.login).toBe('string')

    const listed = (await (
      await fetch(`${fake.url}/api/issues/${issue.idReadable}/comments?fields=id`)
    ).json()) as Array<{ text: string }>
    expect(listed.map((c) => c.text)).toEqual(['first note'])

    const updated = (await (
      await postJson(fake, `/api/issues/${issue.idReadable}/comments/${added.id}`, { text: 'edited note' })
    ).json()) as { id: string; text: string }
    expect(updated.id).toBe(added.id)
    expect(updated.text).toBe('edited note')

    const removed = await fetch(`${fake.url}/api/issues/${issue.idReadable}/comments/${added.id}`, { method: 'DELETE' })
    expect(removed.status).toBe(204)
  })

  test('commenting on a missing issue is 404', async () => {
    fake.reset()
    const res = await postJson(fake, '/api/issues/NOPE-1/comments', { text: 'orphan' })
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.test.ts`
Expected: FAIL — comment routes hit the 404 fallback (add returns 404).

- [ ] **Step 3: Write minimal implementation**

Add to `fake-youtrack-server.ts` (before `startFakeYouTrackServer`):

```typescript
// ---------- Comments handler ----------

const commentProjection = (c: StoredComment): unknown => ({
  id: c.id,
  $type: 'IssueComment',
  text: c.text,
  author: { id: 'fake-user-1', $type: 'User', login: 'fake.user', name: 'Fake User' },
  created: c.created,
  updated: c.updated ?? null,
  reactions: [],
})

const handleComments = (ctx: Ctx): Response | undefined => {
  const { method, path, state, query } = ctx

  const onePath = matchPath('/api/issues/:id/comments/:commentId', path)
  if (onePath !== null) {
    const issue = findIssue(state, onePath['id'] ?? '')
    if (issue === undefined) return errorResponse(404, 'issue not found')
    const comment = state.comments.get(onePath['commentId'] ?? '')
    if (comment === undefined || comment.issueId !== issue.id) return errorResponse(404, 'comment not found')
    if (method === 'GET') return json(commentProjection(comment))
    if (method === 'POST') {
      const body = (ctx.body ?? {}) as { text?: string }
      if (body.text !== undefined) {
        comment.text = body.text
        comment.updated = nextTs(state)
      }
      return json(commentProjection(comment))
    }
    if (method === 'DELETE') {
      state.comments.delete(comment.id)
      return noContent()
    }
  }

  const collPath = matchPath('/api/issues/:id/comments', path)
  if (collPath !== null) {
    const issue = findIssue(state, collPath['id'] ?? '')
    if (issue === undefined) return errorResponse(404, 'issue not found')
    if (method === 'POST') {
      const body = (ctx.body ?? {}) as { text: string }
      const id = nextId(state, 'comment')
      const comment: StoredComment = { id, issueId: issue.id, text: body.text, created: nextTs(state), updated: undefined }
      state.comments.set(id, comment)
      return json(commentProjection(comment))
    }
    if (method === 'GET') {
      const list = [...state.comments.values()].filter((c) => c.issueId === issue.id)
      const top = Number(query.get('$top') ?? '100')
      const skip = Number(query.get('$skip') ?? '0')
      return json(list.slice(skip, skip + top).map(commentProjection))
    }
  }

  return undefined
}
```

Register the handler — change the `handlers` line:

```typescript
  const handlers: Array<(ctx: Ctx) => Response | undefined> = [handleProjects, handleIssues, handleComments]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.ts tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.test.ts
git commit -m "test(youtrack-parity): fake comment CRUD"
```

---

### Task 5: Relations (issue links + link types)

**Files:**
- Modify: `tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.ts`
- Test: `tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.test.ts`

**Interfaces:**
- Consumes: `Ctx`, `State`, `StoredLink`, `nextId`, `json`, `noContent`, `errorResponse`, `matchPath`, `findIssue`, `issueLinksProjection` (already emitted by `issueProjection`).
- Produces (same-file): `LINK_TYPES`, `decodeLinkId(linkId)`, `handleRelations(ctx)`; registers `handleRelations` in `handlers`.

**Design note — how the provider drives relations (`plugins/task-provider-youtrack/relations.ts`):**
`addRelation(taskId, relatedTaskId, type)` (a) GETs the owner issue's `links` to look for a reusable link, (b) GETs `/api/issueLinkTypes` and builds `linkId = <typeId><suffix>` where suffix is `''` for `directed:false`, `s` for OUTWARD, `t` for INWARD, (c) GETs `/api/issues/<relatedTaskId>?fields=id` to resolve the target's db id, (d) POSTs `/api/issues/<taskId>/links/<linkId>/issues` with `{ id: <targetDbId> }` (response body is ignored — the provider echoes `{ taskId, relatedTaskId, type }` from its inputs). `removeRelation` GETs the owner's links (with `issues(id,idReadable)`), finds the link whose `issues[]` contains `relatedTaskId`, then DELETEs `/api/issues/<taskId>/links/<link.id>`. Link-type ids must NOT end in `s`/`t` so `decodeLinkId` can strip the direction suffix unambiguously.

- [ ] **Step 1: Write the failing test**

Append a describe to `fake-youtrack-server.test.ts`:

```typescript
describe('fake YouTrack server — relations', () => {
  let fake: FakeYouTrackServer

  beforeAll(() => {
    fake = startFakeYouTrackServer()
  })

  afterAll(async () => {
    await fake.stop()
  })

  test('exposes issue link types', async () => {
    const res = await fetch(`${fake.url}/api/issueLinkTypes?fields=id,name,directed`)
    const types = (await res.json()) as Array<{ id: string; name: string; directed: boolean }>
    expect(types.map((t) => t.name)).toContain('Depend')
    expect(types.map((t) => t.name)).toContain('Relates')
    for (const t of types) expect(/[st]$/u.test(t.id)).toBe(false)
  })

  test('creates a link and surfaces it on the owner issue; delete removes it', async () => {
    fake.reset()
    const project = await createProject(fake, 'Rel P', 'RP')
    const first = (await (await postJson(fake, '/api/issues', { project: { id: project.id }, summary: 'First' })).json()) as {
      id: string
      idReadable: string
    }
    const second = (await (await postJson(fake, '/api/issues', { project: { id: project.id }, summary: 'Second' })).json()) as {
      id: string
      idReadable: string
    }
    const add = await postJson(fake, `/api/issues/${first.idReadable}/links/lt-depends/issues`, { id: second.id })
    expect(add.status).toBe(200)

    const owner = (await (await fetch(`${fake.url}/api/issues/${first.idReadable}?fields=id`)).json()) as {
      links: Array<{ id: string; linkType: { name: string }; issues: Array<{ idReadable: string }> }>
    }
    expect(owner.links.length).toBe(1)
    expect(owner.links[0]?.linkType.name).toBe('Depend')
    expect(owner.links[0]?.issues[0]?.idReadable).toBe(second.idReadable)

    const linkId = owner.links[0]?.id ?? ''
    const del = await fetch(`${fake.url}/api/issues/${first.idReadable}/links/${linkId}`, { method: 'DELETE' })
    expect(del.status).toBe(204)
    const afterOwner = (await (await fetch(`${fake.url}/api/issues/${first.idReadable}?fields=id`)).json()) as {
      links: unknown[]
    }
    expect(afterOwner.links.length).toBe(0)
  })

  test('resolving a missing related issue is 404', async () => {
    fake.reset()
    const res = await fetch(`${fake.url}/api/issues/NOPE-9?fields=id`)
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.test.ts`
Expected: FAIL — link-type and link routes hit the 404 fallback.

- [ ] **Step 3: Write minimal implementation**

Add to `fake-youtrack-server.ts` (before `startFakeYouTrackServer`):

```typescript
// ---------- Relations handler ----------

const LINK_TYPES: ReadonlyArray<{ id: string; name: string; directed: boolean }> = [
  { id: 'lt-depend', name: 'Depend', directed: true },
  { id: 'lt-relate', name: 'Relates', directed: false },
  { id: 'lt-duplicate', name: 'Duplicate', directed: true },
  { id: 'lt-subtask', name: 'Subtask', directed: true },
]

const decodeLinkId = (linkId: string): { typeName: string; direction: string } => {
  const suffix = linkId.slice(-1)
  if (suffix === 's' || suffix === 't') {
    const base = linkId.slice(0, -1)
    const type = LINK_TYPES.find((t) => t.id === base)
    if (type !== undefined) return { typeName: type.name, direction: suffix === 's' ? 'OUTWARD' : 'INWARD' }
  }
  const exact = LINK_TYPES.find((t) => t.id === linkId)
  return { typeName: exact?.name ?? 'Relates', direction: 'BOTH' }
}

const handleRelations = (ctx: Ctx): Response | undefined => {
  const { method, path, state } = ctx

  if (path === '/api/issueLinkTypes' && method === 'GET') {
    return json(LINK_TYPES)
  }

  const addPath = matchPath('/api/issues/:id/links/:linkId/issues', path)
  if (addPath !== null && method === 'POST') {
    const owner = findIssue(state, addPath['id'] ?? '')
    if (owner === undefined) return errorResponse(404, 'issue not found')
    const body = (ctx.body ?? {}) as { id: string }
    const target = state.issues.get(body.id) ?? findIssue(state, body.id)
    if (target === undefined) return errorResponse(404, 'target issue not found')
    const { typeName, direction } = decodeLinkId(addPath['linkId'] ?? '')
    const id = nextId(state, 'link')
    state.links.set(id, { id, ownerIssueId: owner.id, targetIssueId: target.id, typeName, direction })
    return json({ id })
  }

  const delPath = matchPath('/api/issues/:id/links/:linkId', path)
  if (delPath !== null && method === 'DELETE') {
    const owner = findIssue(state, delPath['id'] ?? '')
    if (owner === undefined) return errorResponse(404, 'issue not found')
    const linkId = delPath['linkId'] ?? ''
    return state.links.delete(linkId) ? noContent() : errorResponse(404, 'link not found')
  }

  return undefined
}
```

Register the handler — change the `handlers` line:

```typescript
  const handlers: Array<(ctx: Ctx) => Response | undefined> = [handleProjects, handleIssues, handleComments, handleRelations]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.test.ts`
Expected: PASS (all describes).

- [ ] **Step 5: Commit**

```bash
git add tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.ts tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.test.ts
git commit -m "test(youtrack-parity): fake issue links + link types"
```

---

### Task 6: Exclusions + integrity tests

**Files:**
- Create: `tests/plugins/task-provider-youtrack/parity/youtrack-parity-exclusions.ts`
- Test: `tests/plugins/task-provider-youtrack/parity/youtrack-parity-exclusions.test.ts`

**Interfaces:**
- Consumes: `PARITY_GROUPS` from `../../../stories/harness/parity/expectations.js`.
- Produces: `export const YOUTRACK_PARITY_EXCLUSIONS: readonly Readonly<{ group: string; reason: string }>[]`.

**Why these six** (derived by reading the frozen expectation modules + the provider source; the runner in Task 8 is the final proof):
- `SCN-parity-task-dates` / `SCN-parity-task-preserve-startdate` — `mapIssueToTask` (mappers.ts) emits **no `startDate`**; YouTrack issues model no start date, only `dueDate` from the "Due Date" custom field. Both groups assert a `startDate` round-trip.
- `SCN-parity-task-label` — labels excluded by decision; YouTrack models tags, not the label attach/detach surface.
- `SCN-parity-identity` — identity excluded by decision (`provisionWorkspaceMember`/`listUsers` over Hub is out of scope).
- `SCN-parity-project-label-errors` — exercises `removeTaskLabel` (labels); excluded with the label group.
- `SCN-parity-project-crud` — `operations/projects.ts` mappers always emit a `description` key, so `Object.keys(project)` is `[description,id,name,url]`; the group asserts exactly `[id,name,url]`. A normalized-shape divergence, not a fake limitation.

- [ ] **Step 1: Write the failing test**

Create `tests/plugins/task-provider-youtrack/parity/youtrack-parity-exclusions.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { PARITY_GROUPS } from '../../../stories/harness/parity/expectations.js'
import { YOUTRACK_PARITY_EXCLUSIONS } from './youtrack-parity-exclusions.js'

describe('youtrack parity exclusions integrity', () => {
  const ids = new Set(PARITY_GROUPS.map((group) => group.id))

  test('every excluded id names a real PARITY_GROUPS id', () => {
    for (const entry of YOUTRACK_PARITY_EXCLUSIONS) {
      expect(ids.has(entry.group)).toBe(true)
    }
  })

  test('every exclusion carries a non-empty reason', () => {
    for (const entry of YOUTRACK_PARITY_EXCLUSIONS) {
      expect(entry.reason.length).toBeGreaterThan(0)
    }
  })

  test('no duplicate exclusions', () => {
    const groups = YOUTRACK_PARITY_EXCLUSIONS.map((entry) => entry.group)
    expect(new Set(groups).size).toBe(groups.length)
  })

  test('run set = PARITY_GROUPS minus exclusions (nothing silently dropped)', () => {
    const excluded = new Set(YOUTRACK_PARITY_EXCLUSIONS.map((entry) => entry.group))
    const runSet = PARITY_GROUPS.filter((group) => !excluded.has(group.id))
    expect(runSet.length).toBe(PARITY_GROUPS.length - YOUTRACK_PARITY_EXCLUSIONS.length)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/task-provider-youtrack/parity/youtrack-parity-exclusions.test.ts`
Expected: FAIL — `Cannot find module './youtrack-parity-exclusions.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `tests/plugins/task-provider-youtrack/parity/youtrack-parity-exclusions.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Shared PARITY_GROUPS that cannot map to the YouTrack conformance binding, each
 * with the concrete reason. The binding runner (provider-conformance.test.ts)
 * runs PARITY_GROUPS minus these ids; the integrity test proves no id is stale
 * and nothing is silently dropped. A genuine conformance gap is recorded here
 * with a reason — never skipped without one.
 */

export const YOUTRACK_PARITY_EXCLUSIONS: readonly Readonly<{ group: string; reason: string }>[] = [
  {
    group: 'SCN-parity-task-dates',
    reason:
      'YouTrackProvider (plugins/task-provider-youtrack/mappers.ts mapIssueToTask) emits no startDate — YouTrack issues have no start-date field and only dueDate is derived from the "Due Date" custom field, so the group\'s startDate round-trip assertion cannot hold.',
  },
  {
    group: 'SCN-parity-task-preserve-startdate',
    reason:
      'Same startDate gap: YouTrackProvider surfaces no startDate on a Task, so preserving one across an update is unobservable.',
  },
  {
    group: 'SCN-parity-task-label',
    reason:
      'Labels excluded for this lane by decision; YouTrack models tags, not the createLabel/addTaskLabel/removeTaskLabel surface the group asserts. Label coverage is deferred.',
  },
  {
    group: 'SCN-parity-identity',
    reason:
      'Identity excluded for this lane by decision; provisionWorkspaceMember/listUsers over the YouTrack Hub is out of scope for the conformance lane.',
  },
  {
    group: 'SCN-parity-project-label-errors',
    reason:
      'Exercises removeTaskLabel (labels), excluded alongside SCN-parity-task-label; the updateProject-missing rejection is already covered structurally by other error groups.',
  },
  {
    group: 'SCN-parity-project-crud',
    reason:
      'YouTrackProvider project mappers (plugins/task-provider-youtrack/operations/projects.ts) always emit a description key (value undefined when absent), so Object.keys(project) is [description,id,name,url]; the group asserts exactly [id,name,url]. A normalized-shape divergence (YouTrack surfaces project description), not a fake limitation.',
  },
] as const
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/plugins/task-provider-youtrack/parity/youtrack-parity-exclusions.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add tests/plugins/task-provider-youtrack/parity/youtrack-parity-exclusions.ts tests/plugins/task-provider-youtrack/parity/youtrack-parity-exclusions.test.ts
git commit -m "test(youtrack-parity): exclusion set + integrity tests"
```

---

### Task 7: YouTrack custom-field extension groups

**Files:**
- Create: `tests/plugins/task-provider-youtrack/parity/youtrack-custom-field-groups.ts`
- Test: `tests/plugins/task-provider-youtrack/parity/youtrack-custom-field-groups.test.ts`

**Interfaces:**
- Consumes: `ParityGroup` type from `../../../stories/harness/parity/group.js`.
- Produces: `export const youtrackCustomFieldGroups: readonly ParityGroup[]` — YouTrack-only groups proving status/priority round-trip through YouTrack's custom-field model. Consumed by the runner in Task 8. These groups assert exact YouTrack-specific values, so they are NOT `canonicalize`-based and belong here, not in the frozen module.

- [ ] **Step 1: Write the failing test**

Create `tests/plugins/task-provider-youtrack/parity/youtrack-custom-field-groups.test.ts` (a shape test — the behavioral proof is the runner in Task 8):

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { youtrackCustomFieldGroups } from './youtrack-custom-field-groups.js'

describe('youtrack custom-field groups', () => {
  test('exposes status and priority groups with unique ids and titles', () => {
    const ids = youtrackCustomFieldGroups.map((group) => group.id)
    expect(ids).toContain('SCN-youtrack-custom-field-status')
    expect(ids).toContain('SCN-youtrack-custom-field-priority')
    expect(new Set(ids).size).toBe(ids.length)
    for (const group of youtrackCustomFieldGroups) {
      expect(group.title.length).toBeGreaterThan(0)
      expect(typeof group.run).toBe('function')
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/task-provider-youtrack/parity/youtrack-custom-field-groups.test.ts`
Expected: FAIL — `Cannot find module './youtrack-custom-field-groups.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `tests/plugins/task-provider-youtrack/parity/youtrack-custom-field-groups.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import type { ParityGroup } from '../../../stories/harness/parity/group.js'

/**
 * YouTrack-only parity groups: they prove status and priority round-trip through
 * YouTrack's custom-field model (State = StateBundle, Priority = EnumBundle),
 * exercising buildIssueCustomFields (bundle resolution) on write and
 * getCustomFieldValue on read. Values are YouTrack-specific, so these are not
 * canonicalize-based and live outside the frozen shared module. The fake seeds
 * State values ['Open','In Progress','Done'] and Priority values
 * ['high','normal','low'] (fake-youtrack-server.ts).
 */

export const youtrackCustomFieldGroups: readonly ParityGroup[] = [
  {
    id: 'SCN-youtrack-custom-field-status',
    title: 'SCN-youtrack-custom-field-status: status round-trips through the State custom field',
    async run({ provider, projectId }) {
      const created = await provider.createTask({ projectId, title: 'CF Status', status: 'In Progress' })
      expect(created.status).toBe('In Progress')
      const fetched = await provider.getTask(created.id)
      expect(fetched.status).toBe('In Progress')
      const updated = await provider.updateTask(created.id, { status: 'Done' })
      expect(updated.status).toBe('Done')
      const refetched = await provider.getTask(created.id)
      expect(refetched.status).toBe('Done')
    },
  },
  {
    id: 'SCN-youtrack-custom-field-priority',
    title: 'SCN-youtrack-custom-field-priority: priority round-trips through the Priority custom field',
    async run({ provider, projectId }) {
      const created = await provider.createTask({ projectId, title: 'CF Priority', priority: 'high' })
      expect(created.priority).toBe('high')
      const fetched = await provider.getTask(created.id)
      expect(fetched.priority).toBe('high')
      const updated = await provider.updateTask(created.id, { priority: 'low' })
      expect(updated.priority).toBe('low')
      const refetched = await provider.getTask(created.id)
      expect(refetched.priority).toBe('low')
    },
  },
] as const
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/plugins/task-provider-youtrack/parity/youtrack-custom-field-groups.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add tests/plugins/task-provider-youtrack/parity/youtrack-custom-field-groups.ts tests/plugins/task-provider-youtrack/parity/youtrack-custom-field-groups.test.ts
git commit -m "test(youtrack-parity): status/priority custom-field extension groups"
```

---

### Task 8: Binding runner — YouTrackProvider vs the fake (integration gate)

**Files:**
- Create: `tests/plugins/task-provider-youtrack/parity/provider-conformance.test.ts`

**Interfaces:**
- Consumes: `YouTrackProvider` (`../../../../plugins/task-provider-youtrack/provider.js`); `PARITY_GROUPS` (`../../../stories/harness/parity/expectations.js`); `required` (`../../../stories/harness/parity/group.js`); `startFakeYouTrackServer`, `FakeYouTrackServer` (Task 1); `YOUTRACK_PARITY_EXCLUSIONS` (Task 6); `youtrackCustomFieldGroups` (Task 7).
- Produces: the conformance suite. No new exports.

This is the integration gate where the real provider meets the fake. It is a genuine TDD loop: run it, and for any **included** group that fails, first fix the fake (the fake is the thing under authorship); only if a group reveals a real, structural YouTrack divergence do you move it into `YOUTRACK_PARITY_EXCLUSIONS` **with a reason** (and update the Task 6 integrity math by re-running that suite). The six exclusions in Task 6 are the expected final set derived from source; do not pre-emptively add more.

- [ ] **Step 1: Write the failing test**

Create `tests/plugins/task-provider-youtrack/parity/provider-conformance.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, beforeAll, describe, test } from 'bun:test'

import { YouTrackProvider } from '../../../../plugins/task-provider-youtrack/provider.js'
import { PARITY_GROUPS } from '../../../stories/harness/parity/expectations.js'
import { required } from '../../../stories/harness/parity/group.js'
import { startFakeYouTrackServer, type FakeYouTrackServer } from './fake-youtrack-server.js'
import { youtrackCustomFieldGroups } from './youtrack-custom-field-groups.js'
import { YOUTRACK_PARITY_EXCLUSIONS } from './youtrack-parity-exclusions.js'

// Third binding of the shared parity contract: YouTrackProvider over a fake
// YouTrack REST server. Proves request-building + response-mapping + contract
// conformance; NOT fidelity against a real YouTrack (both fake and expectations
// are authored here). See fake-youtrack-server.ts header.
const excluded = new Set(YOUTRACK_PARITY_EXCLUSIONS.map((entry) => entry.group))
const includedGroups = PARITY_GROUPS.filter((group) => !excluded.has(group.id))
const allGroups = [...includedGroups, ...youtrackCustomFieldGroups]

describe('provider conformance — YouTrack binding (fake server)', () => {
  let fake: FakeYouTrackServer

  beforeAll(() => {
    fake = startFakeYouTrackServer()
  })

  afterAll(async () => {
    await fake.stop()
  })

  for (const group of allGroups) {
    test(group.title, async () => {
      fake.reset()
      const provider = new YouTrackProvider({ baseUrl: fake.url, token: 'fake-token' })
      const createProject = required(provider.createProject, 'provider.createProject').bind(provider)
      const project = await createProject({ name: `Parity ${group.id}` })
      await group.run({ provider, projectId: project.id })
    })
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/task-provider-youtrack/parity/provider-conformance.test.ts`
Expected: initially FAIL for one or more groups (the real provider exercises code paths the fake tests did not cover directly). This is the iterate-to-green step.

- [ ] **Step 3: Drive the suite to green**

For each failing **included** group, diagnose from the assertion + the fake's route the provider hit, and fix the fake in `fake-youtrack-server.ts`. Likely touch-points and their fixes:
- **List sort/paging** (`SCN-parity-task-list-sort`, `-list-paging`): confirm `interpretQuery` handles the `sort by: title asc` clause the provider's `buildYouTrackQuery` emits and that default order is insertion order (`created` ascending).
- **Status/priority writes** (`SCN-parity-task-update` status `In Progress`, `SCN-parity-task-full-property` priority `high`, and the extension groups): confirm the seeded State/Priority bundle values contain the exact names the groups use, so `buildIssueCustomFields`'s single-match resolution succeeds. Add a value to `STATE_VALUES`/`PRIORITY_VALUES` only if a group needs it.
- **Relations** (`SCN-parity-relation`, `-relation-multiple`, `SCN-parity-relation-errors`): confirm `/api/issueLinkTypes`, the link POST/DELETE routes, and the owner-issue links projection line up with `relations.ts`'s resolve/remove flow.
- **Errors** (`SCN-parity-task-errors`, `-comment-errors`): confirm every "missing id" path returns a non-2xx so the provider's `YouTrackApiError`/`classify-error.ts` path throws.

Do NOT add an exclusion to dodge a fixable fake gap. Only a genuine structural divergence (like the six in Task 6) earns an exclusion — and then re-run `bun test tests/plugins/task-provider-youtrack/parity/youtrack-parity-exclusions.test.ts` so the integrity math stays correct. If you touched `fake-youtrack-server.ts`, re-run `fake-youtrack-server.test.ts` too.

- [ ] **Step 4: Run the full parity suite to verify it passes**

Run: `bun test tests/plugins/task-provider-youtrack/parity/`
Expected: PASS — every included shared group, both custom-field extension groups, the fake unit tests, and the exclusion-integrity tests are green.

- [ ] **Step 5: Confirm hermeticity + no frozen drift**

```bash
git status --porcelain tests/stories scripts/story bunfig.toml
```
Expected: **no output** (nothing under the frozen inputs changed). Then run the default suite to confirm the lane rides along without a new script/job:

Run: `bun test tests/plugins/task-provider-youtrack/`
Expected: PASS (existing YouTrack plugin tests + the new parity suite).

- [ ] **Step 6: Commit**

```bash
git add tests/plugins/task-provider-youtrack/parity/provider-conformance.test.ts tests/plugins/task-provider-youtrack/parity/fake-youtrack-server.ts tests/plugins/task-provider-youtrack/parity/youtrack-parity-exclusions.ts
git commit -m "test(youtrack-parity): bind YouTrackProvider to the fake over shared + custom-field groups"
```

---

## Self-Review

**Spec coverage:**
- §1 Placement/lane → all files under `tests/plugins/task-provider-youtrack/parity/`, default `bun test`, no CI/script/catalog/frozen change (Tasks 1–8; Task 8 Step 5 asserts no frozen drift). ✓
- §2 Stateful fake (`startFakeYouTrackServer(): { url; stop; reset }`, `Bun.serve` port 0, issue/project/comment/link store, `fields=` projection, custom fields as bundle values, list sort/filter/paging, search, errors) → Tasks 1–5. ✓
- §3 Binding runner (beforeAll start, `new YouTrackProvider({ baseUrl, token })`, iterate groups, afterAll stop) → Task 8. ✓
- §4 Reuse + frozen direction (imports outward; extension groups local) → Tasks 6–8. ✓
- §5 Exclusions (`YOUTRACK_PARITY_EXCLUSIONS`, integrity test, real-gap-reported-not-hidden) → Task 6 + Task 8 Step 3. ✓
- §6 What it proves/doesn't → header comments in `fake-youtrack-server.ts` and `provider-conformance.test.ts`. ✓
- Error handling (4xx/5xx → `YouTrackApiError`; fake error body; OS-assigned port) → `errorResponse` + Task 8 error groups. ✓
- Testing/verification (fake unit tests; conformance run; exclusion integrity; custom-field both directions; isolation-clean) → Tasks 1–8. ✓
- Custom-field extension = status/priority only; sprints/agiles/saved-queries deferred; no Assignee-dependent group (Assignee field present but unused). ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code; exclusion reasons are concrete; Task 8 Step 3 gives named touch-points, not "handle edge cases." ✓

**Type consistency:** `FakeYouTrackServer`, `Ctx`, `State`, `StoredIssue`/`StoredComment`/`StoredLink`, `findIssue`, `issueProjection`, `issueListProjection`, `applyCustomFieldPayload`, `interpretQuery`, `handleIssueQuery`, `decodeLinkId`, `LINK_TYPES`, `YOUTRACK_PARITY_EXCLUSIONS`, `youtrackCustomFieldGroups` are named identically across the tasks that define and consume them. Provider constructed as `new YouTrackProvider({ baseUrl, token })` (matches `YouTrackConfig`). Group binding uses `{ provider, projectId }` (matches `ParityHarness`). ✓

**Known integration risk (surfaced, not hidden):** Tasks 1–5 pin the fake against the REST contract mapped from the provider source, but the real provider is only bound in Task 8. Task 8 is explicitly the iterate-to-green gate with concrete touch-points, and the fake unit tests localize any shape drift. The six exclusions are derived from source (mappers.ts, operations/projects.ts) and expected to be final; Task 8 Step 3 forbids adding exclusions to mask fixable fake gaps.
