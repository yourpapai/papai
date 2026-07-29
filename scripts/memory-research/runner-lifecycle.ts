// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { LifecycleEntry } from './report.js'
import type { MemoryScenario } from './types.js'

export type LifecycleRecorder = Readonly<{
  entries: readonly LifecycleEntry[]
  add: (kind: LifecycleEntry['kind'], referenceId: string, occurredAt: string) => void
}>

export const createLifecycleRecorder = (scenarioId: MemoryScenario['scenarioId']): LifecycleRecorder => {
  const entries: LifecycleEntry[] = []
  return {
    entries,
    add: (kind, referenceId, occurredAt): void => {
      entries.push({ ordinal: entries.length, scenarioId, kind, referenceId, occurredAt })
    },
  }
}
