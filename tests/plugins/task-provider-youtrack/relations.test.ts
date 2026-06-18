// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { z } from 'zod'

import { YouTrackClassifiedError } from '../../../plugins/task-provider-youtrack/classify-error.js'
import type { YouTrackConfig } from '../../../plugins/task-provider-youtrack/client.js'
import {
  addYouTrackRelation,
  removeYouTrackRelation,
  updateYouTrackRelation,
} from '../../../plugins/task-provider-youtrack/relations.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

let fetchMock: ReturnType<typeof mock<(url: string, init: RequestInit) => Promise<Response>>>

const config: YouTrackConfig = {
  baseUrl: 'https://test.youtrack.cloud',
  token: 'test-token',
}

const mockFetchSequence = (responses: Array<{ data: unknown; status?: number }>): void => {
  let callIndex = 0
  const m = mock<(url: string, init: RequestInit) => Promise<Response>>(() => {
    const response = responses[callIndex] ?? responses[responses.length - 1]!
    callIndex++
    return Promise.resolve(
      new Response(JSON.stringify(response.data), {
        status: response.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
  fetchMock = m
  setMockFetch((url: string, init: RequestInit) => m(url, init))
}

const FetchCallSchema = z.tuple([
  z.string(),
  z.looseObject({ method: z.string().optional(), body: z.string().optional() }),
])

const getFetchUrl = (index: number): URL => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[index])
  if (!parsed.success) return new URL('https://empty')
  return new URL(parsed.data[0])
}

const getFetchMethod = (index: number): string => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[index])
  if (!parsed.success) return ''
  return parsed.data[1].method ?? ''
}

const BodySchema = z.looseObject({})

const getFetchBody = (index: number): Record<string, unknown> => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[index])
  if (!parsed.success) return {}
  const { body } = parsed.data[1]
  if (body === undefined) return {}
  return BodySchema.parse(JSON.parse(body))
}

// A YouTrack issue-links GET response that exposes the directed link entries for PROJ-123.
const issueLinksResponse = {
  id: 'issue-123',
  links: [
    { id: 'lt-depend-s', direction: 'OUTWARD', linkType: { id: 'lt-depend', name: 'Depend' } },
    { id: 'lt-depend-t', direction: 'INWARD', linkType: { id: 'lt-depend', name: 'Depend' } },
    { id: 'lt-dup-s', direction: 'OUTWARD', linkType: { id: 'lt-dup', name: 'Duplicate' } },
    { id: 'lt-dup-t', direction: 'INWARD', linkType: { id: 'lt-dup', name: 'Duplicate' } },
    { id: 'lt-sub-s', direction: 'OUTWARD', linkType: { id: 'lt-sub', name: 'Subtask' } },
    { id: 'lt-sub-t', direction: 'INWARD', linkType: { id: 'lt-sub', name: 'Subtask' } },
    { id: 'lt-rel', direction: 'BOTH', linkType: { id: 'lt-rel', name: 'Relates' } },
  ],
}

beforeEach(() => {
  mockLogger()
})

describe('addYouTrackRelation (structured /links/{linkID}/issues)', () => {
  beforeEach(() => {
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('discovers linkID from issue links, resolves db id, then POSTs the link', async () => {
    mockFetchSequence([
      // GET /api/issues/PROJ-123/links
      { data: issueLinksResponse },
      // GET /api/issues/PROJ-456 (db id)
      { data: { id: '2-456' } },
      // POST links/{linkID}/issues
      { data: { id: 'created-link' } },
    ])

    await addYouTrackRelation(config, 'PROJ-123', 'PROJ-456', 'blocks')

    expect(getFetchUrl(0).pathname).toBe('/api/issues/PROJ-123/links')
    expect(getFetchMethod(0)).toBe('GET')

    expect(getFetchUrl(1).pathname).toBe('/api/issues/PROJ-456')
    expect(getFetchMethod(1)).toBe('GET')

    // blocks -> Depend / OUTWARD -> discovered link id 'lt-depend-s'
    expect(getFetchUrl(2).pathname).toBe('/api/issues/PROJ-123/links/lt-depend-s/issues')
    expect(getFetchMethod(2)).toBe('POST')
    expect(getFetchBody(2)).toEqual({ id: '2-456' })
  })

  test('uses the INWARD entry for blocked_by', async () => {
    mockFetchSequence([{ data: issueLinksResponse }, { data: { id: '2-456' } }, { data: {} }])

    await addYouTrackRelation(config, 'PROJ-123', 'PROJ-456', 'blocked_by')

    expect(getFetchUrl(2).pathname).toBe('/api/issues/PROJ-123/links/lt-depend-t/issues')
  })

  test('maps duplicate to the Duplicate OUTWARD entry', async () => {
    mockFetchSequence([{ data: issueLinksResponse }, { data: { id: '2-456' } }, { data: {} }])

    await addYouTrackRelation(config, 'PROJ-123', 'PROJ-456', 'duplicate')

    expect(getFetchUrl(2).pathname).toBe('/api/issues/PROJ-123/links/lt-dup-s/issues')
  })

  test('maps parent to the Subtask OUTWARD entry', async () => {
    mockFetchSequence([{ data: issueLinksResponse }, { data: { id: '2-456' } }, { data: {} }])

    await addYouTrackRelation(config, 'PROJ-123', 'PROJ-456', 'parent')

    expect(getFetchUrl(2).pathname).toBe('/api/issues/PROJ-123/links/lt-sub-s/issues')
  })

  test('maps related to the undirected Relates entry (direction BOTH)', async () => {
    mockFetchSequence([{ data: issueLinksResponse }, { data: { id: '2-456' } }, { data: {} }])

    await addYouTrackRelation(config, 'PROJ-123', 'PROJ-456', 'related')

    expect(getFetchUrl(2).pathname).toBe('/api/issues/PROJ-123/links/lt-rel/issues')
  })

  test('falls back to issueLinkTypes + constructed id when issue links lack the entry', async () => {
    mockFetchSequence([
      // GET links: no entries surfaced
      { data: { id: 'issue-123', links: [] } },
      // GET /api/issueLinkTypes
      { data: [{ id: 'lt-depend', name: 'Depend', directed: true }] },
      // GET db id
      { data: { id: '2-456' } },
      // POST
      { data: {} },
    ])

    await addYouTrackRelation(config, 'PROJ-123', 'PROJ-456', 'blocks')

    expect(getFetchUrl(1).pathname).toBe('/api/issueLinkTypes')
    expect(getFetchMethod(1)).toBe('GET')
    // Depend is directed, OUTWARD -> suffix 's'
    expect(getFetchUrl(3).pathname).toBe('/api/issues/PROJ-123/links/lt-depends/issues')
    expect(getFetchBody(3)).toEqual({ id: '2-456' })
  })

  test('fallback uses suffix s for an undirected link type', async () => {
    mockFetchSequence([
      { data: { id: 'issue-123', links: [] } },
      { data: [{ id: 'lt-rel', name: 'Relates', directed: false }] },
      { data: { id: '2-456' } },
      { data: {} },
    ])

    await addYouTrackRelation(config, 'PROJ-123', 'PROJ-456', 'related')

    expect(getFetchUrl(3).pathname).toBe('/api/issues/PROJ-123/links/lt-rels/issues')
  })

  test('throws linkTypeNotFound listing available types when resolution fails', async () => {
    mockFetchSequence([
      // no matching entry
      { data: { id: 'issue-123', links: [] } },
      // Depend absent
      { data: [{ id: 'lt-rel', name: 'Relates', directed: false }] },
    ])

    await expect(addYouTrackRelation(config, 'PROJ-123', 'PROJ-456', 'blocks')).rejects.toBeInstanceOf(
      YouTrackClassifiedError,
    )
  })
})

describe('removeYouTrackRelation', () => {
  beforeEach(() => {
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('uses REST DELETE endpoint', async () => {
    mockFetchSequence([
      {
        data: {
          id: 'issue-1',
          links: [
            {
              id: 'link-1',
              direction: 'OUTWARD',
              linkType: { id: 'lt-1', name: 'Depend' },
              issues: [{ id: 'PROJ-456', idReadable: 'PROJ-456' }],
            },
          ],
        },
      },
      { data: {} },
    ])

    await removeYouTrackRelation(config, 'PROJ-123', 'PROJ-456')

    expect(getFetchUrl(0).pathname).toBe('/api/issues/PROJ-123')
    expect(getFetchMethod(0)).toBe('GET')
    expect(getFetchUrl(1).pathname).toBe('/api/issues/PROJ-123/links/link-1')
    expect(getFetchMethod(1)).toBe('DELETE')
  })

  test('throws when relation not found', async () => {
    mockFetchSequence([{ data: { id: 'issue-1', links: [] } }])

    await expect(removeYouTrackRelation(config, 'PROJ-123', 'PROJ-456')).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })
})

describe('updateYouTrackRelation', () => {
  beforeEach(() => {
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('removes the old relation then adds the new one via the structured endpoint', async () => {
    mockFetchSequence([
      // removeYouTrackRelation: GET issue, then DELETE
      {
        data: {
          id: 'issue-1',
          links: [
            {
              id: 'link-1',
              direction: 'OUTWARD',
              linkType: { id: 'lt-1', name: 'Depend' },
              issues: [{ id: 'PROJ-456', idReadable: 'PROJ-456' }],
            },
          ],
        },
      },
      // DELETE
      { data: {} },
      // addYouTrackRelation: GET links, GET db id, POST
      { data: issueLinksResponse },
      { data: { id: '2-456' } },
      { data: {} },
    ])

    await updateYouTrackRelation(config, 'PROJ-123', 'PROJ-456', 'duplicate')

    expect(getFetchUrl(1).pathname).toBe('/api/issues/PROJ-123/links/link-1')
    expect(getFetchMethod(1)).toBe('DELETE')
    expect(getFetchUrl(4).pathname).toBe('/api/issues/PROJ-123/links/lt-dup-s/issues')
    expect(getFetchMethod(4)).toBe('POST')
  })
})
