// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { createStagedDownloader } from '../../src/attachments/staged-download.js'
import type { StagedFileDownloadFn } from '../../src/attachments/types.js'

const returnNull = (): Promise<Buffer | null> => Promise.resolve(null)

describe('staged download factory', () => {
  let downloadFn: StagedFileDownloadFn

  describe('telegram provider', () => {
    const mockFetcher = mock<(fileId: string) => Promise<Buffer | null>>((fileId: string) => {
      if (fileId === 'tg_valid') return Promise.resolve(Buffer.from('tg-bytes'))
      return Promise.resolve(null)
    })

    beforeEach(() => {
      mock.restore()
      downloadFn = createStagedDownloader({
        telegramFetcher: mockFetcher,
        mattermostFetcher: returnNull,
      })
    })

    test('delegates to telegramFetcher for telegram source', async () => {
      const result = await downloadFn('tg_valid', 'telegram')
      expect(result).not.toBeNull()
      expect(result!.toString()).toBe('tg-bytes')
      expect(mockFetcher).toHaveBeenCalledWith('tg_valid')
    })

    test('returns null for missing telegram file', async () => {
      const result = await downloadFn('tg_missing', 'telegram')
      expect(result).toBeNull()
    })
  })

  describe('mattermost provider', () => {
    const mockFetcher = mock<(fileId: string) => Promise<Buffer | null>>((fileId: string) => {
      if (fileId === 'mm_valid') return Promise.resolve(Buffer.from('mm-bytes'))
      return Promise.resolve(null)
    })

    beforeEach(() => {
      mock.restore()
      downloadFn = createStagedDownloader({
        telegramFetcher: returnNull,
        mattermostFetcher: mockFetcher,
      })
    })

    test('delegates to mattermostFetcher for mattermost source', async () => {
      const result = await downloadFn('mm_valid', 'mattermost')
      expect(result).not.toBeNull()
      expect(result!.toString()).toBe('mm-bytes')
      expect(mockFetcher).toHaveBeenCalledWith('mm_valid')
    })

    test('returns null for missing mattermost file', async () => {
      const result = await downloadFn('mm_missing', 'mattermost')
      expect(result).toBeNull()
    })
  })

  describe('discord provider', () => {
    beforeEach(() => {
      downloadFn = createStagedDownloader({
        telegramFetcher: returnNull,
        mattermostFetcher: returnNull,
      })
    })

    test('returns null for discord (not supported)', async () => {
      const result = await downloadFn('discord_123', 'discord')
      expect(result).toBeNull()
    })
  })

  describe('unknown provider', () => {
    beforeEach(() => {
      downloadFn = createStagedDownloader({
        telegramFetcher: returnNull,
        mattermostFetcher: returnNull,
      })
    })

    test('returns null for unknown provider', async () => {
      const result = await downloadFn('x_123', 'unknown')
      expect(result).toBeNull()
    })
  })
})
