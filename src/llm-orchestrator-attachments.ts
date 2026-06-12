// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage } from 'ai'

import {
  isS3Configured,
  listActiveAttachments,
  loadAttachmentRecord,
  selectAttachmentsForTurn,
  supportsAttachmentModelInput,
} from './attachments/index.js'
import type { AttachmentRef, StoredAttachment } from './attachments/types.js'
import { transformNewAttachments, type TransformLine } from './plugins/attachment-transform.js'
import { getUserTimezoneOrDefault } from './utils/config-timezone.js'
import { formatCurrentTimeTag } from './utils/current-time-format.js'

type AttachmentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; image: Buffer; mediaType?: string }
  | { type: 'file'; data: Buffer; filename?: string; mediaType: string }

const recordToPart = (record: StoredAttachment): AttachmentPart | null => {
  // Audio bytes never reach the LLM as content parts; transcripts (when a
  // transformer plugin is enabled) reach it as text lines instead.
  if (record.mimeType !== undefined && record.mimeType.startsWith('audio/')) {
    return null
  }
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

const buildTurnLines = (
  selected: readonly AttachmentRef[],
  transforms: ReadonlyMap<string, TransformLine>,
): { liveLines: string[]; historyLines: string[] } => {
  const liveLines: string[] = []
  const historyLines: string[] = []
  for (const ref of selected) {
    const transformed = transforms.get(ref.attachmentId)
    if (transformed === undefined) {
      const line = `[User attached ${ref.attachmentId}: ${ref.filename}]`
      liveLines.push(line)
      historyLines.push(line)
    } else {
      liveLines.push(transformed.line)
      historyLines.push(transformed.historyLine)
    }
  }
  return { liveLines, historyLines }
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

  if (selected.length === 0) return textOnly()

  const records = await loadAttachmentRecords(contextId, selected)
  const newIds = new Set(newAttachmentIds)
  const newRecords = records.filter((record) => newIds.has(record.attachmentId))
  const transforms = await transformNewAttachments(contextId, chatUserId, newRecords)

  const { liveLines, historyLines } = buildTurnLines(selected, transforms)

  const liveContent = `${timeTag}\n${liveLines.join('\n')}\n\n${text}`
  const historyContent = `${timeTag}\n${historyLines.join('\n')}\n\n${text}`
  const historyMessage: ModelMessage = { role: 'user', content: historyContent }

  if (supportsAttachmentModelInput(modelName)) {
    const parts: AttachmentPart[] = []
    for (const record of records) {
      const part = recordToPart(record)
      if (part !== null) parts.push(part)
    }
    parts.push({ type: 'text', text: liveContent })
    return { modelMessage: { role: 'user', content: parts } as ModelMessage, historyMessage }
  }

  return { modelMessage: { role: 'user', content: liveContent } as ModelMessage, historyMessage }
}
