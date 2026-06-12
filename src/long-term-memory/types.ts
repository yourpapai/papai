// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export const MemoryScopeTypeSchema = z.enum(['personal', 'group'])
export type MemoryScopeType = z.infer<typeof MemoryScopeTypeSchema>

export type MemoryScope = Readonly<{
  scopeId: string
  scopeType: MemoryScopeType
}>

export const MemoryKindSchema = z.enum([
  'preference',
  'fact',
  'decision',
  'project_context',
  'person_context',
  'procedure',
  'episode',
  'reference',
])
export type MemoryKind = z.infer<typeof MemoryKindSchema>

export const MemoryStatusSchema = z.enum(['active', 'stale', 'archived', 'contradicted'])
export type MemoryStatus = z.infer<typeof MemoryStatusSchema>

export const MemorySourceSchema = z.enum(['background', 'explicit', 'tool_result', 'admin_edit'])
export type MemorySource = z.infer<typeof MemorySourceSchema>

export type MemoryProfile = MemoryScope &
  Readonly<{
    profile: string
    enabled: boolean
    version: number
    updatedAt: string
  }>

export type MemoryEvidence = Readonly<{
  messageIds?: readonly string[]
  actorIds?: readonly string[]
  timestamps?: readonly string[]
  contextId?: string
}>

export type MemoryRecord = MemoryScope &
  Readonly<{
    id: string
    kind: MemoryKind
    content: string
    summary: string | null
    tags: readonly string[]
    confidence: number
    status: MemoryStatus
    source: MemorySource
    evidence: MemoryEvidence
    createdAt: string
    updatedAt: string
    lastSeenAt: string
    validFrom?: string | null
    validUntil?: string | null
    expiresAt?: string | null
    embedding?: Float32Array | null
  }>

export type MemoryRecordInput = Omit<MemoryRecord, 'embedding'> & Readonly<{ embedding?: Float32Array | null }>
