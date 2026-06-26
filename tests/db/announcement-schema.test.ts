// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { announcementDeliveries, versionAnnouncements } from '../../src/db/announcement-schema.js'

describe('announcement-schema', () => {
  test('versionAnnouncements table has expected column definitions', () => {
    expect(versionAnnouncements.version).toBeDefined()
    expect(versionAnnouncements.announcedAt).toBeDefined()
    expect(versionAnnouncements.rawBody).toBeDefined()
    expect(versionAnnouncements.humanizedBody).toBeDefined()
    expect(versionAnnouncements.broadcastAt).toBeDefined()
  })

  test('announcementDeliveries table has expected column definitions', () => {
    expect(announcementDeliveries.version).toBeDefined()
    expect(announcementDeliveries.contextId).toBeDefined()
    expect(announcementDeliveries.contextType).toBeDefined()
    expect(announcementDeliveries.status).toBeDefined()
    expect(announcementDeliveries.deliveredAt).toBeDefined()
  })
})
