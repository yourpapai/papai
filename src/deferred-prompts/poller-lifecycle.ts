// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Scheduler } from '../utils/scheduler.js'

export function stopRegisteredPollerTask(scheduler: Scheduler, taskName: string): void {
  if (!scheduler.hasTask(taskName)) return
  scheduler.stop(taskName)
  scheduler.unregister(taskName)
}
