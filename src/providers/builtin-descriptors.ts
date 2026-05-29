// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { YOUTRACK_CAPABILITIES, YOUTRACK_TRAITS } from '../../plugins/task-provider-youtrack/constants.js'
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

export const builtinDescriptorSeeds: readonly BuiltinDescriptorSeed[] = [
  {
    type: 'youtrack',
    displayName: 'YouTrack',
    capabilities: YOUTRACK_CAPABILITIES,
    traits: YOUTRACK_TRAITS,
    instanceConfigSchema: [
      { key: 'baseUrl', label: 'YouTrack URL', required: true, sensitive: false, scope: 'instance' },
    ],
    contextConfigSchema: [
      {
        key: 'token',
        label: 'YouTrack Permanent Token',
        required: true,
        sensitive: true,
        scope: 'context',
        storageKey: 'youtrack_token',
      },
    ],
  },
]
