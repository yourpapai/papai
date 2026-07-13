// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  DEFAULT_SCHEDULER_TASK_NAMES,
  registerDefaultSchedulerTasks,
  scheduler,
  unregisterDefaultSchedulerTasks,
} from '../src/scheduler-instance.js'

describe('scheduler-instance', () => {
  test('keeps defaults absent until the background lifecycle registers them', () => {
    for (const taskName of DEFAULT_SCHEDULER_TASK_NAMES) expect(scheduler.hasTask(taskName)).toBe(false)

    registerDefaultSchedulerTasks()
    for (const taskName of DEFAULT_SCHEDULER_TASK_NAMES) expect(scheduler.hasTask(taskName)).toBe(true)

    unregisterDefaultSchedulerTasks()
    for (const taskName of DEFAULT_SCHEDULER_TASK_NAMES) expect(scheduler.hasTask(taskName)).toBe(false)
  })
})
