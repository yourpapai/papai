// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildPermissionDenied } from '../../src/tools/permission-gate.js'

describe('buildPermissionDenied', () => {
  test('returns structured permission_denied shape', () => {
    const result = buildPermissionDenied('User denied the call.')
    expect(result).toEqual({ status: 'permission_denied', message: 'User denied the call.' })
  })
})
