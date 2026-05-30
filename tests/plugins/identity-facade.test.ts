// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { buildIdentityFacade } from '../../src/plugins/identity-facade.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('buildIdentityFacade', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('recordClaim then lookup returns an unverified mapping', () => {
    const identity = buildIdentityFacade('kaneo', 'ctx-1')
    identity.recordClaim('kaneo-u-7', 'alice')
    const found = identity.lookupForChatUser('ctx-1')
    expect(found).toEqual({ providerUserId: 'kaneo-u-7', providerLogin: 'alice', verified: false })
  })

  test('lookup returns null when no mapping exists', () => {
    const identity = buildIdentityFacade('kaneo', 'ctx-unknown')
    expect(identity.lookupForChatUser('ctx-unknown')).toBeNull()
  })

  test('recordClaim persists an optional display name', () => {
    const captured: Array<Record<string, unknown>> = []
    const identity = buildIdentityFacade('kaneo', 'ctx-2', {
      getIdentityMapping: () => null,
      setIdentityMapping: (params) => {
        captured.push({ ...params })
      },
    })
    identity.recordClaim('kaneo-u-9', 'bob', 'Bob Builder')
    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({
      contextId: 'ctx-2',
      providerName: 'kaneo',
      providerUserId: 'kaneo-u-9',
      providerUserLogin: 'bob',
      displayName: 'Bob Builder',
      matchMethod: 'manual_nl',
      confidence: 100,
    })
  })

  test('lookup returns null for a cleared mapping (provider ids are null)', () => {
    const identity = buildIdentityFacade('kaneo', 'ctx-cleared', {
      getIdentityMapping: () => ({
        contextId: 'ctx-cleared',
        providerName: 'kaneo',
        providerUserId: null,
        providerUserLogin: null,
        displayName: null,
        matchedAt: new Date().toISOString(),
        matchMethod: 'unmatched',
        confidence: 0,
      }),
      setIdentityMapping: () => {},
    })
    expect(identity.lookupForChatUser('ctx-cleared')).toBeNull()
  })

  test('lookup reports verified when the stored match method is auto', () => {
    const identity = buildIdentityFacade('kaneo', 'ctx-3', {
      getIdentityMapping: () => ({
        contextId: 'ctx-3',
        providerName: 'kaneo',
        providerUserId: 'kaneo-u-1',
        providerUserLogin: 'carol',
        displayName: null,
        matchedAt: new Date().toISOString(),
        matchMethod: 'auto',
        confidence: 90,
      }),
      setIdentityMapping: () => {},
    })
    expect(identity.lookupForChatUser('ctx-3')).toEqual({
      providerUserId: 'kaneo-u-1',
      providerLogin: 'carol',
      verified: true,
    })
  })
})
