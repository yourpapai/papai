// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { cancelCodingTaskTool, followupCodingTaskTool, steerCodingTaskTool } from '../../../plugins/nerv/event-tools.js'
import { getActiveTaskId, setActive } from '../../../plugins/nerv/history.js'
import { options, runtimeCtx } from './support.js'

const CTX_ID = 'pi:aW5zdA:ctx:Y2hhbg:thread:dDE'

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value))
  return {}
}

type Captured = { url: string; body: unknown }

function capturingFetch(captured: Captured[]) {
  return (url: string, init?: RequestInit): Promise<Response> => {
    const b = init?.body
    captured.push({ url, body: typeof b === 'string' && b.length > 0 ? JSON.parse(b) : null })
    return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 202 }))
  }
}

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

function withActive(store: Map<string, string>, taskId: string): void {
  setActive(kvOf(store), CTX_ID, taskId)
}

test('followup posts chat_followup with text to the thread task', async () => {
  const captured: Captured[] = []
  const store = new Map<string, string>()
  withActive(store, 't1')
  const tool = followupCodingTaskTool(capturingFetch(captured))
  await tool.execute({ text: 'address review comments' }, runtimeCtx(store), options())
  expect(captured[0]?.url).toBe('http://nerv:9000/tasks/t1/events')
  expect(captured[0]?.body).toEqual({ type: 'chat_followup', payload: { prompt: 'address review comments' } })
})

// Anti-drift contract pin: papai emits payload.prompt (not payload.text) on the wire. nerv's
// tasks.ts route schema requires payload.prompt — a silent field-name mismatch here previously
// made the followup instruction resolve to '' on the nerv side and get silently dropped.
test('contract: chat_followup wire body is exactly {type, payload:{prompt}}', async () => {
  const captured: Captured[] = []
  const store = new Map<string, string>()
  withActive(store, 't1')
  const tool = followupCodingTaskTool(capturingFetch(captured))
  await tool.execute({ text: 'ship it' }, runtimeCtx(store), options())
  expect(captured[0]?.body).toEqual({ type: 'chat_followup', payload: { prompt: 'ship it' } })
})

test('steer posts steer with text', async () => {
  const captured: Captured[] = []
  const store = new Map<string, string>()
  withActive(store, 't1')
  const tool = steerCodingTaskTool(capturingFetch(captured))
  await tool.execute({ text: 'stop touching the config' }, runtimeCtx(store), options())
  expect(captured[0]?.body).toEqual({ type: 'steer', payload: { prompt: 'stop touching the config' } })
})

test('cancel posts cancel and clears the active pointer', async () => {
  const captured: Captured[] = []
  const store = new Map<string, string>()
  withActive(store, 't1')
  const ctx = runtimeCtx(store)
  const tool = cancelCodingTaskTool(capturingFetch(captured))
  await tool.execute({}, ctx, options())
  expect(captured[0]?.body).toEqual({ type: 'cancel', payload: {} })
  expect(getActiveTaskId(kvOf(store), CTX_ID)).toBeNull()
})

test('explicit taskId overrides the thread pointer', async () => {
  const captured: Captured[] = []
  const store = new Map<string, string>()
  withActive(store, 't1')
  const tool = followupCodingTaskTool(capturingFetch(captured))
  await tool.execute({ taskId: 't9', text: 'go' }, runtimeCtx(store), options())
  expect(captured[0]?.url).toBe('http://nerv:9000/tasks/t9/events')
})

test('followup returns not_found with no active task', async () => {
  const tool = followupCodingTaskTool(() => Promise.resolve(new Response('{}', { status: 202 })))
  const result = await tool.execute({ text: 'go' }, runtimeCtx(new Map()), options())
  expect(asRecord(result)['error']).toBe('not_found')
})

test('followup requires text', async () => {
  const store = new Map<string, string>()
  withActive(store, 't1')
  const tool = followupCodingTaskTool(() => Promise.resolve(new Response('{}', { status: 202 })))
  const result = await tool.execute({}, runtimeCtx(store), options())
  expect(asRecord(result)['error']).toBe('invalid_input')
})
