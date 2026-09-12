// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import type { ChatProvider } from '../chat/types.js'
import { getContextSettings } from '../instances/context-store.js'
import { logger } from '../logger.js'
import { cancelActiveAlertsPinnedToInstance } from './alerts.js'
import { resolveProactivePlatformInstanceId } from './proactive-delivery.js'
import { getStorageContextId } from './proactive-llm-helpers.js'
import type { DeferredExecutionContext } from './proactive-llm.js'
import type { AlertPrompt } from './types.js'

const log = logger.child({ scope: 'deferred:poller:alerts' })

const alertDeliveryContextKey = (alert: AlertPrompt): string => getStorageContextId(alert.deliveryTarget)

const configContextIdForDelivery = (deliveryTarget: DeferredExecutionContext['deliveryTarget']): string =>
  getConfigContextIdFromStorageContextId(getStorageContextId(deliveryTarget))

/** One poll unit: every alert sharing a config context and an effective task
 * instance. `pinnedTaskInstanceId` is null when the instance comes from the
 * context's current settings rather than an alert pin. */
export type InstanceAlertGroup = {
  configContextId: string
  pinnedTaskInstanceId: string | null
  contextGroups: Map<string, AlertPrompt[]>
}

/** Groups eligible alerts by effective task instance: an alert's own pin wins,
 * otherwise the context's currently assigned instance, otherwise null. */
export function groupAlertsByInstance(eligibleAlerts: readonly AlertPrompt[]): Map<string, InstanceAlertGroup> {
  const byInstance = new Map<string, InstanceAlertGroup>()
  for (const alert of eligibleAlerts) {
    const storageContextId = alertDeliveryContextKey(alert)
    const configContextId = configContextIdForDelivery(alert.deliveryTarget)
    const effectiveInstanceId = alert.taskInstanceId ?? getContextSettings(configContextId)?.taskInstanceId ?? null
    const groupKey = `${configContextId}\u0000${effectiveInstanceId ?? ''}`
    let instanceGroup = byInstance.get(groupKey)
    if (instanceGroup === undefined) {
      instanceGroup = {
        configContextId,
        pinnedTaskInstanceId: alert.taskInstanceId ?? null,
        contextGroups: new Map(),
      }
      byInstance.set(groupKey, instanceGroup)
    } else if (instanceGroup.pinnedTaskInstanceId === null && alert.taskInstanceId !== null) {
      // The group's effective instance may come from settings for unpinned
      // members while other members carry an explicit pin to the same instance.
      instanceGroup.pinnedTaskInstanceId = alert.taskInstanceId
    }
    const group = instanceGroup.contextGroups.get(storageContextId)
    if (group === undefined) instanceGroup.contextGroups.set(storageContextId, [alert])
    else group.push(alert)
  }
  return byInstance
}

export function routableContextGroups(
  contextGroups: Map<string, AlertPrompt[]>,
  chat: ChatProvider,
): Map<string, AlertPrompt[]> {
  const routable = new Map<string, AlertPrompt[]>()
  for (const [storageContextId, alerts] of contextGroups) {
    if (resolveProactivePlatformInstanceId(chat, alerts[0]!.deliveryTarget) !== null) {
      routable.set(storageContextId, alerts)
    }
  }
  return routable
}

/** A non-null pin that no longer resolves (instance stopped or deleted,
 * plugin inactive, missing/invalid config) gets its alerts cancelled rather
 * than re-evaluated every cycle — it must never be re-pointed at the
 * context's current instance (design D3). Destructive by design and an
 * accepted trade-off: recoverable causes (re-activated instance, re-enabled
 * plugin, re-added context token) do not restore the cancelled alerts. A
 * null pin keeps today's warn-and-retry behavior. */
export function handleUnresolvableProvider(configContextId: string, pinnedTaskInstanceId: string | null): void {
  if (pinnedTaskInstanceId === null) {
    log.warn({ configContextId }, 'Could not build task provider for alert polling')
    return
  }
  cancelActiveAlertsPinnedToInstance(pinnedTaskInstanceId, configContextId)
  log.info(
    { configContextId, taskInstanceId: pinnedTaskInstanceId },
    'Skipped alert evaluation: pinned task instance no longer resolves',
  )
}
