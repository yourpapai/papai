// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { isToolFailureResult } from '../../tool-failure.js'
import { COMPACTION_THRESHOLD_BYTES } from './constants.js'
import { isCompactedEnvelope } from './types.js'

export type CompactionDecision = { compact: false } | { compact: true; serialized: string; totalBytes: number }

export function evaluateForCompaction(result: unknown): CompactionDecision {
  if (result === undefined || result === null) return { compact: false }
  if (isToolFailureResult(result)) return { compact: false }
  if (isCompactedEnvelope(result)) return { compact: false }
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(result)
  } catch {
    return { compact: false }
  }
  if (serialized === undefined) return { compact: false }
  const totalBytes = Buffer.byteLength(serialized, 'utf8')
  if (totalBytes <= COMPACTION_THRESHOLD_BYTES) return { compact: false }
  return { compact: true, serialized, totalBytes }
}
