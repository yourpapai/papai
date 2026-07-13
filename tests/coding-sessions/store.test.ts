// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { readRecord as readLegacyRecord } from '../../plugins/acp/history.js'
import { readRecord as readStableRecord } from '../../src/coding-sessions/session-record.js'
import { getCodingSessionRecord, setCodingSessionRecord } from '../../src/coding-sessions/store.js'
import { kvGet } from '../../src/plugins/store.js'
import { setupTestDb } from '../utils/test-helpers.js'

describe('coding-session store', () => {
  beforeEach(setupTestDb)

  test('reads and writes durable records through an architecture-neutral API', () => {
    setCodingSessionRecord('platform:user', 'session-1', {
      project: 'papai',
      title: 'Add health check',
      createdAt: '2026-07-12T12:00:00.000Z',
      shareToken: 'share-token',
      transcriptUrl: 'https://papai.invalid/t/share-token',
    })

    expect(getCodingSessionRecord('platform:user', 'session-1')).toEqual({
      project: 'papai',
      title: 'Add health check',
      createdAt: '2026-07-12T12:00:00.000Z',
      shareToken: 'share-token',
      transcriptUrl: 'https://papai.invalid/t/share-token',
    })
    expect(kvGet('acp', 'platform:user', 'session:session-1')).toBeDefined()
  })

  test('shares record parsing primitives with the current implementation', () => {
    expect(readStableRecord).toBe(readLegacyRecord)
  })

  test('returns null for unavailable or malformed durable records', () => {
    expect(getCodingSessionRecord('platform:user', 'missing')).toBeNull()
  })
})
