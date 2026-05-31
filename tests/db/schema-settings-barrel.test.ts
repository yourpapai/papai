// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { settingsAuthCodes, settingsRateLimit, settingsSessions } from '../../src/db/schema.js'

describe('schema barrel: settings auth tables', () => {
  test('re-exports the three settings auth tables', () => {
    expect(settingsAuthCodes).toBeDefined()
    expect(settingsSessions).toBeDefined()
    expect(settingsRateLimit).toBeDefined()
  })
})
