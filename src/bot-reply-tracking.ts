// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { performance } from 'node:perf_hooks'

import type { AnalyticsObserver } from './analytics/runtime.js'
import type { AnalyticsSourceContext, ReplySentFact } from './analytics/source-facts.js'
import type { ButtonReplyOptions, ChatFile, EmbedOptions, ReplyFn, ReplyOptions } from './chat/types.js'
import { emitUser } from './debug/event-bus.js'

/** Per-part cap so tracked reply lengths stay bounded regardless of content size. */
const MAX_REPLY_PART_CHARS = 65_536

export type ReplyDeliveryStats = Readonly<{
  partCount: number
  succeededCount: number
  failedCount: number
  totalLengthChars: number
  firstLatencyMs: number | null
}>

export type ReplyDeliveryTracker = Readonly<{
  record: (ok: boolean, lengthChars: number) => void
  stats: () => ReplyDeliveryStats
}>

/** Accumulates adapter-bound delivery outcomes; the first settled part fixes firstLatencyMs. */
export function createReplyDeliveryTracker(
  startMonotonicMs: number,
  nowMonotonicMs: () => number = () => performance.now(),
): ReplyDeliveryTracker {
  let partCount = 0
  let succeededCount = 0
  let failedCount = 0
  let totalLengthChars = 0
  let firstLatencyMs: number | null = null
  return {
    record: (ok, lengthChars) => {
      partCount += 1
      if (ok) succeededCount += 1
      else failedCount += 1
      totalLengthChars += Math.min(Math.max(0, lengthChars), MAX_REPLY_PART_CHARS)
      firstLatencyMs ??= Math.max(0, Math.round(nowMonotonicMs() - startMonotonicMs))
    },
    stats: () => ({ partCount, succeededCount, failedCount, totalLengthChars, firstLatencyMs }),
  }
}

export type TrackedReply = { reply: ReplyFn; didReply: () => boolean; delivery: ReplyDeliveryTracker | null }

type RecordDelivery = (ok: boolean, lengthChars: number) => void

const NO_DELIVERY: RecordDelivery = () => undefined

function invokeReplyText(
  fn: { (content: string): Promise<void>; (content: string, options: ReplyOptions): Promise<void> },
  content: string,
  options: ReplyOptions | undefined,
): Promise<void> {
  if (options === undefined) return fn(content)
  return fn(content, options)
}

function createTrackedTextReply(
  markReplied: () => void,
  record: RecordDelivery,
  fn: { (content: string): Promise<void>; (content: string, options: ReplyOptions): Promise<void> },
): { (content: string): Promise<void>; (content: string, options: ReplyOptions): Promise<void> } {
  function tracked(content: string): Promise<void>
  function tracked(content: string, options: ReplyOptions): Promise<void>
  async function tracked(...args: [content: string] | [content: string, options: ReplyOptions]): Promise<void> {
    markReplied()
    const [content, options] = args
    try {
      await invokeReplyText(fn, content, options)
      record(true, content.length)
    } catch (error) {
      record(false, content.length)
      throw error
    }
  }

  return tracked
}

function createTrackedFileReply(
  markReplied: () => void,
  record: RecordDelivery,
  fn: { (file: ChatFile): Promise<void>; (file: ChatFile, options: ReplyOptions): Promise<void> },
): { (file: ChatFile): Promise<void>; (file: ChatFile, options: ReplyOptions): Promise<void> } {
  function tracked(file: ChatFile): Promise<void>
  function tracked(file: ChatFile, options: ReplyOptions): Promise<void>
  async function tracked(...args: [file: ChatFile] | [file: ChatFile, options: ReplyOptions]): Promise<void> {
    markReplied()
    const [file, options] = args
    try {
      if (options === undefined) await fn(file)
      else await fn(file, options)
      record(true, 0)
    } catch (error) {
      record(false, 0)
      throw error
    }
  }

  return tracked
}

function createTrackedButtonsReply(
  markReplied: () => void,
  record: RecordDelivery,
  fn: ReplyFn['buttons'],
): ReplyFn['buttons'] {
  return async (content: string, options: ButtonReplyOptions) => {
    markReplied()
    try {
      const result = await fn(content, options)
      record(true, content.length)
      return result
    } catch (error) {
      record(false, content.length)
      throw error
    }
  }
}

function createTrackedRedactMessage(
  markReplied: () => void,
  record: RecordDelivery,
  fn: NonNullable<ReplyFn['redactMessage']>,
): NonNullable<ReplyFn['redactMessage']> {
  return async (replacementText: string): Promise<void> => {
    markReplied()
    try {
      await fn(replacementText)
      record(true, replacementText.length)
    } catch (error) {
      record(false, replacementText.length)
      throw error
    }
  }
}

function createTrackedReplaceButtons(
  markReplied: () => void,
  record: RecordDelivery,
  fn: NonNullable<ReplyFn['replaceButtons']>,
): NonNullable<ReplyFn['replaceButtons']> {
  return async (content: string, options: ButtonReplyOptions): Promise<void> => {
    markReplied()
    try {
      await fn(content, options)
      record(true, content.length)
    } catch (error) {
      record(false, content.length)
      throw error
    }
  }
}

function createTrackedEmbed(
  markReplied: () => void,
  record: RecordDelivery,
  fn: NonNullable<ReplyFn['embed']>,
): NonNullable<ReplyFn['embed']> {
  return async (options: EmbedOptions): Promise<void> => {
    markReplied()
    try {
      await fn(options)
      record(true, 0)
    } catch (error) {
      record(false, 0)
      throw error
    }
  }
}

function withOptionalReplies(
  reply: ReplyFn,
  markReplied: () => void,
  record: RecordDelivery,
  supportsFiles: boolean,
): Partial<ReplyFn> {
  const tracked: Partial<ReplyFn> = {}

  if (reply.replaceText !== undefined)
    tracked.replaceText = createTrackedTextReply(markReplied, record, reply.replaceText)
  if (supportsFiles && reply.file !== undefined) tracked.file = createTrackedFileReply(markReplied, record, reply.file)
  if (reply.redactMessage !== undefined)
    tracked.redactMessage = createTrackedRedactMessage(markReplied, record, reply.redactMessage)
  if (reply.replaceButtons !== undefined)
    tracked.replaceButtons = createTrackedReplaceButtons(markReplied, record, reply.replaceButtons)
  if (reply.embed !== undefined) tracked.embed = createTrackedEmbed(markReplied, record, reply.embed)

  return tracked
}

export function trackReplyUsage(reply: ReplyFn, supportsFiles: boolean, delivery?: ReplyDeliveryTracker): TrackedReply {
  let replied = false
  const markReplied = (): void => {
    replied = true
  }
  const record: RecordDelivery = delivery === undefined ? NO_DELIVERY : delivery.record

  return {
    reply: {
      ...reply,
      text: createTrackedTextReply(markReplied, record, reply.text),
      formatted: createTrackedTextReply(markReplied, record, reply.formatted),
      buttons: createTrackedButtonsReply(markReplied, record, reply.buttons),
      ...withOptionalReplies(reply, markReplied, record, supportsFiles),
    },
    didReply: (): boolean => replied,
    delivery: delivery ?? null,
  }
}

function emitReplyCompleted(userId: string, contextId: string, start: number, turnId?: string): void {
  emitUser('reply:sent', userId, { contextId, duration: Date.now() - start }, turnId)
  emitUser('message:replied', userId, { contextId, duration: Date.now() - start }, turnId)
}

/** Analytics side of a completed reply: the authoritative source plus the fact's idempotency anchor. */
export type ReplyAnalytics = Readonly<{
  observer: AnalyticsObserver
  source: AnalyticsSourceContext
  sourceEventId: string
}>

function deliveryOutcomeOf(stats: ReplyDeliveryStats | null): ReplySentFact['delivery'] {
  if (stats === null) return 'success'
  if (stats.failedCount === 0) return 'success'
  if (stats.succeededCount === 0) return 'failed'
  return 'partial'
}

function buildReplySentFact(tracked: TrackedReply, start: number, analytics: ReplyAnalytics): ReplySentFact {
  const stats = tracked.delivery?.stats() ?? null
  return {
    version: 1,
    type: 'reply_sent',
    sourceEventId: analytics.sourceEventId,
    occurredAtMs: Date.now(),
    source: analytics.source,
    latencyMs: stats?.firstLatencyMs ?? Math.max(0, Date.now() - start),
    partCount: stats?.partCount ?? 1,
    totalLengthChars: stats?.totalLengthChars ?? 0,
    delivery: deliveryOutcomeOf(stats),
  }
}

export function emitReplyCompletedIfNeeded(
  tracked: TrackedReply,
  userId: string,
  contextId: string,
  start: number,
  turnId?: string,
  analytics?: ReplyAnalytics,
): void {
  if (!tracked.didReply()) return
  emitReplyCompleted(userId, contextId, start, turnId)
  if (analytics !== undefined) analytics.observer.observe(buildReplySentFact(tracked, start, analytics))
}
