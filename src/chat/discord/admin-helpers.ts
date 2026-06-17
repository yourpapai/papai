// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../logger.js'
import type { DiscordClientLike } from './client-factory.js'
import { resolveDiscordGuildFromContext } from './label-helpers.js'

const log = logger.child({ scope: 'chat:discord:admin' })

/** discord.js PermissionFlagsBits.Administrator. */
const DISCORD_ADMINISTRATOR_FLAG = 8n

/**
 * Whether `userId` has the Administrator permission in the guild that owns the
 * given channel (owners resolve all permissions, so they pass too). Returns null
 * when the guild/member can't be resolved or the lookup fails.
 */
export async function isDiscordGuildAdmin(
  client: DiscordClientLike,
  channelId: string,
  userId: string,
): Promise<boolean | null> {
  const resolvedGuild = await resolveDiscordGuildFromContext(client, channelId)
  if (resolvedGuild === null || resolvedGuild.guild.members.fetch === undefined) return null
  try {
    const member = await resolvedGuild.guild.members.fetch(userId)
    if (member.permissions === undefined) return null
    return member.permissions.has(DISCORD_ADMINISTRATOR_FLAG)
  } catch (e) {
    log.warn(
      { userId, channelId, error: e instanceof Error ? e.message : String(e) },
      'Discord guild admin lookup failed',
    )
    return null
  }
}
