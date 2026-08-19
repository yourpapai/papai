// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AuthorizationResult, ReplyFn } from './chat/types.js'
import { t } from './i18n/index.js'
import { getContextLanguage } from './utils/config-language.js'

export function getUnauthorizedReplyText(auth: AuthorizationResult, groupId: string): string | null {
  const locale = getContextLanguage(auth.configContextId ?? auth.storageContextId)
  if (auth.reason === 'group_not_allowed') return t('auth.groupNotAllowed', locale, { groupId })
  if (auth.reason === 'group_member_not_allowed') return t('auth.groupMemberNotAllowed', locale)
  if (auth.reason === 'dm_not_allowed') return t('auth.dmNotAllowed', locale)
  if (auth.reason === 'user_blocked') return t('auth.userBlocked', locale)
  return null
}

export async function replyToUnauthorized(reply: ReplyFn, auth: AuthorizationResult, groupId: string): Promise<void> {
  const message = getUnauthorizedReplyText(auth, groupId)
  if (message !== null) await reply.text(message)
}
