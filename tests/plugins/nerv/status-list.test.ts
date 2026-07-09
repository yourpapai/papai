// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { getActiveTaskId, setActive, writeRecord } from '../../../plugins/nerv/history.js'
import { codingTaskStatusTool, listCodingTasksTool } from '../../../plugins/nerv/tools.js'
import { options, runtimeCtx } from './support.js'

const CTX_ID = 'pi:aW5zdA:ctx:Y2hhbg:thread:dDE'

type Kv = {
  get: (k: string) => string | undefined
  set: (k: string, v: string) => void
  delete: (k: string) => void
  list: (prefix?: string) => Array<{ key: string; value: string }>
}

function kvFor(store: Map<string, string>): Kv {
  return {
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
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value))
  return {}
}

function asRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map((row: unknown): Record<string, unknown> => asRecord(row)) : []
}

test('status auto-resolves the thread task and surfaces status + usageUsd', async () => {
  const store = new Map<string, string>()
  const kv = kvFor(store)
  writeRecord(kv, 't1', { taskId: 't1', storageContextId: CTX_ID, title: 'x', repos: ['demo'], createdAt: 'now' })
  setActive(kv, CTX_ID, 't1')

  const tool = codingTaskStatusTool((url: string) => {
    expect(url).toBe('http://nerv:9000/tasks/t1')
    return Promise.resolve(new Response(JSON.stringify({ status: 'review', usageUsd: 0.42 }), { status: 200 }))
  })
  const result = await tool.execute({}, runtimeCtx(store), options())
  expect(result).toEqual({ status: 'review', usageUsd: 0.42 })
})

test('status clears the active pointer when the task is terminal', async () => {
  const store = new Map<string, string>()
  const kv = kvFor(store)
  writeRecord(kv, 't1', { taskId: 't1', storageContextId: CTX_ID, title: 'x', repos: [], createdAt: 'now' })
  setActive(kv, CTX_ID, 't1')

  const tool = codingTaskStatusTool(() =>
    Promise.resolve(new Response(JSON.stringify({ status: 'completed' }), { status: 200 })),
  )
  await tool.execute({}, runtimeCtx(store), options())
  expect(getActiveTaskId(kv, CTX_ID)).toBeNull()
})

test('status returns not_found when no active task and no taskId', async () => {
  const tool = codingTaskStatusTool(() => Promise.resolve(new Response('{}', { status: 200 })))
  const result = await tool.execute({}, runtimeCtx(new Map()), options())
  expect(asRecord(result)['error']).toBe('not_found')
})

test('list enriches local records via GET /tasks/:id', async () => {
  const store = new Map<string, string>()
  const kv = kvFor(store)
  writeRecord(kv, 't1', {
    taskId: 't1',
    storageContextId: CTX_ID,
    title: 'Task one',
    repos: ['demo'],
    createdAt: 'now',
  })

  const tool = listCodingTasksTool(() =>
    Promise.resolve(new Response(JSON.stringify({ status: 'ci_wait', usageUsd: 1.5 }), { status: 200 })),
  )
  const result = asRows(await tool.execute({}, runtimeCtx(store), options()))
  expect(result).toEqual([{ taskId: 't1', title: 'Task one', repos: ['demo'], status: 'ci_wait', usageUsd: 1.5 }])
})
