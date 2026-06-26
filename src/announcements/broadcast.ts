// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'

import { dmTarget, type ChatProvider, type DeferredDeliveryTarget } from '../chat/types.js'
import { sendProactiveMessage } from '../deferred-prompts/proactive-delivery.js'
import { logger } from '../logger.js'
import {
  isDelivered as defaultIsDelivered,
  listSubscribedGroups as defaultListGroups,
  listSubscribedUsers as defaultListUsers,
  markBroadcast as defaultMarkBroadcast,
  recordDelivery as defaultRecordDelivery,
  type SubscribedGroup,
  type SubscribedUser,
} from './store.js'

const log = logger.child({ scope: 'announcements:broadcast' })

const MAX_CONCURRENT_SENDS = 5

export type BroadcastSummary = { sent: number; failed: number; skipped: number }

export interface BroadcastDeps {
  listSubscribedUsers: () => SubscribedUser[]
  listSubscribedGroups: () => SubscribedGroup[]
  isDelivered: (version: string, contextId: string) => boolean
  recordDelivery: (version: string, contextId: string, contextType: 'dm' | 'group', status: 'sent' | 'failed') => void
  markBroadcast: (version: string, atIso: string) => void
  sendDm: (chat: ChatProvider, platformInstanceId: string, platformUserId: string, body: string) => Promise<boolean>
  sendGroup: (chat: ChatProvider, groupId: string, body: string) => Promise<boolean>
  now: () => string
}

function groupTarget(groupId: string): DeferredDeliveryTarget {
  return {
    contextId: groupId,
    contextType: 'group',
    threadId: null,
    audience: 'shared',
    mentionUserIds: [],
    createdByUserId: '',
    createdByUsername: null,
    storageContextId: groupId,
  }
}

const defaultDeps: BroadcastDeps = {
  listSubscribedUsers: defaultListUsers,
  listSubscribedGroups: defaultListGroups,
  isDelivered: defaultIsDelivered,
  recordDelivery: defaultRecordDelivery,
  markBroadcast: defaultMarkBroadcast,
  sendDm: async (chat, platformInstanceId, platformUserId, body) => {
    const result = await chat.sendMessage(platformInstanceId, dmTarget(platformUserId), body)
    return result !== false
  },
  sendGroup: (chat, groupId, body) => sendProactiveMessage(chat, groupTarget(groupId), body),
  now: () => new Date().toISOString(),
}

const dmContextKey = (u: SubscribedUser): string => `${u.platformInstanceId}:${u.platformUserId}`

/** Fan out `body` to all opt-in subscribers. Idempotent per recipient; failure-isolated. */
export async function broadcastAnnouncement(
  chat: ChatProvider,
  version: string,
  body: string,
  deps: BroadcastDeps = defaultDeps,
): Promise<BroadcastSummary> {
  const limit = pLimit(MAX_CONCURRENT_SENDS)
  const summary: BroadcastSummary = { sent: 0, failed: 0, skipped: 0 }

  const send = async (
    contextId: string,
    contextType: 'dm' | 'group',
    doSend: () => Promise<boolean>,
  ): Promise<void> => {
    if (deps.isDelivered(version, contextId)) {
      summary.skipped += 1
      return
    }
    let ok = false
    try {
      ok = await doSend()
    } catch (error) {
      log.warn({ contextId, error: error instanceof Error ? error.message : String(error) }, 'announcement send threw')
      ok = false
    }
    deps.recordDelivery(version, contextId, contextType, ok ? 'sent' : 'failed')
    if (ok) summary.sent += 1
    else summary.failed += 1
  }

  const userTasks = deps
    .listSubscribedUsers()
    .map((u) =>
      limit(() => send(dmContextKey(u), 'dm', () => deps.sendDm(chat, u.platformInstanceId, u.platformUserId, body))),
    )
  const groupTasks = deps
    .listSubscribedGroups()
    .map((g) => limit(() => send(g.groupId, 'group', () => deps.sendGroup(chat, g.groupId, body))))

  await Promise.allSettled([...userTasks, ...groupTasks])
  deps.markBroadcast(version, deps.now())
  log.info({ version, ...summary }, 'announcement broadcast complete')
  return summary
}
