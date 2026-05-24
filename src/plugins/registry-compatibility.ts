// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatCapability } from '../chat/types.js'
import type { TaskCapability } from '../providers/types.js'

export type PluginCompatibilityInstance = Readonly<{
  taskCapabilities: ReadonlySet<TaskCapability>
  chatCapabilities: ReadonlySet<ChatCapability>
}>

export const NO_ACTIVE_INSTANCE_COMPATIBILITY_REASON = 'No active instance satisfies required capabilities'

const EMPTY_CAPABILITIES: ReadonlySet<never> = new Set()

export function normalizeCompatibilityInstances(
  instances: readonly PluginCompatibilityInstance[],
): readonly PluginCompatibilityInstance[] {
  if (instances.length > 0) return instances
  return [{ taskCapabilities: EMPTY_CAPABILITIES, chatCapabilities: EMPTY_CAPABILITIES }]
}
