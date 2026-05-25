// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getNativeContextId, toScopedContextId } from '../chat/scoped-context.js'
import { validateGroupTargetAccess } from './access.js'
import { listAdminGroupContextsForUser } from './registry.js'

function getDisplayGroupId(userId: string, groupId: string, platformInstanceId: string | undefined): string {
  if (platformInstanceId === undefined) return groupId
  const group = listAdminGroupContextsForUser(userId).find((candidate) => {
    if (candidate.contextId === groupId) return true
    return toScopedContextId({ platformInstanceId, nativeContextId: candidate.contextId }) === groupId
  })
  if (group === undefined) return groupId
  return getNativeContextId(group.contextId)
}

export function getMissingGroupTargetMessage(
  userId: string,
  groupId: string,
  ...args: [] | [platformInstanceId: string]
): string {
  const platformInstanceId = args[0]
  const access = validateGroupTargetAccess(userId, groupId, ...args)
  const displayGroupId = getDisplayGroupId(userId, groupId, platformInstanceId)

  if (access.kind === 'not_authorized') {
    return `That group is no longer authorized for bot use. Ask the bot admin to run \`/group add ${displayGroupId}\` in DM, then run /config or /setup again.`
  }

  return 'You are no longer recognized as an admin for that group. Run /config or /setup again to choose a different target.'
}
