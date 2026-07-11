// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { requirePluginContext } from './context.js'

const factory = (): {
  activate(ctx: unknown): void
  deactivate(ctx: unknown): void
} => {
  return {
    activate(ctx: unknown): void {
      const pluginContext = requirePluginContext(ctx)
      pluginContext.log.info({}, 'mcp-figma plugin activated (scaffold)')
      // Tool registrations land in a later task.
    },

    deactivate(ctx: unknown): void {
      const pluginContext = requirePluginContext(ctx)
      pluginContext.log.info({}, 'mcp-figma plugin deactivated')
    },
  }
}

export default factory
