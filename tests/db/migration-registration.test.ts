// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { MIGRATIONS } from '../../src/db/index.js'

describe('MIGRATIONS list', () => {
  test('includes migration 040_platform_instances', () => {
    const ids = MIGRATIONS.map((m) => m.id)
    expect(ids).toContain('040_platform_instances')
  })

  test('040 is the last migration', () => {
    expect(MIGRATIONS.at(-1)?.id).toBe('040_platform_instances')
  })
})
