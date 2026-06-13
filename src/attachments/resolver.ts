// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AttachmentRef } from './types.js'

const MULTIMODAL_MODEL_PREFIXES = [
  'gpt-4o',
  'gpt-4.1',
  'gpt-5',
  'claude-3',
  'claude-sonnet-4',
  'claude-opus-4',
  'claude-haiku-4',
  'gemini-1.5',
  'gemini-2',
] as const

export function supportsAttachmentModelInput(modelName: string): boolean {
  return MULTIMODAL_MODEL_PREFIXES.some((prefix) => modelName.startsWith(prefix))
}

const renderRef = (attachment: AttachmentRef): string => {
  const meta: string[] = []
  if (attachment.mimeType !== undefined) meta.push(attachment.mimeType)
  if (attachment.size !== undefined) meta.push(`${attachment.size} bytes`)
  const suffix = meta.length === 0 ? '' : ` (${meta.join(', ')})`
  return `${attachment.attachmentId} ${attachment.filename}${suffix}`
}

export function buildAttachmentManifest(attachments: readonly AttachmentRef[]): string | null {
  if (attachments.length === 0) return null
  return `[Available attachments: ${attachments.map(renderRef).join('; ')}]`
}

const ATTACHMENT_ID_RE = /\batt_[a-z0-9-]+\b/giu

export function selectAttachmentsForTurn(params: {
  text: string
  newAttachmentIds: readonly string[]
  activeAttachments: readonly AttachmentRef[]
}): AttachmentRef[] {
  const mentioned = new Set<string>()
  const matches = params.text.matchAll(ATTACHMENT_ID_RE)
  for (const match of matches) mentioned.add(match[0])
  const selectedIds = new Set<string>([...params.newAttachmentIds, ...mentioned])
  return params.activeAttachments.filter((attachment) => selectedIds.has(attachment.attachmentId))
}

// Untrusted text must not be able to fabricate or close bracket tokens; the
// LLM treats [...] lines as core-owned structure.
export const sanitizeForBracket = (s: string): string =>
  s.replaceAll('[', '(').replaceAll(']', ')').replaceAll('"', "'")

export const renderAttachedLine = (attachmentId: string, filename: string): string =>
  `[User attached ${attachmentId}: ${sanitizeForBracket(filename)}]`
