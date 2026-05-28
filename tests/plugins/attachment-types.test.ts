// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { PluginAttachmentFacade, PluginAttachmentRecord } from '../../src/plugins/attachment-types.js'

describe('attachment-types', () => {
  test('PluginAttachmentRecord accepts a populated record', () => {
    const record: PluginAttachmentRecord = {
      attachmentId: 'att_1',
      filename: 'voice.ogg',
      mimeType: 'audio/ogg',
      size: 1024,
      createdAt: '2026-01-01T00:00:00.000Z',
    }
    expect(record.attachmentId).toBe('att_1')
    expect(record.mimeType).toBe('audio/ogg')
  })

  test('PluginAttachmentRecord allows missing mimeType and size', () => {
    const record: PluginAttachmentRecord = {
      attachmentId: 'att_2',
      filename: 'unknown.bin',
      mimeType: undefined,
      size: undefined,
      createdAt: '2026-01-01T00:00:00.000Z',
    }
    expect(record.mimeType).toBeUndefined()
    expect(record.size).toBeUndefined()
  })

  test('PluginAttachmentFacade.read returns record + bytes', async () => {
    const facade: PluginAttachmentFacade = {
      read: (attachmentId: string) =>
        Promise.resolve({
          record: {
            attachmentId,
            filename: 'a.ogg',
            mimeType: 'audio/ogg',
            size: 3,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
          bytes: Buffer.from('abc'),
        }),
    }
    const result = await facade.read('att_3')
    expect(result.record.attachmentId).toBe('att_3')
    expect(result.bytes.toString()).toBe('abc')
  })
})
