<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# YouTrack Relation Linking Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `add_task_relation` / `update_task_relation` work against YouTrack by replacing the write-unsupported `POST /api/issues/{id}/links` (405) with the structured `POST /api/issues/{id}/links/{linkID}/issues` endpoint.

**Architecture:** Rewrite `addYouTrackRelation` to (1) resolve the directed `linkID` defensively — discover it from the issue's own `links` collection, falling back to `/api/issueLinkTypes` + suffix construction — (2) resolve the related issue to its database `id`, then (3) POST `{ id }` to the link's `issues` sub-resource. Resolution failure throws a new classified `linkTypeNotFound` provider error listing the instance's available link types. `removeYouTrackRelation` and `updateYouTrackRelation` are unchanged in behavior.

**Tech Stack:** Bun + TypeScript, Zod v4, `bun:test`. Files live in `plugins/task-provider-youtrack/` (plugin) and `src/providers/errors.ts` (shared error union).

**Spec:** `docs/superpowers/specs/2026-06-17-youtrack-relation-linking-design.md`

---

## Background facts (verified against JetBrains Developer Portal)

- `/api/issues/{issueID}/links` → **GET only** (read). POST returns 405. This is the bug.
- `/api/issues/{issueID}/links/{linkID}/issues` → **GET + POST**; POST adds a link, body is an `Issue`.
- YouTrack's built-in link-type **`name`** values are singular: **`Relates`**, **`Depend`**, **`Duplicate`**, **`Subtask`** (the docs say "the **Depend** link type"). The current code maps `blocks`→`'depends'`, which would never match `Depend` — this plan fixes the mapping to canonical names matched case-insensitively.
- `IssueLink.direction ∈ {OUTWARD, INWARD, BOTH}`. Undirected types (e.g. `Relates`) report `BOTH`, so direction matching must accept `BOTH`.
- `name` is the canonical (non-localized) field; `localizedName` is separate. Matching on `name` is locale-stable.

## File Structure

- **Modify** `src/providers/errors.ts` — add `link-type-not-found` to the `ProviderError` union, a `linkTypeNotFound` factory, and its `getProviderMessage` case. Flows to the plugin via `src/errors.ts` → `src/providers/public-types.ts` → `papai/plugin-types` (no extra export wiring needed).
- **Modify** `tests/providers/errors.test.ts` — add a message-mapping test for the new code.
- **Rewrite** `plugins/task-provider-youtrack/relations.ts` — fix `mapRelationTypeToLinkType` names, add `resolveYouTrackLinkId`, rewrite `addYouTrackRelation`. Keep `mapRelationTypeToDirection`, `removeYouTrackRelation`, `updateYouTrackRelation`.
- **Rewrite** `tests/plugins/task-provider-youtrack/relations.test.ts` — assert the corrected request sequence (discover, fallback, db-id resolution, POST shape, error).

---

## Task 1: Add `linkTypeNotFound` provider error

**Files:**

- Modify: `src/providers/errors.ts`
- Test: `tests/providers/errors.test.ts`

Note: `src/providers/errors.ts` is under `src/`, so the TDD hook requires the failing test first.

- [ ] **Step 1: Write the failing test**

Add this test inside the `describe('getProviderMessage', ...)` block in `tests/providers/errors.test.ts`, right after the existing `test('returns message for status-not-found', ...)` (around line 89):

```typescript
test('returns message for link-type-not-found', () => {
  const error = providerError.linkTypeNotFound('Depend', ['Relates', 'Duplicate', 'Subtask'])
  expect(getProviderMessage(error)).toContain('Depend')
  expect(getProviderMessage(error)).toContain('Relates')
  expect(getProviderMessage(error)).toContain('Duplicate')
  expect(getProviderMessage(error)).toContain('Subtask')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/providers/errors.test.ts -t "link-type-not-found"`
Expected: FAIL — `providerError.linkTypeNotFound` is not a function (TypeScript error / undefined).

- [ ] **Step 3: Add the union member**

In `src/providers/errors.ts`, add this line to the `ProviderError` union immediately after the `status-not-found` member (currently line 36):

```typescript
  | { type: 'provider'; code: 'link-type-not-found'; linkTypeName: string; available: string[] }
```

- [ ] **Step 4: Add the factory**

In `src/providers/errors.ts`, add this factory to the `providerError` object immediately after the `statusNotFound` factory (currently ends line 108):

```typescript
  linkTypeNotFound: (linkTypeName: string, available: string[]): ProviderError => ({
    type: 'provider',
    code: 'link-type-not-found',
    linkTypeName,
    available,
  }),
```

- [ ] **Step 5: Add the message case**

In `src/providers/errors.ts`, in the `getProviderMessage` switch, add this case immediately after the `status-not-found` case (currently lines 153-154):

```typescript
    case 'link-type-not-found':
      return `Link type "${error.linkTypeName}" was not found on this YouTrack instance. Available link types: ${error.available.join(', ')}.`
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test tests/providers/errors.test.ts -t "link-type-not-found"`
Expected: PASS.

- [ ] **Step 7: Run the full errors suite to confirm no regressions**

Run: `bun test tests/providers/errors.test.ts`
Expected: PASS (all tests).

- [ ] **Step 8: Commit**

```bash
git add src/providers/errors.ts tests/providers/errors.test.ts
git commit -m "feat(providers): add linkTypeNotFound provider error"
```

---

## Task 2: Fix YouTrack relation linking via the structured endpoint

**Files:**

- Rewrite: `plugins/task-provider-youtrack/relations.ts`
- Rewrite test: `tests/plugins/task-provider-youtrack/relations.test.ts`

This task rewrites both files together because the request shape changes completely. Write the new tests first (they will fail against the current implementation), then replace the implementation.

- [ ] **Step 1: Replace the test file with the corrected request-sequence tests**

Overwrite `tests/plugins/task-provider-youtrack/relations.test.ts` with the following complete content:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { z } from 'zod'

import { YouTrackClassifiedError } from '../../../plugins/task-provider-youtrack/classify-error.js'
import type { YouTrackConfig } from '../../../plugins/task-provider-youtrack/client.js'
import {
  addYouTrackRelation,
  removeYouTrackRelation,
  updateYouTrackRelation,
} from '../../../plugins/task-provider-youtrack/relations.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

let fetchMock: ReturnType<typeof mock<(url: string, init: RequestInit) => Promise<Response>>>

const config: YouTrackConfig = {
  baseUrl: 'https://test.youtrack.cloud',
  token: 'test-token',
}

const mockFetchSequence = (responses: Array<{ data: unknown; status?: number }>): void => {
  let callIndex = 0
  const m = mock<(url: string, init: RequestInit) => Promise<Response>>(() => {
    const response = responses[callIndex] ?? responses[responses.length - 1]!
    callIndex++
    return Promise.resolve(
      new Response(JSON.stringify(response.data), {
        status: response.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
  fetchMock = m
  setMockFetch((url: string, init: RequestInit) => m(url, init))
}

const FetchCallSchema = z.tuple([
  z.string(),
  z.looseObject({ method: z.string().optional(), body: z.string().optional() }),
])

const getFetchUrl = (index: number): URL => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[index])
  if (!parsed.success) return new URL('https://empty')
  return new URL(parsed.data[0])
}

const getFetchMethod = (index: number): string => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[index])
  if (!parsed.success) return ''
  return parsed.data[1].method ?? ''
}

const BodySchema = z.looseObject({})

const getFetchBody = (index: number): Record<string, unknown> => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[index])
  if (!parsed.success) return {}
  const { body } = parsed.data[1]
  if (body === undefined) return {}
  return BodySchema.parse(JSON.parse(body))
}

// A YouTrack issue-links GET response that exposes the directed link entries for PROJ-123.
const issueLinksResponse = {
  id: 'issue-123',
  links: [
    { id: 'lt-depend-s', direction: 'OUTWARD', linkType: { id: 'lt-depend', name: 'Depend' } },
    { id: 'lt-depend-t', direction: 'INWARD', linkType: { id: 'lt-depend', name: 'Depend' } },
    { id: 'lt-dup-s', direction: 'OUTWARD', linkType: { id: 'lt-dup', name: 'Duplicate' } },
    { id: 'lt-dup-t', direction: 'INWARD', linkType: { id: 'lt-dup', name: 'Duplicate' } },
    { id: 'lt-sub-s', direction: 'OUTWARD', linkType: { id: 'lt-sub', name: 'Subtask' } },
    { id: 'lt-sub-t', direction: 'INWARD', linkType: { id: 'lt-sub', name: 'Subtask' } },
    { id: 'lt-rel', direction: 'BOTH', linkType: { id: 'lt-rel', name: 'Relates' } },
  ],
}

beforeEach(() => {
  mockLogger()
})

describe('addYouTrackRelation (structured /links/{linkID}/issues)', () => {
  beforeEach(() => {
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('discovers linkID from issue links, resolves db id, then POSTs the link', async () => {
    mockFetchSequence([
      { data: issueLinksResponse }, // GET /api/issues/PROJ-123/links
      { data: { id: '2-456' } }, // GET /api/issues/PROJ-456 (db id)
      { data: { id: 'created-link' } }, // POST links/{linkID}/issues
    ])

    await addYouTrackRelation(config, 'PROJ-123', 'PROJ-456', 'blocks')

    expect(getFetchUrl(0).pathname).toBe('/api/issues/PROJ-123/links')
    expect(getFetchMethod(0)).toBe('GET')

    expect(getFetchUrl(1).pathname).toBe('/api/issues/PROJ-456')
    expect(getFetchMethod(1)).toBe('GET')

    // blocks -> Depend / OUTWARD -> discovered link id 'lt-depend-s'
    expect(getFetchUrl(2).pathname).toBe('/api/issues/PROJ-123/links/lt-depend-s/issues')
    expect(getFetchMethod(2)).toBe('POST')
    expect(getFetchBody(2)).toEqual({ id: '2-456' })
  })

  test('uses the INWARD entry for blocked_by', async () => {
    mockFetchSequence([{ data: issueLinksResponse }, { data: { id: '2-456' } }, { data: {} }])

    await addYouTrackRelation(config, 'PROJ-123', 'PROJ-456', 'blocked_by')

    expect(getFetchUrl(2).pathname).toBe('/api/issues/PROJ-123/links/lt-depend-t/issues')
  })

  test('maps duplicate to the Duplicate OUTWARD entry', async () => {
    mockFetchSequence([{ data: issueLinksResponse }, { data: { id: '2-456' } }, { data: {} }])

    await addYouTrackRelation(config, 'PROJ-123', 'PROJ-456', 'duplicate')

    expect(getFetchUrl(2).pathname).toBe('/api/issues/PROJ-123/links/lt-dup-s/issues')
  })

  test('maps parent to the Subtask OUTWARD entry', async () => {
    mockFetchSequence([{ data: issueLinksResponse }, { data: { id: '2-456' } }, { data: {} }])

    await addYouTrackRelation(config, 'PROJ-123', 'PROJ-456', 'parent')

    expect(getFetchUrl(2).pathname).toBe('/api/issues/PROJ-123/links/lt-sub-s/issues')
  })

  test('maps related to the undirected Relates entry (direction BOTH)', async () => {
    mockFetchSequence([{ data: issueLinksResponse }, { data: { id: '2-456' } }, { data: {} }])

    await addYouTrackRelation(config, 'PROJ-123', 'PROJ-456', 'related')

    expect(getFetchUrl(2).pathname).toBe('/api/issues/PROJ-123/links/lt-rel/issues')
  })

  test('falls back to issueLinkTypes + constructed id when issue links lack the entry', async () => {
    mockFetchSequence([
      { data: { id: 'issue-123', links: [] } }, // GET links: no entries surfaced
      { data: [{ id: 'lt-depend', name: 'Depend', directed: true }] }, // GET /api/issueLinkTypes
      { data: { id: '2-456' } }, // GET db id
      { data: {} }, // POST
    ])

    await addYouTrackRelation(config, 'PROJ-123', 'PROJ-456', 'blocks')

    expect(getFetchUrl(1).pathname).toBe('/api/issueLinkTypes')
    expect(getFetchMethod(1)).toBe('GET')
    // Depend is directed, OUTWARD -> suffix 's'
    expect(getFetchUrl(3).pathname).toBe('/api/issues/PROJ-123/links/lt-depends/issues')
    expect(getFetchBody(3)).toEqual({ id: '2-456' })
  })

  test('fallback uses suffix s for an undirected link type', async () => {
    mockFetchSequence([
      { data: { id: 'issue-123', links: [] } },
      { data: [{ id: 'lt-rel', name: 'Relates', directed: false }] },
      { data: { id: '2-456' } },
      { data: {} },
    ])

    await addYouTrackRelation(config, 'PROJ-123', 'PROJ-456', 'related')

    expect(getFetchUrl(3).pathname).toBe('/api/issues/PROJ-123/links/lt-rels/issues')
  })

  test('throws linkTypeNotFound listing available types when resolution fails', async () => {
    mockFetchSequence([
      { data: { id: 'issue-123', links: [] } }, // no matching entry
      { data: [{ id: 'lt-rel', name: 'Relates', directed: false }] }, // Depend absent
    ])

    await expect(addYouTrackRelation(config, 'PROJ-123', 'PROJ-456', 'blocks')).rejects.toBeInstanceOf(
      YouTrackClassifiedError,
    )
  })
})

describe('removeYouTrackRelation', () => {
  beforeEach(() => {
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('uses REST DELETE endpoint', async () => {
    mockFetchSequence([
      {
        data: {
          id: 'issue-1',
          links: [
            {
              id: 'link-1',
              direction: 'OUTWARD',
              linkType: { id: 'lt-1', name: 'Depend' },
              issues: [{ id: 'PROJ-456', idReadable: 'PROJ-456' }],
            },
          ],
        },
      },
      { data: {} },
    ])

    await removeYouTrackRelation(config, 'PROJ-123', 'PROJ-456')

    expect(getFetchUrl(0).pathname).toBe('/api/issues/PROJ-123')
    expect(getFetchMethod(0)).toBe('GET')
    expect(getFetchUrl(1).pathname).toBe('/api/issues/PROJ-123/links/link-1')
    expect(getFetchMethod(1)).toBe('DELETE')
  })

  test('throws when relation not found', async () => {
    mockFetchSequence([{ data: { id: 'issue-1', links: [] } }])

    await expect(removeYouTrackRelation(config, 'PROJ-123', 'PROJ-456')).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })
})

describe('updateYouTrackRelation', () => {
  beforeEach(() => {
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('removes the old relation then adds the new one via the structured endpoint', async () => {
    mockFetchSequence([
      // removeYouTrackRelation: GET issue, then DELETE
      {
        data: {
          id: 'issue-1',
          links: [
            {
              id: 'link-1',
              direction: 'OUTWARD',
              linkType: { id: 'lt-1', name: 'Depend' },
              issues: [{ id: 'PROJ-456', idReadable: 'PROJ-456' }],
            },
          ],
        },
      },
      { data: {} }, // DELETE
      // addYouTrackRelation: GET links, GET db id, POST
      { data: issueLinksResponse },
      { data: { id: '2-456' } },
      { data: {} },
    ])

    await updateYouTrackRelation(config, 'PROJ-123', 'PROJ-456', 'duplicate')

    expect(getFetchUrl(1).pathname).toBe('/api/issues/PROJ-123/links/link-1')
    expect(getFetchMethod(1)).toBe('DELETE')
    expect(getFetchUrl(4).pathname).toBe('/api/issues/PROJ-123/links/lt-dup-s/issues')
    expect(getFetchMethod(4)).toBe('POST')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail against the current implementation**

Run: `bun test tests/plugins/task-provider-youtrack/relations.test.ts`
Expected: FAIL — the current `addYouTrackRelation` POSTs to `/api/issues/PROJ-123/links` and reads no db id, so the URL/method/body assertions and the new fallback/error tests fail.

- [ ] **Step 3: Replace the implementation file**

Overwrite `plugins/task-provider-youtrack/relations.ts` with the following complete content:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { RelationType } from 'papai/plugin-types'
import { providerError } from 'papai/plugin-types'
import { z } from 'zod'

import { logger } from '../../src/logger.js'
import { YouTrackClassifiedError, classifyYouTrackError } from './classify-error.js'
import type { YouTrackConfig } from './client.js'
import { youtrackFetch } from './client.js'
import { IssueLinkSchema } from './schemas/issue-link.js'

const IssueLinksSchema = z.object({
  id: z.string(),
  links: z.array(IssueLinkSchema).optional(),
})

/** Minimal shape of an item from GET /api/issueLinkTypes. */
const IssueLinkTypeListSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    directed: z.boolean().optional(),
  }),
)

/** Minimal shape for resolving an issue's database id. */
const IssueIdSchema = z.object({ id: z.string() })

const log = logger.child({ scope: 'provider:youtrack:relations' })

// YouTrack's built-in link-type names are singular ("Depend", not "Depends"); matched case-insensitively.
function mapRelationTypeToLinkType(type: RelationType): string {
  switch (type) {
    case 'blocks':
    case 'blocked_by':
      return 'Depend'
    case 'duplicate':
    case 'duplicate_of':
      return 'Duplicate'
    case 'parent':
    case 'child':
      return 'Subtask'
    case 'related':
      return 'Relates'
    default:
      return 'Relates'
  }
}

function mapRelationTypeToDirection(type: RelationType): 'OUTWARD' | 'INWARD' {
  switch (type) {
    case 'blocks':
    case 'duplicate':
    case 'parent':
      return 'OUTWARD'
    case 'blocked_by':
    case 'duplicate_of':
    case 'related':
    case 'child':
      return 'INWARD'
    default:
      return 'INWARD'
  }
}

/**
 * Resolve the directed link id used by POST /api/issues/{id}/links/{linkID}/issues.
 *
 * Primary path discovers the id from the issue's own link collection (no suffix guessing,
 * undirected types report direction BOTH). Fallback resolves the link type from
 * /api/issueLinkTypes and constructs the id from the type id plus a direction suffix.
 */
async function resolveYouTrackLinkId(
  config: YouTrackConfig,
  taskId: string,
  linkTypeName: string,
  direction: 'OUTWARD' | 'INWARD',
): Promise<string> {
  const wanted = linkTypeName.toLowerCase()

  const rawLinks = await youtrackFetch(config, 'GET', `/api/issues/${taskId}/links`, {
    query: { fields: 'id,direction,linkType(id,name)' },
  })
  const issue = IssueLinksSchema.parse(rawLinks)
  const discovered = (issue.links ?? []).find(
    (link) =>
      link.id !== undefined &&
      (link.linkType?.name ?? '').toLowerCase() === wanted &&
      (link.direction === direction || link.direction === 'BOTH'),
  )
  if (discovered?.id !== undefined) {
    return discovered.id
  }

  const rawTypes = await youtrackFetch(config, 'GET', '/api/issueLinkTypes', {
    query: { fields: 'id,name,directed' },
  })
  const types = IssueLinkTypeListSchema.parse(rawTypes)
  const match = types.find((t) => t.name.toLowerCase() === wanted)
  if (match === undefined) {
    throw new YouTrackClassifiedError(
      `Link type "${linkTypeName}" not found on this YouTrack instance`,
      providerError.linkTypeNotFound(
        linkTypeName,
        types.map((t) => t.name),
      ),
    )
  }

  const suffix = match.directed === false ? 's' : direction === 'OUTWARD' ? 's' : 't'
  return `${match.id}${suffix}`
}

export async function updateYouTrackRelation(
  config: YouTrackConfig,
  taskId: string,
  relatedTaskId: string,
  type: RelationType,
): Promise<{ taskId: string; relatedTaskId: string; type: string }> {
  log.debug({ taskId, relatedTaskId, type }, 'updateRelation')

  await removeYouTrackRelation(config, taskId, relatedTaskId)

  const result = await addYouTrackRelation(config, taskId, relatedTaskId, type)

  log.info({ taskId, relatedTaskId, type }, 'Relation updated')
  return result
}

export async function addYouTrackRelation(
  config: YouTrackConfig,
  taskId: string,
  relatedTaskId: string,
  type: RelationType,
): Promise<{ taskId: string; relatedTaskId: string; type: string }> {
  log.debug({ taskId, relatedTaskId, type }, 'addRelation')

  try {
    const linkTypeName = mapRelationTypeToLinkType(type)
    const direction = mapRelationTypeToDirection(type)

    const linkId = await resolveYouTrackLinkId(config, taskId, linkTypeName, direction)

    // The POST body is an Issue; YouTrack expects the database id, not the readable id.
    const rawRelated = await youtrackFetch(config, 'GET', `/api/issues/${relatedTaskId}`, {
      query: { fields: 'id' },
    })
    const relatedDbId = IssueIdSchema.parse(rawRelated).id

    await youtrackFetch(config, 'POST', `/api/issues/${taskId}/links/${linkId}/issues`, {
      body: { id: relatedDbId },
      query: { fields: 'id' },
    })

    log.info({ taskId, relatedTaskId, type }, 'Relation added')
    return { taskId, relatedTaskId, type }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), taskId, relatedTaskId, type },
      'Failed to add relation',
    )
    throw classifyYouTrackError(error, { taskId })
  }
}

export async function removeYouTrackRelation(
  config: YouTrackConfig,
  taskId: string,
  relatedTaskId: string,
): Promise<{ taskId: string; relatedTaskId: string }> {
  log.debug({ taskId, relatedTaskId }, 'removeRelation')

  const raw = await youtrackFetch(config, 'GET', `/api/issues/${taskId}`, {
    query: { fields: 'id,links(id,direction,linkType(name),issues(id,idReadable))' },
  })
  const issue = IssueLinksSchema.parse(raw)

  const matchingLink = (issue.links ?? []).find((link) =>
    (link.issues ?? []).some((i) => i.id === relatedTaskId || i.idReadable === relatedTaskId),
  )

  if (matchingLink === undefined) {
    const err = providerError.relationNotFound(taskId, relatedTaskId)
    throw new YouTrackClassifiedError(`Relation not found: ${taskId} -> ${relatedTaskId}`, err)
  }

  await youtrackFetch(config, 'DELETE', `/api/issues/${taskId}/links/${matchingLink.id}`)

  log.info({ taskId, relatedTaskId }, 'Relation removed')
  return { taskId, relatedTaskId }
}
```

- [ ] **Step 4: Run the relations tests to verify they pass**

Run: `bun test tests/plugins/task-provider-youtrack/relations.test.ts`
Expected: PASS (all tests in all three describe blocks).

- [ ] **Step 5: Typecheck and lint the changed files**

Run: `bun check`
Expected: lint + typecheck + format all pass for the staged/changed files. Fix any reported issue at its source (no suppressions).

- [ ] **Step 6: Commit**

```bash
git add plugins/task-provider-youtrack/relations.ts tests/plugins/task-provider-youtrack/relations.test.ts
git commit -m "fix(youtrack): add relations via structured /links/{linkID}/issues endpoint"
```

---

## Task 3: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the YouTrack plugin test suite**

Run: `bun test tests/plugins/task-provider-youtrack/`
Expected: PASS.

- [ ] **Step 2: Run the provider errors suite**

Run: `bun test tests/providers/errors.test.ts`
Expected: PASS.

- [ ] **Step 3: Run the full check**

Run: `bun check:full`
Expected: all checks pass (lint, typecheck, format, license-headers, tests).

- [ ] **Step 4: Manual verification note (pre-release, optional now)**

Because we opted out of a live probe, before releasing, run one real link against a YouTrack instance to confirm the directed `linkID` suffix convention and the `{ id: dbId }` body are accepted end-to-end:

```
add_task_relation(taskId=<A>, relatedTaskId=<B>, type="related")
# expect: success; the link is visible in the YouTrack UI on both issues
```

If the discovery path is used (the common case), the suffix convention is not exercised; the manual check confirms both the discovery and the body shape.

---

## Self-Review notes

- **Spec coverage:** structured endpoint (Task 2), defensive discover→fallback linkID (Task 2 `resolveYouTrackLinkId`), related-issue db-id resolution (Task 2), `linkTypeNotFound` + available list (Task 1, asserted in Task 2), `removeYouTrackRelation`/`updateYouTrackRelation` unchanged behavior (Task 2), mock-only tests + manual verification note (Tasks 2-3). All spec sections map to a task.
- **Built-in name correction:** the spec assumed matching "by canonical name"; this plan pins the canonical names to YouTrack's actual singular forms (`Depend`/`Duplicate`/`Subtask`/`Relates`) and matches case-insensitively — a correctness detail the spec left implicit.
- **Type consistency:** `resolveYouTrackLinkId(config, taskId, linkTypeName, direction)` and `providerError.linkTypeNotFound(linkTypeName, available)` signatures are used identically across the implementation and tests.

```

```
