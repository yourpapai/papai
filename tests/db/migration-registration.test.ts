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

const toNumericId = (id: string): number => Number.parseInt(id.split('_')[0] ?? '0', 10)

describe('MIGRATIONS list', () => {
  test('includes migration 040_platform_instances', () => {
    const ids = MIGRATIONS.map((m) => m.id)
    expect(ids).toContain('040_platform_instances')
  })

  test('includes migration 051_legacy_context_id_backfill', () => {
    const ids = MIGRATIONS.map((m) => m.id)
    expect(ids).toContain('051_legacy_context_id_backfill')
  })

  test('includes migration 070_message_metadata_history_search', () => {
    const ids = MIGRATIONS.map((m) => m.id)
    expect(ids).toContain('070_message_metadata_history_search')
  })

  test('076_context_vault is the last migration', () => {
    const lastMigration = requireDefined(MIGRATIONS.at(-1))
    expect(lastMigration.id).toBe('076_context_vault')
  })

  test('076_context_vault is registered immediately after 075_analytics_materializations', () => {
    const ids = MIGRATIONS.map((m) => m.id)
    const materializationsIndex = ids.indexOf('075_analytics_materializations')
    expect(materializationsIndex).toBeGreaterThanOrEqual(0)
    expect(ids[materializationsIndex + 1]).toBe('076_context_vault')
  })

  test('migration ids are unique', () => {
    const ids = MIGRATIONS.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('migration ids are strictly ordered', () => {
    const numericIds = MIGRATIONS.map((m) => toNumericId(m.id))
    expect(numericIds).toEqual([...numericIds].sort((a, b) => a - b))
  })
})
