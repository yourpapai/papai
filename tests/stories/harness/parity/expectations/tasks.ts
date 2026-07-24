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
  {
    id: 'SCN-parity-task-dates',
    title: 'SCN-parity-task-dates: createTask round-trips startDate and dueDate',
    async run({ provider, projectId }) {
      const created = await provider.createTask({
        projectId,
        title: 'Parity Dates',
        startDate: '2026-08-01',
        dueDate: '2026-08-15',
      })
      const fetched = await provider.getTask(created.id)
      expect(canonicalize(fetched, VOLATILE_KEYS)).toMatchObject({ id: VOLATILE, title: 'Parity Dates' })
      // Real Kaneo normalizes a date-only input to a full ISO datetime
      // ('2026-08-01' -> '2026-08-01T00:00:00.000Z') while MemoryTaskProvider echoes it
      // verbatim. Both agree on the calendar-date prefix, so assert that — stronger than
      // mere presence, tolerant of the wire-format divergence (mirrors how
      // SCN-parity-task-update documents Kaneo's status normalization).
      expect(fetched.startDate).toBeTypeOf('string')
      expect(fetched.startDate).toMatch(/^2026-08-01/u)
      expect(fetched.dueDate).toBeTypeOf('string')
      expect(fetched.dueDate).toMatch(/^2026-08-15/u)
    },
  },
  {
    id: 'SCN-parity-task-full-property',
    title: 'SCN-parity-task-full-property: createTask round-trips description and priority',
    async run({ provider, projectId }) {
      const created = await provider.createTask({
        projectId,
        title: 'Parity Full Property',
        description: 'A described task',
        priority: 'high',
      })
      const fetched = await provider.getTask(created.id)
      expect(canonicalize(fetched, VOLATILE_KEYS)).toMatchObject({ id: VOLATILE, title: 'Parity Full Property' })
      expect(fetched.description).toBe('A described task')
      expect(fetched.priority).toBe('high')
    },
  },
  {
    id: 'SCN-parity-task-preserve-startdate',
    title: 'SCN-parity-task-preserve-startdate: updateTask title preserves an existing startDate',
    async run({ provider, projectId }) {
      const created = await provider.createTask({ projectId, title: 'Parity Preserve', startDate: '2026-09-01' })
      await provider.updateTask(created.id, { title: 'Parity Preserve Renamed' })
      const fetched = await provider.getTask(created.id)
      expect(fetched.title).toBe('Parity Preserve Renamed')
      // Kaneo normalizes the date-only startDate to a full ISO datetime; assert the shared
      // calendar-date prefix (see SCN-parity-task-dates for the divergence rationale).
      expect(fetched.startDate).toBeTypeOf('string')
      expect(fetched.startDate).toMatch(/^2026-09-01/u)
    },
  },
  {
    id: 'SCN-parity-task-null-dates',
    title: 'SCN-parity-task-null-dates: createTask without dates leaves startDate and dueDate unset',
    async run({ provider, projectId }) {
      const created = await provider.createTask({ projectId, title: 'Parity No Dates' })
      const fetched = await provider.getTask(created.id)
      // Neither binding must invent a date: the fake omits the keys; real Kaneo may
      // return null. A for...of over both values keeps the check conditional-free.
      for (const value of [fetched.startDate, fetched.dueDate]) {
        const unset = value === null || value === undefined || value === ''
        expect(unset).toBe(true)
      }
    },
  },
  {
    id: 'SCN-parity-task-special-chars',
    title: 'SCN-parity-task-special-chars: createTask round-trips special characters in the title',
    async run({ provider, projectId }) {
      const title = 'Ünïcode & <special> "chars" — 日本語 100%'
      const created = await provider.createTask({ projectId, title })
      const fetched = await provider.getTask(created.id)
      expect(fetched.title).toBe(title)
    },
  },
  {
    id: 'SCN-parity-task-long-title',
    title: 'SCN-parity-task-long-title: createTask round-trips a long title',
    async run({ provider, projectId }) {
      const title = `Parity Long ${'x'.repeat(500)}`
      const created = await provider.createTask({ projectId, title })
      const fetched = await provider.getTask(created.id)
      expect(fetched.title).toBe(title)
    },
  },
] as const
