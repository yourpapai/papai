// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { sql } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { analyticsNormalizationRejections } from '../../db/schema.js'
import { logger } from '../../logger.js'

const log = logger.child({ scope: 'analytics:storage:rejection-store' })

export type RejectionStoreDeps = Readonly<{ getDrizzleDb: typeof defaultGetDrizzleDb }>

export const incrementNormalizationRejection = (
  input: { utcDay: string; sourceEventType: string; reason: string; count?: number },
  deps: RejectionStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): void => {
  const db = deps.getDrizzleDb()
  const count = input.count ?? 1
  db.insert(analyticsNormalizationRejections)
    .values({
      utcDay: input.utcDay,
      sourceEventType: input.sourceEventType,
      reason: input.reason,
      count,
    })
    .onConflictDoUpdate({
      target: [
        analyticsNormalizationRejections.utcDay,
        analyticsNormalizationRejections.sourceEventType,
        analyticsNormalizationRejections.reason,
      ],
      set: { count: sql`${analyticsNormalizationRejections.count} + ${count}` },
    })
    .run()
  log.debug({ ...input, count }, 'normalization rejection recorded')
}
