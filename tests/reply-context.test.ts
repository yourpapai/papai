// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { stageFileMetadata } from '../src/attachments/staged.js'
import type { IncomingMessage } from '../src/chat/types.js'
import { cacheMessage } from '../src/message-cache/cache.js'
import { buildPromptWithReplyContext, buildReplyContextChain } from '../src/reply-context.js'
import { clearMessageCache, mockLogger, mockMessageCache, setupTestDb } from './utils/test-helpers.js'

function makeDmMessage(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    user: { id: 'user1', username: 'testuser', isAdmin: false },
    contextId: 'ctx1',
    contextType: 'dm',
    isMentioned: false,
    text: 'Hello world',
    platformInstanceId: 'test-instance',
    ...overrides,
  }
}

describe('buildPromptWithReplyContext', () => {
  beforeEach(() => {
    mockLogger()
    mockMessageCache()
  })

  test('returns plain text when no reply context', () => {
    const msg = makeDmMessage({ text: 'Hello world' })
    expect(buildPromptWithReplyContext(msg)).toBe('Hello world')
  })

  test('includes parent message context', () => {
    const msg = makeDmMessage({
      text: 'Can you update it?',
      replyContext: {
        messageId: 'msg123',
        authorUsername: 'otheruser',
        text: 'Task #123 needs review',
      },
    })

    const result = buildPromptWithReplyContext(msg)

    expect(result).toContain('[Replying to message from otheruser:')
    expect(result).toContain('Task #123 needs review')
    expect(result).toContain('Can you update it?')
  })

  test('includes quoted text', () => {
    const msg = makeDmMessage({
      text: 'This part is important',
      replyContext: {
        messageId: 'msg123',
        quotedText: 'Important detail here',
      },
    })

    const result = buildPromptWithReplyContext(msg)

    expect(result).toContain('[Quoted text: "Important detail here"]')
  })

  test('includes truncation note when quotedTextTruncated=true', () => {
    const msg = makeDmMessage({
      text: 'Is this the right task?',
      replyContext: {
        messageId: 'msg123',
        authorUsername: 'alice',
        text: 'Full message text here',
        quotedText: 'B'.repeat(1024),
        quotedTextTruncated: true,
      },
    })

    const result = buildPromptWithReplyContext(msg)

    expect(result).toContain('[Quoted text (truncated')
    expect(result).not.toContain('[Quoted text: "')
  })

  test('includes chain summary', () => {
    const msg = makeDmMessage({
      text: 'Follow-up question',
      replyContext: {
        messageId: 'msg3',
        authorUsername: 'bob',
        text: 'Second message',
        chainSummary: 'alice: First message',
      },
    })

    const result = buildPromptWithReplyContext(msg)

    expect(result).toContain('[Earlier context: alice: First message]')
    expect(result).toContain('[Replying to message from bob:')
    expect(result).toContain('Follow-up question')
  })

  test('falls back to "user" when authorUsername is missing', () => {
    const msg = makeDmMessage({
      text: 'Reply',
      replyContext: {
        messageId: 'msg123',
        text: 'Original',
      },
    })

    const result = buildPromptWithReplyContext(msg)

    expect(result).toContain('[Replying to message from user:')
  })

  test('renders attachment manifest using stable papai attachment ids', () => {
    const msg = makeDmMessage({ text: 'Please upload this' })
    const result = buildPromptWithReplyContext(msg, [
      {
        attachmentId: 'att_123',
        contextId: 'ctx1',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        size: 12345,
        status: 'available',
      },
    ])

    expect(result).toContain('Available attachments')
    expect(result).toContain('att_123 report.pdf (application/pdf, 12345 bytes)')
    expect(result).not.toContain('fileId=')
    expect(result).toContain('Please upload this')
  })

  test('includes multiple attachments in prompt', () => {
    const msg = makeDmMessage({ text: 'Two files' })
    const result = buildPromptWithReplyContext(msg, [
      {
        attachmentId: 'att_1',
        contextId: 'ctx1',
        filename: 'a.txt',
        mimeType: 'text/plain',
        size: 100,
        status: 'available',
      },
      {
        attachmentId: 'att_2',
        contextId: 'ctx1',
        filename: 'b.png',
        mimeType: 'image/png',
        size: 200,
        status: 'available',
      },
    ])

    expect(result).toContain('att_1 a.txt (text/plain, 100 bytes)')
    expect(result).toContain('att_2 b.png (image/png, 200 bytes)')
  })

  test('omits size from manifest when size is undefined', () => {
    const msg = makeDmMessage({ text: 'file' })
    const result = buildPromptWithReplyContext(msg, [
      {
        attachmentId: 'att_42',
        contextId: 'ctx1',
        filename: 'photo.jpg',
        mimeType: 'image/jpeg',
        status: 'available',
      },
    ])

    expect(result).toContain('att_42 photo.jpg (image/jpeg)')
    expect(result).not.toContain('bytes')
  })

  test('includes attachment manifest alongside reply context', () => {
    const msg = makeDmMessage({
      text: 'Here it is',
      replyContext: { messageId: 'prev', authorUsername: 'alice', text: 'Can you send the file?' },
    })
    const result = buildPromptWithReplyContext(msg, [
      {
        attachmentId: 'att_doc',
        contextId: 'ctx1',
        filename: 'doc.pdf',
        status: 'available',
      },
    ])

    expect(result).toContain('[Replying to message from alice:')
    expect(result).toContain('att_doc doc.pdf')
    expect(result).toContain('Here it is')
  })

  test('returns plain text when no reply context and no attachments', () => {
    const msg = makeDmMessage({ text: 'Just text' })
    expect(buildPromptWithReplyContext(msg)).toBe('Just text')
    expect(buildPromptWithReplyContext(msg, [])).toBe('Just text')
  })

  test('omits replying line when replyContext has no text but has quotedText', () => {
    const msg = makeDmMessage({
      text: 'body',
      replyContext: { messageId: 'm1', quotedText: 'Q' },
    })

    expect(buildPromptWithReplyContext(msg)).toBe('[Quoted text: "Q"]\n\nbody')
  })

  test('omits quoted line when replyContext has no quotedText', () => {
    const msg = makeDmMessage({
      text: 'body',
      replyContext: { messageId: 'm1', authorUsername: 'alice', text: 'T' },
    })

    expect(buildPromptWithReplyContext(msg)).toBe('[Replying to message from alice: "T"]\n\nbody')
  })

  test('omits earlier-context line when chainSummary is undefined', () => {
    const msg = makeDmMessage({
      text: 'body',
      replyContext: { messageId: 'm1', authorUsername: 'alice', text: 'T' },
    })

    expect(buildPromptWithReplyContext(msg)).toBe('[Replying to message from alice: "T"]\n\nbody')
  })

  test('omits earlier-context line when chainSummary is empty string', () => {
    const msg = makeDmMessage({
      text: 'body',
      replyContext: { messageId: 'm1', authorUsername: 'alice', text: 'T', chainSummary: '' },
    })

    expect(buildPromptWithReplyContext(msg)).toBe('[Replying to message from alice: "T"]\n\nbody')
  })

  test('joins multiple context lines with blank-line separators before the message', () => {
    const msg = makeDmMessage({
      text: 'body',
      replyContext: {
        messageId: 'm1',
        authorUsername: 'alice',
        text: 'T',
        quotedText: 'Q',
        chainSummary: 'S',
      },
    })

    const out = buildPromptWithReplyContext(msg)
    expect(out).toBe('[Replying to message from alice: "T"]\n[Quoted text: "Q"]\n[Earlier context: S]\n\nbody')
  })
})

describe('buildReplyContextChain', () => {
  beforeEach(() => {
    mockLogger()
    mockMessageCache()
    clearMessageCache()
  })

  test('returns empty when chain has only one message', () => {
    cacheMessage({
      messageId: 'A',
      contextId: 'ctx1',
      text: 'Root message',
      timestamp: Date.now(),
    })

    const result = buildReplyContextChain('ctx1', 'A')

    expect(result.chain).toBeUndefined()
    expect(result.chainSummary).toBeUndefined()
  })

  test('builds chain summary for multi-message chain', () => {
    cacheMessage({
      messageId: 'A',
      contextId: 'ctx1',
      authorUsername: 'alice',
      text: 'First',
      timestamp: Date.now(),
    })
    cacheMessage({
      messageId: 'B',
      contextId: 'ctx1',
      authorUsername: 'bob',
      text: 'Second',
      replyToMessageId: 'A',
      timestamp: Date.now(),
    })
    cacheMessage({
      messageId: 'C',
      contextId: 'ctx1',
      authorUsername: 'alice',
      text: 'Third',
      replyToMessageId: 'B',
      timestamp: Date.now(),
    })

    const result = buildReplyContextChain('ctx1', 'C')

    expect(result.chain).toEqual(['A', 'B', 'C'])
    expect(result.chainSummary).toContain('alice: First')
    expect(result.chainSummary).toContain('bob: Second')
  })

  test('returns undefined chainSummary when earlier messages not cached', () => {
    cacheMessage({
      messageId: 'C',
      contextId: 'ctx1',
      text: 'Third',
      replyToMessageId: 'B',
      timestamp: Date.now(),
    })

    const result = buildReplyContextChain('ctx1', 'C')

    expect(result.chain).toBeUndefined()
    expect(result.chainSummary).toBeUndefined()
  })

  test('chain summary excludes the immediate parent', () => {
    cacheMessage({
      messageId: 'A',
      contextId: 'ctx1',
      authorUsername: 'alice',
      text: 'Root',
      timestamp: Date.now(),
    })
    cacheMessage({
      messageId: 'B',
      contextId: 'ctx1',
      authorUsername: 'bob',
      text: 'Parent',
      replyToMessageId: 'A',
      timestamp: Date.now(),
    })

    const result = buildReplyContextChain('ctx1', 'B')

    expect(result.chain).toEqual(['A', 'B'])
    // Summary should only include A (alice), not B (bob) which is the immediate parent
    expect(result.chainSummary).toBe('alice: Root')
    expect(result.chainSummary).not.toContain('bob')
  })

  test('skips earlier message with empty text and leaves chainSummary undefined', () => {
    cacheMessage({ messageId: 'A', contextId: 'ctx1', text: '', timestamp: Date.now() })
    cacheMessage({
      messageId: 'B',
      contextId: 'ctx1',
      authorUsername: 'bob',
      text: 'Hi',
      replyToMessageId: 'A',
      timestamp: Date.now(),
    })

    const result = buildReplyContextChain('ctx1', 'B')

    expect(result.chain).toEqual(['A', 'B'])
    expect(result.chainSummary).toBeUndefined()
  })

  test('skips earlier message with undefined text and leaves chainSummary undefined', () => {
    cacheMessage({ messageId: 'A', contextId: 'ctx1', timestamp: Date.now() })
    cacheMessage({
      messageId: 'B',
      contextId: 'ctx1',
      authorUsername: 'bob',
      text: 'Hi',
      replyToMessageId: 'A',
      timestamp: Date.now(),
    })

    const result = buildReplyContextChain('ctx1', 'B')

    expect(result.chain).toEqual(['A', 'B'])
    expect(result.chainSummary).toBeUndefined()
  })

  test('falls back to "user" author in chain summary when authorUsername is absent', () => {
    cacheMessage({ messageId: 'A', contextId: 'ctx1', text: 'Root', timestamp: Date.now() })
    cacheMessage({
      messageId: 'B',
      contextId: 'ctx1',
      authorUsername: 'bob',
      text: 'Hi',
      replyToMessageId: 'A',
      timestamp: Date.now(),
    })

    const result = buildReplyContextChain('ctx1', 'B')

    expect(result.chainSummary).toBe('user: Root')
  })

  test('joins multiple earlier messages with the arrow separator', () => {
    cacheMessage({
      messageId: 'A',
      contextId: 'ctx1',
      authorUsername: 'alice',
      text: 'First',
      timestamp: Date.now(),
    })
    cacheMessage({
      messageId: 'B',
      contextId: 'ctx1',
      authorUsername: 'bob',
      text: 'Second',
      replyToMessageId: 'A',
      timestamp: Date.now(),
    })
    cacheMessage({
      messageId: 'C',
      contextId: 'ctx1',
      authorUsername: 'carol',
      text: 'Third',
      replyToMessageId: 'B',
      timestamp: Date.now(),
    })

    const result = buildReplyContextChain('ctx1', 'C')

    expect(result.chainSummary).toBe('alice: First → bob: Second')
  })
})

describe('staged-file context in buildPromptWithReplyContext', () => {
  beforeEach(async () => {
    mockLogger()
    mockMessageCache()
    await setupTestDb()
  })

  function stageForReply(overrides: { senderUsername: string | null; filename: string }): {
    stagedId: string
  } {
    return stageFileMetadata({
      contextId: 'store-1',
      messageId: 'parent-1',
      senderId: 'u1',
      senderUsername: overrides.senderUsername,
      filename: overrides.filename,
      mimeType: null,
      size: null,
      platformFileId: `pf-${overrides.filename}`,
      sourceProvider: 'telegram',
      sourcePlatformInstanceId: 'inst-1',
      origin: null,
      forwardedFrom: null,
    })
  }

  test('appends the staged-file line for a named sender (S3 configured)', () => {
    const staged = stageForReply({ senderUsername: 'alice', filename: 'report.pdf' })
    const msg = makeDmMessage({ text: 'see this', replyToMessageId: 'parent-1' })

    expect(buildPromptWithReplyContext(msg, [], 'store-1')).toBe(
      `[Staged file available: ${staged.stagedId} "report.pdf" from alice]\n\nsee this`,
    )
  })

  test('falls back to "unknown user" when the staged sender is anonymous', () => {
    const staged = stageForReply({ senderUsername: null, filename: 'report.pdf' })
    const msg = makeDmMessage({ text: 'see this', replyToMessageId: 'parent-1' })

    expect(buildPromptWithReplyContext(msg, [], 'store-1')).toBe(
      `[Staged file available: ${staged.stagedId} "report.pdf" from unknown user]\n\nsee this`,
    )
  })

  test('omits the staged block entirely when S3 is not configured', () => {
    delete process.env['S3_BUCKET']
    delete process.env['S3_ACCESS_KEY_ID']
    delete process.env['S3_SECRET_ACCESS_KEY']
    stageForReply({ senderUsername: 'alice', filename: 'report.pdf' })
    const msg = makeDmMessage({ text: 'see this', replyToMessageId: 'parent-1' })

    expect(buildPromptWithReplyContext(msg, [], 'store-1')).toBe('see this')
  })
})
