// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { canonicalize, VOLATILE, VOLATILE_KEYS } from '../canonicalize.js'
import type { ParityGroup } from '../group.js'

export const relationGroups: readonly ParityGroup[] = [
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
    id: 'SCN-parity-relation-multiple',
    title: 'SCN-parity-relation-multiple: a task carries multiple distinct relations',
    async run({ provider, projectId }) {
      const hub = await provider.createTask({ projectId, title: 'Relation Hub' })
      const first = await provider.createTask({ projectId, title: 'Relation Spoke One' })
      const second = await provider.createTask({ projectId, title: 'Relation Spoke Two' })
      const a = await provider.addRelation?.(hub.id, first.id, 'related')
      const b = await provider.addRelation?.(hub.id, second.id, 'related')
      expect(canonicalize(a, VOLATILE_KEYS)).toEqual({ taskId: VOLATILE, relatedTaskId: VOLATILE, type: 'related' })
      expect(canonicalize(b, VOLATILE_KEYS)).toEqual({ taskId: VOLATILE, relatedTaskId: VOLATILE, type: 'related' })
    },
  },
] as const
