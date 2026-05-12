import { buildAttachmentManifest } from './attachments/resolver.js'
import { findStagedFilesByMessageId } from './attachments/staged.js'
import type { AttachmentRef } from './attachments/types.js'
import type { IncomingMessage } from './chat/types.js'
import { logger } from './logger.js'
import { buildReplyChain, getCachedMessage } from './message-cache/index.js'

const log = logger.child({ scope: 'reply-context' })

/**
 * Builds chain and summary from cached messages for a reply.
 * Uses the shared message-cache infrastructure (in-memory + SQLite).
 */
export function buildReplyContextChain(
  contextId: string,
  replyToMessageId: string,
): { chain?: string[]; chainSummary?: string } {
  const result = buildReplyChain(contextId, replyToMessageId)

  if (result.chain.length <= 1) {
    return {}
  }

  // Build summary from earlier messages (exclude the last = immediate parent, already shown in replyContext.text)
  const earlierMessages = result.chain.slice(0, -1)
  const summaries: string[] = []

  for (const msgId of earlierMessages) {
    const msg = getCachedMessage(contextId, msgId)
    if (msg === undefined || msg.text === undefined || msg.text === '') continue
    const author = msg.authorUsername ?? 'user'
    summaries.push(`${author}: ${msg.text}`)
  }

  return {
    chain: result.chain,
    chainSummary: summaries.length > 0 ? summaries.join(' → ') : undefined,
  }
}

/**
 * Builds a prompt string with reply context and an attachment manifest prepended.
 *
 * ReplyContext is already fully populated by platform providers:
 * - Telegram: reply_to_message fields + message cache chain
 * - Mattermost: cached parent or API fetch + message cache chain
 *
 * The attachment manifest is built from the active attachment workspace by
 * the bot before queueing (see `src/bot.ts`). Raw `IncomingFile` payloads no
 * longer drive prompt rendering; they are persisted into the workspace and
 * surfaced as stable `AttachmentRef`s.
 */
function hasContextData(msg: IncomingMessage, attachments: readonly AttachmentRef[]): boolean {
  return msg.replyContext !== undefined || attachments.length > 0
}

function logReplyContextDebug(msg: IncomingMessage): void {
  if (msg.replyContext === undefined) return
  const replyTextLength = msg.replyContext.text?.length ?? 0
  const quotedTextLength = msg.replyContext.quotedText?.length ?? 0
  const hasChainSummary = msg.replyContext.chainSummary !== undefined && msg.replyContext.chainSummary !== ''

  log.debug(
    {
      messageId: msg.messageId,
      replyToMessageId: msg.replyContext.messageId,
      replyTextLength,
      quotedTextLength,
      hasChainSummary,
      replyTextPreview: msg.replyContext.text?.slice(0, 100),
      quotedTextPreview: msg.replyContext.quotedText?.slice(0, 100),
    },
    'Building prompt with reply context',
  )
}

function buildReplyContextLines(msg: IncomingMessage): string[] {
  const lines: string[] = []
  if (msg.replyContext === undefined) return lines

  if (msg.replyContext.text !== undefined) {
    const author = msg.replyContext.authorUsername ?? 'user'
    lines.push(`[Replying to message from ${author}: "${msg.replyContext.text}"]`)
  }

  if (msg.replyContext.quotedText !== undefined) {
    const label =
      msg.replyContext.quotedTextTruncated === true
        ? 'Quoted text (truncated — see full message in reply context above)'
        : 'Quoted text'
    lines.push(`[${label}: "${msg.replyContext.quotedText}"]`)
  }

  if (msg.replyContext.chainSummary !== undefined && msg.replyContext.chainSummary !== '') {
    lines.push(`[Earlier context: ${msg.replyContext.chainSummary}]`)
  }
  return lines
}

function logPromptBuilt(contextLength: number, finalPrompt: string, originalText: string): void {
  log.debug(
    {
      contextParts: contextLength,
      finalPromptLength: finalPrompt.length,
      originalMessageLength: originalText.length,
    },
    'Built prompt with reply context',
  )
}

export function buildPromptWithReplyContext(
  msg: IncomingMessage,
  attachments: readonly AttachmentRef[] = [],
  storageContextId?: string,
): string {
  if (!hasContextData(msg, attachments) && storageContextId === undefined) {
    return msg.text
  }

  const context: string[] = []

  if (msg.replyContext !== undefined) {
    logReplyContextDebug(msg)
    context.push(...buildReplyContextLines(msg))
  }

  const manifest = buildAttachmentManifest(attachments)
  if (manifest !== null) context.push(manifest)

  if (msg.replyToMessageId !== undefined && storageContextId !== undefined) {
    const stagedForReply = findStagedFilesByMessageId(storageContextId, msg.replyToMessageId)
    if (stagedForReply.length > 0) {
      const stagedLines = stagedForReply.map(
        (sf) => `[Staged file available: ${sf.stagedId} "${sf.filename}" from ${sf.senderUsername ?? 'unknown user'}]`,
      )
      context.push(...stagedLines)
    }
  }

  if (context.length === 0) {
    return msg.text
  }

  const finalPrompt = context.join('\n') + '\n\n' + msg.text
  logPromptBuilt(context.length, finalPrompt, msg.text)
  return finalPrompt
}
