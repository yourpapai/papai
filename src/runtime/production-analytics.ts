// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { KeyringState } from '../analytics/identity/keyring.js'
import type { AnalyticsObserver } from '../analytics/runtime.js'
import { getActiveAnalyticsRuntime, startAnalytics } from '../analytics/start-analytics.js'
import type { AuthorizedTurnContextRegistry } from '../analytics/turn-context.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'main' })

export type ProductionAnalyticsRuntime = Readonly<{
  observer: AnalyticsObserver
  registry: AuthorizedTurnContextRegistry
  keyring?: KeyringState
}>

export type ProductionAnalyticsDeps = {
  analytics: ProductionAnalyticsRuntime | null
}

/**
 * Start the analytics runtime unless one is already injected. A failed start
 * is logged and swallowed: the process continues without analytics.
 */
export function startAnalyticsRuntime(state: ProductionAnalyticsDeps): void {
  try {
    startAnalytics()
    state.analytics ??= getActiveAnalyticsRuntime()
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'Analytics runtime start failed')
  }
}
