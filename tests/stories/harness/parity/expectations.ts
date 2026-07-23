// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Declares each provider parity group ONCE as operations-plus-assertions over
 * the `TaskProvider` interface, comparing canonicalized outputs. The fake-binding
 * test (`expectations.fake.test.ts`) runs every group against `MemoryTaskProvider`
 * in this frozen story-contracts lane. `tests/e2e/parity/` imports `PARITY_GROUPS`
 * OUTWARD to run the same groups against real Kaneo — the exported names, types,
 * and each group's `id`/`title` are a hard contract for that lane and for the
 * ledger that mints `@1` catalog storyIds from them.
 */

import { expect } from 'bun:test'

import type { TaskProvider } from '../../../../src/providers/types.js'
import { canonicalize, VOLATILE, VOLATILE_KEYS } from './canonicalize.js'

export type ParityHarness = Readonly<{
  provider: TaskProvider
  projectId: string
}>

export type ParityGroup = Readonly<{
  id: string
  title: string
  run(harness: ParityHarness): Promise<void>
}>

/** Unwraps an optional-method result. Both `MemoryTaskProvider` and `KaneoProvider`
 *  implement every method a parity group calls, so this never throws at runtime —
 *  it only satisfies the `TaskProvider` optional-method type without `!`. */
function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`parity: expected ${label} to be defined`)
  return value
}

export const PARITY_GROUPS: readonly ParityGroup[] = [
  {
    id: 'SCN-parity-task-delete',
    title: 'SCN-parity-task-delete: deleteTask removes the task and getTask then rejects',
    async run({ provider, projectId }) {
      const created = await provider.createTask({ projectId, title: 'Parity Delete' })
      const deleted = await provider.deleteTask?.(created.id)
      expect(canonicalize(deleted, VOLATILE_KEYS)).toEqual({ id: VOLATILE })
      await expect(provider.getTask(created.id)).rejects.toThrow()
    },
  },
  {
    id: 'SCN-parity-task-list-sort',
    title: 'SCN-parity-task-list-sort: listTasks honors sortBy/sortOrder across providers',
    async run({ provider, projectId }) {
      // Seed in a deliberately non-sorted creation order so the assertion below can
      // only pass if `sortBy`/`sortOrder` actually reordered the results.
      await provider.createTask({ projectId, title: 'Sort B' })
      await provider.createTask({ projectId, title: 'Sort C' })
      await provider.createTask({ projectId, title: 'Sort A' })
      const listed = await provider.listTasks(projectId, { sortBy: 'title', sortOrder: 'asc' })
      const titles = listed.map((task) => task.title)
      expect(titles).toEqual(['Sort A', 'Sort B', 'Sort C'])
      expect(canonicalize(listed, VOLATILE_KEYS)).toHaveLength(3)
    },
  },
  {
    id: 'SCN-parity-task-list-paging',
    title: 'SCN-parity-task-list-paging: listTasks pages seeded tasks with limit and page',
    async run({ provider, projectId }) {
      await provider.createTask({ projectId, title: 'Page A' })
      await provider.createTask({ projectId, title: 'Page B' })
      await provider.createTask({ projectId, title: 'Page C' })
      const firstPage = await provider.listTasks(projectId, { limit: 2, page: 1 })
      const secondPage = await provider.listTasks(projectId, { limit: 2, page: 2 })
      expect(firstPage.map((task) => task.title)).toEqual(['Page A', 'Page B'])
      expect(secondPage.map((task) => task.title)).toEqual(['Page C'])
    },
  },
  {
    id: 'SCN-parity-task-search',
    title: 'SCN-parity-task-search: searchTasks matches seeded tasks by query',
    async run({ provider, projectId }) {
      await provider.createTask({ projectId, title: 'Searchable Falcon' })
      await provider.createTask({ projectId, title: 'Searchable Osprey' })
      await provider.createTask({ projectId, title: 'Unrelated Item' })
      const results = await provider.searchTasks({ query: 'Searchable', projectId })
      const titles = results.map((result) => result.title).sort()
      expect(titles).toEqual(['Searchable Falcon', 'Searchable Osprey'])
    },
  },
  {
    id: 'SCN-parity-task-label',
    title: 'SCN-parity-task-label: attach and detach a label from a task',
    async run({ provider, projectId }) {
      const task = await provider.createTask({ projectId, title: 'Label Host' })
      const label = await provider.createLabel?.({ name: 'attach-label' })
      const labelId = required(label, 'createLabel result').id
      const attached = await provider.addTaskLabel?.(task.id, labelId)
      expect(canonicalize(attached, VOLATILE_KEYS)).toEqual({ taskId: VOLATILE, labelId: VOLATILE })
      const listed = (await provider.listTaskLabels?.(task.id)) ?? []
      expect(listed.map((entry) => entry.name)).toEqual(['attach-label'])
      const removed = await provider.removeTaskLabel?.(task.id, labelId)
      expect(canonicalize(removed, VOLATILE_KEYS)).toEqual({ taskId: VOLATILE, labelId: VOLATILE })
    },
  },
  {
    id: 'SCN-parity-project-crud',
    title: 'SCN-parity-project-crud: create, list, update, and delete a project',
    async run({ provider }) {
      const created = required(await provider.createProject?.({ name: 'Parity Project CRUD' }), 'createProject result')
      expect(Object.keys(created).sort()).toEqual(['id', 'name', 'url'])
      expect(canonicalize(created, VOLATILE_KEYS)).toMatchObject({ id: VOLATILE, name: 'Parity Project CRUD' })
      const listed = (await provider.listProjects?.()) ?? []
      expect(listed.map((project) => project.name)).toContain('Parity Project CRUD')
      const updated = required(
        await provider.updateProject?.(created.id, { name: 'Parity Project Renamed' }),
        'updateProject result',
      )
      expect(Object.keys(updated).sort()).toEqual(['id', 'name', 'url'])
      expect(canonicalize(updated, VOLATILE_KEYS)).toMatchObject({ id: VOLATILE, name: 'Parity Project Renamed' })
      const removed = await provider.deleteProject?.(created.id)
      expect(canonicalize(removed, VOLATILE_KEYS)).toEqual({ id: VOLATILE })
    },
  },
  {
    id: 'SCN-parity-relation',
    title: 'SCN-parity-relation: add, update, and remove a task relation',
    async run({ provider, projectId }) {
      const first = await provider.createTask({ projectId, title: 'Relation First' })
      const second = await provider.createTask({ projectId, title: 'Relation Second' })
      const added = await provider.addRelation?.(first.id, second.id, 'blocks')
      expect(canonicalize(added, VOLATILE_KEYS)).toEqual({ taskId: VOLATILE, relatedTaskId: VOLATILE, type: 'blocks' })
      const updated = await provider.updateRelation?.(first.id, second.id, 'related')
      expect(canonicalize(updated, VOLATILE_KEYS)).toEqual({
        taskId: VOLATILE,
        relatedTaskId: VOLATILE,
        type: 'related',
      })
      const removed = await provider.removeRelation?.(first.id, second.id)
      expect(canonicalize(removed, VOLATILE_KEYS)).toEqual({ taskId: VOLATILE, relatedTaskId: VOLATILE })
    },
  },
] as const

export const PARITY_EXCLUSIONS: readonly Readonly<{ group: string; reason: string }>[] = [
  {
    group: 'watchers',
    reason:
      'KaneoProvider (plugins/task-provider-kaneo/provider.ts) implements no watchers counterpart; fake-only surface with no real behavior to check parity against.',
  },
  {
    group: 'votes',
    reason:
      'KaneoProvider (plugins/task-provider-kaneo/provider.ts) implements no votes counterpart; fake-only surface with no real behavior to check parity against.',
  },
  {
    group: 'visibility',
    reason:
      'KaneoProvider (plugins/task-provider-kaneo/provider.ts) implements no visibility counterpart; fake-only surface with no real behavior to check parity against.',
  },
  {
    group: 'worklog',
    reason:
      'KaneoProvider (plugins/task-provider-kaneo/provider.ts) implements no worklog counterpart; fake-only surface with no real behavior to check parity against.',
  },
  {
    group: 'sprints',
    reason:
      'KaneoProvider (plugins/task-provider-kaneo/provider.ts) implements no sprints counterpart; fake-only surface with no real behavior to check parity against.',
  },
  {
    group: 'agiles',
    reason:
      'KaneoProvider (plugins/task-provider-kaneo/provider.ts) implements no agiles counterpart; fake-only surface with no real behavior to check parity against.',
  },
  {
    group: 'saved-queries',
    reason:
      'KaneoProvider (plugins/task-provider-kaneo/provider.ts) implements no saved-queries counterpart; fake-only surface with no real behavior to check parity against.',
  },
  {
    group: 'comment-reactions',
    reason:
      'KaneoProvider (plugins/task-provider-kaneo/provider.ts) implements no comment-reactions counterpart; fake-only surface with no real behavior to check parity against.',
  },
  {
    group: 'attachments',
    reason:
      'KaneoProvider (plugins/task-provider-kaneo/provider.ts) implements no attachments counterpart; fake-only surface with no real behavior to check parity against.',
  },
  {
    group: 'commands-apply',
    reason:
      'KaneoProvider (plugins/task-provider-kaneo/provider.ts) implements no commands-apply counterpart; fake-only surface with no real behavior to check parity against.',
  },
  {
    group: 'count-tasks',
    reason:
      'KaneoProvider (plugins/task-provider-kaneo/provider.ts) implements no count-tasks counterpart; fake-only surface with no real behavior to check parity against.',
  },
  {
    group: 'task-history',
    reason:
      'KaneoProvider (plugins/task-provider-kaneo/provider.ts) implements no task-history counterpart; fake-only surface with no real behavior to check parity against.',
  },
  {
    group: 'get-comment-single',
    reason:
      'KaneoProvider (plugins/task-provider-kaneo/provider.ts) implements no get-comment-single counterpart; fake-only surface with no real behavior to check parity against.',
  },
  {
    group: 'get-project-single',
    reason:
      'KaneoProvider (plugins/task-provider-kaneo/provider.ts) implements no get-project-single counterpart; fake-only surface with no real behavior to check parity against.',
  },
  {
    group: 'project-team',
    reason:
      'KaneoProvider (plugins/task-provider-kaneo/provider.ts) implements no project-team counterpart; fake-only surface with no real behavior to check parity against.',
  },
  {
    group: 'task-list-filter',
    reason:
      'Reclassified during Task 4 (real-Kaneo drift, not a fake-only surface): KaneoProvider (plugins/task-provider-kaneo/task-status.ts validateStatus) rejects any status value that is not the exact name of an existing board column for the project — free-text tokens like "open"/"done" throw KaneoClassifiedError("status-not-found"). MemoryTaskProvider accepts any string as a status with no validation, so this group can only run against the fake; there is no status value the group could seed that both bindings would accept without changing the group itself (out of scope for Task 4).',
  },
  {
    group: 'label-crud',
    reason:
      'Reclassified during Task 4 (real-Kaneo drift, not a fake-only surface): KaneoProvider (plugins/task-provider-kaneo/label-resource.ts) refuses to delete a label that is not attached to a task (KaneoClassifiedError("unsupported-operation")) — labels are deleted implicitly, by detaching them from their last task. MemoryTaskProvider allows deleting an unattached label outright. The group creates, updates, and removes a label without ever attaching it to a task, so its removeLabel step cannot succeed against real Kaneo as written.',
  },
  {
    group: 'status-crud',
    reason:
      "Reclassified during Task 4 (real-Kaneo drift, not a fake-only surface): KaneoProvider's column API (plugins/task-provider-kaneo/schemas/list-tasks.ts ColumnSchema) has no order/position field on individual column create/list/update responses — column order is implicit in listColumns array position only, and the schema instead always returns a required, non-nullable isFinal boolean. MemoryTaskProvider's Column always carries a computed order and only conditionally carries isFinal. The two shapes ({id, name, order} vs {id, name, isFinal}) are structurally incompatible for a single shared exact-shape assertion.",
  },
  {
    group: 'status-reorder',
    reason:
      'Reclassified during Task 4 (real-Kaneo drift, not a fake-only surface): KaneoProvider seeds every project with 4 default board columns (To Do, In Progress, In Review, Done) at creation; MemoryTaskProvider starts a fresh project with zero statuses. The group creates exactly 2 statuses and reorders them to absolute positions 0/1, expecting listStatuses to yield exactly those 2 names in that order — against real Kaneo the 2 new columns interleave with the 4 pre-existing defaults instead of displacing them, so the exact 2-element order assertion cannot hold for a real board.',
  },
  {
    group: 'task-create',
    reason:
      "Reclassified during Task 4 (real-Kaneo drift, not a fake-only surface): KaneoProvider's task response schema (plugins/task-provider-kaneo/schemas/create-task.ts TaskSchema) makes status (string), priority (non-nullable TaskPriorityEnum), and createdAt (non-nullable datetime) mandatory always-present fields, and mapCreateTaskResponse (plugins/task-provider-kaneo/mappers.ts) unconditionally copies description/status/priority/assignee/startDate/dueDate/createdAt onto the mapped Task. MemoryTaskProvider echoes back only the fields the caller supplied, so a task created with just {projectId, title} yields the exact 4-key shape {id, projectId, title, url} on the fake but a 11-key shape (adding assignee, createdAt, description, dueDate, priority, startDate, status) on real Kaneo. Kaneo cannot suppress its mandatory schema fields to match the fake's minimal echo.",
  },
  {
    group: 'task-get',
    reason:
      "Reclassified during Task 4 (real-Kaneo drift, not a fake-only surface): same root cause as task-create — KaneoProvider.getTask maps through mapTaskDetails (plugins/task-provider-kaneo/mappers.ts), which unconditionally includes the same mandatory status/priority/createdAt fields (plus relations) alongside description/assignee/startDate/dueDate. The exact-key-shape assertion that holds for MemoryTaskProvider's minimal echo cannot hold against a real Kaneo task response.",
  },
  {
    group: 'task-update',
    reason:
      "Reclassified during Task 4 (real-Kaneo drift, not a fake-only surface): same root cause as task-create/task-get — KaneoProvider.updateTask returns a full mapped Task via the same mappers, always carrying the mandatory status/priority/createdAt fields (plus description/assignee/startDate/dueDate) that MemoryTaskProvider omits when unset. The group's exact-key-shape assertion after a partial {title, status} update cannot hold against real Kaneo.",
  },
  {
    group: 'comment-crud',
    reason:
      "Reclassified during Task 4 (real-Kaneo drift, not a fake-only surface): KaneoProvider's comment mapper (plugins/task-provider-kaneo/mappers.ts mapComment) always includes createdAt, and Kaneo's comment/activity schemas (plugins/task-provider-kaneo/schemas/global-search.ts SearchCommentSchema) make createdAt a mandatory, non-nullable datetime the server always sets on creation. MemoryTaskProvider's addComment/updateComment/removeComment results carry only {id, body}, so the group's exact-shape assertion ({id: VOLATILE, body: ...}, no createdAt) cannot hold against real Kaneo, which always stamps a creation timestamp it cannot omit.",
  },
  {
    group: 'identity',
    reason:
      "Reclassified during Task 4 (real-Kaneo drift, not a fake-only surface): KaneoProvider.provisionWorkspaceMember (plugins/task-provider-kaneo/operations/members.ts) always synthesizes a unique login as `${sanitizedUsername}-${uniqueSuffix}@pap.ai` because Kaneo's Better Auth backend requires a valid, unique email address for signup and cannot accept a bare username like \"parity.alice\" as a login. MemoryTaskProvider echoes the requested username verbatim as `login`. The group's `expect(provisioned.login).toBe('parity.alice')` pins the literal input username, which real Kaneo can never return.",
  },
] as const
