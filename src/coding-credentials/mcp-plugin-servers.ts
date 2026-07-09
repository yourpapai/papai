// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { getCachedConfig, setCachedConfig } from '../cache.js'
import { logger } from '../logger.js'
import { getPluginsForContext } from '../plugins/registry.js'
import { getSettingsPublicBaseUrl } from '../settings/config.js'
import type { ToolPolicy } from './resolve-agent-secrets.js'

const log = logger.child({ scope: 'coding-credentials:mcp-plugin-servers' })
const PREFIX = '__admin_mcp_plugin_servers__:'
const KEY = 'mcp_plugin_servers'

/** The name prefix that marks a coding-MCP selection as a papai-hosted internal plugin server. */
export const INTERNAL_SERVER_PREFIX = 'plugin:'

const toolPolicyValue = z.enum(['allow', 'ask', 'deny'])

export const mcpPluginServerConfigSchema = z.object({
  plugin_id: z.string().min(1),
  enabled: z.boolean(),
  default_tool_policy: toolPolicyValue,
  tool_policy: z.record(z.string(), toolPolicyValue).optional(),
})
export type McpPluginServerConfig = z.infer<typeof mcpPluginServerConfigSchema>

export const mcpPluginServerConfigsSchema = z.array(mcpPluginServerConfigSchema)

export function adminMcpPluginServersContextId(platformInstanceId: string): string {
  return `${PREFIX}${platformInstanceId}`
}

export function resolveMcpPluginServerConfigs(platformInstanceId: string): McpPluginServerConfig[] {
  const raw = getCachedConfig(adminMcpPluginServersContextId(platformInstanceId), KEY)
  if (raw === null) return []
  try {
    const parsed = mcpPluginServerConfigsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

export function setMcpPluginServerConfigs(platformInstanceId: string, configs: McpPluginServerConfig[]): void {
  setCachedConfig(
    adminMcpPluginServersContextId(platformInstanceId),
    KEY,
    JSON.stringify(mcpPluginServerConfigsSchema.parse(configs)),
  )
}

/** An effective internal MCP server: a plugin that is enabled by the operator AND active+eligible for the context. */
export interface InternalMcpServer {
  /** `plugin:<pluginId>` */
  name: string
  pluginId: string
  label: string
  upstreamUrl: string
  header: string
  toolPolicy: ToolPolicy
}

function toolPolicyOf(config: McpPluginServerConfig): ToolPolicy {
  return { default: config.default_tool_policy, tools: config.tool_policy }
}

/**
 * The internal MCP servers a user in `configContextId` may actually select: operator-enabled,
 * plugin active+eligible for the context, `mcpServer` declared, and a public base URL configured.
 * Fail-closed: empty when SETTINGS_PUBLIC_BASE_URL is unset.
 */
export function listEnabledInternalMcpServers(
  platformInstanceId: string,
  configContextId: string,
): InternalMcpServer[] {
  const base = getSettingsPublicBaseUrl()
  if (base === null) {
    log.debug({ configContextId }, 'SETTINGS_PUBLIC_BASE_URL unset; no internal MCP servers')
    return []
  }
  const configs = new Map(resolveMcpPluginServerConfigs(platformInstanceId).map((c) => [c.plugin_id, c]))
  const eligible = getPluginsForContext(configContextId)
  const servers: InternalMcpServer[] = []
  for (const plugin of eligible) {
    if (plugin.manifest.mcpServer !== true) continue
    const config = configs.get(plugin.manifest.id)
    if (config === undefined || !config.enabled) continue
    servers.push({
      name: `${INTERNAL_SERVER_PREFIX}${plugin.manifest.id}`,
      pluginId: plugin.manifest.id,
      label: plugin.manifest.name,
      upstreamUrl: `${base}/mcp/plugin/${encodeURIComponent(plugin.manifest.id)}`,
      header: 'Authorization',
      toolPolicy: toolPolicyOf(config),
    })
  }
  return servers
}
