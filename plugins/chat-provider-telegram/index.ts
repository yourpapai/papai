// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export { createProvider, TelegramChatProvider, extractReplyContext } from './provider.js'

export default (): { activate(ctx: import('../../src/plugins/context.js').PluginContext): void } => ({
  activate(ctx: import('../../src/plugins/context.js').PluginContext): void {
    // Chat provider factory is registered via the early-pass (chatProviderFactory manifest field).
    // Full activation can register additional contributions if needed.
    ctx.log.info({}, 'Telegram chat provider plugin activated')
  },
})
