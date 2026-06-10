// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getCachedConfig } from '../cache.js'
import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tools:feature-flags' })

/** Reserved, non-user-visible config key holding the per-context reduction flags JSON. */
export const REDUCTION_FLAGS_CONFIG_KEY = 'tool_context_flags'

export interface ReductionFlags {
  progressiveDisclosure: boolean
  resultCompaction: boolean
  semanticToolRetrieval: boolean
}

const ALL_OFF: ReductionFlags = {
  progressiveDisclosure: false,
  resultCompaction: false,
  semanticToolRetrieval: false,
}

function killSwitchEngaged(): boolean {
  return process.env['TOOL_CONTEXT_REDUCTION_DISABLED'] === 'true'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parse(raw: string | null): ReductionFlags {
  if (raw === null || raw.trim() === '') return { ...ALL_OFF }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return { ...ALL_OFF }
    return {
      progressiveDisclosure: parsed['progressive_disclosure'] === true,
      resultCompaction: parsed['result_compaction'] === true,
      semanticToolRetrieval: parsed['semantic_tool_retrieval'] === true,
    }
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error) }, 'Corrupt reduction flags; all OFF')
    return { ...ALL_OFF }
  }
}

/** Resolve the three reduction flags for a storage context id. Kill switch wins. */
export function resolveReductionFlags(storageContextId: string): ReductionFlags {
  if (killSwitchEngaged()) return { ...ALL_OFF }
  const configContextId = getConfigContextIdFromStorageContextId(storageContextId)
  return parse(getCachedConfig(configContextId, REDUCTION_FLAGS_CONFIG_KEY))
}
