<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Enhanced Design: Full YouTrack API Coverage

Status: Approved
Created: 2026-04-08
Owner: platform/providers
Scope: `src/providers/youtrack/`, `src/providers/types.ts`, `src/tools/`
Based on: `docs/youtrack-full-api-design.md`

## Executive Summary

This document enhances the original YouTrack full API design with:

- Error recovery and resilience patterns
- Pagination edge case handling
- Locale and field name collision mitigation
- Shared bundle confirmation mechanism
- Observability and monitoring strategy
- Rollback capability per phase

Implementation uses feature-based phase structure with independent, sequentially-released phases.

## Phase Overview

| Phase | Focus                    | New Capabilities                                                                      | Estimated Scope |
| ----- | ------------------------ | ------------------------------------------------------------------------------------- | --------------- |
| 1     | Bug fixes & cheap wins   | Extended ISSUE_FIELDS, relations API                                                  | ~10 files       |
| 2     | Statuses & custom fields | `statuses.*`, bundle resolution                                                       | ~15 files       |
| 3     | Attachments & work items | `attachments.*`, `workItems.*`                                                        | ~12 files       |
| 4     | Collaboration            | `tasks.watchers/votes/visibility`, `comments.reactions`, `projects.team`, `find_user` | ~15 files       |
| 5     | Agile & history          | `sprints.*`, `activities.read`, `queries.saved`, `count_tasks`                        | ~10 files       |

---

## Phase 1: Bug Fixes & Cheap Wins

### 1.1 Fix `updateLabel` Color Bug

**File:** `src/providers/youtrack/labels.ts:60`

**Current code:**

```typescript
const body: Record<string, unknown> = {}
if (params.name !== undefined) body['name'] = params.name
// color is never sent!
```

**Fix:**

```typescript
const body: Record<string, unknown> = {}
if (params.name !== undefined) body['name'] = params.name
if (params.color !== undefined) {
  body['color'] = { background: params.color }
}
```

### 1.2 Implement `getComment`

**New file:** `src/providers/youtrack/operations/comments.ts`

```typescript
export async function getYouTrackComment(config: YouTrackConfig, taskId: string, commentId: string): Promise<Comment> {
  log.debug({ taskId, commentId }, 'getComment')
  try {
    const raw = await youtrackFetch(config, 'GET', `/api/issues/${taskId}/comments/${commentId}`, {
      query: { fields: COMMENT_FIELDS },
    })
    const comment = CommentSchema.parse(raw)
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

**Update:** `src/providers/youtrack/index.ts` — add `getComment` method

### 1.3 Implement `archive_project` (DELETE)

**File:** `src/providers/youtrack/operations/projects.ts`

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

### 1.4 Extended ISSUE_FIELDS

**File:** `src/providers/youtrack/constants.ts`

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

### 1.5 Update Task Type

**File:** `src/providers/types.ts`

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
  // Phase 1 additions (all optional)
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

### 1.6 Switch Relations to REST API

**File:** `src/providers/youtrack/relations.ts`

Replace command API (`/execute`) with structured link API:

```typescript
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
```

### 1.7 Phase 1 Deliverables

- [ ] `updateLabel` sends color
- [ ] `getComment` implemented
- [ ] `deleteProject` implemented
- [ ] ISSUE_FIELDS extended
- [ ] Task type updated with new fields
- [ ] TaskListItem includes resolved
- [ ] Relations use REST API
- [ ] All tests passing
- [ ] No breaking changes for existing tools

---

## Phase 2: Statuses & Richer Custom Fields

### 2.1 New Files

```
src/providers/youtrack/
  bundle-cache.ts        # State bundle resolution and caching
  schemas/bundle.ts      # Bundle response schemas
  operations/statuses.ts # Status CRUD operations
```

### 2.2 Bundle Cache Implementation

**File:** `src/providers/youtrack/bundle-cache.ts`

```typescript
import type { YouTrackConfig } from './client.js'
import { youtrackFetch } from './client.js'

interface BundleInfo {
  id: string
  name: string
  isShared: boolean
  projectIds: string[]
}

interface CustomFieldInfo {
  $type: string
  bundleId?: string
}

type ProjectFieldKey = `${string}:${string}` // projectId:fieldName

const bundleCache = new Map<ProjectFieldKey, { info: CustomFieldInfo; expires: number }>()
const bundleInfoCache = new Map<string, { info: BundleInfo; expires: number }>()
const failureCache = new Map<ProjectFieldKey, { expires: number }>()

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const FAILURE_TTL_MS = 30 * 1000 // 30 seconds

export async function resolveStateBundle(
  config: YouTrackConfig,
  projectId: string,
): Promise<{ bundleId: string; isShared: boolean } | null> {
  const key: ProjectFieldKey = `${projectId}:State`

  // Check failure cache first
  const failure = failureCache.get(key)
  if (failure !== undefined && failure.expires > Date.now()) {
    log.warn({ projectId }, 'State bundle resolution previously failed, skipping')
    return null
  }

  // Check field cache
  const cached = bundleCache.get(key)
  if (cached !== undefined && cached.expires > Date.now()) {
    return resolveBundleInfo(config, cached.info.bundleId)
  }

  // Fetch project's custom fields
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

  // Cache the field info
  bundleCache.set(key, {
    info: { $type: stateField.$type, bundleId: stateField.bundle.id },
    expires: Date.now() + CACHE_TTL_MS,
  })

  return resolveBundleInfo(config, stateField.bundle.id)
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

### 2.3 Status Operations

**File:** `src/providers/youtrack/operations/statuses.ts`

```typescript
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
  return values.map((v, index) => ({
    id: v.id,
    name: v.name,
    order: v.ordinal ?? index,
    isFinal: v.isResolved ?? false,
  }))
}
```

### 2.4 Shared Bundle Confirmation

Add to `createStatus`, `updateStatus`, `deleteStatus`, `reorderStatuses`:

```typescript
if (bundle.isShared && params.confirm !== true) {
  return {
    status: 'confirmation_required',
    message: `This State bundle is shared by multiple projects. Changes affect all of them. Set confirm=true to proceed.`,
  }
}
```

### 2.5 Extended Custom Fields

**File:** `src/providers/youtrack/mappers.ts`

```typescript
export const buildCustomFields = (
  params: {
    status?: string
    priority?: string
    assignee?: string
    type?: string
    subsystem?: string
    estimation?: string
    affectedVersions?: string[]
    fixVersions?: string[]
  },
  schema?: CustomFieldSchema,
): Array<{ name: string; $type: string; value: unknown }> => {
  const fields: Array<{ name: string; $type: string; value: unknown }> = []

  if (params.priority !== undefined) {
    fields.push({
      name: 'Priority',
      $type: 'SingleEnumIssueCustomField',
      value: { name: params.priority },
    })
  }
  if (params.status !== undefined) {
    fields.push({ name: 'State', $type: 'StateIssueCustomField', value: { name: params.status } })
  }
  if (params.assignee !== undefined) {
    fields.push({
      name: 'Assignee',
      $type: 'SingleUserIssueCustomField',
      value: { login: params.assignee },
    })
  }
  if (params.type !== undefined) {
    fields.push({
      name: 'Type',
      $type: 'SingleEnumIssueCustomField',
      value: { name: params.type },
    })
  }
  if (params.subsystem !== undefined) {
    fields.push({
      name: 'Subsystem',
      $type: 'SingleEnumIssueCustomField',
      value: { name: params.subsystem },
    })
  }
  if (params.estimation !== undefined) {
    fields.push({
      name: 'Estimation',
      $type: 'PeriodIssueCustomField',
      value: { presentation: params.estimation },
    })
  }
  if (params.affectedVersions !== undefined && params.affectedVersions.length > 0) {
    fields.push({
      name: 'Affected versions',
      $type: 'MultiVersionIssueCustomField',
      value: params.affectedVersions.map((v) => ({ name: v })),
    })
  }
  if (params.fixVersions !== undefined && params.fixVersions.length > 0) {
    fields.push({
      name: 'Fix versions',
      $type: 'MultiVersionIssueCustomField',
      value: params.fixVersions.map((v) => ({ name: v })),
    })
  }

  return fields
}
```

### 2.6 Phase 2 Capabilities

```typescript
// Add to YOUTRACK_CAPABILITIES
'statuses.list',
'statuses.create',
'statuses.update',
'statuses.delete',
'statuses.reorder',
```

---

## Phase 3: Attachments & Work Items

### 3.1 New Domain Types

```typescript
export type WorkItem = {
  id: string
  taskId: string
  author: string
  date: string
  duration: string
  description?: string
  type?: string
}
```

### 3.2 New Operations

**Attachment operations:**

- `listYouTrackAttachments(config, taskId)`
- `uploadYouTrackAttachment(config, taskId, file)` — multipart/form-data
- `deleteYouTrackAttachment(config, taskId, attachmentId)`

**Work item operations:**

- `listYouTrackWorkItems(config, taskId)`
- `createYouTrackWorkItem(config, taskId, params)`
- `updateYouTrackWorkItem(config, taskId, workItemId, params)`
- `deleteYouTrackWorkItem(config, taskId, workItemId)`

### 3.3 New Capabilities

```typescript
'attachments.list',
'attachments.upload',
'attachments.delete',
'workItems.list',
'workItems.create',
'workItems.update',
'workItems.delete',
```

### 3.4 Duration Parsing Helper

```typescript
function parseDuration(input: string): string {
  // Accept: "2h 30m", "1.5h", "90m", "PT2H30M"
  // Return: ISO-8601 "PT2H30M"
  const match = input.match(/^PT/) ? input : naturalToIso(input)
  return match
}
```

---

## Phase 4: Collaboration

### 4.1 New Operations

- `listYouTrackWatchers(config, taskId)`
- `addYouTrackWatcher(config, taskId, userId)`
- `removeYouTrackWatcher(config, taskId, userId)`
- `addYouTrackVote(config, taskId)`
- `removeYouTrackVote(config, taskId)`
- `setYouTrackVisibility(config, taskId, params)`
- `addYouTrackCommentReaction(config, taskId, commentId, emoji)`
- `removeYouTrackCommentReaction(config, taskId, commentId, reactionId)`
- `listYouTrackProjectTeam(config, projectId)`
- `addYouTrackProjectMember(config, projectId, userId)`
- `removeYouTrackProjectMember(config, projectId, userId)`
- `listYouTrackUsers(config, query?)`
- `getYouTrackCurrentUser(config)`

### 4.2 New Capabilities

```typescript
'tasks.watchers',
'tasks.votes',
'tasks.visibility',
'comments.reactions',
'projects.team',
```

### 4.3 New Types

```typescript
export type UserRef = {
  id: string
  login: string
  name?: string
  email?: string
}
```

---

## Phase 5: Agile & History

### 5.1 New Operations

- `listYouTrackAgiles(config)`
- `listYouTrackSprints(config, agileId)`
- `createYouTrackSprint(config, agileId, params)`
- `updateYouTrackSprint(config, sprintId, params)`
- `assignYouTrackIssueToSprint(config, taskId, sprintId)`
- `getYouTrackTaskHistory(config, taskId, params)`
- `listYouTrackSavedQueries(config)`
- `runYouTrackSavedQuery(config, queryId)`
- `countYouTrackIssues(config, query)`

### 5.2 New Capabilities

```typescript
'sprints.list',
'sprints.create',
'sprints.update',
'sprints.assign',
'activities.read',
'queries.saved',
```

### 5.3 New Types

```typescript
export type Sprint = {
  id: string
  name: string
  agileId: string
  start?: string
  finish?: string
  archived: boolean
}

export type Activity = {
  id: string
  timestamp: string
  author: string
  category: 'CommentsCategory' | 'CustomFieldCategory' | 'LinksCategory' | string
  field?: string
  added?: unknown
  removed?: unknown
}
```

---

## Error Recovery & Resilience

### Rate Limiting

```typescript
const MAX_RETRIES = 3
const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 8000

async function youtrackFetchWithRetry<T>(
  config: YouTrackConfig,
  method: string,
  path: string,
  options?: FetchOptions,
  attempt = 0,
): Promise<T> {
  try {
    const response = await youtrackFetch(config, method, path, options)

    // Log rate limit status
    const remaining = response.headers?.get('x-ratelimit-remaining')
    if (remaining !== null && parseInt(remaining, 10) < 10) {
      log.warn({ remaining }, 'Rate limit approaching')
    }

    return response
  } catch (error) {
    if (isRateLimitError(error) && attempt < MAX_RETRIES) {
      const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS)
      log.warn({ attempt, delay }, 'Rate limited, retrying')
      await sleep(delay)
      return youtrackFetchWithRetry(config, method, path, options, attempt + 1)
    }
    throw error
  }
}
```

### Network Error Detection

```typescript
function isNetworkError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    return (
      msg.includes('econnrefused') ||
      msg.includes('enotfound') ||
      msg.includes('etimedout') ||
      msg.includes('fetch failed')
    )
  }
  return false
}
```

### Token Scope Detection

```typescript
let adminScopeCache: boolean | undefined

async function checkAdminScope(config: YouTrackConfig): Promise<boolean> {
  if (adminScopeCache !== undefined) return adminScopeCache

  try {
    await youtrackFetch(config, 'GET', '/api/admin/projects', { query: { $top: '1' } })
    adminScopeCache = true
    return true
  } catch (error) {
    if (isForbiddenError(error)) {
      adminScopeCache = false
      log.warn('Token lacks admin scope')
      return false
    }
    throw error
  }
}
```

---

## Pagination Strategy

```typescript
interface PaginateOptions {
  maxPages?: number
  pageSize?: number
}

async function paginate<T>(
  fetch: (top: number, skip: number) => Promise<T[]>,
  options: PaginateOptions = {},
): Promise<T[]> {
  const pageSize = options.pageSize ?? 100
  const maxPages = options.maxPages ?? 10
  const results: T[] = []

  for (let page = 0; page < maxPages; page++) {
    const items = await fetch(pageSize, page * pageSize)
    results.push(...items)

    log.debug({ page, count: items.length, total: results.length }, 'Pagination progress')

    if (items.length < pageSize) {
      break
    }
  }

  log.info({ total: results.length }, 'Pagination complete')
  return results
}
```

---

## Locale & Field Name Strategy

### Field Resolution Cache

```typescript
interface FieldCacheKey {
  projectId: string
  fieldName: string
}

const fieldCache = new Map<string, { info: CustomFieldInfo; expires: number }>()

async function resolveCustomField(
  config: YouTrackConfig,
  projectId: string,
  fieldName: string,
): Promise<CustomFieldInfo | null> {
  const key = `${projectId}:${fieldName}`
  const cached = fieldCache.get(key)
  if (cached !== undefined && cached.expires > Date.now()) {
    return cached.info
  }

  // Fetch project custom fields
  const raw = await youtrackFetch(config, 'GET', `/api/admin/projects/${projectId}/customFields`, {
    query: { fields: 'field(name,localizedName),bundle(id,$type)' },
  })

  const fields = ProjectCustomFieldSchema.array().parse(raw)
  const field = fields.find((f) => f.field?.name === fieldName || f.field?.localizedName === fieldName)

  if (field === undefined) return null

  fieldCache.set(key, {
    info: { $type: field.$type, bundleId: field.bundle?.id },
    expires: Date.now() + CACHE_TTL_MS,
  })

  return { $type: field.$type, bundleId: field.bundle?.id }
}
```

---

## Observability & Monitoring

### Operation Timing

```typescript
const startTime = performance.now()
// ... operation ...
const duration = performance.now() - startTime
log.info({ operation: 'createStatus', duration: Math.round(duration), projectId }, 'Operation complete')
```

### Health Endpoint

```typescript
// src/debug/youtrack-health.ts
export async function getYouTrackHealth(config: YouTrackConfig): Promise<{
  tokenValid: boolean
  rateLimitRemaining?: number
  bundleCacheSize: number
}> {
  const [tokenValid, rateLimit] = await Promise.all([
    checkToken(config).catch(() => false),
    getRateLimitStatus(config).catch(() => undefined),
  ])

  return {
    tokenValid,
    rateLimitRemaining: rateLimit?.remaining,
    bundleCacheSize: bundleCache.size,
  }
}
```

### Feature Flags

```typescript
const PHASE_FLAGS = {
  phase1: process.env.YOUTRACK_PHASE_1 !== 'false',
  phase2: process.env.YOUTRACK_PHASE_2 !== 'false',
  phase3: process.env.YOUTRACK_PHASE_3 !== 'false',
  phase4: process.env.YOUTRACK_PHASE_4 !== 'false',
  phase5: process.env.YOUTRACK_PHASE_5 !== 'false',
} as const
```

---

## Testing Strategy

### Unit Tests

- One fixture per endpoint variant: `tests/providers/youtrack/fixtures/*.json`
- Schema validation tests for all new schemas
- Mapper tests for field extraction
- Cache tests for bundle resolution

### Integration Tests

- Docker-based YouTrack instance (`jetbrains/youtrack-standalone`)
- Seeded with: 1 project, 1 state bundle, custom fields
- Smoke test per phase

### TDD Enforcement

- Follow existing red→green pipeline
- New domain fields require updated test snapshots
- Mutation testing via Stryker for bundle resolution

---

## Rollout Checklist

### Phase 1 Checklist

- [ ] Update `labels.ts` to send color
- [ ] Add `getYouTrackComment` operation
- [ ] Add `deleteYouTrackProject` operation
- [ ] Extend `ISSUE_FIELDS` constant
- [ ] Update `Task` and `TaskListItem` types
- [ ] Update `mapIssueToTask` mapper
- [ ] Replace relations with REST API
- [ ] Update tests for all changes
- [ ] Update tool descriptions (LLM-facing)
- [ ] Verify Kaneo provider unaffected

### Per-Phase Checklist

- [ ] New schemas validated
- [ ] New operations implemented
- [ ] New capabilities declared
- [ ] New tools registered
- [ ] Tests passing
- [ ] Documentation updated
- [ ] Feature flag working
- [ ] Rollback tested

---

## Non-Goals

- VCS integration writes
- YouTrack workflow scripts/rules
- Notifications, mailbox integration
- Backup/restore admin endpoints
- Cross-provider abstractions for YouTrack-only features

---

## References

- Original design: `docs/youtrack-full-api-design.md`
- YouTrack REST API docs: https://www.jetbrains.com/help/youtrack/devportal/youtrack-rest-api.html
- Provider conventions: `src/providers/CLAUDE.md`
- Tool conventions: `src/tools/CLAUDE.md`
