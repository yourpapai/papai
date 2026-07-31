// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { logger } from '../../logger.js'
import { findWithdrawnActorCensors } from '../derive/facts.js'
import { upsertCensorIntervals } from '../derive/write.js'
import type { RekeyCutoverFence } from '../rekey/cutover-fence.js'

const log = logger.child({ component: 'analytics-censor-maturity-job' })

export type CensorMaturityDeps = Readonly<{
  getDrizzleDb: typeof defaultGetDrizzleDb
  fence?: RekeyCutoverFence
}>

/**
 * Daily censor-maturity sweep. Admits to the cutover fence as the derive
 * writer class; a held fence skips the sweep entirely (zero rows written).
 */
export const runCensorMaturitySweep = (deps: CensorMaturityDeps): number => {
  const admission = deps.fence?.admit('derive')
  if (deps.fence !== undefined && admission === null) {
    log.warn('censor maturity sweep skipped: the cutover fence is held')
    return 0
  }
  try {
    const db = deps.getDrizzleDb()
    return upsertCensorIntervals(db, findWithdrawnActorCensors(db))
  } finally {
    admission?.release()
  }
}
