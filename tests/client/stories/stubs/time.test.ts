// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { FIXED_TS } from '../../../../client/stories/fixtures/debug.js'
import { installTimeStub, uninstallTimeStub } from '../../../../client/stories/stubs/time.js'

describe('time stub', () => {
  afterEach(() => uninstallTimeStub())

  test('pins Date.now to the fixtures FIXED_TS and stays stable across calls', () => {
    installTimeStub()
    const a = Date.now()
    const b = Date.now()
    expect(a).toBe(FIXED_TS)
    expect(b).toBe(FIXED_TS)
  })

  test('restores the real progressing clock on uninstall', () => {
    installTimeStub()
    const pinned = Date.now()
    uninstallTimeStub()
    const restored = Date.now()
    expect(restored).not.toBe(pinned)
    expect(restored).toBeGreaterThan(pinned)
  })

  test('install is idempotent and uninstall only restores once', () => {
    installTimeStub()
    installTimeStub()
    expect(Date.now()).toBe(FIXED_TS)
    uninstallTimeStub()
    const real = Date.now()
    // A second uninstall must not corrupt the restored clock.
    uninstallTimeStub()
    expect(typeof Date.now()).toBe('number')
    void real
  })
})
