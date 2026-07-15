// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import { runMattermostCatchUp, type CatchUpConfig, type CatchUpDeps } from '../../../src/chat/mattermost/catch-up.js'
import type { MattermostThreadPost } from '../../../src/chat/mattermost/schema.js'

function post(id: string, createAt: number, channelId = 'chan-1'): MattermostThreadPost {
  return { id, user_id: 'u1', channel_id: channelId, message: `msg-${id}`, create_at: createAt }
}

function postList(posts: MattermostThreadPost[]): unknown {
  const map: Record<string, MattermostThreadPost> = {}
  for (const p of posts) map[p.id] = p
  return { order: posts.map((p) => p.id), posts: map }
}

function firstArg(calls: [MattermostThreadPost][]): MattermostThreadPost | undefined {
  return calls[0]?.[0]
}

function calledIds(calls: [MattermostThreadPost][]): string[] {
  return calls.map((c) => c[0].id)
}

// Returns null for ids in `cachedIds`, otherwise a stand-in cached record. Kept as a
// module-level helper (rather than inline in a test) so the branch isn't a
// conditional-in-test lint violation.
function cachedLookup(cachedIds: Set<string>): (contextId: string, messageId: string) => unknown {
  return (_contextId: string, messageId: string) => (cachedIds.has(messageId) ? { id: messageId } : null)
}

// apiFetch stub that rejects for one context id and resolves with `list` for others.
// Kept as a module-level helper for the same conditional-in-test reason as above.
function apiFetchFailingFor(
  failingContextId: string,
  list: unknown,
): (method: string, path: string) => Promise<unknown> {
  return (_method: string, path: string) => {
    if (path.includes(failingContextId)) return Promise.reject(new Error('boom'))
    return Promise.resolve(list)
  }
}

const CONFIG: CatchUpConfig = { perChannelCap: 20, stalenessMs: 5000, concurrency: 3 }

function makeDeps(overrides: Partial<CatchUpDeps> = {}): CatchUpDeps {
  return {
    apiFetch: mock((_method: string, _path: string) => Promise.resolve(postList([]))),
    listContexts: () => [{ contextId: 'chan-1' }],
    getCursor: () => 100,
    getCachedMessage: () => null,
    replayPost: mock((_post: MattermostThreadPost) => Promise.resolve()),
    cachePostOnly: mock((_post: MattermostThreadPost) => Promise.resolve()),
    now: () => 10_000,
    ...overrides,
  }
}

describe('runMattermostCatchUp', () => {
  test('cursor null -> apiFetch never called (no baseline)', async () => {
    const apiFetch = mock((_method: string, _path: string) => Promise.resolve(postList([])))
    const deps = makeDeps({ apiFetch, getCursor: () => null })
    await runMattermostCatchUp('inst-1', deps, CONFIG)
    expect(apiFetch).not.toHaveBeenCalled()
  })

  test('dedupes cached posts and applies staleness cap', async () => {
    const p1 = post('p1', 1000)
    const p2 = post('p2', 2000)
    const p3 = post('p3', 9000)
    const apiFetch = mock((_method: string, _path: string) => Promise.resolve(postList([p1, p2, p3])))
    const replayPost = mock((_post: MattermostThreadPost) => Promise.resolve())
    const cachePostOnly = mock((_post: MattermostThreadPost) => Promise.resolve())
    const deps = makeDeps({
      apiFetch,
      // p1 already processed; p2/p3 not yet seen
      getCachedMessage: cachedLookup(new Set(['p1'])),
      replayPost,
      cachePostOnly,
      now: () => 10_000,
    })

    await runMattermostCatchUp('inst-1', deps, { ...CONFIG, stalenessMs: 5000 })

    // p3: now(10000) - create_at(9000) = 1000 < 5000 -> fresh -> replayed
    expect(replayPost).toHaveBeenCalledTimes(1)
    expect(firstArg(replayPost.mock.calls)?.id).toBe('p3')

    // p2: now(10000) - create_at(2000) = 8000 > 5000 -> stale -> cache only
    expect(cachePostOnly).toHaveBeenCalledTimes(1)
    expect(firstArg(cachePostOnly.mock.calls)?.id).toBe('p2')

    // p1: already cached -> neither called for it
    expect(calledIds(replayPost.mock.calls)).not.toContain('p1')
    expect(calledIds(cachePostOnly.mock.calls)).not.toContain('p1')
  })

  test('perChannelCap keeps only the newest N posts', async () => {
    const p1 = post('p1', 1000)
    const p2 = post('p2', 2000)
    const p3 = post('p3', 9000)
    const apiFetch = mock((_method: string, _path: string) => Promise.resolve(postList([p1, p2, p3])))
    const replayPost = mock((_post: MattermostThreadPost) => Promise.resolve())
    const cachePostOnly = mock((_post: MattermostThreadPost) => Promise.resolve())
    const deps = makeDeps({
      apiFetch,
      getCachedMessage: () => null,
      replayPost,
      cachePostOnly,
      now: () => 10_000,
    })

    // stalenessMs large so everything would be "fresh" if considered
    await runMattermostCatchUp('inst-1', deps, { perChannelCap: 1, stalenessMs: 1_000_000, concurrency: 3 })

    // Only newest (p3) considered at all -- p2 must not be touched even though it'd be fresh
    const touchedIds = [...calledIds(replayPost.mock.calls), ...calledIds(cachePostOnly.mock.calls)]
    expect(touchedIds).toEqual(['p3'])
  })

  test('one channel throwing does not prevent the other from being processed', async () => {
    const goodPost = post('good-1', 9000, 'chan-2')
    const apiFetch = mock(apiFetchFailingFor('chan-1', postList([goodPost])))
    const replayPost = mock((_post: MattermostThreadPost) => Promise.resolve())
    const cachePostOnly = mock((_post: MattermostThreadPost) => Promise.resolve())
    const deps = makeDeps({
      apiFetch,
      listContexts: () => [{ contextId: 'chan-1' }, { contextId: 'chan-2' }],
      getCachedMessage: () => null,
      replayPost,
      cachePostOnly,
      now: () => 10_000,
    })

    await expect(runMattermostCatchUp('inst-1', deps, CONFIG)).resolves.toBeUndefined()

    expect(replayPost).toHaveBeenCalledTimes(1)
    expect(firstArg(replayPost.mock.calls)?.id).toBe('good-1')
  })
})
