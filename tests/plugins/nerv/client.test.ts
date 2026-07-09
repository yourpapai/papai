// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { asNumber, asObject, callNerv, NOT_CONFIGURED, readNervConfig } from '../../../plugins/nerv/client.js'

const admin = (m: Record<string, string>): { get(k: string): string | undefined } => ({
  get: (k: string): string | undefined => m[k],
})

test('readNervConfig trims and strips trailing slashes', () => {
  const cfg = readNervConfig(admin({ nerv_base_url: 'http://nerv:9000/// ', nerv_token: ' tok ' }))
  expect(cfg).toEqual({ baseUrl: 'http://nerv:9000', token: 'tok' })
})

test('readNervConfig returns null when unset', () => {
  expect(readNervConfig(admin({}))).toBeNull()
  expect(readNervConfig(admin({ nerv_base_url: 'http://nerv:9000' }))).toBeNull()
})

test('asNumber parses finite numbers only', () => {
  expect(asNumber(asObject({ n: 4.2 }), 'n')).toBe(4.2)
  expect(asNumber(asObject({ n: 'x' }), 'n')).toBeNull()
  expect(asNumber(asObject({}), 'n')).toBeNull()
})

test('callNerv sends bearer + JSON and normalizes non-2xx', async () => {
  const seen: { url?: string; init?: RequestInit } = {}
  const httpFetch = (url: string, init?: RequestInit): Promise<Response> => {
    seen.url = url
    seen.init = init
    return Promise.resolve(new Response(JSON.stringify({ taskId: 't1' }), { status: 201 }))
  }
  const ok = await callNerv(httpFetch, { baseUrl: 'http://nerv:9000', token: 'tok' }, 'POST', '/tasks', { a: 1 })
  expect(ok).toEqual({ taskId: 't1' })
  expect(seen.url).toBe('http://nerv:9000/tasks')
  expect(new Headers(seen.init?.headers).get('Authorization')).toBe('Bearer tok')

  const bad = (_url: string): Promise<Response> => Promise.resolve(new Response('{"error":"x"}', { status: 500 }))
  const err = await callNerv(bad, { baseUrl: 'http://nerv:9000', token: 'tok' }, 'GET', '/tasks/1')
  expect(err).toEqual({ error: 'nerv_error', status: 500, body: { error: 'x' } })
})

test('NOT_CONFIGURED is the not_configured sentinel', () => {
  expect(NOT_CONFIGURED.error).toBe('not_configured')
})
