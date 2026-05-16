// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { validateGroupTargetAccess } from './access.js'

export function getMissingGroupTargetMessage(userId: string, groupId: string): string {
  const access = validateGroupTargetAccess(userId, groupId)

  if (access.kind === 'not_authorized') {
    return 'That group is no longer authorized for bot use. Ask the bot admin to run `/group add <group-id>` in DM, then run /config or /setup again.'
  }

  return 'You are no longer recognized as an admin for that group. Run /config or /setup again to choose a different target.'
}
