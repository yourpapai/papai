// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getRequiredProviderConfigKeysForContext } from './config-keys.js'
import { getConfig, getConfigValue } from './config.js'
// getConfig already delegates to the config cache (and normalizes the timezone value), so a
// separate getCachedConfig fallback would be dead — it could only run when the value is null,
// where the cache is null too.
const readConfig = (contextId: string, key: 'timezone'): string | null => getConfig(contextId, key)

export const checkRequiredProviderConfig = (contextId: string): string[] => {
  const requiredKeys = getRequiredProviderConfigKeysForContext(contextId)
  return requiredKeys.filter((key) => getConfigValue(contextId, key) === null)
}

export const resolveConfigId = (contextId: string, configContextId: string | undefined): string => {
  if (configContextId !== undefined) return configContextId
  return contextId
}

export const resolveTimezone = (configId: string): string => {
  const configuredTimezone = readConfig(configId, 'timezone')
  if (configuredTimezone !== null) return configuredTimezone
  return 'UTC'
}
