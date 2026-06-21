// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getIdentityMapping, setIdentityMapping, setProvisionedIdentityMapping } from '../../src/identity/mapping.js'
import { isMatchMethod } from '../../src/identity/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('provisioned MatchMethod', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('isMatchMethod accepts "provisioned"', () => {
    expect(isMatchMethod('provisioned')).toBe(true)
  })

  test('setProvisionedIdentityMapping writes when no existing mapping', () => {
    setProvisionedIdentityMapping({
      contextId: 'user-1',
      providerName: 'kaneo',
      providerUserId: 'kaneo-id-1',
      providerUserLogin: 'user1@pap.ai',
      displayName: 'Alice',
      matchMethod: 'provisioned',
      confidence: 1,
    })
    const mapping = getIdentityMapping('user-1', 'kaneo')
    expect(mapping?.matchMethod).toBe('provisioned')
    expect(mapping?.providerUserId).toBe('kaneo-id-1')
  })

  test('setProvisionedIdentityMapping does NOT overwrite auto mapping', () => {
    setIdentityMapping({
      contextId: 'user-2',
      providerName: 'kaneo',
      providerUserId: 'auto-id',
      providerUserLogin: 'auto@example.com',
      displayName: 'Bob',
      matchMethod: 'auto',
      confidence: 1,
    })
    setProvisionedIdentityMapping({
      contextId: 'user-2',
      providerName: 'kaneo',
      providerUserId: 'provisioned-id',
      providerUserLogin: 'provisioned@pap.ai',
      displayName: 'Bob Provisioned',
      matchMethod: 'provisioned',
      confidence: 1,
    })
    const mapping = getIdentityMapping('user-2', 'kaneo')
    expect(mapping?.matchMethod).toBe('auto')
    expect(mapping?.providerUserId).toBe('auto-id')
  })

  test('setProvisionedIdentityMapping does NOT overwrite manual_nl mapping', () => {
    setIdentityMapping({
      contextId: 'user-3',
      providerName: 'kaneo',
      providerUserId: 'manual-id',
      providerUserLogin: 'manual@example.com',
      displayName: 'Carol',
      matchMethod: 'manual_nl',
      confidence: 1,
    })
    setProvisionedIdentityMapping({
      contextId: 'user-3',
      providerName: 'kaneo',
      providerUserId: 'provisioned-id',
      providerUserLogin: 'provisioned@pap.ai',
      displayName: 'Carol Provisioned',
      matchMethod: 'provisioned',
      confidence: 1,
    })
    const mapping = getIdentityMapping('user-3', 'kaneo')
    expect(mapping?.matchMethod).toBe('manual_nl')
    expect(mapping?.providerUserId).toBe('manual-id')
  })

  test('setProvisionedIdentityMapping DOES overwrite unmatched mapping', () => {
    setIdentityMapping({
      contextId: 'user-4',
      providerName: 'kaneo',
      providerUserId: null,
      providerUserLogin: null,
      displayName: null,
      matchMethod: 'unmatched',
      confidence: 0,
    })
    setProvisionedIdentityMapping({
      contextId: 'user-4',
      providerName: 'kaneo',
      providerUserId: 'provisioned-id',
      providerUserLogin: 'provisioned@pap.ai',
      displayName: 'Dave',
      matchMethod: 'provisioned',
      confidence: 1,
    })
    const mapping = getIdentityMapping('user-4', 'kaneo')
    expect(mapping?.matchMethod).toBe('provisioned')
    expect(mapping?.providerUserId).toBe('provisioned-id')
  })
})
