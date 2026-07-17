// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'

import { PLUGIN_API_VERSION, type DiscoveredPlugin } from '../../../plugins/types.js'

const retiredAcpManifest: DiscoveredPlugin['manifest'] = {
  id: 'acp',
  name: 'ACP Coding Sessions',
  version: '1.0.0',
  description: 'Retired plugin identity retained while coding sessions run as a trusted module',
  apiVersion: PLUGIN_API_VERSION,
  main: 'retired-module.ts',
  contributes: {
    tools: [],
    promptFragments: [],
    commands: [],
    jobs: [],
    configKeys: [],
    taskProviderTypes: [],
    attachmentTransformers: [],
  },
  permissions: [],
  defaultEnabled: false,
  activationTimeoutMs: 5000,
  requiredTaskCapabilities: [],
  requiredChatCapabilities: [],
  configRequirements: [],
  providerCapabilities: [],
  providerTraits: [],
  providerConfigSchema: [],
  providerContextConfigSchema: [],
  providerAllowedHosts: [],
}

const retiredAcpManifestHash = createHash('sha256').update(JSON.stringify(retiredAcpManifest)).digest('hex')

/**
 * Compatibility-only ACP discovery record. It deliberately has no executable
 * source: the coding trusted module owns all former ACP contributions.
 */
export const retiredAcpPluginDiscovery: Omit<DiscoveredPlugin, 'retired'> = {
  manifest: retiredAcpManifest,
  pluginDir: '/retired-plugins/acp',
  entryPoint: '',
  manifestHash: retiredAcpManifestHash,
}
