// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import type { Scheduler } from '../../utils/scheduler.js'
import type { KeyVersion } from '../controlled-types.js'
import type { EffectiveLanes } from '../governance/policy-store.js'
import type { RekeyCutoverFence } from '../rekey/cutover-fence.js'
import type { AnalyticsObserver } from '../runtime.js'
import { createAnalyticsJobHandlers } from './register-handlers.js'

export { createAnalyticsJobHandlers } from './register-handlers.js'

export const ANALYTICS_SNAPSHOT_PATH_ENV = 'ANALYTICS_SNAPSHOT_PATH'

export const AGGREGATE_FLUSH_INTERVAL_MS = 60_000
export const HIGHWATER_INTERVAL_MS = 300_000
export const INTENT_INTERVAL_MS = 300_000
export const DERIVE_INTERVAL_MS = 300_000
export const DELIVERY_INTERVAL_MS = 60_000
export const RECONCILE_INTERVAL_MS = 3_600_000
export const SNAPSHOT_INTERVAL_MS = 3_600_000
export const EXPIRY_INTERVAL_MS = 60_000
export const CENSOR_MATURITY_CRON = '15 1 * * *'

export const HIGHWATER_BATCH_SIZE = 500
export const INTENT_PAGE_LIMIT = 200
export const DERIVE_WINDOW_MS = 15 * 60_000
export const FINALIZE_GRACE_MS = 5 * 60_000

export type AnalyticsJobName =
  | 'analytics-aggregate-flush'
  | 'analytics-usage-highwater'
  | 'analytics-intent-scan'
  | 'analytics-derive'
  | 'analytics-delivery'
  | 'analytics-reconcile'
  | 'analytics-snapshot'
  | 'analytics-expiry-purge'
  | 'analytics-censor-maturity'

export type AnalyticsJobSpec =
  | Readonly<{ name: AnalyticsJobName; intervalMs: number }>
  | Readonly<{ name: AnalyticsJobName; cron: string }>

export const ANALYTICS_JOB_SPECS: readonly AnalyticsJobSpec[] = [
  { name: 'analytics-aggregate-flush', intervalMs: AGGREGATE_FLUSH_INTERVAL_MS },
  { name: 'analytics-usage-highwater', intervalMs: HIGHWATER_INTERVAL_MS },
  { name: 'analytics-intent-scan', intervalMs: INTENT_INTERVAL_MS },
  { name: 'analytics-derive', intervalMs: DERIVE_INTERVAL_MS },
  { name: 'analytics-delivery', intervalMs: DELIVERY_INTERVAL_MS },
  { name: 'analytics-reconcile', intervalMs: RECONCILE_INTERVAL_MS },
  { name: 'analytics-snapshot', intervalMs: SNAPSHOT_INTERVAL_MS },
  { name: 'analytics-expiry-purge', intervalMs: EXPIRY_INTERVAL_MS },
  { name: 'analytics-censor-maturity', cron: CENSOR_MATURITY_CRON },
]

export const ANALYTICS_JOB_NAMES: readonly AnalyticsJobName[] = ANALYTICS_JOB_SPECS.map((spec) => spec.name)

export type AnalyticsJobRunnerOverrides = Readonly<{
  flush?: (nowMs: number) => void | Promise<void>
  highwater?: (nowMs: number) => void
  intent?: (nowMs: number) => void
  derive?: (nowMs: number) => void
  delivery?: (nowMs: number) => void | Promise<void>
  reconcile?: (nowMs: number) => void
  snapshot?: (nowMs: number) => void
  expiryPurge?: (nowMs: number) => void
  censorMaturity?: (nowMs: number) => void
}>

export type AnalyticsJobKeyMaterial = Readonly<{ key: Buffer; keyVersion: KeyVersion }>

export type AnalyticsJobDeps = Readonly<{
  nowMs: () => number
  getDrizzleDb: typeof defaultGetDrizzleDb
  lanes: () => EffectiveLanes
  observer: () => AnalyticsObserver | null
  openEpochId: () => string | null
  keyMaterial: () => AnalyticsJobKeyMaterial | null
  snapshotPath: () => string | null
  fence?: RekeyCutoverFence
  overrides?: AnalyticsJobRunnerOverrides
}>

/**
 * Registers the nine bounded analytics jobs on the shared scheduler.
 * Registration is additive (provider poller/recurring tasks are untouched)
 * and idempotent across runtime restarts: a fully registered set is never
 * duplicated. All kill-switch/mode checks happen at job entry, so a mode
 * change while a job is queued exits before any actor data is read.
 */
export const registerAnalyticsJobs = (scheduler: Scheduler, deps: AnalyticsJobDeps): void => {
  if (scheduler.hasTask(ANALYTICS_JOB_SPECS[0]?.name ?? 'analytics-aggregate-flush')) return
  const handlers = createAnalyticsJobHandlers(deps)
  for (const spec of ANALYTICS_JOB_SPECS) {
    const handler = handlers[spec.name]
    if ('intervalMs' in spec) scheduler.register(spec.name, { interval: spec.intervalMs, handler })
    else scheduler.register(spec.name, { cron: spec.cron, handler })
  }
}

export const unregisterAnalyticsJobs = (scheduler: Scheduler): void => {
  for (const name of ANALYTICS_JOB_NAMES) {
    if (scheduler.hasTask(name)) scheduler.unregister(name)
  }
}
