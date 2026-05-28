// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'
import { sweepExpired } from './index.js'

const log = logger.child({ scope: 'dashboard-auth:sweeper' })

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000

export interface SweeperOptions {
  intervalMs?: number
  sweep?: () => void
  scheduleWith?: (fn: () => void, ms: number) => () => void
}

const defaultSchedule = (fn: () => void, ms: number): (() => void) => {
  const handle = setInterval(fn, ms)
  if (typeof (handle as { unref?: () => void }).unref === 'function') {
    ;(handle as { unref: () => void }).unref()
  }
  return (): void => {
    clearInterval(handle)
  }
}

export const startSweeper = (opts: SweeperOptions = {}): (() => void) => {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS
  const sweep =
    opts.sweep ??
    ((): void => {
      sweepExpired()
    })
  const schedule = opts.scheduleWith ?? defaultSchedule
  log.info({ intervalMs }, 'dashboard-auth sweeper starting')
  const stop = schedule(() => {
    try {
      sweep()
    } catch (err) {
      log.error({ error: err instanceof Error ? err.message : String(err) }, 'dashboard-auth sweep failed')
    }
  }, intervalMs)
  return stop
}
