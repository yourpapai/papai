// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { type ParityGroup, required } from '../group.js'

export const searchGroups: readonly ParityGroup[] = [
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
    id: 'SCN-parity-search-all-projects',
    title: 'SCN-parity-search-all-projects: searchTasks without projectId matches across projects',
    async run({ provider, projectId }) {
      await provider.createTask({ projectId, title: 'Cross Project Kestrel' })
      const results = await provider.searchTasks({ query: 'Kestrel' })
      expect(results.map((result) => result.title)).toContain('Cross Project Kestrel')
    },
  },
  {
    id: 'SCN-parity-search-empty',
    title: 'SCN-parity-search-empty: searchTasks returns an empty array for a non-matching query',
    async run({ provider, projectId }) {
      await provider.createTask({ projectId, title: 'Present Task' })
      const results = await provider.searchTasks({ query: 'zzz-no-such-token-qxqx', projectId })
      expect(results).toEqual([])
    },
  },
  {
    id: 'SCN-parity-search-projectid-limit',
    title: 'SCN-parity-search-projectid-limit: searchTasks honors projectId and limit together',
    async run({ provider, projectId }) {
      await provider.createTask({ projectId, title: 'Limited Alpha' })
      await provider.createTask({ projectId, title: 'Limited Beta' })
      await provider.createTask({ projectId, title: 'Limited Gamma' })
      const otherProject = required(
        await provider.createProject?.({ name: 'Parity Search Isolation' }),
        'createProject result',
      )
      await provider.createTask({ projectId: otherProject.id, title: 'Limited Outsider' })
      const results = await provider.searchTasks({ query: 'Limited', projectId, limit: 2 })
      expect(results.length).toBeLessThanOrEqual(2)
      expect(results.length).toBeGreaterThan(0)
      for (const result of results) {
        expect(result.title.startsWith('Limited')).toBe(true)
        expect(result.title).not.toBe('Limited Outsider')
      }
    },
  },
] as const
