// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { TRUSTED_MODULES } from '../../src/composition/trusted-modules.js'

describe('TRUSTED_MODULES', () => {
  test('is empty until a module is added in a later task', () => {
    expect(TRUSTED_MODULES).toEqual([])
  })
})
