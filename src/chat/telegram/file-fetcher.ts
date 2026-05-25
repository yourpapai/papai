// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { TelegramFileFetcher } from './file-helpers.js'

type TelegramFileApi = {
  getFile: (fileId: string) => Promise<{ file_path?: string }>
}

type TelegramFileLogger = {
  warn: (metadata: Record<string, unknown>, message: string) => void
  error: (metadata: Record<string, unknown>, message: string) => void
}

export const createTelegramFileFetcher = (
  api: TelegramFileApi,
  token: string,
  log: TelegramFileLogger,
): TelegramFileFetcher => {
  const fetcher: TelegramFileFetcher = async (fileId: string): Promise<Buffer | null> => {
    try {
      const fileInfo = await api.getFile(fileId)
      if (fileInfo.file_path === undefined) return null
      const url = `https://api.telegram.org/file/bot${token}/${fileInfo.file_path}`
      const response = await fetch(url)
      if (!response.ok) {
        log.warn({ fileId, status: response.status }, 'Telegram file download failed')
        return null
      }
      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      log.error({ fileId, error: errMsg }, 'Failed to fetch Telegram file')
      return null
    }
  }
  return fetcher
}
