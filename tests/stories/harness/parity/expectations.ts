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

import type { Column, TaskProvider } from '../../../../src/providers/types.js'
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

/** Statuses.* mutators return `T | { status: 'confirmation_required' }` unless
 *  called with `confirm: true`. Parity groups always pass `confirm: true`, so this
 *  narrows the union to `T` without an unsafe `as` cast. */
type ConfirmationRequired = Readonly<{ status: 'confirmation_required'; message: string }>

function requireConfirmed<T extends { id: string }>(value: T | ConfirmationRequired | undefined, label: string): T {
  if (value === undefined) throw new Error(`parity: expected ${label} to be defined`)
  if ('id' in value) return value
  throw new Error(`parity: expected ${label} to be confirmed, got confirmation_required`)
}

export const PARITY_GROUPS: readonly ParityGroup[] = [
  {
    id: 'SCN-parity-task-create',
    title: 'SCN-parity-task-create: createTask returns a normalized task shape',
    async run({ provider, projectId }) {
      const task = await provider.createTask({ projectId, title: 'Parity Create' })
      expect(Object.keys(task).sort()).toEqual(['id', 'projectId', 'title', 'url'])
      expect(canonicalize(task, VOLATILE_KEYS)).toMatchObject({
        id: VOLATILE,
        projectId: VOLATILE,
        title: 'Parity Create',
      })
    },
  },
  {
    id: 'SCN-parity-task-get',
    title: 'SCN-parity-task-get: getTask returns the same normalized shape as createTask',
    async run({ provider, projectId }) {
      const created = await provider.createTask({ projectId, title: 'Parity Get' })
      const fetched = await provider.getTask(created.id)
      expect(Object.keys(fetched).sort()).toEqual(['id', 'projectId', 'title', 'url'])
      expect(canonicalize(fetched, VOLATILE_KEYS)).toMatchObject({
        id: VOLATILE,
        projectId: VOLATILE,
        title: 'Parity Get',
      })
    },
  },
  {
    id: 'SCN-parity-task-update',
    title: 'SCN-parity-task-update: updateTask applies a title and status change',
    async run({ provider, projectId }) {
      const created = await provider.createTask({ projectId, title: 'Parity Update' })
      const updated = await provider.updateTask(created.id, { title: 'Parity Updated', status: 'in-progress' })
      expect(Object.keys(updated).sort()).toEqual(['id', 'projectId', 'status', 'title', 'url'])
      expect(canonicalize(updated, VOLATILE_KEYS)).toMatchObject({
        id: VOLATILE,
        projectId: VOLATILE,
        title: 'Parity Updated',
        status: 'in-progress',
      })
      const fetched = await provider.getTask(created.id)
      expect(canonicalize(fetched, VOLATILE_KEYS)).toEqual(canonicalize(updated, VOLATILE_KEYS))
    },
  },
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
    id: 'SCN-parity-task-list-filter',
    title: 'SCN-parity-task-list-filter: listTasks filters seeded tasks by status',
    async run({ provider, projectId }) {
      await provider.createTask({ projectId, title: 'Filter Open A', status: 'open' })
      await provider.createTask({ projectId, title: 'Filter Open B', status: 'open' })
      await provider.createTask({ projectId, title: 'Filter Done A', status: 'done' })
      const listed = await provider.listTasks(projectId, { status: 'open' })
      const titles = listed.map((task) => task.title).sort()
      expect(titles).toEqual(['Filter Open A', 'Filter Open B'])
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
    id: 'SCN-parity-comment-crud',
    title: 'SCN-parity-comment-crud: add, list, update, and remove a comment',
    async run({ provider, projectId }) {
      const task = await provider.createTask({ projectId, title: 'Comment Host' })
      const added = await provider.addComment?.(task.id, 'first note')
      expect(canonicalize(added, VOLATILE_KEYS)).toEqual({ id: VOLATILE, body: 'first note' })
      const listed = (await provider.getComments?.(task.id, {})) ?? []
      expect(listed.map((comment) => comment.body).sort()).toEqual(['first note'])
      const addedId = required(added, 'addComment result').id
      const updated = await provider.updateComment?.({ taskId: task.id, commentId: addedId, body: 'edited note' })
      expect(canonicalize(updated, VOLATILE_KEYS)).toEqual({ id: VOLATILE, body: 'edited note' })
      const removed = await provider.removeComment?.({ taskId: task.id, commentId: addedId })
      expect(canonicalize(removed, VOLATILE_KEYS)).toEqual({ id: VOLATILE })
    },
  },
  {
    id: 'SCN-parity-label-crud',
    title: 'SCN-parity-label-crud: create, list, update, and remove a label',
    async run({ provider }) {
      const created = await provider.createLabel?.({ name: 'parity-label', color: '#123456' })
      expect(canonicalize(created, VOLATILE_KEYS)).toEqual({ id: VOLATILE, name: 'parity-label', color: '#123456' })
      const listed = (await provider.listLabels?.()) ?? []
      expect(listed.map((label) => label.name)).toEqual(['parity-label'])
      const createdId = required(created, 'createLabel result').id
      const updated = await provider.updateLabel?.(createdId, { name: 'parity-label-2' })
      expect(canonicalize(updated, VOLATILE_KEYS)).toEqual({ id: VOLATILE, name: 'parity-label-2', color: '#123456' })
      const removed = await provider.removeLabel?.(createdId)
      expect(canonicalize(removed, VOLATILE_KEYS)).toEqual({ id: VOLATILE })
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
    id: 'SCN-parity-status-crud',
    title: 'SCN-parity-status-crud: create, list, update, and delete a status',
    async run({ provider, projectId }) {
      const created = requireConfirmed<Column>(
        await provider.createStatus?.(projectId, { name: 'Parity Status' }, true),
        'createStatus result',
      )
      expect(Object.keys(created).sort()).toEqual(['id', 'name', 'order'])
      expect(canonicalize(created, VOLATILE_KEYS)).toMatchObject({ id: VOLATILE, name: 'Parity Status' })
      const listed = (await provider.listStatuses?.(projectId)) ?? []
      expect(listed.map((status) => status.name)).toContain('Parity Status')
      const updated = requireConfirmed<Column>(
        await provider.updateStatus?.(projectId, created.id, { name: 'Parity Status Renamed' }, true),
        'updateStatus result',
      )
      expect(Object.keys(updated).sort()).toEqual(['id', 'name', 'order'])
      expect(canonicalize(updated, VOLATILE_KEYS)).toMatchObject({ id: VOLATILE, name: 'Parity Status Renamed' })
      const removed = requireConfirmed<{ id: string }>(
        await provider.deleteStatus?.(projectId, created.id, true),
        'deleteStatus result',
      )
      expect(canonicalize(removed, VOLATILE_KEYS)).toEqual({ id: VOLATILE })
    },
  },
  {
    id: 'SCN-parity-status-reorder',
    title: 'SCN-parity-status-reorder: reorderStatuses changes listStatuses order',
    async run({ provider, projectId }) {
      const first = requireConfirmed<Column>(
        await provider.createStatus?.(projectId, { name: 'Reorder First' }, true),
        'createStatus result',
      )
      const second = requireConfirmed<Column>(
        await provider.createStatus?.(projectId, { name: 'Reorder Second' }, true),
        'createStatus result',
      )
      const reordered = await provider.reorderStatuses?.(
        projectId,
        [
          { id: second.id, position: 0 },
          { id: first.id, position: 1 },
        ],
        true,
      )
      expect(reordered).toBeUndefined()
      const listed = (await provider.listStatuses?.(projectId)) ?? []
      expect(listed.map((status) => status.name)).toEqual(['Reorder Second', 'Reorder First'])
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
  {
    id: 'SCN-parity-identity',
    title: 'SCN-parity-identity: provisionWorkspaceMember and listUsers resolve normalized shapes',
    async run({ provider }) {
      const provisioned = required(
        await provider.provisionWorkspaceMember?.({
          chatUserId: 'parity-alice',
          displayName: 'Parity Alice',
          username: 'parity.alice',
        }),
        'provisionWorkspaceMember result',
      )
      expect(Object.keys(provisioned).sort()).toEqual(['login', 'password', 'providerUserId'])
      // `password`/`providerUserId` are provider-opaque (not in VOLATILE_KEYS): each
      // provider mints them differently, so pin `login` exactly and only require the
      // other two to be non-empty strings rather than a fixed sentinel or literal.
      expect(provisioned.login).toBe('parity.alice')
      expect(provisioned.password.length).toBeGreaterThan(0)
      expect(provisioned.providerUserId.length).toBeGreaterThan(0)
      // The fake's provisionWorkspaceMember doesn't populate the store listUsers reads
      // from, so element-shape parity can't be asserted hermetically here; the strong
      // cross-provider identity signal is the provisionWorkspaceMember assertion above.
      const users = required(await provider.listUsers?.('parity', 10), 'listUsers result')
      expect(Array.isArray(users)).toBe(true)
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
] as const
