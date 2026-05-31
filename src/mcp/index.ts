// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export { buildMcpToolSet } from './user-endpoints.js'
export { buildPluginMcpToolSet } from './plugin-endpoints.js'
export type { PluginMcpDescriptor } from './plugin-endpoints.js'
export { adaptMcpPool } from './plugin-pool-adapter.js'
export type { PluginPoolAdapter } from './plugin-pool-adapter.js'
export { McpConnectionPool, mcpPool } from './client-pool.js'
export { convertMcpToolsToToolSet } from './tool-adapter.js'
export type { McpEndpointConfig, McpPluginConfig, McpServerInfo, McpServerStatus } from './types.js'
