// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { parseReductionFlagsJson } from '../../src/tools/feature-flags.js'

describe('cross_thread_memory flag', () => {
  test('off by default', () => {
    expect(parseReductionFlagsJson(null).crossThreadMemory).toBe(false)
    expect(parseReductionFlagsJson('{}').crossThreadMemory).toBe(false)
  })
  test('only literal true enables it', () => {
    expect(parseReductionFlagsJson('{"cross_thread_memory":true}').crossThreadMemory).toBe(true)
    expect(parseReductionFlagsJson('{"cross_thread_memory":"true"}').crossThreadMemory).toBe(false)
  })
})
