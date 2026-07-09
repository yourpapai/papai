// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { readRecord, writeRecord } from '../../../../src/modules/coding/acp/history.js'
import { enrichSession, recordStartedSession } from '../../../../src/modules/coding/acp/session-records.js'
import { runtimeCtxWithKv } from './support.js'

describe('recordStartedSession', () => {
  test('writes a record keyed by the session id from the result', () => {
    const store = new Map<string, string>()
    const ctx = runtimeCtxWithKv(store)
    recordStartedSession(ctx, { id: 's-1', status: 'queued' }, 'demo', 'Add a health check\nmore detail')
    const rec = readRecord(ctx.kv, 's-1')
    expect(rec).not.toBeNull()
    expect(rec?.project).toBe('demo')
    expect(rec?.title).toBe('Add a health check')
  })

  test('prefixes the title with the PR number when prNumber is provided', () => {
    const store = new Map<string, string>()
    const ctx = runtimeCtxWithKv(store)
    recordStartedSession(ctx, { id: 's-pr' }, 'demo', 'review it', 42)
    const rec = readRecord(ctx.kv, 's-pr')
    expect(rec?.title).toBe('PR #42: review it')
    expect(rec?.prNumber).toBe(42)
  })

  test('captures shareToken/transcriptUrl from the result', () => {
    const store = new Map<string, string>()
    const ctx = runtimeCtxWithKv(store)
    recordStartedSession(
      ctx,
      { id: 'sess-9', shareToken: 'tok_z', transcriptUrl: 'https://papai.example/t/tok_z' },
      'demo',
      'do it',
    )
    const rec = readRecord(ctx.kv, 'sess-9')
    expect(rec?.shareToken).toBe('tok_z')
    expect(rec?.transcriptUrl).toBe('https://papai.example/t/tok_z')
  })

  test('does nothing when the result carries no session id', () => {
    const store = new Map<string, string>()
    const ctx = runtimeCtxWithKv(store)
    recordStartedSession(ctx, {}, 'demo', 'do it')
    expect(store.size).toBe(0)
  })
})

describe('enrichSession', () => {
  test('returns the row unchanged when it has no session id', () => {
    const store = new Map<string, string>()
    const ctx = runtimeCtxWithKv(store)
    const row = { status: 'running' }
    expect(enrichSession(ctx, row)).toEqual(row)
  })

  test('merges the locally-known title and parentSessionId onto the magi row', () => {
    const store = new Map<string, string>()
    const ctx = runtimeCtxWithKv(store)
    writeRecord(ctx.kv, 's-7', {
      project: 'demo',
      title: 'Add a health check',
      createdAt: 'x',
      parentSessionId: 'p-1',
    })
    const result = enrichSession(ctx, { id: 's-7', status: 'running' })
    expect(result).toMatchObject({ id: 's-7', title: 'Add a health check', parentSessionId: 'p-1' })
  })

  test('refreshes the stored record status/prUrl/prNumber from the magi row', () => {
    const store = new Map<string, string>()
    const ctx = runtimeCtxWithKv(store)
    writeRecord(ctx.kv, 's-7', { project: 'demo', title: 'Add a health check', createdAt: 'x', status: 'active' })
    const result = enrichSession(ctx, { id: 's-7', status: 'done', prUrl: 'https://github.com/a/b/pull/12' })
    expect(result).toMatchObject({ prNumber: 12 })
    const refreshed = readRecord(ctx.kv, 's-7')
    expect(refreshed?.status).toBe('done')
    expect(refreshed?.prUrl).toBe('https://github.com/a/b/pull/12')
    expect(refreshed?.prNumber).toBe(12)
  })

  test('includes transcriptUrl from the local record when present', () => {
    const store = new Map<string, string>()
    const ctx = runtimeCtxWithKv(store)
    writeRecord(ctx.kv, 's-7', {
      project: 'demo',
      title: 'Add a health check',
      createdAt: 'x',
      transcriptUrl: 'https://papai.example/t/tok_z',
    })
    const result = enrichSession(ctx, { id: 's-7', status: 'running' })
    expect(result).toMatchObject({ transcriptUrl: 'https://papai.example/t/tok_z' })
  })

  test('omits transcriptUrl when the local record has none', () => {
    const store = new Map<string, string>()
    const ctx = runtimeCtxWithKv(store)
    writeRecord(ctx.kv, 's-7', { project: 'demo', title: 'Add a health check', createdAt: 'x' })
    const result = enrichSession(ctx, { id: 's-7', status: 'running' })
    expect(result).not.toHaveProperty('transcriptUrl')
  })

  test('returns the row unmodified (aside from prNumber) when there is no local record', () => {
    const store = new Map<string, string>()
    const ctx = runtimeCtxWithKv(store)
    const result = enrichSession(ctx, { id: 'unknown-session', status: 'running' })
    expect(result).toEqual({ id: 'unknown-session', status: 'running' })
  })
})
