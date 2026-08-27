// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readEvents } from '../events.js'
import type { SddEvent } from '../events.js'
import { initialStep, step } from './machine.js'
import type { KernelEvent, KernelMachine, KernelSnapshot } from './machine.js'

export interface FoldAccounting {
  readonly total: number
  readonly mapped: number
  readonly tolerated: number
}

export interface FoldResult {
  readonly snapshot: KernelSnapshot
  readonly accounting: FoldAccounting
}

export function toKernelEvent(event: SddEvent): KernelEvent | null {
  if (event.type === 'stage_enter') return { type: 'stage.enter', stage: event.stage }
  if (event.type === 'stage_exit') return { type: 'stage.exit', stage: event.stage }
  if (event.type === 'gate' && event.action === 'presented') return { type: 'gate.presented' }
  if (event.type === 'gate' && event.action === 'answered') return { type: 'gate.answered' }
  return null
}

export function foldEvents(machine: KernelMachine, events: readonly SddEvent[]): FoldResult {
  let snapshot = initialStep(machine)[0]
  let mapped = 0
  let tolerated = 0
  for (const event of events) {
    const kernelEvent = toKernelEvent(event)
    if (kernelEvent === null) {
      tolerated += 1
      continue
    }
    mapped += 1
    snapshot = step(machine, snapshot, kernelEvent)[0]
  }
  return { snapshot, accounting: { total: events.length, mapped, tolerated } }
}

export function foldLog(machine: KernelMachine, logPath: string): FoldResult {
  return foldEvents(machine, readEvents(logPath))
}
