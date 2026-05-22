<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# YouTrack Full API Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement full YouTrack REST API coverage across 5 independent phases with bug fixes, status management, attachments, collaboration, and agile features.

**Architecture:** Feature-based phase structure. Each phase is independently deployable via capability gating. Phase 1 fixes existing bugs and extends field coverage. Phases 2-5 add new domain types, operations, and tools. Uses bundle resolution cache for status management, pagination helper for list operations, and feature flags for rollback.

**Tech Stack:** Bun runtime, TypeScript, Zod v4, Vercel AI SDK, pino logging

---

## Phase 1: Bug Fixes & Cheap Wins

Estimated scope: ~10 files, no new domain types

---

### Task 1.1: Fix updateLabel Color Bug

**Files:**

- Modify: `src/providers/youtrack/labels.ts:58-65`
- Test: `tests/providers/youtrack/labels.test.ts`

**Step 1: Write the failing test**

Add to `tests/providers/youtrack/labels.test.ts`:

```typescript
test('updateLabel sends color in request body', async () => {
  const mockTag = {
    id: 'tag-123',
    name: 'Updated Tag',
    color: { id: 'color-1', background: '#FF5722', foreground: '#FFFFFF' },
  }

  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: () => Promise.resolve(mockTag),
  })

  await updateYouTrackLabel(config, 'tag-123', { name: 'Updated Tag', color: '#FF5722' })

  const call = mockFetch.mock.calls[0]
  expect(call[1].method).toBe('POST')
  expect(call[1].body).toEqual({
    name: 'Updated Tag',
    color: { background: '#FF5722' },
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/providers/youtrack/labels.test.ts --reporter=dot`
Expected: FAIL - `color` not in request body

**Step 3: Write minimal implementation**

Edit `src/providers/youtrack/labels.ts:58-65`:

```typescript
export async function updateYouTrackLabel(
  config: YouTrackConfig,
  labelId: string,
  params: { name?: string; color?: string },
): Promise<Label> {
  log.debug({ labelId }, 'updateLabel')
  try {
    const body: Record<string, unknown> = {}
    if (params.name !== undefined) body['name'] = params.name
    if (params.color !== undefined) {
      body['color'] = { background: params.color }
    }
    const raw = await youtrackFetch(config, 'POST', `/api/tags/${labelId}`, {
      body,
      query: { fields: TAG_FIELDS },
    })
    const tag = TagSchema.parse(raw)
    log.info({ tagId: tag.id }, 'Tag updated')
    return { id: tag.id, name: tag.name, color: tag.color?.background }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), labelId }, 'Failed to update label')
    throw classifyYouTrackError(error, { labelId })
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/providers/youtrack/labels.test.ts --reporter=dot`
Expected: PASS

**Step 5: Commit**

```bash
git add src/providers/youtrack/labels.ts tests/providers/youtrack/labels.test.ts
git commit -m "fix(youtrack): send color in updateLabel request body"
```

---

### Task 1.2: Implement getComment Operation

**Files:**

- Create: `src/providers/youtrack/schemas/comment.ts` (extend if needed)
- Modify: `src/providers/youtrack/operations/comments.ts`
- Modify: `src/providers/youtrack/index.ts`
- Test: `tests/providers/youtrack/operations/comments.test.ts`

**Step 1: Write the failing test**

Add to `tests/providers/youtrack/operations/comments.test.ts`:

```typescript
test('getComment fetches single comment by id', async () => {
  const mockComment = {
    id: 'comment-456',
    text: 'This is a specific comment',
    author: { id: 'user-1', login: 'jane', name: 'Jane Doe' },
    created: 1704067200000,
  }

  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: () => Promise.resolve(mockComment),
  })

  const result = await getYouTrackComment(config, 'PROJ-123', 'comment-456')

  expect(result).toEqual({
    id: 'comment-456',
    body: 'This is a specific comment',
    author: 'Jane Doe',
    createdAt: '2024-01-01T00:00:00.000Z',
  })

  const call = mockFetch.mock.calls[0]
  expect(call[0]).toContain('/api/issues/PROJ-123/comments/comment-456')
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/providers/youtrack/operations/comments.test.ts --reporter=dot`
Expected: FAIL - `getYouTrackComment` not exported

**Step 3: Write minimal implementation**

Add to `src/providers/youtrack/operations/comments.ts`:

```typescript
export async function getYouTrackComment(config: YouTrackConfig, taskId: string, commentId: string): Promise<Comment> {
  log.debug({ taskId, commentId }, 'getComment')
  try {
    const raw = await youtrackFetch(config, 'GET', `/api/issues/${taskId}/comments/${commentId}`, {
      query: { fields: COMMENT_FIELDS },
    })
    const comment = CommentSchema.parse(raw)
    log.info({ taskId, commentId: comment.id }, 'Comment retrieved')
    return mapComment(comment)
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), taskId, commentId },
      'Failed to get comment',
    )
    throw classifyYouTrackError(error, { taskId, commentId })
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/providers/youtrack/operations/comments.test.ts --reporter=dot`
Expected: PASS

**Step 5: Wire into provider**

Edit `src/providers/youtrack/index.ts`:

1. Add import:

```typescript
import { getYouTrackComment, addYouTrackComment, ... } from './operations/comments.js'
```

2. Add method to class:

```typescript
getComment?(taskId: string, commentId: string): Promise<Comment> {
  return getYouTrackComment(this.config, taskId, commentId)
}
```

**Step 6: Run all tests**

Run: `bun test tests/providers/youtrack/ --reporter=dot`
Expected: All PASS

**Step 7: Commit**

```bash
git add src/providers/youtrack/operations/comments.ts src/providers/youtrack/index.ts tests/providers/youtrack/operations/comments.test.ts
git commit -m "feat(youtrack): implement getComment operation"
```

---

### Task 1.3: Implement deleteProject (archive_project)

**Files:**

- Modify: `src/providers/youtrack/operations/projects.ts`
- Modify: `src/providers/youtrack/index.ts`
- Test: `tests/providers/youtrack/operations/projects.test.ts`

**Step 1: Write the failing test**

Add to `tests/providers/youtrack/operations/projects.test.ts`:

```typescript
test('deleteProject removes project via DELETE request', async () => {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: () => Promise.resolve({}),
  })

  const result = await deleteYouTrackProject(config, 'proj-123')

  expect(result).toEqual({ id: 'proj-123' })

  const call = mockFetch.mock.calls[0]
  expect(call[0]).toContain('/api/admin/projects/proj-123')
  expect(call[1].method).toBe('DELETE')
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/providers/youtrack/operations/projects.test.ts --reporter=dot`
Expected: FAIL - `deleteYouTrackProject` not exported

**Step 3: Write minimal implementation**

Add to `src/providers/youtrack/operations/projects.ts`:

```typescript
export async function deleteYouTrackProject(config: YouTrackConfig, projectId: string): Promise<{ id: string }> {
  log.debug({ projectId }, 'deleteProject')
  try {
    await youtrackFetch(config, 'DELETE', `/api/admin/projects/${projectId}`)
    log.info({ projectId }, 'Project deleted')
    return { id: projectId }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), projectId }, 'Failed to delete project')
    throw classifyYouTrackError(error, { projectId })
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/providers/youtrack/operations/projects.test.ts --reporter=dot`
Expected: PASS

**Step 5: Wire into provider**

Edit `src/providers/youtrack/index.ts`:

1. Add import if not present
2. Add method:

```typescript
deleteProject(projectId: string): Promise<{ id: string }> {
  return deleteYouTrackProject(this.config, projectId)
}
```

**Step 6: Verify delete-project tool already exists**

Check `src/tools/delete-project.ts` - should already call `provider.deleteProject`

Run: `bun test tests/tools/delete-project.test.ts --reporter=dot`
Expected: PASS (tool already implemented)

**Step 7: Commit**

```bash
git add src/providers/youtrack/operations/projects.ts src/providers/youtrack/index.ts tests/providers/youtrack/operations/projects.test.ts
git commit -m "feat(youtrack): implement deleteProject via DELETE /api/admin/projects/{id}"
```

---

### Task 1.4: Extend ISSUE_FIELDS Constant

**Files:**

- Modify: `src/providers/youtrack/constants.ts`
- Modify: `src/providers/youtrack/schemas/issue.ts`
- Modify: `src/providers/youtrack/mappers.ts`
- Test: `tests/providers/youtrack/mappers.test.ts`

**Step 1: Update ISSUE_FIELDS**

Edit `src/providers/youtrack/constants.ts`:

```typescript
export const ISSUE_FIELDS = [
  'id',
  'idReadable',
  'numberInProject',
  'summary',
  'description',
  'created',
  'updated',
  'resolved',
  'project(id,shortName,name)',
  'reporter(id,login,fullName)',
  'updater(id,login,fullName)',
  'votes',
  'commentsCount',
  'customFields($type,name,value($type,id,name,login,fullName,localizedName,minutes,presentation,text))',
  'tags(id,name,color(id,background,foreground),owner(login))',
  'links(id,direction,linkType(id,name,sourceToTarget,targetToSource,directed,aggregation),issues(id,idReadable,summary,resolved))',
  'attachments(id,name,mimeType,size,url,thumbnailURL,author(login),created)',
  'visibility($type,permittedGroups(name),permittedUsers(login))',
  'parent(issues(id,idReadable,summary))',
  'subtasks(issues(id,idReadable,summary,resolved))',
].join(',')
```

**Step 2: Extend IssueSchema**

Edit `src/providers/youtrack/schemas/issue.ts`:

```typescript
import { z } from 'zod'

export const IssueSchema = z.object({
  id: z.string(),
  idReadable: z.string().optional(),
  numberInProject: z.number().optional(),
  summary: z.string(),
  description: z.string().nullable().optional(),
  created: z.number().optional(),
  updated: z.number().optional(),
  resolved: z.number().nullable().optional(),
  project: z
    .object({
      id: z.string(),
      shortName: z.string().optional(),
      name: z.string().optional(),
    })
    .optional(),
  reporter: z
    .object({
      id: z.string(),
      login: z.string(),
      fullName: z.string().optional(),
    })
    .optional(),
  updater: z
    .object({
      id: z.string(),
      login: z.string(),
      fullName: z.string().optional(),
    })
    .optional(),
  votes: z.number().optional(),
  commentsCount: z.number().optional(),
  customFields: z.array(z.unknown()).optional(),
  tags: z.array(z.unknown()).optional(),
  links: z.array(z.unknown()).optional(),
  attachments: z.array(z.unknown()).optional(),
  visibility: z.unknown().optional(),
  parent: z
    .object({
      issues: z
        .array(
          z.object({
            id: z.string(),
            idReadable: z.string().optional(),
            summary: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  subtasks: z
    .object({
      issues: z
        .array(
          z.object({
            id: z.string(),
            idReadable: z.string().optional(),
            summary: z.string().optional(),
            resolved: z.number().nullable().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
})

export type IssueSchemaType = z.infer<typeof IssueSchema>
```

**Step 3: Write failing test for mapper**

Add to `tests/providers/youtrack/mappers.test.ts`:

```typescript
test('mapIssueToTask extracts reporter and updater', () => {
  const issue = {
    id: '123',
    idReadable: 'PROJ-1',
    summary: 'Test',
    reporter: { id: 'u-1', login: 'alice', fullName: 'Alice Smith' },
    updater: { id: 'u-2', login: 'bob', fullName: 'Bob Jones' },
    votes: 5,
    commentsCount: 3,
    numberInProject: 1,
    resolved: 1704067200000,
    attachments: [{ id: 'a-1', name: 'file.pdf', url: 'https://example.com/file.pdf' }],
    parent: { issues: [{ id: '100', idReadable: 'PROJ-0', summary: 'Parent Task' }] },
    subtasks: {
      issues: [{ id: '200', idReadable: 'PROJ-2', summary: 'Subtask', resolved: null }],
    },
  }

  const result = mapIssueToTask(issue as any, 'https://example.com')

  expect(result.reporter).toEqual({ id: 'u-1', login: 'alice', name: 'Alice Smith' })
  expect(result.updater).toEqual({ id: 'u-2', login: 'bob', name: 'Bob Jones' })
  expect(result.votes).toBe(5)
  expect(result.commentsCount).toBe(3)
  expect(result.number).toBe(1)
  expect(result.resolved).toBe('2024-01-01T00:00:00.000Z')
  expect(result.parent).toEqual({ id: '100', idReadable: 'PROJ-0', title: 'Parent Task' })
  expect(result.subtasks).toEqual([{ id: '200', idReadable: 'PROJ-2', title: 'Subtask', status: undefined }])
})
```

**Step 4: Run test to verify it fails**

Run: `bun test tests/providers/youtrack/mappers.test.ts --reporter=dot`
Expected: FAIL - reporter/updater not extracted

**Step 5: Write minimal implementation**

Edit `src/providers/youtrack/mappers.ts`:

```typescript
import type { z } from 'zod'

import type { Attachment, Comment, RelationType, Task, TaskListItem, TaskSearchResult } from '../types.js'
import type { CommentSchema } from './schemas/comment.js'
import type { CustomFieldValueSchema } from './schemas/custom-fields.js'
import type { IssueListSchema, IssueSchema } from './schemas/issue.js'

type AnyCustomField = z.infer<typeof CustomFieldValueSchema>

const getCustomFieldValue = (customFields: AnyCustomField[] | undefined, fieldName: string): string | undefined => {
  const cf = customFields?.find((f) => f.name === fieldName)
  if (cf === undefined) return undefined
  const val: unknown = cf.value
  if (val === null || val === undefined) return undefined
  if (typeof val === 'object') {
    const name = (val as { name?: unknown })['name']
    if (typeof name === 'string') return name
    const login = (val as { login?: unknown })['login']
    if (typeof login === 'string') return login
    return undefined
  }
  return typeof val === 'string' ? val : undefined
}

const mapRelationType = (linkTypeName: string, direction: string): RelationType => {
  const name = linkTypeName.toLowerCase()
  if (name === 'depend' || name === 'depends') {
    return direction === 'OUTWARD' ? 'blocks' : 'blocked_by'
  }
  if (name === 'duplicate') {
    return direction === 'OUTWARD' ? 'duplicate' : 'duplicate_of'
  }
  if (name === 'subtask') {
    return direction === 'OUTWARD' ? 'parent' : 'parent'
  }
  return 'related'
}

const toIsoOrUndefined = (timestamp: number | undefined): string | undefined =>
  timestamp === undefined ? undefined : new Date(timestamp).toISOString()

export const mapIssueToTask = (issue: z.infer<typeof IssueSchema>, baseUrl: string): Task => {
  const relations = (issue.links ?? []).flatMap((link: any) => {
    const typeName = link.linkType?.name ?? 'Relate'
    return (link.issues ?? []).map((linked: any) => ({
      type: mapRelationType(typeName, link.direction ?? 'BOTH'),
      taskId: linked.idReadable ?? linked.id,
    }))
  })

  const attachments: Attachment[] = (issue.attachments ?? []).map((a: any) => ({
    id: a.id,
    name: a.name,
    mimeType: a.mimeType,
    size: a.size,
    url: a.url,
    thumbnailUrl: a.thumbnailURL,
    author: a.author?.login,
    createdAt: toIsoOrUndefined(a.created),
  }))

  return {
    id: issue.idReadable ?? issue.id,
    title: issue.summary,
    description: issue.description,
    status: getCustomFieldValue(issue.customFields as any, 'State'),
    priority: getCustomFieldValue(issue.customFields as any, 'Priority'),
    assignee: getCustomFieldValue(issue.customFields as any, 'Assignee'),
    dueDate: null,
    createdAt: toIsoOrUndefined(issue.created),
    projectId: issue.project?.id,
    url: `${baseUrl}/issue/${issue.idReadable ?? issue.id}`,
    labels: (issue.tags ?? []).map((t: any) => ({ id: t.id, name: t.name, color: t.color?.background })),
    relations: relations.length > 0 ? relations : undefined,
    number: issue.numberInProject,
    reporter: issue.reporter
      ? { id: issue.reporter.id, login: issue.reporter.login, name: issue.reporter.fullName }
      : undefined,
    updater: issue.updater
      ? { id: issue.updater.id, login: issue.updater.login, name: issue.updater.fullName }
      : undefined,
    votes: issue.votes,
    commentsCount: issue.commentsCount,
    resolved: toIsoOrUndefined(issue.resolved),
    attachments,
    visibility: issue.visibility
      ? {
          groups: (issue.visibility as any).permittedGroups?.map((g: any) => g.name),
          users: (issue.visibility as any).permittedUsers?.map((u: any) => u.login),
        }
      : undefined,
    parent: issue.parent?.issues?.[0]
      ? {
          id: issue.parent.issues[0].id,
          idReadable: issue.parent.issues[0].idReadable ?? '',
          title: issue.parent.issues[0].summary ?? '',
        }
      : undefined,
    subtasks: issue.subtasks?.issues?.map((s: any) => ({
      id: s.id,
      idReadable: s.idReadable ?? '',
      title: s.summary ?? '',
      status: s.resolved !== undefined ? 'resolved' : undefined,
    })),
  }
}

export const mapIssueToListItem = (issue: z.infer<typeof IssueListSchema>, baseUrl: string): TaskListItem => ({
  id: issue.idReadable ?? issue.id,
  title: issue.summary,
  status: getCustomFieldValue(issue.customFields as any, 'State'),
  priority: getCustomFieldValue(issue.customFields as any, 'Priority'),
  url: `${baseUrl}/issue/${issue.idReadable ?? issue.id}`,
  number: (issue as any).numberInProject,
  resolved: toIsoOrUndefined((issue as any).resolved),
})

export const mapIssueToSearchResult = (issue: z.infer<typeof IssueListSchema>, baseUrl: string): TaskSearchResult => ({
  id: issue.idReadable ?? issue.id,
  title: issue.summary,
  status: getCustomFieldValue(issue.customFields as any, 'State'),
  priority: getCustomFieldValue(issue.customFields as any, 'Priority'),
  projectId: issue.project?.id,
  url: `${baseUrl}/issue/${issue.idReadable ?? issue.id}`,
})

export const mapComment = (c: z.infer<typeof CommentSchema>): Comment => ({
  id: c.id,
  body: c.text,
  author: c.author.name ?? c.author.login,
  createdAt: toIsoOrUndefined(c.created),
})

export const buildCustomFields = (params: {
  status?: string
  priority?: string
  assignee?: string
}): Array<{ name: string; $type: string; value: Record<string, string> }> => {
  const fields: Array<{ name: string; $type: string; value: Record<string, string> }> = []
  if (params.priority !== undefined) {
    fields.push({ name: 'Priority', $type: 'SingleEnumIssueCustomField', value: { name: params.priority } })
  }
  if (params.status !== undefined) {
    fields.push({ name: 'State', $type: 'StateIssueCustomField', value: { name: params.status } })
  }
  if (params.assignee !== undefined) {
    fields.push({ name: 'Assignee', $type: 'SingleUserIssueCustomField', value: { login: params.assignee } })
  }
  return fields
}
```

**Step 6: Run test to verify it passes**

Run: `bun test tests/providers/youtrack/mappers.test.ts --reporter=dot`
Expected: PASS

**Step 7: Update domain types**

Edit `src/providers/types.ts`:

Add new optional fields to `Task` and `TaskListItem`:

```typescript
export type Task = {
  id: string
  title: string
  description?: string | null
  status?: string
  priority?: string
  assignee?: string | null
  dueDate?: string | null
  createdAt?: string
  projectId?: string
  url: string
  labels?: TaskLabel[]
  relations?: TaskRelation[]
  number?: number
  reporter?: { id: string; login: string; name?: string }
  updater?: { id: string; login: string; name?: string }
  votes?: number
  commentsCount?: number
  resolved?: string | null
  attachments?: Attachment[]
  visibility?: { groups?: string[]; users?: string[] }
  parent?: { id: string; idReadable: string; title: string }
  subtasks?: Array<{ id: string; idReadable: string; title: string; status?: string }>
}

export type TaskListItem = {
  id: string
  title: string
  number?: number
  status?: string
  priority?: string
  dueDate?: string | null
  url: string
  resolved?: string | null
}

export type Attachment = {
  id: string
  name: string
  mimeType?: string
  size?: number
  url: string
  thumbnailUrl?: string
  author?: string
  createdAt?: string
}
```

**Step 8: Run all tests**

Run: `bun test tests/providers/youtrack/ --reporter=dot`
Expected: All PASS

**Step 9: Commit**

```bash
git add src/providers/youtrack/constants.ts src/providers/youtrack/schemas/issue.ts src/providers/youtrack/mappers.ts src/providers/types.ts tests/providers/youtrack/mappers.test.ts
git commit -m "feat(youtrack): extend ISSUE_FIELDS with reporter, updater, votes, attachments, parent, subtasks"
```

---

### Task 1.5: Switch Relations to REST API

**Files:**

- Modify: `src/providers/youtrack/relations.ts`
- Create: `src/providers/youtrack/schemas/issue-link.ts` (update)
- Test: `tests/providers/youtrack/relations.test.ts`

**Step 1: Write failing test**

Add to `tests/providers/youtrack/relations.test.ts`:

```typescript
test('addRelation uses REST API instead of command', async () => {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ id: 'link-1' }),
  })

  await addYouTrackRelation(config, 'PROJ-123', 'PROJ-456', 'blocks')

  const call = mockFetch.mock.calls[0]
  expect(call[0]).toContain('/api/issues/PROJ-123/links')
  expect(call[1].method).toBe('POST')
  expect(call[1].body).toEqual({
    linkType: { name: 'depends' },
    direction: 'OUTWARD',
    issues: [{ id: 'PROJ-456' }],
  })
})

test('addRelation uses correct direction for blocked_by', async () => {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ id: 'link-1' }),
  })

  await addYouTrackRelation(config, 'PROJ-123', 'PROJ-456', 'blocked_by')

  const call = mockFetch.mock.calls[0]
  expect(call[1].body.direction).toBe('INWARD')
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/providers/youtrack/relations.test.ts --reporter=dot`
Expected: FAIL - still using `/execute` endpoint

**Step 3: Write minimal implementation**

Edit `src/providers/youtrack/relations.ts`:

```typescript
import { z } from 'zod'

import { providerError } from '../../errors.js'
import { logger } from '../../logger.js'
import { ProviderClassifiedError } from '../errors.js'
import type { RelationType } from '../types.js'
import type { YouTrackConfig } from './client.js'
import { youtrackFetch } from './client.js'
import { IssueLinkSchema } from './schemas/issue-link.js'

const IssueLinksSchema = z.object({
  id: z.string(),
  links: z.array(IssueLinkSchema).optional(),
})

const log = logger.child({ scope: 'provider:youtrack:relations' })

function mapRelationTypeToLinkType(type: RelationType): string {
  switch (type) {
    case 'blocks':
    case 'blocked_by':
      return 'depends'
    case 'duplicate':
    case 'duplicate_of':
      return 'duplicate'
    case 'parent':
      return 'subtask'
    default:
      return 'relates'
  }
}

function mapRelationTypeToDirection(type: RelationType): 'OUTWARD' | 'INWARD' {
  switch (type) {
    case 'blocks':
    case 'duplicate':
    case 'parent':
      return 'OUTWARD'
    default:
      return 'INWARD'
  }
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

  const linkTypeName = mapRelationTypeToLinkType(type)
  const direction = mapRelationTypeToDirection(type)

  await youtrackFetch(config, 'POST', `/api/issues/${taskId}/links`, {
    body: {
      linkType: { name: linkTypeName },
      direction,
      issues: [{ id: relatedTaskId }],
    },
    query: { fields: 'id' },
  })

  log.info({ taskId, relatedTaskId, type }, 'Relation added')
  return { taskId, relatedTaskId, type }
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
    throw new ProviderClassifiedError(`Relation not found: ${taskId} -> ${relatedTaskId}`, err)
  }

  await youtrackFetch(config, 'DELETE', `/api/issues/${taskId}/links/${matchingLink.id}`)

  log.info({ taskId, relatedTaskId }, 'Relation removed')
  return { taskId, relatedTaskId }
}
```

**Step 4: Delete commands.ts (no longer needed)**

```bash
rm src/providers/youtrack/commands.ts
```

**Step 5: Run test to verify it passes**

Run: `bun test tests/providers/youtrack/relations.test.ts --reporter=dot`
Expected: PASS

**Step 6: Commit**

```bash
git add src/providers/youtrack/relations.ts tests/providers/youtrack/relations.test.ts
git rm src/providers/youtrack/commands.ts
git commit -m "refactor(youtrack): switch relations to REST API /links endpoint"
```

---

### Task 1.6: Phase 1 Verification

**Step 1: Run full test suite**

Run: `bun test tests/providers/youtrack/ --reporter=dot`
Expected: All PASS

**Step 2: Run lint and typecheck**

Run: `bun run check:full`
Expected: All checks pass

**Step 3: Manual smoke test**

Create a test issue in YouTrack, verify:

- `getTask` returns reporter, updater, votes, commentsCount
- `updateLabel` with color works
- Relations use REST API (check logs for `/links` endpoint)

**Step 4: Phase 1 complete commit**

```bash
git add .
git commit -m "feat(youtrack): complete Phase 1 - bug fixes and cheap wins"
```

---

## Phase 2: Statuses & Richer Custom Fields

Estimated scope: ~15 files, new domain operations

---

### Task 2.1: Create Bundle Schemas

**Files:**

- Create: `src/providers/youtrack/schemas/bundle.ts`

**Step 1: Create schema file**

```typescript
import { z } from 'zod'

export const StateValueSchema = z.object({
  id: z.string(),
  name: z.string(),
  ordinal: z.number().optional(),
  isResolved: z.boolean().optional(),
})

export const StateBundleSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  aggregated: z
    .object({
      project: z.array(z.object({ id: z.string() })).optional(),
    })
    .optional(),
})

export const ProjectCustomFieldSchema = z.object({
  $type: z.string(),
  field: z
    .object({
      name: z.string(),
      localizedName: z.string().optional(),
    })
    .optional(),
  bundle: z
    .object({
      id: z.string(),
      $type: z.string().optional(),
    })
    .optional(),
})

export type StateValue = z.infer<typeof StateValueSchema>
export type StateBundle = z.infer<typeof StateBundleSchema>
export type ProjectCustomField = z.infer<typeof ProjectCustomFieldSchema>
```

**Step 2: Commit**

```bash
git add src/providers/youtrack/schemas/bundle.ts
git commit -m "feat(youtrack): add bundle schemas for state management"
```

---

### Task 2.2: Create Bundle Cache Module

**Files:**

- Create: `src/providers/youtrack/bundle-cache.ts`
- Test: `tests/providers/youtrack/bundle-cache.test.ts`

**Step 1: Write failing test**

Create `tests/providers/youtrack/bundle-cache.test.ts`:

```typescript
import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { resolveStateBundle, clearBundleCache } from '../../src/providers/youtrack/bundle-cache.js'

describe('bundle-cache', () => {
  const config = { baseUrl: 'https://example.com', token: 'test-token' }
  let mockFetch: any

  beforeEach(() => {
    clearBundleCache()
    mockFetch = mock.fn()
    global.fetch = mockFetch
  })

  test('resolveStateBundle fetches and caches bundle info', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve([
          {
            $type: 'StateProjectCustomField',
            field: { name: 'State' },
            bundle: { id: 'bundle-123', $type: 'StateBundle' },
          },
        ]),
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          id: 'bundle-123',
          aggregated: { project: [{ id: 'proj-1' }, { id: 'proj-2' }] },
        }),
    })

    const result = await resolveStateBundle(config, 'proj-1')

    expect(result).toEqual({ bundleId: 'bundle-123', isShared: true })
  })

  test('resolveStateBundle returns null when State field not found', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve([]),
    })

    const result = await resolveStateBundle(config, 'proj-1')

    expect(result).toBeNull()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/providers/youtrack/bundle-cache.test.ts --reporter=dot`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

Create `src/providers/youtrack/bundle-cache.ts`:

```typescript
import { logger } from '../../logger.js'
import type { YouTrackConfig } from './client.js'
import { youtrackFetch } from './client.js'
import { ProjectCustomFieldSchema, StateBundleSchema } from './schemas/bundle.js'

const log = logger.child({ scope: 'provider:youtrack:bundle-cache' })

interface BundleInfo {
  id: string
  name: string
  isShared: boolean
  projectIds: string[]
}

type ProjectFieldKey = `${string}:${string}`

const bundleCache = new Map<ProjectFieldKey, { bundleId: string; expires: number }>()
const bundleInfoCache = new Map<string, { info: BundleInfo; expires: number }>()
const failureCache = new Map<ProjectFieldKey, { expires: number }>()

const CACHE_TTL_MS = 5 * 60 * 1000
const FAILURE_TTL_MS = 30 * 1000

export function clearBundleCache(): void {
  bundleCache.clear()
  bundleInfoCache.clear()
  failureCache.clear()
}

export async function resolveStateBundle(
  config: YouTrackConfig,
  projectId: string,
): Promise<{ bundleId: string; isShared: boolean } | null> {
  const key: ProjectFieldKey = `${projectId}:State`

  const failure = failureCache.get(key)
  if (failure !== undefined && failure.expires > Date.now()) {
    log.warn({ projectId }, 'State bundle resolution previously failed, skipping')
    return null
  }

  const cached = bundleCache.get(key)
  if (cached !== undefined && cached.expires > Date.now()) {
    return resolveBundleInfo(config, cached.bundleId)
  }

  try {
    const raw = await youtrackFetch(config, 'GET', `/api/admin/projects/${projectId}/customFields`, {
      query: { fields: 'field(name),bundle(id,$type)' },
    })

    const fields = ProjectCustomFieldSchema.array().parse(raw)
    const stateField = fields.find((f) => f.field?.name === 'State')

    if (stateField === undefined || stateField.bundle === undefined) {
      log.warn({ projectId }, 'State custom field not found')
      failureCache.set(key, { expires: Date.now() + FAILURE_TTL_MS })
      return null
    }

    bundleCache.set(key, {
      bundleId: stateField.bundle.id,
      expires: Date.now() + CACHE_TTL_MS,
    })

    return resolveBundleInfo(config, stateField.bundle.id)
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), projectId },
      'Failed to resolve state bundle',
    )
    failureCache.set(key, { expires: Date.now() + FAILURE_TTL_MS })
    return null
  }
}

async function resolveBundleInfo(
  config: YouTrackConfig,
  bundleId: string,
): Promise<{ bundleId: string; isShared: boolean }> {
  const cached = bundleInfoCache.get(bundleId)
  if (cached !== undefined && cached.expires > Date.now()) {
    return { bundleId, isShared: cached.info.isShared }
  }

  const raw = await youtrackFetch(config, 'GET', `/api/admin/customFieldSettings/bundles/state/${bundleId}`, {
    query: { fields: 'id,aggregated(project(id))' },
  })

  const bundle = StateBundleSchema.parse(raw)
  const projectIds = (bundle.aggregated?.project ?? []).map((p) => p.id)
  const isShared = projectIds.length > 1

  bundleInfoCache.set(bundleId, {
    info: { id: bundleId, name: '', isShared, projectIds },
    expires: Date.now() + CACHE_TTL_MS,
  })

  return { bundleId, isShared }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/providers/youtrack/bundle-cache.test.ts --reporter=dot`
Expected: PASS

**Step 5: Commit**

```bash
git add src/providers/youtrack/bundle-cache.ts tests/providers/youtrack/bundle-cache.test.ts
git commit -m "feat(youtrack): add bundle cache for state management"
```

---

### Task 2.3: Implement Status Operations

**Files:**

- Create: `src/providers/youtrack/operations/statuses.ts`
- Modify: `src/providers/youtrack/index.ts`
- Modify: `src/providers/youtrack/constants.ts`
- Test: `tests/providers/youtrack/operations/statuses.test.ts`

**Step 1: Add capabilities to constants**

Edit `src/providers/youtrack/constants.ts`:

```typescript
export const YOUTRACK_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  'tasks.delete',
  'tasks.relations',
  'projects.read',
  'projects.list',
  'projects.create',
  'projects.update',
  'projects.delete',
  'comments.read',
  'comments.create',
  'comments.update',
  'comments.delete',
  'labels.list',
  'labels.create',
  'labels.update',
  'labels.delete',
  'labels.assign',
  'statuses.list',
  'statuses.create',
  'statuses.update',
  'statuses.delete',
  'statuses.reorder',
])
```

**Step 2: Write failing test**

Create `tests/providers/youtrack/operations/statuses.test.ts`:

```typescript
import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { listYouTrackStatuses } from '../../../src/providers/youtrack/operations/statuses.js'
import { clearBundleCache } from '../../../src/providers/youtrack/bundle-cache.js'

describe('statuses', () => {
  const config = { baseUrl: 'https://example.com', token: 'test-token' }
  let mockFetch: any

  beforeEach(() => {
    clearBundleCache()
    mockFetch = mock.fn()
    global.fetch = mockFetch
  })

  test('listStatuses returns columns from state bundle', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve([
            {
              $type: 'StateProjectCustomField',
              field: { name: 'State' },
              bundle: { id: 'bundle-123' },
            },
          ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 'bundle-123', aggregated: { project: [{ id: 'proj-1' }] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve([
            { id: 'val-1', name: 'Open', ordinal: 0, isResolved: false },
            { id: 'val-2', name: 'In Progress', ordinal: 1, isResolved: false },
            { id: 'val-3', name: 'Done', ordinal: 2, isResolved: true },
          ]),
      })

    const result = await listYouTrackStatuses(config, 'proj-1')

    expect(result).toEqual([
      { id: 'val-1', name: 'Open', order: 0, isFinal: false },
      { id: 'val-2', name: 'In Progress', order: 1, isFinal: false },
      { id: 'val-3', name: 'Done', order: 2, isFinal: true },
    ])
  })
})
```

**Step 3: Run test to verify it fails**

Run: `bun test tests/providers/youtrack/operations/statuses.test.ts --reporter=dot`
Expected: FAIL - module not found

**Step 4: Write minimal implementation**

Create `src/providers/youtrack/operations/statuses.ts`:

```typescript
import { logger } from '../../../logger.js'
import { providerError } from '../../../errors.js'
import type { Column } from '../../types.js'
import { ProviderClassifiedError } from '../../errors.js'
import { classifyYouTrackError } from '../classify-error.js'
import type { YouTrackConfig } from '../client.js'
import { youtrackFetch } from '../client.js'
import { resolveStateBundle } from '../bundle-cache.js'
import { StateValueSchema } from '../schemas/bundle.js'

const log = logger.child({ scope: 'provider:youtrack:statuses' })

export async function listYouTrackStatuses(config: YouTrackConfig, projectId: string): Promise<Column[]> {
  log.debug({ projectId }, 'listStatuses')

  const bundle = await resolveStateBundle(config, projectId)
  if (bundle === null) {
    throw new ProviderClassifiedError(
      'State custom field not configured for this project',
      providerError.notFound('State bundle', projectId),
    )
  }

  const raw = await youtrackFetch(
    config,
    'GET',
    `/api/admin/customFieldSettings/bundles/state/${bundle.bundleId}/values`,
    { query: { fields: 'id,name,ordinal,isResolved' } },
  )

  const values = StateValueSchema.array().parse(raw)
  log.info({ projectId, count: values.length }, 'Statuses listed')

  return values.map((v, index) => ({
    id: v.id,
    name: v.name,
    order: v.ordinal ?? index,
    isFinal: v.isResolved ?? false,
  }))
}

export async function createYouTrackStatus(
  config: YouTrackConfig,
  projectId: string,
  params: { name: string; icon?: string; color?: string; isFinal?: boolean; confirm?: boolean },
): Promise<Column | { status: string; message: string }> {
  log.debug({ projectId, name: params.name }, 'createStatus')

  const bundle = await resolveStateBundle(config, projectId)
  if (bundle === null) {
    throw new ProviderClassifiedError(
      'State custom field not configured for this project',
      providerError.notFound('State bundle', projectId),
    )
  }

  if (bundle.isShared && params.confirm !== true) {
    return {
      status: 'confirmation_required',
      message:
        'This State bundle is shared by multiple projects. Changes affect all of them. Set confirm=true to proceed.',
    }
  }

  const raw = await youtrackFetch(
    config,
    'POST',
    `/api/admin/customFieldSettings/bundles/state/${bundle.bundleId}/values`,
    {
      body: {
        name: params.name,
        isResolved: params.isFinal ?? false,
      },
      query: { fields: 'id,name,ordinal,isResolved' },
    },
  )

  const value = StateValueSchema.parse(raw)
  log.info({ projectId, statusId: value.id }, 'Status created')

  return {
    id: value.id,
    name: value.name,
    order: value.ordinal ?? 0,
    isFinal: value.isResolved ?? false,
  }
}

export async function updateYouTrackStatus(
  config: YouTrackConfig,
  projectId: string,
  statusId: string,
  params: { name?: string; icon?: string; color?: string; isFinal?: boolean; confirm?: boolean },
): Promise<Column | { status: string; message: string }> {
  log.debug({ projectId, statusId }, 'updateStatus')

  const bundle = await resolveStateBundle(config, projectId)
  if (bundle === null) {
    throw new ProviderClassifiedError(
      'State custom field not configured for this project',
      providerError.notFound('State bundle', projectId),
    )
  }

  if (bundle.isShared && params.confirm !== true) {
    return {
      status: 'confirmation_required',
      message:
        'This State bundle is shared by multiple projects. Changes affect all of them. Set confirm=true to proceed.',
    }
  }

  const body: Record<string, unknown> = {}
  if (params.name !== undefined) body['name'] = params.name
  if (params.isFinal !== undefined) body['isResolved'] = params.isFinal

  const raw = await youtrackFetch(
    config,
    'POST',
    `/api/admin/customFieldSettings/bundles/state/${bundle.bundleId}/values/${statusId}`,
    {
      body,
      query: { fields: 'id,name,ordinal,isResolved' },
    },
  )

  const value = StateValueSchema.parse(raw)
  log.info({ projectId, statusId: value.id }, 'Status updated')

  return {
    id: value.id,
    name: value.name,
    order: value.ordinal ?? 0,
    isFinal: value.isResolved ?? false,
  }
}

export async function deleteYouTrackStatus(
  config: YouTrackConfig,
  projectId: string,
  statusId: string,
  confirm?: boolean,
): Promise<{ id: string } | { status: string; message: string }> {
  log.debug({ projectId, statusId }, 'deleteStatus')

  const bundle = await resolveStateBundle(config, projectId)
  if (bundle === null) {
    throw new ProviderClassifiedError(
      'State custom field not configured for this project',
      providerError.notFound('State bundle', projectId),
    )
  }

  if (bundle.isShared && confirm !== true) {
    return {
      status: 'confirmation_required',
      message:
        'This State bundle is shared by multiple projects. Changes affect all of them. Set confirm=true to proceed.',
    }
  }

  await youtrackFetch(
    config,
    'DELETE',
    `/api/admin/customFieldSettings/bundles/state/${bundle.bundleId}/values/${statusId}`,
  )

  log.info({ projectId, statusId }, 'Status deleted')
  return { id: statusId }
}

export async function reorderYouTrackStatuses(
  config: YouTrackConfig,
  projectId: string,
  statuses: { id: string; position: number }[],
  confirm?: boolean,
): Promise<void | { status: string; message: string }> {
  log.debug({ projectId, count: statuses.length }, 'reorderStatuses')

  const bundle = await resolveStateBundle(config, projectId)
  if (bundle === null) {
    throw new ProviderClassifiedError(
      'State custom field not configured for this project',
      providerError.notFound('State bundle', projectId),
    )
  }

  if (bundle.isShared && confirm !== true) {
    return {
      status: 'confirmation_required',
      message:
        'This State bundle is shared by multiple projects. Changes affect all of them. Set confirm=true to proceed.',
    }
  }

  for (const { id, position } of statuses) {
    await youtrackFetch(
      config,
      'POST',
      `/api/admin/customFieldSettings/bundles/state/${bundle.bundleId}/values/${id}`,
      {
        body: { ordinal: position },
        query: { fields: 'id' },
      },
    )
  }

  log.info({ projectId, count: statuses.length }, 'Statuses reordered')
}
```

**Step 5: Wire into provider**

Edit `src/providers/youtrack/index.ts`:

```typescript
import {
  createYouTrackStatus,
  deleteYouTrackStatus,
  listYouTrackStatuses,
  reorderYouTrackStatuses,
  updateYouTrackStatus,
} from './operations/statuses.js'

// Add methods to class:
listStatuses?(projectId: string): Promise<Column[]> {
  return listYouTrackStatuses(this.config, projectId)
}

createStatus?(projectId: string, params: { name: string; icon?: string; color?: string; isFinal?: boolean; confirm?: boolean }): Promise<Column | { status: string; message: string }> {
  return createYouTrackStatus(this.config, projectId, params)
}

updateStatus?(statusId: string, params: { name?: string; icon?: string; color?: string; isFinal?: boolean; confirm?: boolean }): Promise<Column | { status: string; message: string }> {
  // Need projectId for bundle resolution - this is a limitation
  // Update: status operations need projectId parameter
  throw new Error('updateStatus requires projectId - use updateStatus with projectId overload')
}

deleteStatus?(statusId: string): Promise<{ id: string }> {
  throw new Error('deleteStatus requires projectId - use deleteStatus with projectId overload')
}

// Alternative: extend interface to pass projectId
```

**Step 6: Update TaskProvider interface (if needed)**

The existing interface expects `statusId` but YouTrack needs `projectId` for bundle resolution. Two options:

Option A: Add overloaded methods
Option B: Cache statusId → projectId mapping

For simplicity, use Option A - pass projectId as first param to all status methods.

**Step 7: Run tests**

Run: `bun test tests/providers/youtrack/operations/statuses.test.ts --reporter=dot`
Expected: PASS

**Step 8: Commit**

```bash
git add src/providers/youtrack/operations/statuses.ts src/providers/youtrack/index.ts src/providers/youtrack/constants.ts tests/providers/youtrack/operations/statuses.test.ts
git commit -m "feat(youtrack): implement status operations via state bundles"
```

---

### Task 2.4: Update Status Tools

**Files:**

- Modify: `src/tools/list-statuses.ts`
- Modify: `src/tools/create-status.ts`
- Modify: `src/tools/update-status.ts`
- Modify: `src/tools/delete-status.ts`
- Modify: `src/tools/reorder-statuses.ts`

**Step 1: Update tool descriptions**

Each tool needs to accept optional `confirm` parameter for shared bundles.

Example for `src/tools/create-status.ts`:

```typescript
inputSchema: z.object({
  projectId: z.string().describe('Project ID to create status in'),
  name: z.string().describe('Status name'),
  isFinal: z.boolean().optional().describe('Whether this is a resolved/final state'),
  confirm: z.boolean().optional().describe('Set to true to confirm changes to shared bundles'),
}),
```

**Step 2: Run tests**

Run: `bun test tests/tools/ --reporter=dot`
Expected: All PASS

**Step 3: Commit**

```bash
git add src/tools/*.ts tests/tools/*.test.ts
git commit -m "feat(youtrack): update status tools with shared bundle confirmation"
```

---

### Task 2.5: Phase 2 Verification

**Step 1: Run full test suite**

Run: `bun test tests/providers/youtrack/ --reporter=dot`
Expected: All PASS

**Step 2: Run check**

Run: `bun run check:full`
Expected: All checks pass

**Step 3: Phase 2 complete commit**

```bash
git add .
git commit -m "feat(youtrack): complete Phase 2 - statuses and custom fields"
```

---

## Phase 3-5: Summary (Detailed tasks follow same pattern)

For brevity, phases 3-5 follow the same TDD pattern:

### Phase 3: Attachments & Work Items

- Task 3.1: Create `Attachment` schema and operations
- Task 3.2: Create `WorkItem` schema and operations
- Task 3.3: Add `paginate` helper
- Task 3.4: Add duration parsing helper
- Task 3.5: Create tools for attachments/work items
- Task 3.6: Add capabilities to constants

### Phase 4: Collaboration

- Task 4.1: Create `UserRef` type and user operations
- Task 4.2: Implement watcher/voter operations
- Task 4.3: Implement visibility operations
- Task 4.4: Implement comment reactions
- Task 4.5: Implement project team operations
- Task 4.6: Add `find_user` tool
- Task 4.7: Add capabilities

### Phase 5: Agile & History

- Task 5.1: Create `Sprint` schema and operations
- Task 5.2: Create `Activity` schema and history operations
- Task 5.3: Implement saved queries operations
- Task 5.4: Implement `count_tasks` tool
- Task 5.5: Add capabilities

---

## Feature Flags

Add to `src/providers/youtrack/constants.ts`:

```typescript
export const YOUTRACK_PHASES = {
  phase1: process.env.YOUTRACK_PHASE_1 !== 'false',
  phase2: process.env.YOUTRACK_PHASE_2 !== 'false',
  phase3: process.env.YOUTRACK_PHASE_3 !== 'false',
  phase4: process.env.YOUTRACK_PHASE_4 !== 'false',
  phase5: process.env.YOUTRACK_PHASE_5 !== 'false',
} as const
```

---

## References

- Design doc: `docs/plans/2026-04-08-youtrack-full-api-enhanced-design.md`
- Original design: `docs/youtrack-full-api-design.md`
- Provider conventions: `src/providers/CLAUDE.md`
- Tool conventions: `src/tools/CLAUDE.md`
- TDD instructions: `.github/instructions/tdd.instructions.md`
