// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AnalyticsObserver } from '../analytics/runtime.js'
import { observeTurnStopRequested } from '../analytics/turn-observer.js'
import type { ChatProvider, CommandHandler } from '../chat/types.js'
import { t } from '../i18n/index.js'
import { logger } from '../logger.js'
import { runRegistry } from '../run-control/registry.js'
import { getContextLanguage } from '../utils/config-language.js'

const log = logger.child({ scope: 'commands:stop' })

export function registerStopCommand(chat: Readonly<ChatProvider>, analyticsObserver?: AnalyticsObserver): void {
  const handler: CommandHandler = async (msg, reply, auth) => {
    if (!auth.allowed) return

    const locale = getContextLanguage(auth.configContextId ?? auth.storageContextId)
    const run = runRegistry.get(auth.storageContextId)
    if (run === undefined) {
      await reply.text(t('commands.stop.nothingRunning', locale))
      return
    }

    if (run.stopRequested) {
      run.abortController.abort()
      log.info(
        { storageContextId: auth.storageContextId, turnId: run.turnId, userId: msg.user.id },
        '/stop force-abort',
      )
      observeTurnStopRequested(analyticsObserver, msg, auth, run.turnId, 'forced')
      await reply.text(t('commands.stop.stoppingNow', locale))
      return
    }

    run.stopRequested = true
    log.info({ storageContextId: auth.storageContextId, turnId: run.turnId, userId: msg.user.id }, '/stop graceful')
    observeTurnStopRequested(analyticsObserver, msg, auth, run.turnId, 'graceful')
    await reply.text(t('commands.stop.windingDown', locale))
  }

  chat.registerCommand('stop', handler)
}
