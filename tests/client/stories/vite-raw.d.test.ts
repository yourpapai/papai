// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import '../../../client/stories/vite-raw.d.js'

describe('vite-raw ambient module declaration', () => {
  test('declares the `*?raw` module without runtime errors', () => {
    expect(true).toBe(true)
  })
})
