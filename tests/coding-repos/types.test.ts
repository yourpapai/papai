// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { REPO_PRESETS } from '../../src/coding-repos/types.js'

describe('coding-repos types', () => {
  test('REPO_PRESETS contains the three permission levels', () => {
    expect(REPO_PRESETS).toContain('autonomous')
    expect(REPO_PRESETS).toContain('cautious')
    expect(REPO_PRESETS).toContain('readonly')
    expect(REPO_PRESETS).toHaveLength(3)
  })
})
