// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { SETTINGS_ENTRY_PLACEHOLDER } from '../../../client/settings/index.js'

describe('settings entry (stub)', () => {
  test('module loads', () => {
    expect(SETTINGS_ENTRY_PLACEHOLDER).toBe(true)
  })
})
