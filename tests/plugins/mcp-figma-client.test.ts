// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { FigmaClient } from '../../plugins/mcp-figma/client.js'

interface Captured {
  url: string
  token: string | undefined
}

function scriptedFetch(
  statuses: number[],
  body: unknown,
): {
  httpFetch: (url: string, init: RequestInit | undefined) => Promise<Response>
  captured: Captured[]
} {
  const captured: Captured[] = []
  let i = 0
  const httpFetch = (url: string, init: RequestInit | undefined): Promise<Response> => {
    const headers = new Headers(init?.headers)
    captured.push({ url, token: headers.get('X-Figma-Token') ?? undefined })
    const status = statuses[Math.min(i, statuses.length - 1)]
    i += 1
    return Promise.resolve(new Response(JSON.stringify(body), { status }))
  }
  return { httpFetch, captured }
}

describe('FigmaClient token pool + 429 rotation', () => {
  test('single token, 200 → returns simplified design', async () => {
    const { httpFetch, captured } = scriptedFetch([200], { name: 'D', document: { children: [] } })
    const client = new FigmaClient({ token: 'tok1', httpFetch })
    const out = await client.getFile('KEY')
    expect(out).toEqual({ name: 'D', nodes: [], globalVars: { styles: {} } })
    expect(captured).toHaveLength(1)
    expect(captured[0]?.token).toBe('tok1')
  })

  test('pool of 2, first token 429 then second 200 → rotates and succeeds', async () => {
    const { httpFetch, captured } = scriptedFetch([429, 200], { name: 'D', document: { children: [] } })
    const client = new FigmaClient({ token: 'tokA, tokB', httpFetch })
    await client.getFile('KEY')
    expect(captured).toHaveLength(2)
    expect(captured[0]?.token).toBe('tokA')
    expect(captured[1]?.token).toBe('tokB')
  })

  test('all tokens 429 → clean rate-limited error, one attempt per token', async () => {
    const { httpFetch, captured } = scriptedFetch([429], {})
    const client = new FigmaClient({ token: 'tokA,tokB', httpFetch })
    await expect(client.getFile('KEY')).rejects.toThrow(/429.*exhausted/u)
    expect(captured).toHaveLength(2)
  })

  test('non-429 error surfaces immediately without rotation', async () => {
    const { httpFetch, captured } = scriptedFetch([500], {})
    const client = new FigmaClient({ token: 'tokA,tokB', httpFetch })
    await expect(client.getFile('KEY')).rejects.toThrow(/Figma API 500/u)
    expect(captured).toHaveLength(1)
  })

  test('empty or whitespace-only token pool throws', () => {
    const noop = (): Promise<Response> => Promise.resolve(new Response('{}'))
    expect(() => new FigmaClient({ token: '', httpFetch: noop })).toThrow(/empty/u)
    expect(() => new FigmaClient({ token: '  ,  ', httpFetch: noop })).toThrow(/empty/u)
  })

  test('pool of 3, first two 429 then third 200 → two rotations, succeeds on token 3', async () => {
    const { httpFetch, captured } = scriptedFetch([429, 429, 200], { name: 'D', document: { children: [] } })
    const client = new FigmaClient({ token: 'tokA,tokB,tokC', httpFetch })
    await client.getFile('KEY')
    expect(captured).toHaveLength(3)
    expect(captured[0]?.token).toBe('tokA')
    expect(captured[1]?.token).toBe('tokB')
    expect(captured[2]?.token).toBe('tokC')
  })
})
