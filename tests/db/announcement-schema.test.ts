// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { announcementDeliveries, versionAnnouncements } from '../../src/db/announcement-schema.js'
import { getDrizzleDb } from '../../src/db/drizzle.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('announcement-schema', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('versionAnnouncements round-trips all columns correctly', () => {
    const db = getDrizzleDb()
    db.insert(versionAnnouncements)
      .values({
        version: 'v1.2.3',
        announcedAt: '2026-06-26T00:00:00.000Z',
        rawBody: '## What is new',
        humanizedBody: 'Some new features',
        broadcastAt: '2026-06-26T01:00:00.000Z',
      })
      .run()

    const row = db.select().from(versionAnnouncements).get()
    expect(row).toEqual({
      version: 'v1.2.3',
      announcedAt: '2026-06-26T00:00:00.000Z',
      rawBody: '## What is new',
      humanizedBody: 'Some new features',
      broadcastAt: '2026-06-26T01:00:00.000Z',
    })
  })

  test('announcementDeliveries round-trips all columns correctly', () => {
    const db = getDrizzleDb()
    db.insert(versionAnnouncements).values({ version: 'v1.2.3', announcedAt: '2026-06-26T00:00:00.000Z' }).run()

    db.insert(announcementDeliveries)
      .values({
        version: 'v1.2.3',
        contextId: 'ctx-dm-1',
        contextType: 'dm',
        status: 'delivered',
        deliveredAt: '2026-06-26T01:00:00.000Z',
      })
      .run()

    const row = db.select().from(announcementDeliveries).get()
    expect(row).toEqual({
      version: 'v1.2.3',
      contextId: 'ctx-dm-1',
      contextType: 'dm',
      status: 'delivered',
      deliveredAt: '2026-06-26T01:00:00.000Z',
    })
  })
})
