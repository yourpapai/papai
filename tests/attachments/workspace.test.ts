import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  _createInMemoryBlobStore,
  _resetBlobStore,
  _setBlobStore,
  type InMemoryBlobStore,
} from '../../src/attachments/blob-store.js'
import { persistIncomingAttachments } from '../../src/attachments/ingest.js'
import { clearAttachmentWorkspace, listActiveAttachments } from '../../src/attachments/workspace.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('attachment workspace', () => {
  let blobs: InMemoryBlobStore

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    blobs = _createInMemoryBlobStore()
    _setBlobStore(blobs)
  })

  afterEach(() => {
    _resetBlobStore()
  })

  test('persists incoming files, lists them as active, and clears them by context', async () => {
    const refs = await persistIncomingAttachments({
      contextId: 'ctx-workspace',
      sourceProvider: 'mattermost',
      sourceMessageId: 'm-42',
      files: [
        {
          fileId: 'platform-f1',
          filename: 'diagram.png',
          mimeType: 'image/png',
          size: 7,
          content: Buffer.from('pngdata'),
        },
      ],
    })

    expect(refs).toHaveLength(1)
    expect(refs[0]?.attachmentId.startsWith('att_')).toBe(true)
    expect(listActiveAttachments('ctx-workspace')).toHaveLength(1)
    expect(blobs.size()).toBe(1)

    await clearAttachmentWorkspace('ctx-workspace')

    expect(listActiveAttachments('ctx-workspace')).toEqual([])
    expect(blobs.size()).toBe(0)
  })

  test('listActiveAttachments scopes by context and skips other contexts', async () => {
    await persistIncomingAttachments({
      contextId: 'ctx-a',
      sourceProvider: 'telegram',
      files: [{ fileId: 'a', filename: 'a.txt', content: Buffer.from('a') }],
    })
    await persistIncomingAttachments({
      contextId: 'ctx-b',
      sourceProvider: 'telegram',
      files: [{ fileId: 'b', filename: 'b.txt', content: Buffer.from('b') }],
    })

    expect(listActiveAttachments('ctx-a')).toHaveLength(1)
    expect(listActiveAttachments('ctx-b')).toHaveLength(1)

    await clearAttachmentWorkspace('ctx-a')

    expect(listActiveAttachments('ctx-a')).toHaveLength(0)
    expect(listActiveAttachments('ctx-b')).toHaveLength(1)
  })

  test('persistIncomingAttachments returns one ref per file in the same order', async () => {
    const refs = await persistIncomingAttachments({
      contextId: 'ctx-order',
      sourceProvider: 'telegram',
      files: [
        { fileId: 'f1', filename: 'one.txt', content: Buffer.from('1') },
        { fileId: 'f2', filename: 'two.txt', content: Buffer.from('2') },
      ],
    })

    expect(refs.map((ref) => ref.filename)).toEqual(['one.txt', 'two.txt'])
  })
})
