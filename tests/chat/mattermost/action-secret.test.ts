// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  getMattermostActionSigningSecret,
  MATTERMOST_ACTION_SIGNING_SECRET_KEY,
  seedMattermostActionSigningSecretFromEnv,
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

describe('seedMattermostActionSigningSecretFromEnv', () => {
  const original = process.env['PAPAI_MATTERMOST_ACTION_SIGNING_SECRET']

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  afterEach(() => {
    if (original === undefined) delete process.env['PAPAI_MATTERMOST_ACTION_SIGNING_SECRET']
    else process.env['PAPAI_MATTERMOST_ACTION_SIGNING_SECRET'] = original
  })

  test('seeds the configured secret when the env var is set', () => {
    process.env['PAPAI_MATTERMOST_ACTION_SIGNING_SECRET'] = 'known-secret-value'
    seedMattermostActionSigningSecretFromEnv()
    expect(getMattermostActionSigningSecret()).toBe('known-secret-value')
  })

  test('is a no-op when the env var is unset (existing generate path still works)', () => {
    delete process.env['PAPAI_MATTERMOST_ACTION_SIGNING_SECRET']
    seedMattermostActionSigningSecretFromEnv()
    // getMattermostActionSigningSecret generates + stores a random secret on first read.
    expect(getMattermostActionSigningSecret()).toMatch(/^[A-Za-z0-9_-]+$/u)
  })

  test('never overwrites an already-stored secret', () => {
    // getMattermostActionSigningSecret generates + stores the initial secret.
    const first = getMattermostActionSigningSecret()
    process.env['PAPAI_MATTERMOST_ACTION_SIGNING_SECRET'] = 'different-value'
    seedMattermostActionSigningSecretFromEnv()
    expect(getMattermostActionSigningSecret()).toBe(first)
  })
})
