// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect } from 'bun:test'

import { resolveActiveTaskId, type HttpFetch, type NervConfig } from './client.js'
import { setActive, type KvStore } from './history.js'

function makeKv(): KvStore {
  const m = new Map<string, string>()
  return {
    get: (k) => m.get(k),
    set: (k, v) => {
      m.set(k, v)
    },
    delete: (k) => {
      m.delete(k)
    },
    list: (prefix) =>
      [...m.entries()]
        .filter(([k]) => prefix === undefined || k.startsWith(prefix))
        .map(([key, value]) => ({ key, value })),
  }
}
const cfg: NervConfig = { baseUrl: 'http://nerv', token: 't' }

test('returns an explicit taskId without touching kv or nerv', async () => {
  const fetchFn: HttpFetch = () => {
    throw new Error('must not fetch')
  }
  expect(await resolveActiveTaskId(fetchFn, cfg, makeKv(), 'ctx', 'explicit-1')).toBe('explicit-1')
})
test('returns the cached active task without calling nerv', async () => {
  const kv = makeKv()
  setActive(kv, 'ctx', 'cached-1')
  let called = false
  const fetchFn: HttpFetch = () => {
    called = true
    return Promise.resolve(new Response('{}'))
  }
  expect(await resolveActiveTaskId(fetchFn, cfg, kv, 'ctx', null)).toBe('cached-1')
  expect(called).toBe(false)
})
test('falls back to nerv lookup by context and caches the result', async () => {
  const kv = makeKv()
  const fetchFn: HttpFetch = (url) => {
    expect(url).toContain('/tasks?contextId=ctx')
    return Promise.resolve(new Response(JSON.stringify({ taskId: 'from-nerv' }), { status: 200 }))
  }
  expect(await resolveActiveTaskId(fetchFn, cfg, kv, 'ctx', null)).toBe('from-nerv')
  expect(kv.get('active:ctx')).toBe('from-nerv')
})
test('returns null when nerv reports no active task', async () => {
  const fetchFn: HttpFetch = () => Promise.resolve(new Response(JSON.stringify({ taskId: null }), { status: 200 }))
  expect(await resolveActiveTaskId(fetchFn, cfg, makeKv(), 'ctx', null)).toBeNull()
})
test('fails safe (returns null, does not throw) when nerv is unreachable', async () => {
  const kv = makeKv()
  const fetchFn: HttpFetch = () => Promise.reject(new Error('network unreachable'))
  expect(await resolveActiveTaskId(fetchFn, cfg, kv, 'ctx', null)).toBeNull()
  expect(kv.get('active:ctx')).toBeUndefined()
})
