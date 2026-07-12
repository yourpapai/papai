// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'
import { runMemoryCapture, type RunMemoryCaptureInput } from './capture.js'
import { markActivity } from './extraction-state.js'

const log = logger.child({ scope: 'memory:capture-debounce' })

export const MEMORY_CAPTURE_DEBOUNCE_MS = 600_000

export type ArmCaptureDeps = Readonly<{
  markActivity: (input: RunMemoryCaptureInput, historyLen: number, now: string) => void
  runCapture: (input: RunMemoryCaptureInput) => Promise<void>
  schedule: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clear: (timer: ReturnType<typeof setTimeout>) => void
  debounceMs: number
  now: () => string
}>

type PendingCapture = Readonly<{
  timer: ReturnType<typeof setTimeout>
  clear(timer: ReturnType<typeof setTimeout>): void
}>

const pending = new Map<string, PendingCapture>()
const inFlight = new Set<Promise<void>>()
let drainInFlight: Promise<void> | undefined

const defaultDeps: ArmCaptureDeps = {
  markActivity: (input, historyLen, now) => {
    markActivity(
      {
        contextId: input.storageContextId,
        contextType: input.contextType,
        configContextId: input.configContextId,
        historyLen,
      },
      now,
    )
  },
  runCapture: (input) => runMemoryCapture(input),
  schedule: (fn, ms) => setTimeout(fn, ms),
  clear: (timer) => {
    clearTimeout(timer)
  },
  debounceMs: MEMORY_CAPTURE_DEBOUNCE_MS,
  now: () => new Date().toISOString(),
}

/** Record activity and (re)arm a debounced capture for this context. Safe to call every turn. */
export function armMemoryCapture(input: RunMemoryCaptureInput, deps: ArmCaptureDeps = defaultDeps): void {
  if (input.actorRole === 'guest') return
  if (input.contextType !== 'group') return
  if (drainInFlight !== undefined) return

  deps.markActivity(input, input.history.length, deps.now())

  const existing = pending.get(input.storageContextId)
  if (existing !== undefined) existing.clear(existing.timer)

  const timer = deps.schedule(() => {
    pending.delete(input.storageContextId)
    const capture = deps
      .runCapture(input)
      .catch((error: unknown) => {
        log.warn(
          {
            contextId: input.storageContextId,
            error: error instanceof Error ? error.message : String(error),
          },
          'Debounced capture failed',
        )
      })
      .finally(() => {
        inFlight.delete(capture)
      })
    inFlight.add(capture)
  }, deps.debounceMs)
  pending.set(input.storageContextId, { timer, clear: deps.clear })
}

/** Cancel deferred captures during runtime teardown and release their captured state. */
export function cancelPendingMemoryCaptures(): void {
  for (const { timer, clear } of pending.values()) clear(timer)
  pending.clear()
}

/** Cancel deferred captures and wait until every already-started capture settles. */
export function cancelAndDrainPendingMemoryCaptures(): Promise<void> {
  if (drainInFlight !== undefined) return drainInFlight
  cancelPendingMemoryCaptures()
  const drainCaptures = async (): Promise<void> => {
    const captures = [...inFlight]
    if (captures.length === 0) return
    await Promise.all(captures)
    return drainCaptures()
  }
  const draining = drainCaptures().finally(() => {
    if (drainInFlight === draining) drainInFlight = undefined
  })
  drainInFlight = draining
  return draining
}
