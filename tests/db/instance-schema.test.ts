// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { getTableName } from 'drizzle-orm'

import { admins, contextSettings, platformInstances, taskInstances } from '../../src/db/schema.js'

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

  test('admins table name', () => {
    expect(getTableName(admins)).toBe('admins')
  })
})
