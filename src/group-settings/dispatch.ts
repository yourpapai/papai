// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ReplyFn } from '../chat/types.js'
import { renderConfigForTarget } from '../commands/config.js'
import { startSetupForTarget } from '../commands/setup.js'
import type { GroupSettingsSelectorResult } from './types.js'

export type DispatchGroupSelectorDeps = {
  renderConfigForTarget: (reply: ReplyFn, targetContextId: string, interactiveButtons: boolean) => Promise<void>
  startSetupForTarget: (
    userId: string,
    reply: ReplyFn,
    targetContextId: string,
    platformInstanceId: string,
  ) => Promise<void>
}

const defaultDeps: DispatchGroupSelectorDeps = {
  renderConfigForTarget,
  startSetupForTarget,
}

/**
 * Dispatches a GroupSettingsSelectorResult to the appropriate reply action.
 * Returns true if the result was handled, false if it was not.
 */
export async function dispatchGroupSelectorResult(
  result: GroupSettingsSelectorResult,
  reply: ReplyFn,
  userId: string,
  platformInstanceId: string,
): Promise<boolean>
export async function dispatchGroupSelectorResult(
  result: GroupSettingsSelectorResult,
  reply: ReplyFn,
  userId: string,
  platformInstanceId: string,
  interactiveButtons: boolean | undefined,
): Promise<boolean>
export async function dispatchGroupSelectorResult(
  result: GroupSettingsSelectorResult,
  reply: ReplyFn,
  userId: string,
  platformInstanceId: string,
  interactiveButtons: boolean | undefined,
  deps: DispatchGroupSelectorDeps | undefined,
): Promise<boolean>
export async function dispatchGroupSelectorResult(
  result: GroupSettingsSelectorResult,
  reply: ReplyFn,
  userId: string,
  platformInstanceId: string,
  ...rest: [] | [boolean | undefined] | [boolean | undefined, DispatchGroupSelectorDeps | undefined]
): Promise<boolean> {
  const interactiveButtons = rest[0]
  const deps = rest[1]
  let shouldUseInteractiveButtons = true
  if (interactiveButtons !== undefined) {
    shouldUseInteractiveButtons = interactiveButtons
  }
  let resolvedDeps = defaultDeps
  if (deps !== undefined) {
    resolvedDeps = deps
  }
  if (!result.handled) return false

  if ('continueWith' in result) {
    if (result.continueWith.command === 'config') {
      await resolvedDeps.renderConfigForTarget(reply, result.continueWith.targetContextId, shouldUseInteractiveButtons)
    } else {
      await resolvedDeps.startSetupForTarget(userId, reply, result.continueWith.targetContextId, platformInstanceId)
    }
    return true
  }

  if ('buttons' in result && result.buttons !== undefined) {
    if ('replaceButtons' in reply && typeof reply.replaceButtons === 'function') {
      await reply.replaceButtons(result.response, { buttons: result.buttons })
    } else {
      await reply.buttons(result.response, { buttons: result.buttons })
    }
    return true
  }

  if ('response' in result) {
    if ('replaceText' in reply && typeof reply.replaceText === 'function') {
      await reply.replaceText(result.response)
    } else {
      await reply.text(result.response)
    }
    return true
  }

  return false
}
