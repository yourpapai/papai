// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { taskTrackerModule } from '../../../src/modules/task-tracker/module.js'

describe('task-tracker module', () => {
  test('id is "task-tracker"', () => {
    expect(taskTrackerModule.id).toBe('task-tracker')
  })

  test('owns the membership-store migrations (060, 068), in ascending order', () => {
    expect(taskTrackerModule.migrations?.map((m) => m.id)).toEqual([
      '060_kaneo_workspace_members',
      '068_task_provider_members',
    ])
  })

  test('has an onActivate hook', () => {
    expect(typeof taskTrackerModule.onActivate).toBe('function')
  })
})
