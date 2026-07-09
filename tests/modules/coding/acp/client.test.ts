// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import {
  asPositiveInt,
  asString,
  callMagi,
  NOT_CONFIGURED,
  readMagiConfig,
} from '../../../../src/modules/coding/acp/client.js'

const reader = (values: Record<string, string | undefined>): { get(key: string): string | undefined } => ({
  get: (key: string): string | undefined => values[key],
})

describe('acp client', () => {
  it('readMagiConfig trims and strips trailing slashes', () => {
    expect(readMagiConfig(reader({ magi_base_url: 'https://magi.test/ ', magi_token: ' tok ' }))).toEqual({
      baseUrl: 'https://magi.test',
      token: 'tok',
    })
  })

  it('readMagiConfig returns null when base url or token is missing/blank', () => {
    expect(readMagiConfig(reader({ magi_base_url: '', magi_token: 'tok' }))).toBeNull()
    expect(readMagiConfig(reader({ magi_base_url: 'https://magi.test', magi_token: '  ' }))).toBeNull()
  })

  it('callMagi sends bearer auth and parses JSON', async () => {
    let seenUrl = ''
    let seenAuth = ''
    const httpFetch = (url: string, init?: RequestInit): Promise<Response> => {
      seenUrl = url
      seenAuth = String(new Headers(init?.headers).get('Authorization'))
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    }
    const result = await callMagi(httpFetch, { baseUrl: 'https://magi.test', token: 'tok' }, 'GET', '/agents')
    expect(seenUrl).toBe('https://magi.test/agents')
    expect(seenAuth).toBe('Bearer tok')
    expect(result).toEqual({ ok: true })
  })

  it('callMagi wraps non-2xx into a magi_error envelope', async () => {
    const httpFetch = (): Promise<Response> => Promise.resolve(new Response(JSON.stringify('nope'), { status: 503 }))
    const result = await callMagi(httpFetch, { baseUrl: 'https://magi.test', token: 'tok' }, 'GET', '/agents')
    expect(result).toEqual({ error: 'magi_error', status: 503, body: 'nope' })
  })

  it('parsing helpers behave', () => {
    expect(asString({ a: 'x' }, 'a')).toBe('x')
    expect(asString({ a: '' }, 'a')).toBeNull()
    expect(asPositiveInt({ n: 3 }, 'n')).toBe(3)
    expect(asPositiveInt({ n: -1 }, 'n')).toBeNull()
    expect(NOT_CONFIGURED.error).toBe('not_configured')
  })
})
