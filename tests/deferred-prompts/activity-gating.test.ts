// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { mixedActivityTreeError } from '../../src/deferred-prompts/activity-gating.js'
import { alertConditionSchema } from '../../src/deferred-prompts/condition-schema.js'
import { mockLogger } from '../utils/test-helpers.js'

beforeEach(() => {
  mockLogger()
})

describe('mixedActivityTreeError', () => {
  test('accepts a pure activity tree', () => {
    const condition = alertConditionSchema.parse({
      or: [
        { kind: 'activity', taskId: 'task-1' },
        { kind: 'activity', taskId: 'task-2', categories: ['comment'] },
      ],
    })
    expect(mixedActivityTreeError(condition)).toBeNull()
  })

  test('accepts a field-only tree', () => {
    const condition = alertConditionSchema.parse({
      and: [
        { field: 'task.status', op: 'eq', value: 'done' },
        { field: 'task.id', op: 'eq', value: 'task-1' },
      ],
    })
    expect(mixedActivityTreeError(condition)).toBeNull()
  })

  test('refuses a mixed activity and field tree at the top level', () => {
    const condition = alertConditionSchema.parse({
      and: [
        { kind: 'activity', taskId: 'task-1' },
        { field: 'task.status', op: 'eq', value: 'done' },
      ],
    })
    expect(mixedActivityTreeError(condition)).toContain('cannot be combined')
  })

  test('refuses a mixed tree nested under combinators', () => {
    const condition = alertConditionSchema.parse({
      or: [
        { field: 'task.priority', op: 'eq', value: 'urgent' },
        {
          and: [
            { kind: 'activity', taskId: 'task-1' },
            { field: 'task.labels', op: 'contains', value: 'bug' },
          ],
        },
      ],
    })
    expect(mixedActivityTreeError(condition)).toContain('cannot be combined')
  })
})
