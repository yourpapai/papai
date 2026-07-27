// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { resolveVoiceStagedFiles } from './bot-attachments.js'
import { emitReplyCompletedIfNeeded, trackReplyUsage } from './bot-reply-tracking.js'
import type { BotDeps } from './bot.js'
import { defaultDeps } from './llm-orchestrator.js'
import type { CoalescedItem } from './message-queue/types.js'

/**
 * Bridge a queue-flushed {@link CoalescedItem} into a `processMessage` turn.
 * Tracks reply usage, resolves staged voice attachments, forwards every
 * coalesced field (including `messageIds` and `segments` for the edit feature),
 * and always emits `replyCompleted` — even when `processMessage` throws.
 */
export async function processCoalescedMessage(coalescedItem: CoalescedItem, deps: BotDeps): Promise<void> {
  const start = Date.now()
  const tracked = trackReplyUsage(coalescedItem.reply, true)
  try {
    const voiceAttachmentIds = await resolveVoiceStagedFiles(
      coalescedItem.storageContextId,
      coalescedItem.voiceStagedIds,
      deps.stagedDownloadFn,
    )
    await deps.processMessage(
      tracked.reply,
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
  } finally {
    emitReplyCompletedIfNeeded(tracked, coalescedItem.userId, coalescedItem.storageContextId, start)
  }
}
