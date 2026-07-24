// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { performance } from 'node:perf_hooks'

import {
  buildAnalyticsSourceContext,
  buildChatMessageAcceptedFact,
  createAuthorizedTurnSeed,
  type AuthorizedTurnSeed,
} from './analytics/bot-observer.js'
import type { AnalyticsObserver } from './analytics/runtime.js'
import type { AnalyticsSourceContext } from './analytics/source-facts.js'
import type { AuthorizedTurnContextRegistry } from './analytics/turn-context.js'
import {
  buildGuestTurnAggregateFact,
  buildTurnCompletedFact,
  buildTurnStartedFact,
  buildTurnSteeredFact,
  nextSteerOrdinal,
} from './analytics/turn-observer.js'
import type { StagedFileDownloadFn } from './attachments/types.js'
import { findVoiceStagedIds, resolveMessageAttachments, resolveVoiceStagedFiles } from './bot-attachments.js'
import {
  createReplyDeliveryTracker,
  emitReplyCompletedIfNeeded,
  trackReplyUsage,
  type ReplyAnalytics,
  type ReplyDeliveryTracker,
} from './bot-reply-tracking.js'
import { replyToUnauthorized } from './bot-unauthorized-reply.js'
import type { ChatParticipantResolver } from './chat/participants/roster.js'
import { maybeSeedContextAssignment } from './chat/seed-context-assignment.js'
import type { AuthorizationResult, ChatProvider, IncomingMessage, ReplyFn } from './chat/types.js'
import type { ProcessMessageFn } from './llm-orchestrator-process-args.js'
import { defaultDeps } from './llm-orchestrator.js'
import { logger } from './logger.js'
import { enqueueMessage, type CoalescedItem as QueuedCoalescedItem } from './message-queue/index.js'
import { buildPromptWithReplyContext } from './reply-context.js'
import { runRegistry } from './run-control/registry.js'
import type { RunControl } from './run-control/types.js'

export type BotDeps = Readonly<{ processMessage: ProcessMessageFn }> &
  Readonly<
    Partial<
      Record<'stagedDownloadFn', StagedFileDownloadFn> &
        Record<'enqueueMessage', typeof enqueueMessage> &
        Record<'chatParticipantResolver', ChatParticipantResolver> &
        Record<'analyticsObserver', AnalyticsObserver> &
        Record<'analyticsTurnRegistry', AuthorizedTurnContextRegistry>
    >
  >

const log = logger.child({ scope: 'bot' })

type TurnAnalytics = Readonly<{
  observer: AnalyticsObserver
  seed: AuthorizedTurnSeed
  source: AnalyticsSourceContext
  isGuest: boolean
}>

function resolveTurnAnalytics(
  deps: BotDeps,
  seed: AuthorizedTurnSeed | undefined,
  turnId: string,
): TurnAnalytics | null {
  const observer = deps.analyticsObserver
  if (observer === undefined || seed === undefined) return null
  return { observer, seed, source: { ...seed.source, rawTurnId: turnId }, isGuest: seed.source.actorRole === 'guest' }
}

function createTurnReplyAnalytics(analytics: TurnAnalytics | null): ReplyAnalytics | undefined {
  if (analytics === null || analytics.isGuest) return undefined
  return {
    observer: analytics.observer,
    source: analytics.source,
    sourceEventId: `${analytics.seed.sourceEventId}:reply_sent`,
  }
}

function observeTurnStart(analytics: TurnAnalytics, deps: BotDeps, turnId: string, startMonotonicMs: number): void {
  if (analytics.isGuest) return
  deps.analyticsTurnRegistry?.register({ turnId, source: analytics.source })
  analytics.observer.observe(
    buildTurnStartedFact(analytics.seed, analytics.source, startMonotonicMs - analytics.seed.acceptedAtMonotonicMs),
  )
}

function observeTurnCompletion(
  analytics: TurnAnalytics,
  deps: BotDeps,
  turnId: string,
  outcome: 'ok' | 'llm_error',
  durationMs: number,
  replyCount: number,
): void {
  if (analytics.isGuest) {
    analytics.observer.observe(buildGuestTurnAggregateFact(analytics.seed, analytics.source, outcome))
    return
  }
  analytics.observer.observe(
    buildTurnCompletedFact(analytics.seed, analytics.source, { outcome, durationMs, replyCount }),
  )
  deps.analyticsTurnRegistry?.complete(turnId)
}

async function runTurnProcess(coalescedItem: QueuedCoalescedItem, deps: BotDeps, reply: ReplyFn): Promise<void> {
  const voiceAttachmentIds = await resolveVoiceStagedFiles(
    coalescedItem.storageContextId,
    coalescedItem.voiceStagedIds,
    deps.stagedDownloadFn,
  )
  await deps.processMessage(
    reply,
    coalescedItem.storageContextId,
    coalescedItem.userId,
    coalescedItem.username,
    coalescedItem.text,
    coalescedItem.contextType,
    coalescedItem.configContextId,
    {
      ...defaultDeps,
      stagedDownloadFn: deps.stagedDownloadFn,
      chatParticipantResolver: deps.chatParticipantResolver,
    },
    [...voiceAttachmentIds, ...coalescedItem.newAttachmentIds],
    coalescedItem.turnId,
    coalescedItem.actorRole,
    coalescedItem.messageIds,
    coalescedItem.segments,
  )
}

export async function processQueuedTurn(coalescedItem: QueuedCoalescedItem, deps: BotDeps): Promise<void> {
  const start = Date.now()
  const startMonotonicMs = performance.now()
  const analytics = resolveTurnAnalytics(deps, coalescedItem.analyticsTurnSeed, coalescedItem.turnId)
  const delivery: ReplyDeliveryTracker | undefined =
    analytics !== null && !analytics.isGuest ? createReplyDeliveryTracker(startMonotonicMs) : undefined
  const tracked = trackReplyUsage(coalescedItem.reply, true, delivery)
  if (analytics !== null) observeTurnStart(analytics, deps, coalescedItem.turnId, startMonotonicMs)
  let outcome: 'ok' | 'llm_error' = 'ok'
  try {
    await runTurnProcess(coalescedItem, deps, tracked.reply)
  } catch (error) {
    outcome = 'llm_error'
    throw error
  } finally {
    emitReplyCompletedIfNeeded(
      tracked,
      coalescedItem.userId,
      coalescedItem.storageContextId,
      start,
      coalescedItem.turnId,
      createTurnReplyAnalytics(analytics),
    )
    if (analytics !== null) {
      observeTurnCompletion(
        analytics,
        deps,
        coalescedItem.turnId,
        outcome,
        performance.now() - startMonotonicMs,
        delivery?.stats().succeededCount ?? 0,
      )
    }
  }
}

function shouldIgnoreGroupMessage(msg: IncomingMessage): boolean {
  if (msg.contextType !== 'group') return false
  if (msg.commandMatch !== undefined && msg.commandMatch !== '') return false
  return !msg.isMentioned && msg.isReplyToBot !== true
}

function createMessageSeed(
  observer: AnalyticsObserver | undefined,
  msg: IncomingMessage,
  auth: AuthorizationResult,
  attachmentCount: number,
): AuthorizedTurnSeed | undefined {
  if (observer === undefined) return undefined
  const source = buildAnalyticsSourceContext(msg, auth, 'normal', null)
  if (source === null) return undefined
  return createAuthorizedTurnSeed(source, msg, attachmentCount, {
    nowMs: () => Date.now(),
    nowMonotonicMs: () => performance.now(),
  })
}

async function steerActiveRun(
  activeRun: RunControl,
  reply: ReplyFn,
  auth: AuthorizationResult,
  steerText: string,
  seed: AuthorizedTurnSeed | undefined,
  observer: AnalyticsObserver | undefined,
): Promise<void> {
  activeRun.steerQueue.push({ text: steerText })
  log.debug(
    { storageContextId: auth.storageContextId, turnId: activeRun.turnId },
    'Mid-run message routed to steer queue',
  )
  await reply.text('✋ folding that into the current run…')
  if (observer === undefined || seed === undefined) return
  observer.observe(
    buildTurnSteeredFact(
      { ...seed.source, rawTurnId: activeRun.turnId },
      {
        sourceEventId: `${seed.sourceEventId}:steered`,
        ordinal: nextSteerOrdinal(activeRun),
        steerLengthChars: steerText.length,
        ackSent: true,
      },
    ),
  )
}

export async function handleAuthorizedMessage(
  chat: ChatProvider,
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
  deps: BotDeps,
): Promise<void> {
  if (!auth.allowed) {
    if (msg.isMentioned) await replyToUnauthorized(reply, auth, msg.contextId)
    return
  }
  if (shouldIgnoreGroupMessage(msg)) return
  maybeSeedContextAssignment(auth, msg.platformInstanceId)
  const voiceStagedIds = msg.contextType === 'group' ? findVoiceStagedIds(auth.storageContextId, msg.messageId) : []
  const { newAttachmentIds, activeAttachments } = await resolveMessageAttachments(chat, msg, auth.storageContextId)
  const newAttachmentIdSet = new Set(newAttachmentIds)
  const messageAttachments = activeAttachments.filter((ref) => newAttachmentIdSet.has(ref.attachmentId))
  const steerText = buildPromptWithReplyContext(msg, messageAttachments, auth.storageContextId)

  const observer = deps.analyticsObserver
  const seed = createMessageSeed(observer, msg, auth, newAttachmentIds.length)
  if (observer !== undefined && seed !== undefined) {
    observer.observe(buildChatMessageAcceptedFact(seed, { isCommand: false, command: 'none' }))
  }

  const activeRun = runRegistry.get(auth.storageContextId)
  if (activeRun !== undefined) {
    await steerActiveRun(activeRun, reply, auth, steerText, seed, observer)
    return
  }

  const queueMessage = deps.enqueueMessage ?? enqueueMessage
  queueMessage(
    {
      text: steerText,
      userId: msg.user.id,
      username: msg.user.username,
      storageContextId: auth.storageContextId,
      configContextId: auth.configContextId,
      contextType: msg.contextType,
      newAttachmentIds,
      voiceStagedIds,
      actorRole: auth.isGuest === true ? 'guest' : 'member',
      messageId: msg.messageId,
      analyticsTurnSeed: seed,
    },
    reply,
    (coalescedItem): Promise<void> => processQueuedTurn(coalescedItem, deps),
  )
}
