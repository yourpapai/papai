// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { GitLabClient } from '../../plugins/mcp-gitlab/client.js'

interface Captured {
  url: string
}

function firstUrl(captured: Captured[]): string {
  const [first] = captured
  if (first === undefined) {
    throw new Error('expected at least one captured request')
  }
  return first.url
}

function pagedTreeFetch(totalPages: number): {
  httpFetch: (url: string, init: RequestInit | undefined) => Promise<Response>
  captured: Captured[]
} {
  const captured: Captured[] = []
  const httpFetch = (url: string, _init: RequestInit | undefined): Promise<Response> => {
    captured.push({ url })
    const page = new URL(url).searchParams.get('page') ?? '1'
    const body = JSON.stringify([{ id: `e${page}`, path: `p${page}`, type: 'blob' }])
    return Promise.resolve(new Response(body, { status: 200, headers: { 'x-total-pages': String(totalPages) } }))
  }
  return { httpFetch, captured }
}

describe('GitLabClient.getRepositoryTree pagination', () => {
  test('follows all pages via x-total-pages and concatenates in order', async () => {
    const { httpFetch, captured } = pagedTreeFetch(3)
    const client = new GitLabClient({ baseUrl: 'https://gl.example.com', token: 't', httpFetch })
    const out = await client.getRepositoryTree('group/proj', { recursive: true })
    expect(out.entries.map((e) => e.id)).toEqual(['e1', 'e2', 'e3'])
    expect(out.capped).toBe(false)
    expect(captured).toHaveLength(3)
    expect(new URL(firstUrl(captured)).searchParams.get('per_page')).toBe('100')
  })

  test('single page (x-total-pages: 1) fetches exactly once', async () => {
    const { httpFetch, captured } = pagedTreeFetch(1)
    const client = new GitLabClient({ baseUrl: 'https://gl.example.com', token: 't', httpFetch })
    const out = await client.getRepositoryTree('group/proj', {})
    expect(out.entries.map((e) => e.id)).toEqual(['e1'])
    expect(out.capped).toBe(false)
    expect(captured).toHaveLength(1)
  })

  test('caps at MAX_PAGES (50) and reports capped: true', async () => {
    const { httpFetch, captured } = pagedTreeFetch(999)
    const client = new GitLabClient({ baseUrl: 'https://gl.example.com', token: 't', httpFetch })
    const out = await client.getRepositoryTree('group/proj', {})
    expect(out.capped).toBe(true)
    expect(captured).toHaveLength(50)
  })
})

function pagedMrFetch(totalPages: number): {
  httpFetch: (url: string, init: RequestInit | undefined) => Promise<Response>
  captured: Captured[]
} {
  const captured: Captured[] = []
  const httpFetch = (url: string, _init: RequestInit | undefined): Promise<Response> => {
    captured.push({ url })
    const page = new URL(url).searchParams.get('page') ?? '1'
    const body = JSON.stringify([{ title: `mr${page}`, state: 'opened' }])
    return Promise.resolve(new Response(body, { status: 200, headers: { 'x-total-pages': String(totalPages) } }))
  }
  return { httpFetch, captured }
}

describe('GitLabClient.getMrs all mode', () => {
  test('all:true fetches every page and concatenates, capped:false', async () => {
    const { httpFetch, captured } = pagedMrFetch(2)
    const client = new GitLabClient({ baseUrl: 'https://gl.example.com', token: 't', httpFetch })
    const out = await client.getMrs('group/proj', { all: true })
    expect(out.items.map((m) => m.title)).toEqual(['mr1', 'mr2'])
    expect(out.capped).toBe(false)
    expect(out.total).toBe(2)
    expect(captured).toHaveLength(2)
  })

  test('all:true ignores caller page and starts at page 1', async () => {
    const { httpFetch, captured } = pagedMrFetch(1)
    const client = new GitLabClient({ baseUrl: 'https://gl.example.com', token: 't', httpFetch })
    await client.getMrs('group/proj', { all: true, page: 7 })
    expect(new URL(firstUrl(captured)).searchParams.get('page')).toBe('1')
  })
})
