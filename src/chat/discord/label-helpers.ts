// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../logger.js'
import type { ResolveUserContext } from '../types.js'
import type { DiscordClientLike, GuildLike } from './client-factory.js'
import { isGuildLike } from './type-guards.js'

const log = logger.child({ scope: 'chat:discord:labels' })

export function formatDiscordUserLabel(displayName: string | null, username: string | null): string | null {
  if (displayName !== null && username !== null) {
    return `${displayName} (@${username})`
  }
  if (displayName !== null) return displayName
  if (username !== null) return `@${username}`
  return null
}

export function getDiscordUserDisplayName(
  user: Partial<{
    displayName: string
    globalName: string | null
    username: string
  }>,
): string | null {
  if (user.globalName !== undefined && user.globalName !== null && user.globalName !== '') return user.globalName
  return null
}

export function getDiscordMemberDisplayName(
  member: Partial<{
    displayName: string
    nickname: string | null
    user:
      | Partial<{
          displayName: string
          globalName: string | null
          username: string
        }>
      | undefined
  }>,
): string | null {
  if (member.nickname !== undefined && member.nickname !== null && member.nickname !== '') return member.nickname
  if (
    member.user !== undefined &&
    member.user.globalName !== undefined &&
    member.user.globalName !== null &&
    member.user.globalName !== ''
  ) {
    return member.user.globalName
  }
  return null
}

export async function resolveDiscordGroupLabel(client: DiscordClientLike, groupId: string): Promise<string | null> {
  if (client.channels === undefined) return null
  const cached = client.channels.cache.get(groupId)
  if (typeof cached === 'object' && cached !== null && 'name' in cached && typeof cached.name === 'string') {
    return cached.name
  }
  if (client.channels.fetch === undefined) return null
  try {
    const ch = await client.channels.fetch(groupId)
    if (typeof ch !== 'object' || ch === null) return null
    if ('name' in ch && typeof ch.name === 'string') return ch.name.length > 0 ? ch.name : null
    return null
  } catch (e) {
    log.warn({ groupId, error: e instanceof Error ? e.message : String(e) }, 'Discord group label lookup failed')
    return null
  }
}

function getDiscordChannelGuildId(channel: unknown): string | null {
  if (typeof channel !== 'object' || channel === null || !('guildId' in channel)) return null
  return typeof channel.guildId === 'string' ? channel.guildId : null
}

export async function resolveDiscordGuildFromContext(
  client: DiscordClientLike,
  contextId: string,
): Promise<Readonly<{ guild: GuildLike; guildId: string }> | null> {
  if (client.channels === undefined || client.guilds === undefined) return null

  const cachedGuildId = getDiscordChannelGuildId(client.channels.cache.get(contextId))
  if (cachedGuildId !== null) {
    const cachedGuild = client.guilds.cache.get(cachedGuildId)
    return isGuildLike(cachedGuild) ? { guild: cachedGuild, guildId: cachedGuildId } : null
  }

  if (client.channels.fetch === undefined) return null

  try {
    const fetchedChannel = await client.channels.fetch(contextId)
    const fetchedGuildId = getDiscordChannelGuildId(fetchedChannel)
    if (fetchedGuildId === null) return null

    const fetchedGuild = client.guilds.cache.get(fetchedGuildId)
    return isGuildLike(fetchedGuild) ? { guild: fetchedGuild, guildId: fetchedGuildId } : null
  } catch (e) {
    log.warn({ contextId, error: e instanceof Error ? e.message : String(e) }, 'Discord channel lookup failed')
    return null
  }
}

async function tryGuildMemberLabel(
  client: DiscordClientLike,
  userId: string,
  contextId: string,
): Promise<string | null> {
  const resolvedGuild = await resolveDiscordGuildFromContext(client, contextId)
  if (resolvedGuild === null || resolvedGuild.guild.members.fetch === undefined) return null

  try {
    const member = await resolvedGuild.guild.members.fetch(userId)
    const displayName = getDiscordMemberDisplayName(member)
    const userNode = member.user
    const username =
      userNode !== undefined && userNode.username !== undefined && userNode.username !== '' ? userNode.username : null
    return formatDiscordUserLabel(displayName, username)
  } catch (e) {
    log.warn(
      { userId, contextId, error: e instanceof Error ? e.message : String(e) },
      'Discord guild member label lookup failed',
    )
    return null
  }
}

export async function resolveDiscordUserLabel(
  client: DiscordClientLike,
  userId: string,
  context: ResolveUserContext | undefined,
): Promise<string | null> {
  if (context !== undefined && context.contextType === 'group') {
    const guildLabel = await tryGuildMemberLabel(client, userId, context.contextId)
    if (guildLabel !== null) return guildLabel
  }
  if (client.users === undefined) return null
  try {
    const user = await client.users.fetch(userId)
    const displayName = getDiscordUserDisplayName(user)
    const username = user.username !== undefined && user.username !== '' ? user.username : null
    return formatDiscordUserLabel(displayName, username)
  } catch (e) {
    log.warn({ userId, error: e instanceof Error ? e.message : String(e) }, 'Discord user label lookup failed')
    return null
  }
}
