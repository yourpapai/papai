// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage } from 'ai'

import {
  isS3Configured,
  listActiveAttachments,
  loadAttachmentRecord,
  renderAttachedLine,
  selectAttachmentsForTurn,
  supportsAttachmentModelInput,
} from './attachments/index.js'
import type { AttachmentRef, StoredAttachment } from './attachments/types.js'
import { getConfigContextIdFromStorageContextId } from './chat/scoped-context.js'
import type { MessageSegment, PapaiTurnMeta } from './message-edit/segments.js'
import { hasContextTransformers, transformNewAttachments, type TransformLine } from './plugins/attachment-transform.js'
import { getUserTimezoneOrDefault } from './utils/config-timezone.js'
import { formatCurrentTimeTag } from './utils/current-time-format.js'

type AttachmentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; image: Buffer; mediaType?: string }
  | { type: 'file'; data: Buffer; filename?: string; mediaType: string }

/**
 * Build the `providerOptions.papai` block for a user turn, or `undefined` when
 * there are no segments (legacy/no messageIds). Returning `undefined` lets the
 * caller omit the property entirely, so `applyEditToHistory` cleanly no-ops on
 * pre-feature history. Arrays are copied as mutable so the result satisfies the
 * AI SDK's `SharedV4ProviderOptions` (JSONObject) shape.
 */
const buildPapaiMeta = (
  segments: readonly MessageSegment[],
  opts: { isThread: boolean; isDm: boolean },
): PapaiTurnMeta | undefined => {
  if (segments.length === 0) return undefined
  return {
    messageIds: segments.map((s) => s.messageId),
    segments: segments.map((s) => ({ ...s })),
    isThread: opts.isThread,
    isDm: opts.isDm,
  }
}

/**
 * Attach `providerOptions.papai` (when defined) to a user `historyMessage`.
 * Returns a new message rather than mutating; `providerOptions` is merged
 * with any caller-supplied options.
 */
const withPapaiMeta = (msg: ModelMessage, meta: PapaiTurnMeta | undefined): ModelMessage => {
  if (meta === undefined) return msg
  return {
    ...msg,
    providerOptions: { ...msg.providerOptions, papai: meta },
  } as ModelMessage
}

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
      const line = renderAttachedLine(ref.attachmentId, ref.filename)
      liveLines.push(line)
      historyLines.push(line)
    } else {
      liveLines.push(transformed.line)
      historyLines.push(transformed.historyLine)
    }
  }
  return { liveLines, historyLines }
}

// \n\n intentionally separates attachment lines from the user's text so the
// LLM clearly sees them as structured metadata rather than inline prose.
const formatTurnContent = (timeTag: string, lines: string[], text: string): string =>
  `${timeTag}\n${lines.join('\n')}\n\n${text}`

const buildFullPathMessages = async (
  contextId: string,
  chatUserId: string,
  modelName: string,
  timeTag: string,
  text: string,
  selected: readonly AttachmentRef[],
  newAttachmentIds: readonly string[],
  papaiMeta: PapaiTurnMeta | undefined,
): Promise<{ modelMessage: ModelMessage; historyMessage: ModelMessage }> => {
  const records = await loadAttachmentRecords(contextId, selected)
  const newIds = new Set(newAttachmentIds)
  // Dispatch over new records PLUS any selected voice-origin record (carry-over).
  // A voice attachment mentioned by id in a later turn (newAttachmentIds=[]) would
  // otherwise render as a plain [User attached …] line even though the plugin's KV
  // cache holds its transcript. The transformer is cache-first, so carry-over cache
  // hits are free; an expired-cache carry-over re-transcribes, which is the desired
  // deterministic behaviour.
  const transformable = records.filter((record) => newIds.has(record.attachmentId) || record.origin === 'voice')
  const transforms = await transformNewAttachments(contextId, chatUserId, transformable)
  const { liveLines, historyLines } = buildTurnLines(selected, transforms)
  const liveContent = formatTurnContent(timeTag, liveLines, text)
  const historyContent = formatTurnContent(timeTag, historyLines, text)
  const historyMessage: ModelMessage = { role: 'user', content: historyContent }
  if (supportsAttachmentModelInput(modelName)) {
    const parts: AttachmentPart[] = []
    for (const record of records) {
      const part = recordToPart(record)
      if (part !== null) parts.push(part)
    }
    parts.push({ type: 'text', text: liveContent })
    return {
      modelMessage: { role: 'user', content: parts } as ModelMessage,
      historyMessage: withPapaiMeta(historyMessage, papaiMeta),
    }
  }
  return {
    modelMessage: { role: 'user', content: liveContent } as ModelMessage,
    historyMessage: withPapaiMeta(historyMessage, papaiMeta),
  }
}

export const buildUserTurnMessages = (
  contextId: string,
  chatUserId: string,
  modelName: string,
  text: string,
  newAttachmentIds: readonly string[],
  segments: readonly MessageSegment[] = [],
  contextOpts: { isThread: boolean; isDm: boolean } = { isThread: false, isDm: true },
): Promise<{ modelMessage: ModelMessage; historyMessage: ModelMessage }> => {
  const papaiMeta = buildPapaiMeta(segments, contextOpts)
  // Timezone is stored under the (thread-stripped) config-context id, not the raw chatUserId.
  // `contextId` here is the thread-scoped storageContextId, so strip it to the config-context id
  // before the lookup (DM: no-op; group thread: drops the :thread: suffix).
  const configContextId = getConfigContextIdFromStorageContextId(contextId)
  const timeTag = formatCurrentTimeTag(new Date(), getUserTimezoneOrDefault(configContextId))
  const prefixedText = `${timeTag}\n${text}`
  const textOnly = {
    modelMessage: { role: 'user', content: prefixedText } as ModelMessage,
    historyMessage: withPapaiMeta({ role: 'user', content: prefixedText } as ModelMessage, papaiMeta),
  }
  if (!isS3Configured()) return Promise.resolve(textOnly)
  const activeAttachments = listActiveAttachments(contextId)
  const selected = selectAttachmentsForTurn({ text, newAttachmentIds, activeAttachments })
  if (selected.length === 0) return Promise.resolve(textOnly)
  // Fast path: text-only models with no active transformers need no blob reads.
  // Pass-through lines are built directly from the selected refs.
  // Note: hasContextTransformers walks the plugin registry here, and transformNewAttachments
  // (called via buildFullPathMessages) walks it again. The duplicate walk only occurs when
  // the model is text-only AND transformers are registered — a rare configuration — so the
  // cost is negligible and restructuring to pass through a pre-collected list is not warranted.
  if (!supportsAttachmentModelInput(modelName) && !hasContextTransformers(contextId)) {
    const { liveLines, historyLines } = buildTurnLines(selected, new Map())
    return Promise.resolve({
      modelMessage: { role: 'user', content: formatTurnContent(timeTag, liveLines, text) } as ModelMessage,
      historyMessage: withPapaiMeta(
        { role: 'user', content: formatTurnContent(timeTag, historyLines, text) } as ModelMessage,
        papaiMeta,
      ),
    })
  }
  return buildFullPathMessages(contextId, chatUserId, modelName, timeTag, text, selected, newAttachmentIds, papaiMeta)
}
