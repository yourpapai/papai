// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { MIGRATIONS } from '../../src/db/index.js'

const requireDefined = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('expected value to be defined')
  return value
}

describe('MIGRATIONS list', () => {
  test('includes migration 040_platform_instances', () => {
    const ids = MIGRATIONS.map((m) => m.id)
    expect(ids).toContain('040_platform_instances')
  })

  test('includes migration 051_legacy_context_id_backfill', () => {
    const ids = MIGRATIONS.map((m) => m.id)
    expect(ids).toContain('051_legacy_context_id_backfill')
  })

  test('066_coding_repos_egress is the last migration', () => {
    const lastMigration = requireDefined(MIGRATIONS.at(-1))
    expect(lastMigration.id).toBe('066_coding_repos_egress')
  })
})
