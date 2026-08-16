// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createAnalyticsJobHandlers } from '../../../src/analytics/jobs/register-handlers.js'
import { ANALYTICS_JOB_NAMES } from '../../../src/analytics/jobs/register.js'
import type { AnalyticsJobDeps } from '../../../src/analytics/jobs/register.js'
import { createRekeyCutoverFence } from '../../../src/analytics/rekey/cutover-fence.js'
import { analyticsSnapshotPublications } from '../../../src/db/schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'

describe('analytics job handler factory', () => {
  test('builds exactly one handler per registered job name', () => {
    const deps: AnalyticsJobDeps = {
      nowMs: () => 0,
      getDrizzleDb: () => {
        throw new Error('db must not be touched while building handlers')
      },
      lanes: () => ({
        killSwitchActive: true,
        localMode: 'off',
        externalAggregateEnabled: false,
        externalPseudonymousEnabled: false,
      }),
      observer: () => null,
      openEpochId: () => null,
      keyMaterial: () => null,
      snapshotPath: () => null,
    }
    const handlers = createAnalyticsJobHandlers(deps)
    expect(Object.keys(handlers).sort()).toEqual([...ANALYTICS_JOB_NAMES].sort())
  })
})

describe('analytics snapshot handler', () => {
  let workDir = ''

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'papai-snapshot-handler-'))
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  test('stages then promotes the ordinary publication to published', async () => {
    const db = await setupTestDb()
    db.$client.run(
      `INSERT INTO analytics_process_epochs (epoch_id, state, started_at_ms, closed_at_ms) VALUES ('epoch-1', 'closed', 0, 1)`,
    )
    db.$client.run(
      `INSERT INTO analytics_epoch_source_counters (epoch_id, utc_day, source_family, disposition, value)
       VALUES ('epoch-1', '2023-11-14', 'chat', 'opportunity', 1), ('epoch-1', '2023-11-14', 'chat', 'canonical', 1)`,
    )
    const outputPath = join(workDir, 'snapshot.db')
    const deps: AnalyticsJobDeps = {
      nowMs: () => 1_700_000_000_000,
      getDrizzleDb: () => db,
      lanes: () => ({
        killSwitchActive: false,
        localMode: 'local_aggregate',
        externalAggregateEnabled: false,
        externalPseudonymousEnabled: false,
      }),
      observer: () => null,
      openEpochId: () => null,
      keyMaterial: () => null,
      snapshotPath: () => outputPath,
      fence: createRekeyCutoverFence({ getDrizzleDb: () => db }),
    }
    await createAnalyticsJobHandlers(deps)['analytics-snapshot']()
    const publications = db.select().from(analyticsSnapshotPublications).all()
    expect(publications).toHaveLength(1)
    expect(publications[0]?.state).toBe('published')
  })
})
