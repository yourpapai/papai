// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { TRUSTED_MODULES } from '../../src/composition/trusted-modules.js'
import { codingModule } from '../../src/modules/coding/module.js'

describe('TRUSTED_MODULES', () => {
  test('registers the coding module', () => {
    expect(TRUSTED_MODULES).toHaveLength(1)
    expect(TRUSTED_MODULES).toContain(codingModule)
  })
})
