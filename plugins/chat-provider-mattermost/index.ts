// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export { createProvider, MattermostChatProvider } from './provider.js'

export default (): { activate(ctx: import('../../src/plugins/context.js').PluginContext): void } => ({
  activate(ctx: import('../../src/plugins/context.js').PluginContext): void {
    ctx.log.info({}, 'Mattermost chat provider plugin activated')
  },
})
