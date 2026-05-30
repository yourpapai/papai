// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ReplyFn } from '../chat/types.js'
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
  renderConfigForTarget: (_reply, _targetContextId, _interactiveButtons) => {
    // In-chat config rendering was retired (Task 2.1). The group-settings selector
    // dispatch path that reached this is removed across Phase 2/3; a throwing stub
    // ensures any stale-session invocation fails loudly instead of silently dropping the reply.
    throw new Error('In-chat config rendering is retired; use the settings web UI via /config')
  },
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
