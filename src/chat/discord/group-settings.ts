// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { dispatchGroupSelectorResult } from '../../group-settings/dispatch.js'
import { handleGroupSettingsSelectorCallback } from '../../group-settings/selector.js'
import type { ReplyFn } from '../types.js'
import type { ButtonInteractionLike } from './buttons.js'

export function handleDiscordGroupSettingsSelection(
  interaction: ButtonInteractionLike,
  userId: string,
  platformInstanceId: string,
  reply: ReplyFn,
): Promise<boolean> {
  if (!interaction.customId.startsWith('gsel:')) {
    return Promise.resolve(false)
  }

  const result = handleGroupSettingsSelectorCallback(userId, interaction.customId, platformInstanceId)
  return dispatchGroupSelectorResult(result, reply, userId, platformInstanceId)
}
