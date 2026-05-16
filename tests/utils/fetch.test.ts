// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { fetchWithoutTimeout } from '../../src/utils/fetch.js'

describe('fetchWithoutTimeout', () => {
  test('exports fetchWithoutTimeout function', () => {
    expect(typeof fetchWithoutTimeout).toBe('function')
  })

  test('has preconnect method', () => {
    expect(typeof fetchWithoutTimeout.preconnect).toBe('function')
  })
})
