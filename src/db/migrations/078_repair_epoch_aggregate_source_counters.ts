// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'db:migrations:078' })

// The live aggregate lane wrote per-epoch contribution rows without the
// matching opportunity/aggregate_only source counters (fixed in the writer for
// new writes), so every closed epoch with aggregate activity reconciled to a
// permanent unexplained delta. Rebuild the deficit from the contribution cell
// keys (first segment is the UTC day). The 'chat' family matches the live
// writer's AGGREGATE_LANE_SOURCE_FAMILY convention; epochs never span builds,
// so a closed epoch is either fully repaired (deficit > 0) or already intact.
const repairEpochAggregateSourceCounters = (db: Database): void => {
  const closedEpochs = db
    .query<{ epoch_id: string }, []>(`SELECT epoch_id FROM analytics_process_epochs WHERE state = 'closed'`)
    .all()
  let repaired = 0
  for (const { epoch_id: epochId } of closedEpochs) {
    const contributions = db
      .query<{ aggregate_cell_key: string; counter_delta: number; sample_count_delta: number }, [string]>(
        `SELECT aggregate_cell_key, counter_delta, sample_count_delta
         FROM analytics_aggregate_epoch_contributions WHERE epoch_id = ?`,
      )
      .all(epochId)
    if (contributions.length === 0) continue
    const expectedByDay = new Map<string, number>()
    for (const row of contributions) {
      const day = row.aggregate_cell_key.split('|', 1)[0]
      if (day === undefined || day.length === 0) continue
      expectedByDay.set(day, (expectedByDay.get(day) ?? 0) + row.counter_delta + row.sample_count_delta)
    }
    let touched = false
    for (const [day, expected] of expectedByDay) {
      for (const disposition of ['opportunity', 'aggregate_only'] as const) {
        const existing = db
          .query<{ value: number }, [string, string, string]>(
            `SELECT value FROM analytics_epoch_source_counters
             WHERE epoch_id = ? AND utc_day = ? AND source_family = 'chat' AND disposition = ?`,
          )
          .get(epochId, day, disposition)
        const deficit = expected - (existing?.value ?? 0)
        if (deficit <= 0) continue
        db.run(
          `INSERT INTO analytics_epoch_source_counters (epoch_id, utc_day, source_family, disposition, value)
           VALUES (?, ?, 'chat', ?, ?)
           ON CONFLICT(epoch_id, utc_day, source_family, disposition) DO UPDATE SET value = value + excluded.value`,
          [epochId, day, disposition, deficit],
        )
        touched = true
      }
    }
    if (touched) repaired += 1
  }
  if (repaired > 0) log.info({ repaired }, 'rebuilt epoch aggregate source counters from contributions')
}

const up = (db: Database): void => {
  repairEpochAggregateSourceCounters(db)
}

export const migration078RepairEpochAggregateSourceCounters: Migration = {
  id: '078_repair_epoch_aggregate_source_counters',
  up,
}

export default migration078RepairEpochAggregateSourceCounters
