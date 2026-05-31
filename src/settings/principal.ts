// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { toScopedContextId } from '../chat/scoped-context.js'
import { listManageableGroups } from '../group-settings/access.js'
import type { KnownGroupContext } from '../group-settings/types.js'
import { isAdmin, isSuperAdmin } from '../instances/admin-store.js'
import { logger } from '../logger.js'
import { isAuthorized } from '../users.js'

const log = logger.child({ scope: 'settings:principal' })

export type SettingsPrincipal = {
  readonly platformInstanceId: string
  readonly platformUserId: string
  readonly isBotAdmin: boolean
  readonly isSuperAdmin: boolean
  readonly authorized: boolean
  readonly personalConfigContextId: string
  readonly manageableGroups: readonly KnownGroupContext[]
}

/**
 * Resolve the live scope for a principal from the existing authorization stores.
 * Called per request so revocations take effect without waiting for session expiry.
 */
export function resolveSettingsPrincipal(platformInstanceId: string, platformUserId: string): SettingsPrincipal {
  const botAdmin = isAdmin(platformUserId, platformInstanceId)
  const superAdmin = isSuperAdmin(platformUserId)
  const authorized = isAuthorized(platformUserId, platformInstanceId)
  const personalConfigContextId = toScopedContextId({ platformInstanceId, nativeContextId: platformUserId })
  const manageableGroups = listManageableGroups(platformUserId, platformInstanceId)

  log.debug({ platformInstanceId, platformUserId, isBotAdmin: botAdmin, authorized }, 'Resolved settings principal')
  return {
    platformInstanceId,
    platformUserId,
    isBotAdmin: botAdmin,
    isSuperAdmin: superAdmin,
    authorized,
    personalConfigContextId,
    manageableGroups,
  }
}
