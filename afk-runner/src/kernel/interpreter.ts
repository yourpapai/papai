// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { KernelActions, KernelEvent } from './machine.js'

export interface ScheduleWork {
  readonly kind: string
}

export interface ActionSinks {
  readonly emit: (event: KernelEvent) => void
  readonly schedule: (work: ScheduleWork) => void
}

export interface UnknownAction {
  readonly type: string
  readonly params?: unknown
}

function isEmitParams(params: unknown): params is { event: KernelEvent } {
  if (typeof params !== 'object' || params === null) return false
  const candidate: { event?: unknown } = { ...params }
  return (
    typeof candidate['event'] === 'object' &&
    candidate['event'] !== null &&
    typeof (candidate['event'] as { type?: unknown })['type'] === 'string'
  )
}

function isScheduleParams(params: unknown): params is { work: ScheduleWork } {
  if (typeof params !== 'object' || params === null) return false
  const work: unknown = (params as { work?: unknown })['work']
  return typeof work === 'object' && work !== null && typeof (work as { kind?: unknown })['kind'] === 'string'
}

export function executeActions(actions: readonly UnknownAction[] | KernelActions, sinks: ActionSinks): void {
  for (const action of actions) {
    if (action.type === 'emit' && action.params !== undefined && isEmitParams(action.params)) {
      sinks.emit(action.params.event)
      continue
    }
    if (action.type === 'schedule' && action.params !== undefined && isScheduleParams(action.params)) {
      sinks.schedule(action.params.work)
      continue
    }
    throw new Error(`kernel action outside closed vocabulary: ${action.type}`)
  }
}
