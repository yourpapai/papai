// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  CHAT_CAPABILITY_VALUES,
  TASK_CAPABILITY_VALUES,
  TASK_PROVIDER_TRAIT_VALUES,
} from '../../src/plugins/capability-constants.js'

describe('capability constants', () => {
  test('TASK_CAPABILITY_VALUES is a non-empty array', () => {
    expect(TASK_CAPABILITY_VALUES.length).toBeGreaterThan(0)
  })

  test('CHAT_CAPABILITY_VALUES is a non-empty array', () => {
    expect(CHAT_CAPABILITY_VALUES.length).toBeGreaterThan(0)
  })

  test('TASK_PROVIDER_TRAIT_VALUES is a non-empty array', () => {
    expect(TASK_PROVIDER_TRAIT_VALUES.length).toBeGreaterThan(0)
  })
})
