// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { SentryClient } from '../../plugins/mcp-sentry/client.js'
import { sanitizeObject } from '../../plugins/mcp-sentry/format.js'

describe('mcp-sentry sanitizeObject', () => {
  test('masks secret-ish keys, leaves others', () => {
    const input = { token: 'abc', name: 'Bob', inner: { password: 'p', ok: 1 } }
    expect(sanitizeObject(input)).toEqual({
      token: '[REDACTED]',
      name: 'Bob',
      inner: { password: '[REDACTED]', ok: 1 },
    })
  })

  test('does not mask a key literally named "key"', () => {
    expect(sanitizeObject({ key: 'keep-me', apikey: 'x' })).toEqual({ key: 'keep-me', apikey: '[REDACTED]' })
  })

  test('leaves falsy secret values as-is', () => {
    expect(sanitizeObject({ token: '', secret: 0 })).toEqual({ token: '', secret: 0 })
  })

  test('recurses through arrays', () => {
    expect(sanitizeObject([{ token: 'a' }, { name: 'b' }])).toEqual([{ token: '[REDACTED]' }, { name: 'b' }])
  })

  test('passes primitives through', () => {
    expect(sanitizeObject('hello')).toBe('hello')
    expect(sanitizeObject(42)).toBe(42)
    expect(sanitizeObject(null)).toBe(null)
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

interface RouteResponse {
  body: unknown
  status?: number
}

function createRoutedFetch(routes: Record<string, RouteResponse>): (url: string) => Promise<Response> {
  return (url: string): Promise<Response> => {
    const { pathname } = new URL(url)
    const route = routes[pathname]
    const found = route ?? { body: { error: `unexpected path ${pathname}` }, status: 404 }
    return Promise.resolve(jsonResponse(found.body, found.status ?? 200))
  }
}

describe('SentryClient', () => {
  const baseUrl = 'https://sentry.test'
  const token = 'tok'
  const orgSlug = 'acme'

  test('getIssue calls httpFetch with correct URL, headers, method', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    const httpFetch = (url: string, init: RequestInit | undefined): Promise<Response> => {
      capturedUrl = url
      capturedInit = init
      return Promise.resolve(jsonResponse({ id: 'ABC-1' }))
    }
    const client = new SentryClient({ baseUrl, token, orgSlug, httpFetch })

    const result = await client.getIssue('ABC-1')

    expect(capturedUrl).toBe('https://sentry.test/api/0/issues/ABC-1/')
    expect(capturedInit?.method).toBe('GET')
    const headers = new Headers(capturedInit?.headers)
    expect(headers.get('Authorization')).toBe('Bearer tok')
    expect(headers.get('Accept')).toBe('application/json')
    expect(result).toEqual({ id: 'ABC-1' })
  })

  test('getProjects calls the org projects URL with no query params', async () => {
    let capturedUrl = ''
    const httpFetch = (url: string): Promise<Response> => {
      capturedUrl = url
      return Promise.resolve(jsonResponse([{ id: '1' }, { id: '2' }]))
    }
    const client = new SentryClient({ baseUrl, token, orgSlug, httpFetch })

    const result = await client.getProjects()

    expect(capturedUrl).toBe('https://sentry.test/api/0/organizations/acme/projects/')
    expect(result).toEqual([{ id: '1' }, { id: '2' }])
  })

  test('searchIssues sends sort and limit as query params', async () => {
    let capturedUrl = ''
    const httpFetch = (url: string): Promise<Response> => {
      capturedUrl = url
      return Promise.resolve(jsonResponse([]))
    }
    const client = new SentryClient({ baseUrl, token, orgSlug, httpFetch })

    await client.searchIssues({ sort: 'freq', limit: 5 })

    const parsed = new URL(capturedUrl)
    expect(parsed.pathname).toBe('/api/0/organizations/acme/issues/')
    expect(parsed.searchParams.get('sort')).toBe('freq')
    expect(parsed.searchParams.get('limit')).toBe('5')
  })

  test('sanitizes secrets in the returned payload', async () => {
    const httpFetch = (): Promise<Response> => Promise.resolve(jsonResponse({ id: 'ABC-1', token: 'super-secret' }))
    const client = new SentryClient({ baseUrl, token, orgSlug, httpFetch })

    const result = await client.getIssue('ABC-1')

    expect(result).toEqual({ id: 'ABC-1', token: '[REDACTED]' })
  })

  test('throws on non-2xx response', async () => {
    const httpFetch = (): Promise<Response> => Promise.resolve(jsonResponse({ detail: 'not found' }, 404))
    const client = new SentryClient({ baseUrl, token, orgSlug, httpFetch })

    await expect(client.getIssue('missing')).rejects.toThrow(/404/u)
  })

  test('getIssueDetails assembles composite payload and tolerates release failures', async () => {
    const httpFetch = createRoutedFetch({
      '/api/0/issues/X/': {
        body: { id: 'X', tags: [{ key: 'browser' }, { key: 'os' }], metadata: { release: 'v1.0.0' } },
      },
      '/api/0/issues/X/events/': { body: [{ id: 'ev1', release: 'v1.0.0' }] },
      '/api/0/issues/X/comments/': { body: [{ id: 'c1' }] },
      '/api/0/issues/X/tags/browser/values/': { body: [{ value: 'chrome' }] },
      '/api/0/issues/X/tags/os/values/': { body: [{ value: 'linux' }] },
      '/api/0/organizations/acme/releases/v1.0.0/': { body: { detail: 'server error' }, status: 500 },
      '/api/0/organizations/acme/releases/v1.0.0/commits/': { body: { detail: 'server error' }, status: 500 },
    })
    const client = new SentryClient({ baseUrl, token, orgSlug, httpFetch })

    const result = await client.getIssueDetails('X')

    expect(result).toHaveProperty('issue')
    expect(result).toHaveProperty('latestEvents')
    expect(result).toHaveProperty('tagValues')
    expect(result).toHaveProperty('comments')
    expect(result).toHaveProperty('suspectReleases')
    expect(result).toHaveProperty('releaseCommits')

    const details = result as {
      issue: unknown
      latestEvents: unknown
      tagValues: Record<string, unknown>
      comments: unknown
      suspectReleases: unknown[]
      releaseCommits: Array<{ version: string; commits: unknown }>
    }
    expect(details.tagValues['browser']).toEqual([{ value: 'chrome' }])
    expect(details.tagValues['os']).toEqual([{ value: 'linux' }])
    // release fetch failed -> excluded from suspectReleases
    expect(details.suspectReleases).toEqual([])
    // commits fetch failed -> [] for that version, but still present since collected regardless of release success
    expect(details.releaseCommits).toEqual([{ version: 'v1.0.0', commits: [] }])
  })
})
