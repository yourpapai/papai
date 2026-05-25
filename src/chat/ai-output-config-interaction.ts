// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { handleParsedAiOutputConfigCallback, parseAiOutputCallbackData } from '../ai-output-config-ui.js'
import { getMissingGroupTargetMessage } from '../group-settings/target-validation.js'
import { getValidatedDmCallbackTargetContextId, validateImplicitDmConfigTarget } from './config-target-validation.js'
import { replyButtonsPreferReplace, replyTextPreferReplace } from './interaction-router-replies.js'
import { getTargetContextId } from './interaction-router-support.js'
import type { IncomingInteraction, ReplyFn } from './types.js'

type ParsedAiOutputCallback = NonNullable<ReturnType<typeof parseAiOutputCallbackData>>

function isInvalidGroupAiOutputTarget(interaction: IncomingInteraction, parsed: ParsedAiOutputCallback): boolean {
  return (
    interaction.contextType === 'group' &&
    parsed.targetContextId !== undefined &&
    parsed.targetContextId !== interaction.storageContextId
  )
}

async function validateDmAiOutputTarget(
  interaction: IncomingInteraction,
  reply: ReplyFn,
  parsed: ParsedAiOutputCallback,
  targetContextId: string,
): Promise<boolean> {
  if (parsed.targetContextId === undefined && !(await validateImplicitDmConfigTarget(interaction.user.id, reply))) {
    return false
  }
  if (parsed.targetContextId !== undefined) {
    const validatedTargetContextId = getValidatedDmCallbackTargetContextId(interaction.user.id, targetContextId)
    if (validatedTargetContextId === null) {
      await replyTextPreferReplace(reply, getMissingGroupTargetMessage(interaction.user.id, targetContextId))
      return false
    }
  }
  return true
}

export async function handleAiOutputConfigInteraction(
  interaction: IncomingInteraction,
  reply: ReplyFn,
  parsed: ParsedAiOutputCallback,
  replyInvalidAction: (reply: ReplyFn, callbackData: string) => Promise<true>,
): Promise<boolean> {
  if (isInvalidGroupAiOutputTarget(interaction, parsed)) {
    return replyInvalidAction(reply, interaction.callbackData)
  }

  const targetContextId = getTargetContextId(parsed.targetContextId, interaction)
  if (
    interaction.contextType === 'dm' &&
    !(await validateDmAiOutputTarget(interaction, reply, parsed, targetContextId))
  ) {
    return true
  }

  const section = handleParsedAiOutputConfigCallback(targetContextId, parsed)
  if (section === null) {
    return replyInvalidAction(reply, interaction.callbackData)
  }
  await replyButtonsPreferReplace(reply, section.lines.join('\n'), section.buttons)
  return true
}
