// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getStorageContextId } from '../deferred-prompts/proactive-llm-helpers.js'
import { getContextSettings } from '../instances/context-store.js'
import { logger } from '../logger.js'
import { getConfigContextIdFromStorageContextId } from './scoped-context.js'
import type { DeferredDeliveryTarget } from './types.js'

const log = logger.child({ scope: 'chat:delivery-routing' })

const getDeliveryContextSettings = (configContextId: string, storageContextId: string): ReturnType<typeof getContextSettings> => {
  const configSettings = getContextSettings(configContextId)
  if (configSettings !== null) return configSettings
  return getContextSettings(storageContextId)
}

export function resolveDeliveryPlatformInstanceId(target: DeferredDeliveryTarget): string | null {
  const storageContextId = getStorageContextId(target)
  const configContextId = getConfigContextIdFromStorageContextId(storageContextId)
  const settings = getDeliveryContextSettings(configContextId, storageContextId)
  if (settings === null) {
    log.warn(
      { contextId: target.contextId, contextType: target.contextType, storageContextId, configContextId },
      'Cannot route proactive chat delivery: context has no platform instance assignment',
    )
    return null
  }
  return settings.platformInstanceId
}
