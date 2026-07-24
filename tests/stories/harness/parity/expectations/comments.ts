// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { canonicalize, VOLATILE, VOLATILE_KEYS } from '../canonicalize.js'
import { type ParityGroup, required } from '../group.js'

export const commentGroups: readonly ParityGroup[] = [
  {
    id: 'SCN-parity-comment-crud',
    title: 'SCN-parity-comment-crud: add, list, update, and remove a comment',
    async run({ provider, projectId }) {
      const task = await provider.createTask({ projectId, title: 'Comment Host' })
      const added = await provider.addComment?.(task.id, 'first note')
      expect(canonicalize(added, VOLATILE_KEYS)).toMatchObject({ id: VOLATILE, body: 'first note' })
      const listed = (await provider.getComments?.(task.id, {})) ?? []
      expect(listed.map((comment) => comment.body).sort()).toEqual(['first note'])
      const addedId = required(added, 'addComment result').id
      const updated = await provider.updateComment?.({ taskId: task.id, commentId: addedId, body: 'edited note' })
      expect(canonicalize(updated, VOLATILE_KEYS)).toMatchObject({ id: VOLATILE, body: 'edited note' })
      const removed = await provider.removeComment?.({ taskId: task.id, commentId: addedId })
      expect(canonicalize(removed, VOLATILE_KEYS)).toEqual({ id: VOLATILE })
    },
  },
  {
    id: 'SCN-parity-comment-id-stability',
    title: 'SCN-parity-comment-id-stability: a comment keeps its id across update',
    async run({ provider, projectId }) {
      const task = await provider.createTask({ projectId, title: 'Comment Id Host' })
      const added = await provider.addComment?.(task.id, 'original')
      const addedId = required(added, 'addComment result').id
      const updated = await provider.updateComment?.({ taskId: task.id, commentId: addedId, body: 'edited' })
      expect(required(updated, 'updateComment result').id).toBe(addedId)
      const listed = (await provider.getComments?.(task.id, {})) ?? []
      expect(listed.map((comment) => comment.body)).toEqual(['edited'])
    },
  },
  {
    id: 'SCN-parity-comment-long',
    title: 'SCN-parity-comment-long: addComment round-trips a long body',
    async run({ provider, projectId }) {
      const task = await provider.createTask({ projectId, title: 'Long Comment Host' })
      const body = `note ${'y'.repeat(500)}`
      const added = await provider.addComment?.(task.id, body)
      expect(required(added, 'addComment result').body).toBe(body)
    },
  },
  {
    id: 'SCN-parity-comment-special-chars',
    title: 'SCN-parity-comment-special-chars: addComment round-trips special characters',
    async run({ provider, projectId }) {
      const task = await provider.createTask({ projectId, title: 'Special Comment Host' })
      const body = 'reply & <tag> "quote" — 日本語 100%'
      const added = await provider.addComment?.(task.id, body)
      expect(required(added, 'addComment result').body).toBe(body)
    },
  },
] as const
