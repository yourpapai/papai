// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ReplyFn } from '../chat/types.js'
import { isAdmin } from '../instances/admin-store.js'
import { getContextSettings } from '../instances/context-store.js'

export type PluginCommandContext = Readonly<{
  args: string[]
  userId: string
  sourceContextId: string
  sourcePlatformInstanceId: string
  reply: ReplyFn
}>

type TargetContextAuthorization = { allowed: true } | { allowed: false; reason: 'not_configured' | 'not_authorized' }

export const getTargetContextId = (args: string[], requesterContextId: string): string => {
  const targetContextId = args[2]
  if (targetContextId === undefined) return requesterContextId
  return targetContextId
}

export const hasExplicitTargetContext = (args: string[]): boolean => args[2] !== undefined

export const canManageTargetContext = (
  userId: string,
  targetContextId: string,
  sourcePlatformInstanceId: string,
  explicitTargetContext: boolean,
): TargetContextAuthorization => {
  const settings = getContextSettings(targetContextId)
  if (settings === null && explicitTargetContext) return { allowed: false, reason: 'not_configured' }
  const platformInstanceId = settings === null ? sourcePlatformInstanceId : settings.platformInstanceId
  if (isAdmin(userId, platformInstanceId)) return { allowed: true }
  return { allowed: false, reason: 'not_authorized' }
}

export const replyTargetAuthorizationFailure = async (
  authorization: Exclude<TargetContextAuthorization, { allowed: true }>,
  reply: ReplyFn,
): Promise<void> => {
  if (authorization.reason === 'not_configured') {
    await reply.text('Target context is not configured.')
    return
  }
  await reply.text('You are not authorized to manage plugins for that context.')
}
