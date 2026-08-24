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

  test('080_release_announcement_bodies is the last migration', () => {
    const lastMigration = requireDefined(MIGRATIONS.at(-1))
    expect(lastMigration.id).toBe('080_release_announcement_bodies')
  })

  test('077_context_vault_file_artifacts is registered immediately after 076_context_vault', () => {
    const ids = MIGRATIONS.map((m) => m.id)
    const contextVaultIndex = ids.indexOf('076_context_vault')
    expect(contextVaultIndex).toBeGreaterThanOrEqual(0)
    expect(ids[contextVaultIndex + 1]).toBe('077_context_vault_file_artifacts')
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
