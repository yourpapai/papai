// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../logger.js'
import type { ResolveUserContext } from '../types.js'

const log = logger.child({ scope: 'chat:telegram:labels' })

type GetChatFn = (chatId: number) => Promise<unknown>
type GetChatMemberFn = (chatId: number, userId: number) => Promise<unknown>

export function formatTelegramUserLabel(
  firstName: string,
  lastName: string | undefined,
  username: string | undefined,
): string | null {
  const parts: string[] = []
  if (firstName !== '') parts.push(firstName)
  if (lastName !== undefined && lastName !== '') parts.push(lastName)
  const display = parts.join(' ')
  const at = username !== undefined && username !== '' ? `@${username}` : null
  if (display.length > 0) return at === null ? display : `${display} (${at})`
  return at
}

export function getTelegramDisplayLabel(
  firstName: string,
  lastName: string | undefined,
  username: string | null,
): string | undefined {
  let resolvedUsername: string | undefined
  if (username !== null) {
    resolvedUsername = username
  }

  const label = formatTelegramUserLabel(firstName, lastName, resolvedUsername)
  if (label === null) {
    return undefined
  }

  return label
}

export async function resolveTelegramGroupLabel(getChat: GetChatFn, groupId: string): Promise<string | null> {
  const id = Number(groupId)
  if (!Number.isInteger(id)) return null
  try {
    const chat = await getChat(id)
    if (
      typeof chat === 'object' &&
      chat !== null &&
      'title' in chat &&
      typeof chat.title === 'string' &&
      chat.title !== ''
    ) {
      return chat.title
    }
    return null
  } catch (e) {
    log.warn({ groupId, error: e instanceof Error ? e.message : String(e) }, 'Telegram group label lookup failed')
    return null
  }
}

export async function resolveTelegramUserLabel(
  getChatMember: GetChatMemberFn,
  userId: string,
  context: ResolveUserContext | undefined,
): Promise<string | null> {
  const uid = Number(userId)
  if (!Number.isInteger(uid) || context === undefined || context.contextType !== 'group') return null
  const cid = Number(context.contextId)
  if (!Number.isInteger(cid)) return null
  try {
    const member = await getChatMember(cid, uid)
    if (typeof member !== 'object' || member === null || !('user' in member)) return null
    const u = member.user
    if (typeof u !== 'object' || u === null) return null
    const firstName = 'first_name' in u && typeof u.first_name === 'string' ? u.first_name : ''
    const lastName = 'last_name' in u && typeof u.last_name === 'string' && u.last_name !== '' ? u.last_name : undefined
    const username = 'username' in u && typeof u.username === 'string' && u.username !== '' ? u.username : undefined
    return formatTelegramUserLabel(firstName, lastName, username)
  } catch (e) {
    log.warn(
      { userId, contextId: context.contextId, error: e instanceof Error ? e.message : String(e) },
      'Telegram user label lookup failed',
    )
    return null
  }
}
