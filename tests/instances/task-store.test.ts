// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  deleteTaskInstance,
  getTaskInstance,
  insertTaskInstance,
  listTaskInstances,
  updateTaskInstance,
} from '../../src/instances/task-store.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('task-store', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    process.env['INSTANCE_CONFIG_KEY'] = '2'.repeat(64)
  })

  afterEach(() => {
    delete process.env['INSTANCE_CONFIG_KEY']
  })

  test('insert + get round-trips with decrypted config', () => {
    insertTaskInstance({
      id: 'kaneo-prod',
      type: 'kaneo',
      config: { url: 'https://kaneo.invalid' },
      status: 'active',
    })
    const row = getTaskInstance('kaneo-prod')
    expect(row?.type).toBe('kaneo')
    expect(row?.config).toEqual({ url: 'https://kaneo.invalid' })
  })

  test('list returns all rows', () => {
    insertTaskInstance({ id: 'a', type: 'kaneo', config: { url: 'u1' }, status: 'active' })
    insertTaskInstance({ id: 'b', type: 'youtrack', config: { url: 'u2' }, status: 'pending' })
    expect(
      listTaskInstances()
        .map((r) => r.id)
        .toSorted(),
    ).toEqual(['a', 'b'])
  })

  test('update sets config + status', () => {
    insertTaskInstance({ id: 'a', type: 'kaneo', config: { url: 'old' }, status: 'pending' })
    updateTaskInstance('a', { config: { url: 'new' }, status: 'active' })
    const row = getTaskInstance('a')
    expect(row?.config).toEqual({ url: 'new' })
    expect(row?.status).toBe('active')
  })

  test('delete removes the row', () => {
    insertTaskInstance({ id: 'a', type: 'kaneo', config: { url: 'u' }, status: 'active' })
    deleteTaskInstance('a')
    expect(getTaskInstance('a')).toBeNull()
  })

  test('get returns null for missing id', () => {
    expect(getTaskInstance('nope')).toBeNull()
  })

  test('insert + get round-trips a contributed provider type', () => {
    insertTaskInstance({
      id: 'demo-1',
      type: 'demo-tracker',
      config: { baseUrl: 'https://demo.invalid', region: 'eu' },
      status: 'active',
    })
    const row = getTaskInstance('demo-1')
    expect(row?.type).toBe('demo-tracker')
    expect(row?.config).toEqual({ baseUrl: 'https://demo.invalid', region: 'eu' })
  })
})
