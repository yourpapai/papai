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

  test('069_youtrack_command_tool_prefs_rename is the last core migration', () => {
    const lastMigration = requireDefined(MIGRATIONS.at(-1))
    expect(lastMigration.id).toBe('069_youtrack_command_tool_prefs_rename')
  })

  test('coding-table migrations are owned by the coding module, not core', () => {
    const ids = MIGRATIONS.map((m) => m.id)
    expect(ids).not.toContain('061_coding_session_credentials')
    expect(ids).not.toContain('064_coding_session_repos')
    expect(ids).not.toContain('066_coding_repos_egress')
    expect(ids).not.toContain('067_acp_tool_prefs_rename')
    // 065 alters the core-owned authorized_groups table, so it stays in core.
    expect(ids).toContain('065_coding_identity')
  })

  test('membership-store migrations are owned by the task-tracker module, not core', () => {
    const ids = MIGRATIONS.map((m) => m.id)
    expect(ids).not.toContain('060_kaneo_workspace_members')
    expect(ids).not.toContain('068_task_provider_members')
  })
})
