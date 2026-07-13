// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { requirePluginContext } from './context.ts'
import { testSchema } from './input-schema.ts'

const factory = (): {
  activate(ctx: unknown): void
  deactivate(ctx: unknown): void
} => {
  return {
    activate(ctx: unknown): void {
      const pluginContext = requirePluginContext(ctx)

      pluginContext.log.info({}, 'mcp-test plugin activated')

      pluginContext.registration.registerTool({
        name: 'test',
        description: 'Canary tool: returns a fixed string confirming the plugin MCP path is reachable',
        inputSchema: testSchema,
        execute: () => Promise.resolve('mcp-test ok: papai plugin MCP path is reachable'),
      })
    },

    deactivate(ctx: unknown): void {
      const pluginContext = requirePluginContext(ctx)
      pluginContext.log.info({}, 'mcp-test plugin deactivated')
    },
  }
}

export default factory
