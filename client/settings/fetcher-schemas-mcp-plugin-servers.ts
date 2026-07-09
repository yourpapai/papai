// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

const ToolPolicyValue = z.enum(['allow', 'ask', 'deny'])

export const AdminMcpPluginServerConfigSchema = z.object({
  plugin_id: z.string(),
  enabled: z.boolean(),
  default_tool_policy: ToolPolicyValue,
  tool_policy: z.record(z.string(), ToolPolicyValue).optional(),
})
export type AdminMcpPluginServerConfig = z.infer<typeof AdminMcpPluginServerConfigSchema>

export const AdminMcpPluginServerAvailableSchema = z.object({
  pluginId: z.string(),
  name: z.string(),
  description: z.string(),
  tools: z.array(z.string()),
})
export type AdminMcpPluginServerAvailable = z.infer<typeof AdminMcpPluginServerAvailableSchema>

export const AdminMcpPluginServersResponseSchema = z.object({
  available: z.array(AdminMcpPluginServerAvailableSchema),
  configs: z.array(AdminMcpPluginServerConfigSchema),
})
export type AdminMcpPluginServersResponse = z.infer<typeof AdminMcpPluginServersResponseSchema>
