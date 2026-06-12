// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { StoredAttachment } from '../../src/attachments/types.js'
import {
  executeTransformer,
  matchesTransformer,
  renderTransformLine,
  transformNewAttachments,
} from '../../src/plugins/attachment-transform.js'
import type { PluginAttachmentRecord } from '../../src/plugins/attachment-types.js'
import type { PluginToolRuntimeContext } from '../../src/plugins/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVoiceRecord(): PluginAttachmentRecord {
  return {
    attachmentId: 'att_t',
    filename: 'voice.ogg',
    mimeType: 'audio/ogg',
    size: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    origin: 'voice',
  }
}

function makeStubRuntimeContext(): PluginToolRuntimeContext {
  const notImplemented = (): Promise<never> => Promise.reject(new Error('not implemented'))
  return {
    pluginId: 'test-plugin',
    storageContextId: 'test-context',
    chatUserId: 'test-user',
    kv: {
      get: () => undefined,
      set: () => {},
      delete: () => {},
      list: () => [],
    },
    adminConfig: { get: () => undefined },
    contextConfig: { get: () => undefined },
    rateLimit: { check: () => ({ allowed: true }) },
    attachments: {
      read: () => notImplemented(),
    },
  }
}

function makeStoredVoiceAttachment(): StoredAttachment {
  return {
    attachmentId: 'att_stored',
    contextId: 'test-context',
    filename: 'voice.ogg',
    status: 'available',
    sourceProvider: 'telegram',
    checksum: 'abc123',
    blobKey: 'bucket/key',
    createdAt: '2026-01-01T00:00:00.000Z',
    content: Buffer.from('fake-audio'),
    mimeType: 'audio/ogg',
    size: 10,
    origin: 'voice',
  }
}

// ---------------------------------------------------------------------------
// matchesTransformer
// ---------------------------------------------------------------------------

describe('matchesTransformer', () => {
  const transformer = {
    name: 't',
    mimePrefixes: ['audio/'],
    filenameExtensions: ['.ogg', '.mp3'],
    origins: ['voice'] as const,
    transform: (): Promise<{ ok: true; text: string }> => Promise.resolve({ ok: true as const, text: 'x' }),
  }

  test('matches audio mime with voice origin', () => {
    expect(matchesTransformer(transformer, { mimeType: 'audio/ogg', filename: 'voice.ogg', origin: 'voice' })).toBe(
      true,
    )
  })

  test('falls back to extension when mime is missing', () => {
    expect(matchesTransformer(transformer, { mimeType: undefined, filename: 'note.OGG', origin: 'voice' })).toBe(true)
  })

  test('rejects non-voice origin when origins filter is set', () => {
    expect(matchesTransformer(transformer, { mimeType: 'audio/ogg', filename: 'song.ogg', origin: 'file' })).toBe(false)
    expect(matchesTransformer(transformer, { mimeType: 'audio/ogg', filename: 'song.ogg', origin: undefined })).toBe(
      false,
    )
  })

  test('rejects non-matching mime', () => {
    expect(matchesTransformer(transformer, { mimeType: 'image/png', filename: 'a.png', origin: 'voice' })).toBe(false)
  })

  test('matches any origin when origins filter omitted', () => {
    const anyOrigin = { ...transformer, origins: undefined }
    expect(matchesTransformer(anyOrigin, { mimeType: 'audio/ogg', filename: 'a.ogg', origin: undefined })).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// renderTransformLine
// ---------------------------------------------------------------------------

describe('renderTransformLine', () => {
  const record = { attachmentId: 'att_1', filename: 'voice.ogg', origin: 'voice' as const }

  test('success with duration and language', () => {
    const { line } = renderTransformLine(record, {
      ok: true,
      text: 'hello there',
      meta: { durationSec: 185, language: 'en' },
    })
    expect(line).toBe('[Voice attachment att_1 (3:05, en): "hello there"]')
  })

  test('success without meta omits the parens', () => {
    const { line } = renderTransformLine(record, { ok: true, text: 'hi' })
    expect(line).toBe('[Voice attachment att_1: "hi"]')
  })

  test('forwarded attribution', () => {
    const { line } = renderTransformLine({ ...record, forwardedFrom: 'Alice' }, { ok: true, text: 'hi' })
    expect(line).toBe('[Forwarded voice from "Alice" att_1: "hi"]')
  })

  test('failure line', () => {
    const { line } = renderTransformLine(record, { ok: false, reason: 'file too large (max 24 MiB)' })
    expect(line).toBe('[Voice attachment att_1: transcription unavailable — file too large (max 24 MiB)]')
  })

  test('non-voice origin renders the generic label', () => {
    const { line } = renderTransformLine(
      { attachmentId: 'att_2', filename: 'doc.pdf', origin: 'file' },
      { ok: true, text: 'hi' },
    )
    expect(line).toBe('[Attachment att_2: "hi"]')
  })

  test('history line truncates at 120 chars', () => {
    const long = 'x'.repeat(150)
    const { historyLine } = renderTransformLine(record, { ok: true, text: long })
    expect(historyLine).toBe(`[User attached att_1: voice.ogg — "${'x'.repeat(120)}…"]`)
  })

  test('short transcripts are not truncated in history', () => {
    const { historyLine } = renderTransformLine(record, { ok: true, text: 'short' })
    expect(historyLine).toBe('[User attached att_1: voice.ogg — "short"]')
  })

  test('failure history line is the plain attached line', () => {
    const { historyLine } = renderTransformLine(record, { ok: false, reason: 'nope' })
    expect(historyLine).toBe('[User attached att_1: voice.ogg]')
  })

  test('newlines in transcripts are collapsed to keep lines single-line', () => {
    const { line } = renderTransformLine(record, { ok: true, text: 'a\nb\n\nc' })
    expect(line).toBe('[Voice attachment att_1: "a b c"]')
  })
})

// ---------------------------------------------------------------------------
// executeTransformer
// ---------------------------------------------------------------------------

describe('executeTransformer', () => {
  test('timeout produces a failure line', async () => {
    const slow = {
      name: 'slow',
      mimePrefixes: ['audio/'],
      timeoutMs: 1000,
      transform: (): Promise<never> => new Promise<never>(() => {}),
    }
    const result = await executeTransformer(slow, makeVoiceRecord(), makeStubRuntimeContext())
    expect(result.line).toContain('transcription unavailable')
  })

  test('a throwing transformer produces a failure line', async () => {
    const bad = {
      name: 'bad',
      mimePrefixes: ['audio/'],
      transform: (): Promise<never> => Promise.reject(new Error('boom')),
    }
    const result = await executeTransformer(bad, makeVoiceRecord(), makeStubRuntimeContext())
    expect(result.line).toContain('transcription unavailable')
  })
})

// ---------------------------------------------------------------------------
// transformNewAttachments
// ---------------------------------------------------------------------------

describe('transformNewAttachments', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns empty map when no records', async () => {
    expect((await transformNewAttachments('ctx-none', 'user-1', [])).size).toBe(0)
  })

  test('returns empty map when no plugins are active for the context', async () => {
    const records = [makeStoredVoiceAttachment()]
    expect((await transformNewAttachments('ctx-none', 'user-1', records)).size).toBe(0)
  })
})
