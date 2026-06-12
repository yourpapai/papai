// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { JSONValue } from 'ai'

export interface CompactedEnvelope {
  [key: string]: JSONValue | undefined
  _compacted: true
  handle: string
  summary: string | null
  totalBytes: number
  preview: string
  hint: string
}

export interface CompactionContext {
  storageContextId: string
  /** Latest user message text, used to make summaries query-aware. */
  userIntent: string
  enabled: boolean
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function isCompactedEnvelope(value: unknown): value is CompactedEnvelope {
  return (
    isRecord(value) &&
    '_compacted' in value &&
    value['_compacted'] === true &&
    'handle' in value &&
    typeof value['handle'] === 'string' &&
    value['handle'].length > 0
  )
}
