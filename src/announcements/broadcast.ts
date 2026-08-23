// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'

import { getNativeContextId, toScopedContextId } from '../chat/scoped-context.js'
import { dmTarget, type ChatProvider, type DeferredDeliveryTarget } from '../chat/types.js'
import { sendProactiveMessage } from '../deferred-prompts/proactive-delivery.js'
import type { Locale } from '../i18n/index.js'
import { logger } from '../logger.js'
import { recordProactiveInHistory } from '../proactive-history.js'
import { getContextLanguage } from '../utils/config-language.js'
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

export type AnnouncementBodies = Partial<Record<Locale, string>>

/**
 * The single fallback chain: the recipient's locale body, then the en body,
 * then the raw changelog section. Null only when nothing is usable.
 */
export function selectAnnouncementBody(
  bodies: AnnouncementBodies,
  rawBody: string | null,
  locale: Locale,
): string | null {
  return bodies[locale] ?? bodies.en ?? rawBody ?? null
}

export interface BroadcastDeps {
  listSubscribedUsers: () => SubscribedUser[]
  listSubscribedGroups: () => SubscribedGroup[]
  isDelivered: (version: string, contextId: string) => boolean
  recordDelivery: (version: string, contextId: string, contextType: 'dm' | 'group', status: 'sent' | 'failed') => void
  markBroadcast: (version: string, atIso: string) => void
  sendDm: (
    chat: Readonly<ChatProvider>,
    platformInstanceId: string,
    platformUserId: string,
    body: string,
  ) => Promise<boolean>
  sendGroup: (chat: Readonly<ChatProvider>, groupId: string, body: string) => Promise<boolean>
  getUserLocale: (platformInstanceId: string, platformUserId: string) => Locale
  getGroupLocale: (groupId: string) => Locale
  now: () => string
}

/**
 * Build a group delivery target from a subscribed `groupId` (the scoped config
 * context id, e.g. `pi:<instance>:ctx:<channel>`). `contextId` must carry the
 * NATIVE platform id — adapters use it verbatim as the send target (Mattermost
 * `channel_id`, Telegram `chat_id`) — while `storageContextId` keeps the scoped
 * id so delivery routing can recover the platform instance. Passing the scoped
 * id as `contextId` makes Mattermost POST to an invalid channel and fail 403.
 */
export function groupTarget(groupId: string): DeferredDeliveryTarget {
  return {
    contextId: getNativeContextId(groupId),
    contextType: 'group',
    threadId: null,
    audience: 'shared',
    mentionUserIds: [],
    // broadcast: no individual author
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
    const ok = result !== false
    if (ok) recordProactiveInHistory(toScopedContextId({ platformInstanceId, nativeContextId: platformUserId }), body)
    return ok
  },
  sendGroup: async (chat, groupId, body) => {
    const ok = await sendProactiveMessage(chat, groupTarget(groupId), body)
    if (ok) recordProactiveInHistory(groupId, body)
    return ok
  },
  getUserLocale: (platformInstanceId, platformUserId) =>
    getContextLanguage(toScopedContextId({ platformInstanceId, nativeContextId: platformUserId })),
  getGroupLocale: (groupId) => getContextLanguage(groupId),
  now: () => new Date().toISOString(),
}

/** Test-only handle to exercise the real send+record deps. */
export const defaultBroadcastDepsForTest = defaultDeps

// dedup key for announcement_deliveries only; not a canonical scoped context id
const dmContextKey = (u: SubscribedUser): string => `${u.platformInstanceId}:${u.platformUserId}`

/** Resolve the per-recipient body; a send with nothing usable counts as failed. */
const sendWithBody = (doSend: (body: string) => Promise<boolean>, body: string | null): Promise<boolean> =>
  body === null ? Promise.resolve(false) : doSend(body)

/** Per-recipient dedup check, failure-isolated send, and delivery recording. */
function makeSender(deps: BroadcastDeps, version: string, summary: BroadcastSummary) {
  return async (contextId: string, contextType: 'dm' | 'group', doSend: () => Promise<boolean>): Promise<void> => {
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
}

type EnqueueLimited = (fn: () => Promise<void>) => Promise<void>

function buildUserTasks(
  chat: Readonly<ChatProvider>,
  bodies: AnnouncementBodies,
  rawBody: string | null,
  deps: BroadcastDeps,
  send: ReturnType<typeof makeSender>,
  limit: EnqueueLimited,
): Promise<void>[] {
  return deps
    .listSubscribedUsers()
    .map((u) =>
      limit(() =>
        send(dmContextKey(u), 'dm', () =>
          sendWithBody(
            (body) => deps.sendDm(chat, u.platformInstanceId, u.platformUserId, body),
            selectAnnouncementBody(bodies, rawBody, deps.getUserLocale(u.platformInstanceId, u.platformUserId)),
          ),
        ),
      ),
    )
}

function buildGroupTasks(
  chat: Readonly<ChatProvider>,
  bodies: AnnouncementBodies,
  rawBody: string | null,
  deps: BroadcastDeps,
  send: ReturnType<typeof makeSender>,
  limit: EnqueueLimited,
): Promise<void>[] {
  return deps
    .listSubscribedGroups()
    .map((g) =>
      limit(() =>
        send(g.groupId, 'group', () =>
          sendWithBody(
            (body) => deps.sendGroup(chat, g.groupId, body),
            selectAnnouncementBody(bodies, rawBody, deps.getGroupLocale(g.groupId)),
          ),
        ),
      ),
    )
}

/**
 * Fan out per-locale bodies to all opt-in subscribers: each recipient's body is
 * `selectAnnouncementBody(bodies, rawBody, locale)` with the locale resolved from
 * their config context (DM scoped id / group scoped id). Idempotent per recipient;
 * failure-isolated. Dedup keys (`isDelivered`/`recordDelivery`) are locale-independent.
 */
export async function broadcastAnnouncement(
  chat: Readonly<ChatProvider>,
  version: string,
  bodies: AnnouncementBodies,
  rawBody: string | null,
  deps: BroadcastDeps = defaultDeps,
): Promise<BroadcastSummary> {
  const limit = pLimit(MAX_CONCURRENT_SENDS)
  const summary: BroadcastSummary = { sent: 0, failed: 0, skipped: 0 }
  const send = makeSender(deps, version, summary)

  const tasks = [
    ...buildUserTasks(chat, bodies, rawBody, deps, send, limit),
    ...buildGroupTasks(chat, bodies, rawBody, deps, send, limit),
  ]
  await Promise.allSettled(tasks)
  deps.markBroadcast(version, deps.now())
  log.info({ version, ...summary }, 'announcement broadcast complete')
  return summary
}
