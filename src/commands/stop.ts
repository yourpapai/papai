// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AnalyticsObserver } from '../analytics/runtime.js'
import { observeTurnStopRequested } from '../analytics/turn-observer.js'
import type { ChatProvider, CommandHandler } from '../chat/types.js'
import { logger } from '../logger.js'
import { runRegistry } from '../run-control/registry.js'

const log = logger.child({ scope: 'commands:stop' })

export function registerStopCommand(chat: Readonly<ChatProvider>, analyticsObserver?: AnalyticsObserver): void {
  const handler: CommandHandler = async (msg, reply, auth) => {
    if (!auth.allowed) return

    const run = runRegistry.get(auth.storageContextId)
    if (run === undefined) {
      await reply.text('Nothing is running right now.')
      return
    }

    if (run.stopRequested) {
      run.abortController.abort()
      log.info(
        { storageContextId: auth.storageContextId, turnId: run.turnId, userId: msg.user.id },
        '/stop force-abort',
      )
      observeTurnStopRequested(analyticsObserver, msg, auth, run.turnId, 'forced')
      await reply.text('🛑 Stopping immediately…')
      return
    }

    run.stopRequested = true
    log.info({ storageContextId: auth.storageContextId, turnId: run.turnId, userId: msg.user.id }, '/stop graceful')
    observeTurnStopRequested(analyticsObserver, msg, auth, run.turnId, 'graceful')
    await reply.text('🛑 winding down after this step…')
  }

  chat.registerCommand('stop', handler)
}
