// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { canonicalize, VOLATILE, VOLATILE_KEYS } from '../canonicalize.js'
import { type ParityGroup, required } from '../group.js'

export const taskGroups: readonly ParityGroup[] = [
  {
    id: 'SCN-parity-task-create',
    title: 'SCN-parity-task-create: createTask returns a normalized task shape',
    async run({ provider, projectId }) {
      const task = await provider.createTask({ projectId, title: 'Parity Create' })
      expect(canonicalize(task, VOLATILE_KEYS)).toMatchObject({
        id: VOLATILE,
        projectId: VOLATILE,
        title: 'Parity Create',
      })
      const createdUrl = required(task.url, 'task.url')
      expect(createdUrl).toBeTypeOf('string')
      expect(createdUrl.length).toBeGreaterThan(0)
    },
  },
  {
    id: 'SCN-parity-task-get',
    title: 'SCN-parity-task-get: getTask returns the same normalized shape as createTask',
    async run({ provider, projectId }) {
      const created = await provider.createTask({ projectId, title: 'Parity Get' })
      const fetched = await provider.getTask(created.id)
      expect(canonicalize(fetched, VOLATILE_KEYS)).toMatchObject({
        id: VOLATILE,
        projectId: VOLATILE,
        title: 'Parity Get',
      })
      const fetchedUrl = required(fetched.url, 'fetched.url')
      expect(fetchedUrl).toBeTypeOf('string')
      expect(fetchedUrl.length).toBeGreaterThan(0)
    },
  },
  {
    id: 'SCN-parity-task-update',
    title: 'SCN-parity-task-update: updateTask applies a title and status change',
    async run({ provider, projectId }) {
      const created = await provider.createTask({ projectId, title: 'Parity Update' })
      const updated = await provider.updateTask(created.id, { title: 'Parity Updated', status: 'In Progress' })
      // `status` is not pinned to the literal column name here: real Kaneo echoes a
      // normalized/slugged form (e.g. "in-progress") rather than "In Progress", while
      // the fake echoes the input verbatim — both are non-empty strings, so require
      // only presence and type, not a fixed value.
      expect(canonicalize(updated, VOLATILE_KEYS)).toMatchObject({
        id: VOLATILE,
        projectId: VOLATILE,
        title: 'Parity Updated',
      })
      const updatedStatus = required(updated.status, 'updated.status')
      expect(updatedStatus).toBeTypeOf('string')
      expect(updatedStatus.length).toBeGreaterThan(0)
      const updatedUrl = required(updated.url, 'updated.url')
      expect(updatedUrl).toBeTypeOf('string')
      expect(updatedUrl.length).toBeGreaterThan(0)
      const fetched = await provider.getTask(created.id)
      expect(canonicalize(fetched, VOLATILE_KEYS)).toMatchObject({
        id: VOLATILE,
        projectId: VOLATILE,
        title: 'Parity Updated',
      })
      const fetchedUrl = required(fetched.url, 'fetched.url')
      expect(fetchedUrl).toBeTypeOf('string')
      expect(fetchedUrl.length).toBeGreaterThan(0)
      const fetchedStatus = required(fetched.status, 'fetched.status')
      expect(fetchedStatus).toBeTypeOf('string')
      expect(fetchedStatus).toBe(updatedStatus)
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
] as const
