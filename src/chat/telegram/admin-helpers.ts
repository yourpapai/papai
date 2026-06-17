// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Whether `userId` is a creator/administrator of the given Telegram chat.
 * Returns null when ids are non-numeric or the lookup fails (e.g. the user is
 * not in the chat, or the bot lacks visibility).
 */
export async function isTelegramGroupAdmin(
  getChatMember: (chatId: number, userId: number) => Promise<{ status: string }>,
  groupId: string,
  userId: string,
): Promise<boolean | null> {
  const chatId = Number(groupId)
  const uid = Number(userId)
  if (!Number.isInteger(chatId) || !Number.isInteger(uid)) return null
  try {
    const member = await getChatMember(chatId, uid)
    return member.status === 'creator' || member.status === 'administrator'
  } catch {
    return null
  }
}
