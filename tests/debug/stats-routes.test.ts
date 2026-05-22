// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { handleStatsGlobal, handleStatsSubject } from '../../src/debug/stats-routes.js'

describe('stats-routes module', () => {
  test('exports the two stats handlers', () => {
    expect(typeof handleStatsGlobal).toBe('function')
    expect(typeof handleStatsSubject).toBe('function')
  })
})
