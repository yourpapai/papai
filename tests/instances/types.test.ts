// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { BootstrapResult } from '../../src/instances/types.js'

describe('instances/types', () => {
  test('BootstrapResult discriminant narrows correctly', () => {
    const succeeded: BootstrapResult = {
      bootstrapped: true,
      platformInstanceId: 'pi-1',
      taskInstanceId: 'ti-1',
    }
    const skipped: BootstrapResult = { bootstrapped: false, reason: 'already-bootstrapped' }

    expect(succeeded.bootstrapped).toBe(true)
    expect(skipped.bootstrapped).toBe(false)
  })
})
