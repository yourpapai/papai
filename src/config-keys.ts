// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getContextSettings } from './instances/context-store.js'
import { getTaskInstance } from './instances/task-store.js'
import type { ConfigKey } from './types/config.js'

const PREFERENCE_KEYS: readonly ConfigKey[] = ['timezone', 'mcp_endpoints']

export function getConfigKeysForContext(contextId: string): readonly ConfigKey[] {
  const settings = getContextSettings(contextId)
  if (settings === null) return PREFERENCE_KEYS

  const instance = getTaskInstance(settings.taskInstanceId)
  if (instance === null || instance.status !== 'active') return PREFERENCE_KEYS

  if (instance.type === 'youtrack') return ['youtrack_token', ...PREFERENCE_KEYS]
  if (instance.type === 'kaneo') return ['kaneo_apikey', ...PREFERENCE_KEYS]
  return PREFERENCE_KEYS
}
