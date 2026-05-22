// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getActiveGroupSettingsTarget } from '../group-settings/state.js'
import type { IncomingInteraction } from './types.js'

export function getTargetContextId(
  parsedTargetContextId: string | undefined,
  interaction: IncomingInteraction,
): string {
  if (parsedTargetContextId !== undefined) {
    return parsedTargetContextId
  }

  if (interaction.contextType !== 'dm') {
    return interaction.storageContextId
  }

  const activeGroupTarget = getActiveGroupSettingsTarget(interaction.user.id)
  if (activeGroupTarget === undefined || activeGroupTarget === null) {
    return interaction.storageContextId
  }

  return activeGroupTarget
}

export function getResponseText(response: string | undefined): string {
  if (response === undefined) {
    return ''
  }

  return response
}
