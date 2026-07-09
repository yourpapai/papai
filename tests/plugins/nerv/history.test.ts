// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import {
  clearActive,
  deriveTitle,
  getActiveTaskId,
  isTerminal,
  listRecords,
  readRecord,
  setActive,
  writeRecord,
} from '../../../plugins/nerv/history.js'

type FakeKv = {
  store: Map<string, string>
  kv: {
    get(key: string): string | undefined
    set(key: string, value: string): void
    delete(key: string): void
    list(prefix?: string): Array<{ key: string; value: string }>
  }
}

function fakeKv(): FakeKv {
  const store = new Map<string, string>()
  return {
    store,
    kv: {
      get: (k: string): string | undefined => store.get(k),
      set: (k: string, v: string): void => {
        store.set(k, v)
      },
      delete: (k: string): void => {
        store.delete(k)
      },
      list: (prefix?: string): Array<{ key: string; value: string }> =>
        Array.from(store.entries())
          .filter(([k]) => prefix === undefined || k.startsWith(prefix))
          .map(([key, value]) => ({ key, value })),
    },
  }
}

test('deriveTitle takes the first non-empty line, clipped', () => {
  expect(deriveTitle('\n\n  fix the CI  \nmore')).toBe('fix the CI')
  expect(deriveTitle('   ')).toBe('coding task')
  expect(deriveTitle('x'.repeat(200)).length).toBe(120)
})

test('write/read round-trips a record; malformed reads null', () => {
  const { kv } = fakeKv()
  writeRecord(kv, 't1', { taskId: 't1', storageContextId: 'ctx', title: 'T', repos: ['demo'], createdAt: 'now' })
  expect(readRecord(kv, 't1')?.title).toBe('T')
  expect(readRecord(kv, 'missing')).toBeNull()
})

test('active pointer set/get/clear', () => {
  const { kv } = fakeKv()
  expect(getActiveTaskId(kv, 'ctx')).toBeNull()
  setActive(kv, 'ctx', 't1')
  expect(getActiveTaskId(kv, 'ctx')).toBe('t1')
  clearActive(kv, 'ctx')
  expect(getActiveTaskId(kv, 'ctx')).toBeNull()
})

test('listRecords returns only task: records, not active: pointers', () => {
  const { kv } = fakeKv()
  writeRecord(kv, 't1', { taskId: 't1', storageContextId: 'ctx', title: 'A', repos: [], createdAt: 'now' })
  setActive(kv, 'ctx', 't1')
  expect(listRecords(kv).map((r) => r.taskId)).toEqual(['t1'])
})

test('isTerminal recognizes completed/closed/failed', () => {
  expect(isTerminal('completed')).toBe(true)
  expect(isTerminal('closed')).toBe(true)
  expect(isTerminal('failed')).toBe(true)
  expect(isTerminal('coding')).toBe(false)
  expect(isTerminal(undefined)).toBe(false)
})
