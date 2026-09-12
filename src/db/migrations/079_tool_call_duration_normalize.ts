// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:079' })

// The usage emission (tool:execute_end -> recordToolCall) passed the raw
// performance.now() delta through, storing REAL-typed fractional duration_ms
// values in an INTEGER column (fixed at the emission site for new writes).
// Normalize existing values once: round REALs, clamp negatives to zero.
// Idempotent by the WHERE clause; leaves NULL and already-valid integers alone.
const up = (db: Database): void => {
  db.run(`
    UPDATE tool_call_events
    SET duration_ms = max(0, CAST(round(duration_ms) AS INTEGER))
    WHERE duration_ms IS NOT NULL
      AND (typeof(duration_ms) != 'integer' OR duration_ms < 0)
  `)
  log.info('migration 079: normalized tool_call_events duration_ms to non-negative integers')
}

export const migration079ToolCallDurationNormalize: Migration = {
  id: '079_tool_call_duration_normalize',
  up,
}

export default migration079ToolCallDurationNormalize
