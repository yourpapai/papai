// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'

import { toScopedContextId } from '../chat/scoped-context.js'
import { dmTarget } from '../chat/types.js'
import type { ChatProvider } from '../chat/types.js'
import { logger } from '../logger.js'
import { recordProactiveInHistory } from '../proactive-history.js'
import { listUsers } from '../users.js'

const log = logger.child({ scope: 'commands:announce-broadcast' })

const MAX_CONCURRENT_SENDS = 5

export interface BroadcastResult {
  totalUsers: number
  successCount: number
  failCount: number
}

/** Send `message` to every authorized (non-placeholder) user of a platform instance. */
export async function broadcastMessage(
  chat: Readonly<ChatProvider>,
  platformInstanceId: string,
  message: string,
): Promise<BroadcastResult> {
  const users = listUsers(platformInstanceId).filter((u) => !u.platform_user_id.startsWith('placeholder-'))
  if (users.length === 0) return { totalUsers: 0, successCount: 0, failCount: 0 }

  const limit = pLimit(MAX_CONCURRENT_SENDS)
  const results = await Promise.allSettled(
    users.map((user) =>
      limit(async () => {
        const result = await chat.sendMessage(platformInstanceId, dmTarget(user.platform_user_id), message)
        const ok = result !== false
        if (ok)
          recordProactiveInHistory(
            toScopedContextId({ platformInstanceId, nativeContextId: user.platform_user_id }),
            message,
          )
        return ok
      }),
    ),
  )

  results.forEach((result) => {
    if (result.status === 'rejected') {
      const errorMsg = result.reason instanceof Error ? result.reason.message : String(result.reason)
      log.warn({ platformInstanceId, error: errorMsg }, 'Failed to send announcement')
    }
  })

  const successCount = results.filter((r) => r.status === 'fulfilled' && r.value).length
  const failCount = results.length - successCount
  log.info({ platformInstanceId, totalUsers: users.length, successCount, failCount }, 'Broadcast complete')
  return { totalUsers: users.length, successCount, failCount }
}
