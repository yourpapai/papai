// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { getTableName } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/sqlite-core'

import { contextSettings, platformAdmins, platformInstances, superAdmins, taskInstances } from '../../src/db/schema.js'

describe('instance-schema re-exports', () => {
  test('platformInstances table name', () => {
    expect(getTableName(platformInstances)).toBe('platform_instances')
  })

  test('taskInstances table name', () => {
    expect(getTableName(taskInstances)).toBe('task_instances')
  })

  test('contextSettings table name', () => {
    expect(getTableName(contextSettings)).toBe('context_settings')
  })

  test('superAdmins table name', () => {
    expect(getTableName(superAdmins)).toBe('super_admins')
  })

  test('platformAdmins table name', () => {
    expect(getTableName(platformAdmins)).toBe('platform_admins')
  })

  test('contextSettings has task and platform foreign keys', () => {
    expect(getTableConfig(contextSettings).foreignKeys).toHaveLength(2)
  })

  test('platformAdmins references platform instances', () => {
    expect(getTableConfig(platformAdmins).foreignKeys).toHaveLength(1)
  })

  test('superAdmins has no platform foreign key', () => {
    expect(getTableConfig(superAdmins).foreignKeys).toHaveLength(0)
  })
})
