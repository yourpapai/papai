// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import type { ParityGroup } from '../group.js'

export const errorGroups: readonly ParityGroup[] = [
  {
    id: 'SCN-parity-task-errors',
    title: 'SCN-parity-task-errors: get, update, and delete reject for a missing task',
    async run({ provider }) {
      const missing = 'parity-missing-task'
      await expect(provider.getTask(missing)).rejects.toThrow()
      await expect(provider.updateTask(missing, { title: 'nope' })).rejects.toThrow()
      await expect(provider.deleteTask?.(missing)).rejects.toThrow()
    },
  },
  {
    id: 'SCN-parity-comment-errors',
    title: 'SCN-parity-comment-errors: commenting on a missing task rejects',
    async run({ provider }) {
      await expect(provider.addComment?.('parity-missing-task', 'orphan note')).rejects.toThrow()
    },
  },
  {
    id: 'SCN-parity-relation-errors',
    title: 'SCN-parity-relation-errors: relating a task to a missing task rejects',
    async run({ provider, projectId }) {
      const task = await provider.createTask({ projectId, title: 'Relation Error Host' })
      await expect(provider.addRelation?.(task.id, 'parity-missing-task', 'blocks')).rejects.toThrow()
    },
  },
  {
    id: 'SCN-parity-project-label-errors',
    title: 'SCN-parity-project-label-errors: updating a missing project and removing a missing label reject',
    async run({ provider, projectId }) {
      await expect(provider.updateProject?.('parity-missing-project', { name: 'nope' })).rejects.toThrow()
      const task = await provider.createTask({ projectId, title: 'Label Error Host' })
      await expect(provider.removeTaskLabel?.(task.id, 'parity-missing-label')).rejects.toThrow()
    },
  },
] as const
