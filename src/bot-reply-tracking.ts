import type { ButtonReplyOptions, ChatFile, EmbedOptions, ReplyFn, ReplyOptions } from './chat/types.js'
import { emitUser } from './debug/event-bus.js'

export type TrackedReply = { reply: ReplyFn; didReply: () => boolean }

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
  fn: { (content: string): Promise<void>; (content: string, options: ReplyOptions): Promise<void> },
): { (content: string): Promise<void>; (content: string, options: ReplyOptions): Promise<void> } {
  function tracked(content: string): Promise<void>
  function tracked(content: string, options: ReplyOptions): Promise<void>
  async function tracked(...args: [content: string] | [content: string, options: ReplyOptions]): Promise<void> {
    markReplied()
    const [content, options] = args
    await invokeReplyText(fn, content, options)
  }

  return tracked
}

function createTrackedFileReply(
  markReplied: () => void,
  fn: { (file: ChatFile): Promise<void>; (file: ChatFile, options: ReplyOptions): Promise<void> },
): { (file: ChatFile): Promise<void>; (file: ChatFile, options: ReplyOptions): Promise<void> } {
  function tracked(file: ChatFile): Promise<void>
  function tracked(file: ChatFile, options: ReplyOptions): Promise<void>
  async function tracked(...args: [file: ChatFile] | [file: ChatFile, options: ReplyOptions]): Promise<void> {
    markReplied()
    const [file, options] = args
    if (options === undefined) {
      await fn(file)
      return
    }

    await fn(file, options)
  }

  return tracked
}

function createTrackedButtonsReply(
  markReplied: () => void,
  fn: (content: string, options: ButtonReplyOptions) => Promise<void>,
): (content: string, options: ButtonReplyOptions) => Promise<void> {
  return async (content: string, options: ButtonReplyOptions): Promise<void> => {
    markReplied()
    await fn(content, options)
  }
}

function withOptionalReplies(reply: ReplyFn, markReplied: () => void, supportsFiles: boolean): Partial<ReplyFn> {
  const replaceText = reply.replaceText
  const file = reply.file
  const redactMessage = reply.redactMessage
  const replaceButtons = reply.replaceButtons
  const embed = reply.embed
  const tracked: Partial<ReplyFn> = {}

  if (replaceText !== undefined) tracked.replaceText = createTrackedTextReply(markReplied, replaceText)
  if (supportsFiles && file !== undefined) tracked.file = createTrackedFileReply(markReplied, file)
  if (redactMessage !== undefined) {
    tracked.redactMessage = async (replacementText: string): Promise<void> => {
      markReplied()
      await redactMessage(replacementText)
    }
  }
  if (replaceButtons !== undefined) tracked.replaceButtons = createTrackedButtonsReply(markReplied, replaceButtons)
  if (embed !== undefined) {
    tracked.embed = async (options: EmbedOptions): Promise<void> => {
      markReplied()
      await embed(options)
    }
  }

  return tracked
}

export function trackReplyUsage(reply: ReplyFn, supportsFiles: boolean): TrackedReply {
  let replied = false
  const markReplied = (): void => {
    replied = true
  }

  return {
    reply: {
      ...reply,
      text: createTrackedTextReply(markReplied, reply.text),
      formatted: createTrackedTextReply(markReplied, reply.formatted),
      buttons: createTrackedButtonsReply(markReplied, reply.buttons),
      ...withOptionalReplies(reply, markReplied, supportsFiles),
    },
    didReply: (): boolean => replied,
  }
}

function emitReplyCompleted(userId: string, contextId: string, start: number, turnId?: string): void {
  emitUser('reply:sent', userId, { contextId, duration: Date.now() - start }, turnId)
  emitUser('message:replied', userId, { contextId, duration: Date.now() - start }, turnId)
}

export function emitReplyCompletedIfNeeded(
  tracked: TrackedReply,
  userId: string,
  contextId: string,
  start: number,
  turnId?: string,
): void {
  if (tracked.didReply()) emitReplyCompleted(userId, contextId, start, turnId)
}
