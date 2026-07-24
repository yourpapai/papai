// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import type { ParityGroup } from '../group.js'

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
] as const
