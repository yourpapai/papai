// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomUUID } from 'node:crypto'

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import type { ContextType } from '../chat/types.js'
import { logger } from '../logger.js'
import { runRecallCascade, type RecallHit } from '../long-term-memory/recall-cascade.js'
import { resolveMemoryScope } from '../long-term-memory/scope.js'
import {
  archiveMemoryRecord,
  listMemoryRecords,
  saveMemoryRecord,
  searchMemoryRecords,
} from '../long-term-memory/store.js'
import { MemoryKindSchema, MemoryStatusSchema, type MemoryRecord, type MemoryScope } from '../long-term-memory/types.js'

const log = logger.child({ scope: 'tool:memory' })

export type MemoryToolContext = Readonly<{
  storageContextId: string
  contextType: Extract<ContextType, 'dm' | 'group'>
}>

const tagsSchema = z
  .array(z.string().min(1).max(40))
  .max(10)
  .default([])
  .describe('Optional short tags for grouping the memory')

const optionalKindSchema = MemoryKindSchema.optional().describe('Optional memory kind filter')

const limitSchema = z.number().int().min(1).max(50).optional().describe('Maximum number of memory records to return')

type PublicMemoryRecord = Readonly<{
  id: string
  kind: MemoryRecord['kind']
  content: string
  summary: string | null
  tags: readonly string[]
  confidence: number
  status: MemoryRecord['status']
  source: MemoryRecord['source']
  createdAt: string
  updatedAt: string
  lastSeenAt: string
  expiresAt?: string | null
}>

const toPublicRecord = (record: MemoryRecord): PublicMemoryRecord => ({
  id: record.id,
  kind: record.kind,
  content: record.content,
  summary: record.summary,
  tags: record.tags,
  confidence: record.confidence,
  status: record.status,
  source: record.source,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  lastSeenAt: record.lastSeenAt,
  expiresAt: record.expiresAt,
})

type PublicHit = PublicMemoryRecord & Readonly<{ provenance: RecallHit['provenance'] }>

const toPublicHit = (hit: RecallHit): PublicHit => ({ ...toPublicRecord(hit), provenance: hit.provenance })

const memoryScope = (context: MemoryToolContext): MemoryScope =>
  resolveMemoryScope({ storageContextId: context.storageContextId, contextType: context.contextType })

const nowIso = (): string => new Date().toISOString()

const sameText = (left: string, right: string): boolean =>
  left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase()

export function makeRememberMemoryTool(input: MemoryToolContext): ToolSet[string] {
  return tool({
    description:
      'Store explicit long-term memory for the current user or group. Use only when the user asks to remember durable information.',
    inputSchema: z.object({
      content: z.string().min(3).max(2000).describe('Durable memory content to store'),
      kind: MemoryKindSchema.describe('Category that best describes the memory'),
      tags: tagsSchema.optional(),
      expiresAt: z.iso.datetime().optional().describe('Optional ISO timestamp when this memory should expire'),
    }),
    execute: ({ content, kind, tags, expiresAt }) => {
      const scope = memoryScope(input)
      const now = nowIso()
      const record = saveMemoryRecord({
        id: randomUUID(),
        ...scope,
        kind,
        content,
        summary: null,
        tags: tags ?? [],
        confidence: 1,
        status: 'active',
        source: 'explicit',
        evidence: { contextId: input.storageContextId },
        createdAt: now,
        updatedAt: now,
        lastSeenAt: now,
        expiresAt: expiresAt ?? null,
      })
      log.info(
        { scopeId: scope.scopeId, scopeType: scope.scopeType, memoryId: record.id, kind },
        'Memory saved via tool',
      )
      return { status: 'saved', id: record.id, kind: record.kind }
    },
  })
}

export function makeSearchMemoryTool(input: MemoryToolContext): ToolSet[string] {
  return tool({
    description:
      'Search everything known in this conversation, the shared group memory, and other conversations (priority-ordered), by keyword or meaning. Optionally filter by kind or include stale memories.',
    inputSchema: z.object({
      query: z.string().min(1).max(500).describe('What to search for in memory'),
      include_stale: z.boolean().optional().describe('Include stale memories in addition to active memories'),
      kind: optionalKindSchema,
      limit: limitSchema,
    }),
    execute: async ({ query, include_stale: includeStale, kind, limit }) => {
      const configContextId = getConfigContextIdFromStorageContextId(input.storageContextId)
      const { records } = await runRecallCascade({
        storageContextId: input.storageContextId,
        configContextId,
        contextType: input.contextType,
        query,
        limit,
        kind,
        includeStale: includeStale ?? false,
      })
      log.debug(
        { storageContextId: input.storageContextId, kind, limit, count: records.length },
        'Memory searched via tool',
      )
      return { records: records.map(toPublicHit) }
    },
  })
}

export function makeListMemoryTool(input: MemoryToolContext): ToolSet[string] {
  return tool({
    description: 'List long-term memory records in the current user or group scope.',
    inputSchema: z.object({
      kind: optionalKindSchema,
      status: MemoryStatusSchema.optional().describe('Memory status to list; defaults to active'),
      limit: limitSchema,
    }),
    execute: ({ kind, status, limit }) => {
      const scope = memoryScope(input)
      const resolvedStatus = status ?? 'active'
      const records = listMemoryRecords({ ...scope, kind, status: resolvedStatus, limit }).map(toPublicRecord)
      log.debug(
        {
          scopeId: scope.scopeId,
          scopeType: scope.scopeType,
          kind,
          status: resolvedStatus,
          limit,
          count: records.length,
        },
        'Memory listed via tool',
      )
      return { records }
    },
  })
}

export function makeForgetMemoryTool(input: MemoryToolContext): ToolSet[string] {
  return tool({
    description: 'Archive one long-term memory in the current user or group scope by memory ID or keyword query.',
    inputSchema: z.object({
      memory_id: z.string().max(128).optional().describe('Exact memory record ID to archive'),
      query: z.string().min(1).max(500).optional().describe('Keyword query used when memory_id is not available'),
    }),
    execute: ({ memory_id: memoryId, query }) => {
      const scope = memoryScope(input)
      const now = nowIso()
      if (memoryId !== undefined) {
        const archived = archiveMemoryRecord(scope, memoryId, now)
        log.info(
          { scopeId: scope.scopeId, scopeType: scope.scopeType, memoryId, archived },
          'Memory archive by ID requested via tool',
        )
        return archived ? { status: 'forgotten', id: memoryId } : { status: 'not_found' }
      }
      if (query === undefined) return { status: 'not_found' }

      const matches = searchMemoryRecords({ ...scope, query, includeStale: true })
      const match = matches.find((record) => sameText(record.content, query)) ?? matches[0]
      if (match === undefined) {
        log.info({ scopeId: scope.scopeId, scopeType: scope.scopeType }, 'Memory archive by query found no match')
        return { status: 'not_found' }
      }

      const archived = archiveMemoryRecord(scope, match.id, now)
      log.info(
        { scopeId: scope.scopeId, scopeType: scope.scopeType, memoryId: match.id, archived },
        'Memory archive by query requested via tool',
      )
      return archived ? { status: 'forgotten', id: match.id } : { status: 'not_found' }
    },
  })
}
