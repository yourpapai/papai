// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { MemoryProfileRow, MemoryRecordRow } from '../db/schema.js'
import type { MemoryEvidence, MemoryProfile, MemoryRecord } from './types.js'

export const parseTags = (json: string): readonly string[] => {
  try {
    const parsed: unknown = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string') : []
  } catch {
    return []
  }
}

export const parseEvidence = (json: string): MemoryEvidence => {
  try {
    const parsed: unknown = JSON.parse(json)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as MemoryEvidence
  } catch {
    return {}
  }
}

export const sanitizeFtsQuery = (query: string): string => `"${query.replace(/"/gu, '""')}"`

export const serializeEmbedding = (embedding: Float32Array | null | undefined): Buffer | null =>
  embedding === null || embedding === undefined
    ? null
    : Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength)

const copyViewBuffer = (view: ArrayBufferView): ArrayBuffer => {
  const copy = new Uint8Array(view.byteLength)
  copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
  return copy.buffer
}

export const deserializeEmbedding = (embedding: MemoryRecordRow['embedding']): Float32Array | null => {
  if (embedding === null) return null
  if (embedding instanceof ArrayBuffer) return new Float32Array(embedding.slice(0))
  if (ArrayBuffer.isView(embedding)) return new Float32Array(copyViewBuffer(embedding))
  return null
}

export const rowToProfile = (row: MemoryProfileRow): MemoryProfile => ({
  scopeId: row.scopeId,
  scopeType: row.scopeType,
  profile: row.profile,
  enabled: row.enabled,
  version: row.version,
  updatedAt: row.updatedAt,
})

export const rowToRecord = (row: MemoryRecordRow): MemoryRecord => ({
  id: row.id,
  scopeId: row.scopeId,
  scopeType: row.scopeType,
  kind: row.kind,
  content: row.content,
  summary: row.summary,
  tags: parseTags(row.tags),
  confidence: row.confidence,
  status: row.status,
  source: row.source,
  evidence: parseEvidence(row.evidence),
  threadContextId: row.threadContextId ?? null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  lastSeenAt: row.lastSeenAt,
  validFrom: row.validFrom,
  validUntil: row.validUntil,
  expiresAt: row.expiresAt,
  embedding: deserializeEmbedding(row.embedding),
})
