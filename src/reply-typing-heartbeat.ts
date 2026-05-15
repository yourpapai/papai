// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatFile, ReplyFn, ReplyOptions } from './chat/types.js'
import { createScheduler } from './utils/scheduler.js'

const TYPING_INTERVAL_MS = 4500
const TYPING_HEARTBEAT_TASK = 'reply-typing-heartbeat'

type TextLikeReply = {
  (content: string): Promise<void>
  (content: string, options: ReplyOptions): Promise<void>
}
type FileLikeReply = {
  (file: ChatFile): Promise<void>
  (file: ChatFile, options: ReplyOptions): Promise<void>
}
type TypingHeartbeatOptions = { intervalMs: number | undefined }

function wrapReplyWithHeartbeatStop(reply: ReplyFn, stop: () => void): ReplyFn {
  const withStop =
    <Args extends readonly unknown[]>(fn: (...args: Args) => Promise<void>) =>
    (...args: Args): Promise<void> => {
      stop()
      return fn(...args)
    }
  const wrapTextReply =
    (fn: TextLikeReply): TextLikeReply =>
    (...args: [content: string] | [content: string, options: ReplyOptions]): Promise<void> => {
      const [content, options] = args
      stop()
      return options === undefined ? fn(content) : fn(content, options)
    }
  const wrapFileReply =
    (fn: FileLikeReply): FileLikeReply =>
    (...args: [file: ChatFile] | [file: ChatFile, options: ReplyOptions]): Promise<void> => {
      const [file, options] = args
      stop()
      return options === undefined ? fn(file) : fn(file, options)
    }

  return {
    ...reply,
    text: wrapTextReply(reply.text),
    formatted: wrapTextReply(reply.formatted),
    buttons: withStop(reply.buttons),
    ...(reply.replaceText === undefined ? {} : { replaceText: wrapTextReply(reply.replaceText) }),
    ...(reply.file === undefined ? {} : { file: wrapFileReply(reply.file) }),
    ...(reply.redactMessage === undefined ? {} : { redactMessage: withStop(reply.redactMessage) }),
    ...(reply.replaceButtons === undefined ? {} : { replaceButtons: withStop(reply.replaceButtons) }),
    ...(reply.embed === undefined ? {} : { embed: withStop(reply.embed) }),
  }
}

/**
 * Check if value is a Promise-like object (has catch method).
 */
function isPromiseLike(value: unknown): value is Promise<unknown> {
  if (value === undefined || value === null) return false
  if (typeof value !== 'object') return false
  return 'catch' in value && typeof (value as Record<string, unknown>)['catch'] === 'function'
}

/**
 * Send typing indicator safely, swallowing both sync and async errors.
 * Typing is best-effort and should never block message processing.
 */
function sendTypingSafely(reply: ReplyFn): void {
  // Cast to unknown-returning function since implementations may return
  // a Promise (even though ReplyFn.typing is typed as () => void)
  const typingFn = reply.typing as () => unknown

  // Call typing and capture result, handling both sync errors and async rejections
  let result: unknown
  try {
    result = typingFn()
  } catch {
    // Sync error - non-fatal
    return
  }

  // Handle async typing that returns a Promise
  if (isPromiseLike(result)) {
    const promise = result
    promise.catch(() => {
      // Non-fatal: typing is best-effort
    })
  }
}

/**
 * Execute a function with a typing heartbeat that periodically
 * triggers the typing indicator until a reply is sent.
 */
export async function withReplyTypingHeartbeat<T>(
  reply: ReplyFn,
  fn: (wrappedReply: ReplyFn) => Promise<T>,
  ...rest: [] | [options: TypingHeartbeatOptions]
): Promise<T> {
  let intervalMs = TYPING_INTERVAL_MS
  const options = rest[0]
  if (options !== undefined && options.intervalMs !== undefined) {
    intervalMs = options.intervalMs
  }

  const scheduler = createScheduler()
  let stopped = false

  const stop = (): void => {
    if (stopped) return
    stopped = true
    scheduler.stop(TYPING_HEARTBEAT_TASK)
    scheduler.unregister(TYPING_HEARTBEAT_TASK)
  }

  scheduler.register(TYPING_HEARTBEAT_TASK, {
    interval: intervalMs,
    handler: (): void => {
      if (stopped) return
      sendTypingSafely(reply)
    },
  })

  // Initial typing indicator
  sendTypingSafely(reply)

  scheduler.start(TYPING_HEARTBEAT_TASK)

  try {
    return await fn(wrapReplyWithHeartbeatStop(reply, stop))
  } finally {
    stop()
  }
}
