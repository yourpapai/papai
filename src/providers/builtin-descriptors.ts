// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { TaskCapability } from './task-capability.js'
import type { ProviderConfigField, TaskProviderTrait } from './types.js'

export type BuiltinDescriptorSeed = {
  type: string
  displayName: string
  capabilities: ReadonlySet<TaskCapability>
  instanceConfigSchema: readonly ProviderConfigField[]
  contextConfigSchema: readonly ProviderConfigField[]
  traits: ReadonlySet<TaskProviderTrait>
}

/**
 * Built-in task provider descriptor seeds.
 *
 * All task providers (Kaneo, YouTrack) are now plugin-contributed exclusively.
 * This array is intentionally empty and serves as the merge point in listTaskProviderTypes().
 */
export const builtinDescriptorSeeds: readonly BuiltinDescriptorSeed[] = []
