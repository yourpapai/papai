// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  getMattermostActionSigningSecret,
  MATTERMOST_ACTION_SIGNING_SECRET_KEY,
} from '../../../src/chat/mattermost/action-secret.js'
import { systemConfig } from '../../../src/db/schema.js'
import { getTestDb, mockLogger, setupTestDb } from '../../utils/test-helpers.js'

describe('Mattermost action signing secret', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('creates and persists a secret on first use', () => {
    const secret = getMattermostActionSigningSecret()
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/u)

    const row = getTestDb()
      .select()
      .from(systemConfig)
      .all()
      .find((entry) => entry.key === MATTERMOST_ACTION_SIGNING_SECRET_KEY)

    expect(row?.value).toBe(secret)
    expect(row?.updatedBy).toBe('mattermost-action-signing')
  })

  test('reuses existing persisted secret', () => {
    getTestDb()
      .insert(systemConfig)
      .values({ key: MATTERMOST_ACTION_SIGNING_SECRET_KEY, value: 'persisted-secret', updatedAt: 1, updatedBy: 'test' })
      .run()

    expect(getMattermostActionSigningSecret()).toBe('persisted-secret')
  })
})
