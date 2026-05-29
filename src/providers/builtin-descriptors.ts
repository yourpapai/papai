// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { ALL_CAPABILITIES, KANEO_TRAITS } from '../../plugins/task-provider-kaneo/constants.js'
import type { TaskCapability } from './task-capability.js'
import type { ProviderConfigField, TaskProviderTrait } from './types.js'
import { YOUTRACK_CAPABILITIES, YOUTRACK_TRAITS } from './youtrack/constants.js'

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
    type: 'kaneo',
    displayName: 'Kaneo',
    capabilities: ALL_CAPABILITIES,
    traits: KANEO_TRAITS,
    instanceConfigSchema: [
      { key: 'baseUrl', label: 'Kaneo URL', required: true, sensitive: false, scope: 'instance' },
      { key: 'internalUrl', label: 'Kaneo Internal URL', required: false, sensitive: false, scope: 'instance' },
    ],
    contextConfigSchema: [
      {
        key: 'credential',
        label: 'Kaneo API Key',
        required: true,
        sensitive: true,
        scope: 'context',
        storageKey: 'kaneo_apikey',
      },
      {
        key: 'workspaceId',
        label: 'Workspace ID',
        required: true,
        sensitive: false,
        scope: 'context',
        storageKey: 'kaneo_workspace_id',
      },
    ],
  },
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
