// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mountApp } from '../../../client/debug/index.js'

describe('mountApp', () => {
  test('mounts the dashboard into the given target', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.getElementById('root')!
    const app = mountApp(target)
    expect(target.children.length).toBeGreaterThan(0)
    expect(typeof app).toBe('object')
  })
})
