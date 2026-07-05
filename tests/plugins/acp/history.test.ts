// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { deriveTitle, parsePrNumber, readRecord, writeRecord } from '../../../plugins/acp/history.js'

type FakeKv = {
  store: Map<string, string>
  get(key: string): string | undefined
  set(key: string, value: string): void
  delete(key: string): void
  list(prefix?: string): Array<{ key: string; value: string }>
}

function fakeKv(): FakeKv {
  const store = new Map<string, string>()
  return {
    store,
    get: (k: string): string | undefined => store.get(k),
    set: (k: string, v: string): void => {
      store.set(k, v)
    },
    delete: (k: string): void => {
      store.delete(k)
    },
    list: (prefix?: string): Array<{ key: string; value: string }> =>
      Array.from(store.entries())
        .filter(([k]) => prefix === undefined || k.startsWith(prefix))
        .map(([key, value]) => ({ key, value })),
  }
}

describe('acp history index', () => {
  test('writes and reads a session record', () => {
    const kv = fakeKv()
    writeRecord(kv, 's1', { project: 'demo', title: 'add health check', createdAt: '2026-07-01T00:00:00.000Z' })
    expect(kv.store.get('session:s1')).toContain('"project":"demo"')
    const rec = readRecord(kv, 's1')
    expect(rec).not.toBeNull()
    expect(rec!.project).toBe('demo')
    expect(rec!.title).toBe('add health check')
  })

  test('readRecord tolerates the legacy "1" marker', () => {
    const kv = fakeKv()
    kv.set('session:old', '1')
    expect(readRecord(kv, 'old')).toBeNull()
  })

  test('parsePrNumber handles GitHub and GitLab URLs', () => {
    expect(parsePrNumber('https://github.com/a/b/pull/42')).toBe(42)
    expect(parsePrNumber('https://gitlab.com/a/b/-/merge_requests/7')).toBe(7)
    expect(parsePrNumber('https://example.com/nope')).toBeUndefined()
    expect(parsePrNumber(undefined)).toBeUndefined()
  })

  test('deriveTitle takes a trimmed first line', () => {
    expect(deriveTitle('  Fix the build\nand more')).toBe('Fix the build')
    expect(deriveTitle('')).toBe('coding session')
  })

  test('round-trips shareToken/transcriptUrl', () => {
    const kv = fakeKv()
    writeRecord(kv, 's2', {
      project: 'demo',
      title: 'add health check',
      createdAt: '2026-07-01T00:00:00.000Z',
      shareToken: 'tok_abc',
      transcriptUrl: 'https://papai.example/t/tok_abc',
    })
    const rec = readRecord(kv, 's2')
    expect(rec).not.toBeNull()
    expect(rec!.shareToken).toBe('tok_abc')
    expect(rec!.transcriptUrl).toBe('https://papai.example/t/tok_abc')
  })

  test('non-string shareToken reads back as undefined', () => {
    const kv = fakeKv()
    kv.set(
      'session:s3',
      JSON.stringify({ project: 'demo', title: 'x', createdAt: '2026-07-01T00:00:00.000Z', shareToken: 42 }),
    )
    const rec = readRecord(kv, 's3')
    expect(rec).not.toBeNull()
    expect(rec!.shareToken).toBeUndefined()
  })
})
