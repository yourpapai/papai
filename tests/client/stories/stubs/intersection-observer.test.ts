// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import {
  installIntersectionObserverStub,
  uninstallIntersectionObserverStub,
} from '../../../../client/stories/stubs/intersection-observer.js'

describe('intersection observer stub', () => {
  afterEach(() => uninstallIntersectionObserverStub())

  test('installs a constructible IntersectionObserver with no-op methods', () => {
    installIntersectionObserverStub()
    const IO = globalThis.IntersectionObserver
    expect(typeof IO).toBe('function')
    const instance = new IO(() => {})
    expect(typeof instance.observe).toBe('function')
    expect(typeof instance.unobserve).toBe('function')
    expect(typeof instance.disconnect).toBe('function')
  })
})
