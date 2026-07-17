// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { kvSet, setPluginAdminConfig } from '../plugins/store.js'

// The ACP module deliberately retains the historic storage namespace so existing
// operator configuration and session rows survive the plugin-to-module move.
const ACP_NAMESPACE = 'acp'
const START_CAPABILITY_ID = 'coding-session.start'
const MAGI_BASE_URL_KEY = 'magi_base_url'
const MAGI_TOKEN_KEY = 'magi_token'
const ENABLED_CONTEXT_KEY = 'capability:enabled'

export type CodingSessionCapabilityConfig = Readonly<{
  pluginDirectory: string
  contextId: string
  magiBaseUrl: string
  magiToken: string
  updatedBy: string
}>

export type ConfiguredCodingSessionCapability = Readonly<{
  capabilityId: typeof START_CAPABILITY_ID
}>

/**
 * Story-facing compatibility seam. `pluginDirectory` remains part of the
 * public input contract but ACP is now an always-wired trusted module, so this
 * function only writes operator configuration to its stable legacy namespace.
 */
export function configureCodingSessionCapability(
  config: CodingSessionCapabilityConfig,
): ConfiguredCodingSessionCapability {
  setPluginAdminConfig(ACP_NAMESPACE, MAGI_BASE_URL_KEY, config.magiBaseUrl, config.updatedBy)
  setPluginAdminConfig(ACP_NAMESPACE, MAGI_TOKEN_KEY, config.magiToken, config.updatedBy)
  kvSet(ACP_NAMESPACE, config.contextId, ENABLED_CONTEXT_KEY, '1')
  return { capabilityId: START_CAPABILITY_ID }
}
