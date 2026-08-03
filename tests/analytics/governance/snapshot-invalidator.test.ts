// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { createSnapshotInvalidator } from '../../../src/analytics/governance/snapshot-invalidator.js'
import {
  stageSnapshotPublication,
  promoteStagedSnapshot,
} from '../../../src/analytics/governance/snapshot-publication-store.js'
import * as schema from '../../../src/db/schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const T = 1_800_000_000_000

const publish = (db: Db, snapshotId: string, storageGeneration: string): void => {
  const deps = { getDrizzleDb: (): Db => db }
  stageSnapshotPublication(
    { snapshotId, storageGeneration, pathHash: `h-${snapshotId}`, sourceHighWater: 'hw-1', nowMs: T },
    deps,
  )
  promoteStagedSnapshot({ snapshotId, nowMs: T }, deps)
}

describe('snapshot invalidator port', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
  })

  test('subject deletion unpublishes every published snapshot and reports none remain', () => {
    publish(db, 'snap-1', 'gen-1')
    const invalidator = createSnapshotInvalidator({ getDrizzleDb: (): Db => db })
    const result = invalidator({ reason: 'subject_deletion', nowMs: T + 1 })
    expect(result.unpublishedSnapshotIds).toEqual(['snap-1'])
    expect(result.publishedSnapshotContainsContribution).toBe(false)
    const rows = db.select().from(schema.analyticsSnapshotPublications).all()
    expect(rows[0]?.state).toBe('invalidated')
    expect(rows[0]?.invalidatedAt).toBe(T + 1)
  })

  test('generation transitions unpublish only the named generation', () => {
    publish(db, 'snap-old', 'gen-1')
    stageSnapshotPublication(
      { snapshotId: 'snap-new', storageGeneration: 'gen-2', pathHash: 'h-new', sourceHighWater: 'hw-2', nowMs: T },
      { getDrizzleDb: (): Db => db },
    )
    const invalidator = createSnapshotInvalidator({ getDrizzleDb: (): Db => db })
    const result = invalidator({
      reason: 'generation_transition',
      storageGeneration: 'gen-1',
      transitionRunId: 'run-1',
      nowMs: T + 2,
    })
    expect(result.unpublishedSnapshotIds).toEqual(['snap-old'])
    expect(result.publishedSnapshotContainsContribution).toBe(false)
    const rows = db.select().from(schema.analyticsSnapshotPublications).all()
    expect(rows.find((row) => row.snapshotId === 'snap-new')?.state).toBe('staged')
  })

  test('a staged-but-unpublished snapshot still counts as containing the contribution', () => {
    stageSnapshotPublication(
      { snapshotId: 'snap-staged', storageGeneration: 'gen-1', pathHash: 'h-s', sourceHighWater: 'hw-1', nowMs: T },
      { getDrizzleDb: (): Db => db },
    )
    const invalidator = createSnapshotInvalidator({ getDrizzleDb: (): Db => db })
    const result = invalidator({ reason: 'subject_deletion', nowMs: T + 3 })
    expect(result.publishedSnapshotContainsContribution).toBe(false)
    expect(result.unpublishedSnapshotIds).toEqual([])
  })

  test('no publications: nothing to unpublish, completion allowed', () => {
    const invalidator = createSnapshotInvalidator({ getDrizzleDb: (): Db => db })
    const result = invalidator({ reason: 'subject_deletion', nowMs: T })
    expect(result.unpublishedSnapshotIds).toEqual([])
    expect(result.publishedSnapshotContainsContribution).toBe(false)
  })
})
