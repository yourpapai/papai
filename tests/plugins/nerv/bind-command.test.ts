// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { commandArgOf, handleBindCommand, parseBindPath } from '../../../plugins/nerv/bind-command.js'

const admin = (m: Record<string, string>): { get(k: string): string | undefined } => ({
  get: (k: string): string | undefined => m[k],
})

const cfgMap = { nerv_base_url: 'http://nerv:9000', nerv_token: 'tok' }

type Captured = { url: string; body: unknown }

function parsedBody(init: RequestInit | undefined): unknown {
  const b = init?.body
  return typeof b === 'string' && b.length > 0 ? JSON.parse(b) : null
}

function capturingFetch(captured: Captured[], response: unknown, status = 200) {
  return (url: string, init?: RequestInit): Promise<Response> => {
    captured.push({ url, body: parsedBody(init) })
    return Promise.resolve(
      new Response(JSON.stringify(response), { status, headers: { 'Content-Type': 'application/json' } }),
    )
  }
}

test('commandArgOf trims commandMatch, empty when missing', () => {
  expect(commandArgOf({ commandMatch: '  bind foo/bar  ' })).toBe('bind foo/bar')
  expect(commandArgOf({})).toBe('')
  expect(commandArgOf(null)).toBe('')
})

test('parseBindPath extracts the path for a well-formed bind command', () => {
  expect(parseBindPath('bind foo/bar')).toEqual({ kind: 'path', path: 'foo/bar' })
})

test('parseBindPath reports a usage error when the path is missing', () => {
  expect(parseBindPath('bind')).toEqual({ kind: 'usage-error' })
})

test('parseBindPath reports a usage error when there are extra tokens', () => {
  expect(parseBindPath('bind a b')).toEqual({ kind: 'usage-error' })
})

test('parseBindPath reports not-bind for unrelated or empty input', () => {
  expect(parseBindPath('')).toEqual({ kind: 'not-bind' })
  expect(parseBindPath('projects')).toEqual({ kind: 'not-bind' })
})

test('non-admin is refused and nerv is never called', async () => {
  const calls: string[] = []
  const httpFetch = (url: string): Promise<Response> => {
    calls.push(url)
    return Promise.resolve(new Response('{}', { status: 200 }))
  }
  const texts: string[] = []
  const reply = { text: (s: string): void => void texts.push(s) }
  await handleBindCommand(reply, { isBotAdmin: false, isGroupAdmin: false }, admin(cfgMap), httpFetch, 'acme/demo')
  expect(calls).toHaveLength(0)
  expect(texts.join('\n')).toMatch(/admin/iu)
})

test('admin bind posts the right body and replies success', async () => {
  const captured: Captured[] = []
  const texts: string[] = []
  const reply = { text: (s: string): void => void texts.push(s) }
  await handleBindCommand(
    reply,
    { isBotAdmin: true, isGroupAdmin: false, storageContextId: 'pi:aW5zdA:ctx:Y2hhbg:thread:dDE' },
    admin(cfgMap),
    capturingFetch(captured, { ok: true }),
    'acme/demo',
  )
  expect(captured).toEqual([
    {
      url: 'http://nerv:9000/projects/bind',
      body: { projectPath: 'acme/demo', notifyContextId: 'pi:aW5zdA:ctx:Y2hhbg:thread:dDE' },
    },
  ])
  expect(texts.join('\n')).toMatch(/bound.*acme\/demo/iu)
})

test('nerv 404 (unknown project) surfaces an error reply, not a crash', async () => {
  const httpFetch = (): Promise<Response> => Promise.resolve(new Response('{"error":"not_found"}', { status: 404 }))
  const texts: string[] = []
  const reply = { text: (s: string): void => void texts.push(s) }
  await handleBindCommand(
    reply,
    { isBotAdmin: true, isGroupAdmin: false, storageContextId: 'ctx1' },
    admin(cfgMap),
    httpFetch,
    'unknown/repo',
  )
  expect(texts.join('\n')).toMatch(/unknown nerv project/iu)
})

test('not configured (missing nerv admin config) is surfaced instead of throwing', async () => {
  const texts: string[] = []
  const reply = { text: (s: string): void => void texts.push(s) }
  await handleBindCommand(reply, { isBotAdmin: true, storageContextId: 'ctx1' }, admin({}), undefined, 'acme/demo')
  expect(texts.join('\n')).toMatch(/not configured/iu)
})
