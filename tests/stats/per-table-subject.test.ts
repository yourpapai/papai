// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  groupBlockForSubject,
  identityForSubject,
  stagedForSubject,
  userBlockForSubject,
} from '../../src/stats/per-table-subject.js'

describe('per-table-subject helpers smoke check', () => {
  test('all subject helpers exported as functions', () => {
    expect(typeof identityForSubject).toBe('function')
    expect(typeof stagedForSubject).toBe('function')
    expect(typeof userBlockForSubject).toBe('function')
    expect(typeof groupBlockForSubject).toBe('function')
  })
})
