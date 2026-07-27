// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { SnapshotConsumerClient } from './snapshot-consumer.js'

const log = logger.child({ scope: 'analytics:governance:snapshot-file-consumer' })

/**
 * File-bound BI consumer: a pool of read-only SQLite connections over
 * immutable snapshot files. Mirrors the Metabase contract — pooled/file-bound
 * connections must be closed before an old inode can be unlinked, and a
 * pointer switch without close leaves the old handle open.
 */
export const createFileBoundConsumer = (): SnapshotConsumerClient => {
  const pool = new Map<string, Database>()
  let configuredPath: string | null = null
  let quiesced = false
  const closeAll = (): void => {
    for (const db of pool.values()) db.close()
    pool.clear()
  }
  return {
    quiesce: () => {
      quiesced = true
    },
    closeAll,
    configure: (path) => {
      configuredPath = path
    },
    reopen: () => {
      if (configuredPath === null || pool.has(configuredPath)) return
      pool.set(configuredPath, new Database(configuredPath, { readonly: true }))
    },
    currentSnapshotId: () => {
      if (configuredPath === null) return null
      const db = pool.get(configuredPath)
      if (db === undefined) return null
      const row = db
        .query<{ snapshot_id: string }, []>(`SELECT snapshot_id FROM snapshot_meta WHERE singleton_id = 1`)
        .get()
      return row?.snapshot_id ?? null
    },
    contributionOf: (marker) => {
      if (configuredPath === null) return 0
      const db = pool.get(configuredPath)
      if (db === undefined) return 0
      const row = db
        .query<{ n: number }, [string]>(`SELECT COUNT(*) AS n FROM curated_events WHERE actor_key = ?`)
        .get(marker)
      return row?.n ?? 0
    },
    hasOpenHandle: (path) => pool.has(path),
    resume: () => {
      quiesced = false
      log.info({ quiesced }, 'file-bound consumer resumed')
    },
  }
}
