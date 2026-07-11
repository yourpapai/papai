// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { getActiveTaskId, readRecord, setActive, writeRecord } from '../../../plugins/nerv/history.js'
import { createCodingTaskTool } from '../../../plugins/nerv/tools.js'
import { options, runtimeCtx } from './support.js'

type Captured = { url: string; body: unknown }

function capturingFetch(captured: Captured[], response: unknown, status = 201) {
  return (url: string, init?: RequestInit): Promise<Response> => {
    const b = init?.body
    captured.push({ url, body: typeof b === 'string' && b.length > 0 ? JSON.parse(b) : null })
    return Promise.resolve(
      new Response(JSON.stringify(response), { status, headers: { 'Content-Type': 'application/json' } }),
    )
  }
}

const CTX_ID = 'pi:aW5zdA:ctx:Y2hhbg:thread:dDE'

type Kv = {
  get: (k: string) => string | undefined
  set: (k: string, v: string) => void
  delete: (k: string) => void
  list: () => Array<{ key: string; value: string }>
}

function kvOf(store: Map<string, string>): Kv {
  return {
    get: (k: string): string | undefined => store.get(k),
    set: (k: string, v: string): void => {
      store.set(k, v)
    },
    delete: (k: string): void => {
      store.delete(k)
    },
    list: (): Array<{ key: string; value: string }> => [],
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value))
  return {}
}

test('create posts derived projectPath, storageContextId as contextId, source chat; records + active pointer', async () => {
  const captured: Captured[] = []
  const store = new Map<string, string>()
  const tool = createCodingTaskTool(capturingFetch(captured, { taskId: 't1' }))
  const result = await tool.execute({ project: 'demo', prompt: 'fix the CI' }, runtimeCtx(store), options())

  expect(result).toEqual({ taskId: 't1' })
  expect(captured[0]?.url).toBe('http://nerv:9000/tasks')
  expect(captured[0]?.body).toEqual({
    prompt: 'fix the CI',
    repos: [{ projectPath: 'acme/demo' }],
    contextRef: { contextId: CTX_ID },
    source: 'chat',
    targetBranch: 'main',
  })
  expect(readRecord(kvOf(store), 't1')?.title).toBe('fix the CI')
  expect(getActiveTaskId(kvOf(store), CTX_ID)).toBe('t1')
})

test('create refuses when the thread already has a live task', async () => {
  const store = new Map<string, string>()
  const kv = kvOf(store)
  writeRecord(kv, 't0', {
    taskId: 't0',
    storageContextId: CTX_ID,
    title: 'x',
    repos: [],
    createdAt: 'now',
    status: 'coding',
  })
  setActive(kv, CTX_ID, 't0')

  let called = false
  const tool = createCodingTaskTool(() => {
    called = true
    return Promise.resolve(new Response('{}', { status: 201 }))
  })
  const result = await tool.execute({ project: 'demo', prompt: 'again' }, runtimeCtx(store), options())
  expect(asRecord(result)['error']).toBe('conflict')
  expect(called).toBe(false)
})

test('create allows a new task once the prior one is terminal', async () => {
  const store = new Map<string, string>()
  const kv = kvOf(store)
  writeRecord(kv, 't0', {
    taskId: 't0',
    storageContextId: CTX_ID,
    title: 'x',
    repos: [],
    createdAt: 'now',
    status: 'completed',
  })
  setActive(kv, CTX_ID, 't0')

  const tool = createCodingTaskTool(capturingFetch([], { taskId: 't1' }))
  const result = await tool.execute({ project: 'demo', prompt: 'next' }, runtimeCtx(store), options())
  expect(result).toEqual({ taskId: 't1' })
})

test('create refuses a github.com repo (not GitLab)', async () => {
  const tool = createCodingTaskTool(() => Promise.resolve(new Response('{}', { status: 201 })))
  const result = await tool.execute({ project: 'gh', prompt: 'x' }, runtimeCtx(new Map()), options())
  expect(asRecord(result)['error']).toBe('not_configured')
})

test('create returns not_found for an unknown project', async () => {
  const tool = createCodingTaskTool(() => Promise.resolve(new Response('{}', { status: 201 })))
  const result = await tool.execute({ project: 'nope', prompt: 'x' }, runtimeCtx(new Map()), options())
  expect(asRecord(result)['error']).toBe('not_found')
})

test('create returns NOT_CONFIGURED when nerv config is missing', async () => {
  const store = new Map<string, string>()
  const ctx = runtimeCtx(store)
  const noCfg = { ...ctx, adminConfig: { get: (): undefined => undefined } }
  const tool = createCodingTaskTool(() => Promise.resolve(new Response('{}', { status: 201 })))
  const result = await tool.execute({ project: 'demo', prompt: 'x' }, noCfg, options())
  expect(asRecord(result)['error']).toBe('not_configured')
})

test('create passes outputLanguage from context config when set', async () => {
  const captured: Captured[] = []
  const ctx = runtimeCtx(new Map())
  const withLang = {
    ...ctx,
    contextConfig: { get: (): string | undefined => 'Russian' },
  }
  const tool = createCodingTaskTool(capturingFetch(captured, { taskId: 't3' }))
  await tool.execute({ project: 'demo', prompt: 'fix the CI' }, withLang, options())
  expect(asRecord(captured[0]?.body)['outputLanguage']).toBe('Russian')
})

test('multi-repo passes an array of projectPaths', async () => {
  const captured: Captured[] = []
  const tool = createCodingTaskTool(capturingFetch(captured, { taskId: 't2' }))
  await tool.execute({ projects: ['demo'], prompt: 'x' }, runtimeCtx(new Map()), options())
  expect(asRecord(captured[0]?.body)['repos']).toEqual([{ projectPath: 'acme/demo' }])
})
