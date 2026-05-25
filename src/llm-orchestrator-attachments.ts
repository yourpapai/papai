// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage } from 'ai'

import {
  buildHistoryAttachmentLines,
  isS3Configured,
  listActiveAttachments,
  loadAttachmentRecord,
  selectAttachmentsForTurn,
  supportsAttachmentModelInput,
} from './attachments/index.js'
import type { AttachmentRef, StoredAttachment } from './attachments/types.js'
import { getUserTimezoneOrDefault } from './utils/config-timezone.js'
import { formatCurrentTimeTag } from './utils/current-time-format.js'

type AttachmentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; image: Buffer; mediaType?: string }
  | { type: 'file'; data: Buffer; filename?: string; mediaType: string }

const recordToPart = (record: StoredAttachment): AttachmentPart | null => {
  if (record.mimeType !== undefined && record.mimeType.startsWith('image/')) {
    return { type: 'image', image: record.content, mediaType: record.mimeType }
  }
  if (record.mimeType !== undefined && record.mimeType !== '') {
    const part: AttachmentPart = { type: 'file', data: record.content, mediaType: record.mimeType }
    if (record.filename !== '') (part as { filename?: string }).filename = record.filename
    return part
  }
  return null
}

const loadAttachmentRecords = async (
  contextId: string,
  attachments: readonly AttachmentRef[],
): Promise<StoredAttachment[]> => {
  const loaded = await Promise.all(attachments.map((ref) => loadAttachmentRecord(contextId, ref.attachmentId)))
  const out: StoredAttachment[] = []
  for (const record of loaded) {
    if (record !== null) out.push(record)
  }
  return out
}

export const buildUserTurnMessages = async (
  contextId: string,
  chatUserId: string,
  modelName: string,
  text: string,
  newAttachmentIds: readonly string[],
): Promise<{ modelMessage: ModelMessage; historyMessage: ModelMessage }> => {
  const timeTag = formatCurrentTimeTag(new Date(), getUserTimezoneOrDefault(chatUserId))
  const prefixedText = `${timeTag}\n${text}`

  const textOnly = (): { modelMessage: ModelMessage; historyMessage: ModelMessage } => ({
    modelMessage: { role: 'user', content: prefixedText } as ModelMessage,
    historyMessage: { role: 'user', content: prefixedText } as ModelMessage,
  })

  if (!isS3Configured()) return textOnly()

  const activeAttachments = listActiveAttachments(contextId)
  const selected = selectAttachmentsForTurn({ text, newAttachmentIds, activeAttachments })

  const historyLines = buildHistoryAttachmentLines(selected)
  const historyContent = historyLines.length === 0 ? prefixedText : `${timeTag}\n${historyLines.join('\n')}\n\n${text}`
  const historyMessage: ModelMessage = { role: 'user', content: historyContent }

  if (selected.length === 0 || !supportsAttachmentModelInput(modelName)) {
    return { modelMessage: historyMessage, historyMessage }
  }

  const records = await loadAttachmentRecords(contextId, selected)
  const parts: AttachmentPart[] = []
  for (const record of records) {
    const part = recordToPart(record)
    if (part !== null) parts.push(part)
  }
  parts.push({ type: 'text', text: prefixedText })

  return { modelMessage: { role: 'user', content: parts } as ModelMessage, historyMessage }
}
