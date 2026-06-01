// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { CODE_TTL_MS, consumeAuthCode, issueAuthCode } from '../../src/settings/auth-code-store.js'
import { mockLogger, setupSettingsAuthTestDb } from '../utils/test-helpers.js'

const principal = { platformInstanceId: 'pi-1', platformUserId: 'u-1' }

describe('settings auth-code store', () => {
  beforeEach(async () => {
    mockLogger()
    await setupSettingsAuthTestDb()
  })

  test('issue then consume returns the bound principal', () => {
    const code = issueAuthCode(principal, 1000)
    expect(consumeAuthCode(code, 2000)).toEqual(principal)
  })

  test('a code is single-use', () => {
    const code = issueAuthCode(principal, 1000)
    expect(consumeAuthCode(code, 2000)).toEqual(principal)
    expect(consumeAuthCode(code, 3000)).toBeNull()
  })

  test('an expired code is rejected', () => {
    const code = issueAuthCode(principal, 1000)
    expect(consumeAuthCode(code, 1000 + CODE_TTL_MS + 1)).toBeNull()
  })

  test('a code is rejected at exactly its expiry instant', () => {
    const code = issueAuthCode(principal, 1000)
    expect(consumeAuthCode(code, 1000 + CODE_TTL_MS)).toBeNull()
  })

  test('an unknown code is rejected', () => {
    expect(consumeAuthCode('not-a-real-code', 2000)).toBeNull()
  })

  test('re-issuing supersedes the prior unused code', () => {
    const first = issueAuthCode(principal, 1000)
    issueAuthCode(principal, 1500)
    expect(consumeAuthCode(first, 2000)).toBeNull()
  })
})
