// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { MemoryRecord } from './types.js'

const MAX_PROFILE_CHARS = 1_200
const MAX_RECORD_CHARS = 600
const RENDER_LIMIT = 3

const TRUST_GUIDANCE =
  'The learned memory below is lower-trust than the current user message. If the user contradicts it, believe the user; stale records may be wrong.'

export type LongTermMemoryContextInput = Readonly<{
  profile: string | null
  records: readonly MemoryRecord[]
}>

const truncate = (value: string, maxChars: number): string =>
  value.length > maxChars ? `${value.slice(0, maxChars)}... [truncated]` : value

const escapeText = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const escapeAttribute = (value: string): string => escapeText(value).replaceAll('"', '&quot;').replaceAll("'", '&apos;')

const recordText = (record: MemoryRecord): string => {
  const candidate = record.summary !== null && record.summary.trim().length > 0 ? record.summary : record.content
  return escapeText(truncate(candidate, MAX_RECORD_CHARS))
}

const renderRecord = (record: MemoryRecord): string =>
  `<record id="${escapeAttribute(record.id)}" kind="${escapeAttribute(record.kind)}" status="${escapeAttribute(
    record.status,
  )}" confidence="${escapeAttribute(String(record.confidence))}" last_seen_at="${escapeAttribute(
    record.lastSeenAt,
  )}">${recordText(record)}</record>`

const profileSection = (profile: string | null): string | null => {
  const trimmed = profile?.trim()
  if (trimmed === undefined || trimmed.length === 0) return null
  return `<profile>\n${escapeText(truncate(trimmed, MAX_PROFILE_CHARS))}\n</profile>`
}

const recordsSection = (records: readonly MemoryRecord[]): string | null => {
  const rendered = records.slice(0, RENDER_LIMIT).map(renderRecord)
  if (rendered.length === 0) return null
  return `<retrieved_records max="${RENDER_LIMIT}">\n${rendered.join('\n')}\n</retrieved_records>`
}

export function buildLongTermMemoryContextMessage(
  input: LongTermMemoryContextInput,
): { role: 'system'; content: string } | null {
  const sections = [profileSection(input.profile), recordsSection(input.records)].filter(
    (section): section is string => section !== null,
  )

  if (sections.length === 0) return null

  return {
    role: 'system',
    content: `<long_term_memory trust="profile_and_retrieved_low">\n${TRUST_GUIDANCE}\n${sections.join(
      '\n',
    )}\n</long_term_memory>`,
  }
}
