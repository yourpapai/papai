// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mountAdminApp } from '../../../client/admin/index.js'

describe('mountAdminApp', () => {
  test('exports a mountAdminApp function', () => {
    expect(typeof mountAdminApp).toBe('function')
  })
})
