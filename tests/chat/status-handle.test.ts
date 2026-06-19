// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { StatusHandle } from '../../src/chat/status-handle.js'

describe('StatusHandle', () => {
  test('is satisfied by an object with update and dismiss', () => {
    const handle: StatusHandle = {
      update: (_text: string) => Promise.resolve(),
      dismiss: () => Promise.resolve(),
    }
    expect(typeof handle.update).toBe('function')
    expect(typeof handle.dismiss).toBe('function')
  })
})
