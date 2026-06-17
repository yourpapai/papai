// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { isDiscordGuildAdmin } from '../../../src/chat/discord/admin-helpers.js'

type FetchedMember = {
  displayName: undefined
  nickname: undefined
  user: undefined
  permissions?: { has: (flag: bigint) => boolean }
}

const adminClient = (
  member: { permissions?: { has: (flag: bigint) => boolean } } | { throws: true } | { noFetch: true },
): Parameters<typeof isDiscordGuildAdmin>[0] => {
  const fetchThrows = 'throws' in member
  const membersFetch =
    'noFetch' in member
      ? undefined
      : (): Promise<FetchedMember> =>
          fetchThrows
            ? Promise.reject(new Error('member fetch failed'))
            : Promise.resolve({
                displayName: undefined,
                nickname: undefined,
                user: undefined,
                permissions: 'permissions' in member ? member.permissions : undefined,
              })
  return {
    destroy: (): Promise<void> => Promise.resolve(),
    channels: { cache: new Map([['chan-1', { guildId: 'guild-1' }]]) },
    guilds: {
      cache: new Map([
        [
          'guild-1',
          {
            members: {
              search: (): Promise<Map<string, { id: string }>> => Promise.resolve(new Map<string, { id: string }>()),
              ...(membersFetch === undefined ? {} : { fetch: membersFetch }),
            },
          },
        ],
      ]),
    },
  }
}

test('isDiscordGuildAdmin returns true when the member has the Administrator permission', async () => {
  const result = await isDiscordGuildAdmin(adminClient({ permissions: { has: (flag) => flag === 8n } }), 'chan-1', 'u1')
  expect(result).toBe(true)
})

test('isDiscordGuildAdmin returns false when the member lacks the Administrator permission', async () => {
  const result = await isDiscordGuildAdmin(adminClient({ permissions: { has: () => false } }), 'chan-1', 'u1')
  expect(result).toBe(false)
})

test('isDiscordGuildAdmin returns null when permissions are unavailable', async () => {
  const result = await isDiscordGuildAdmin(adminClient({}), 'chan-1', 'u1')
  expect(result).toBeNull()
})

test('isDiscordGuildAdmin returns null when the guild member cannot be fetched', async () => {
  const result = await isDiscordGuildAdmin(adminClient({ noFetch: true }), 'chan-1', 'u1')
  expect(result).toBeNull()
})

test('isDiscordGuildAdmin returns null when the channel does not resolve to a guild', async () => {
  const client = adminClient({ permissions: { has: () => true } })
  const result = await isDiscordGuildAdmin({ ...client, channels: { cache: new Map() } }, 'unknown-chan', 'u1')
  expect(result).toBeNull()
})

test('isDiscordGuildAdmin returns null when the member fetch throws', async () => {
  const result = await isDiscordGuildAdmin(adminClient({ throws: true }), 'chan-1', 'u1')
  expect(result).toBeNull()
})
