// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import {
  formatDiscordUserLabel,
  getDiscordMemberDisplayName,
  getDiscordUserDisplayName,
  resolveDiscordUserLabel,
} from '../../../src/chat/discord/label-helpers.js'

test('formatDiscordUserLabel formats display name with username when they differ', () => {
  expect(formatDiscordUserLabel('John Johnson', 'itsmike')).toBe('John Johnson (@itsmike)')
})

test('formatDiscordUserLabel returns display name when no username', () => {
  expect(formatDiscordUserLabel('John Johnson', null)).toBe('John Johnson')
})

test('formatDiscordUserLabel returns @username when no display name', () => {
  expect(formatDiscordUserLabel(null, 'itsmike')).toBe('@itsmike')
})

test('formatDiscordUserLabel returns null when both are null', () => {
  expect(formatDiscordUserLabel(null, null)).toBeNull()
})

test('formatDiscordUserLabel includes @username when display name equals username', () => {
  expect(formatDiscordUserLabel('itsmike', 'itsmike')).toBe('itsmike (@itsmike)')
})

test('getDiscordUserDisplayName returns globalName when set', () => {
  expect(getDiscordUserDisplayName({ displayName: 'John', globalName: 'John Global', username: 'john' })).toBe(
    'John Global',
  )
})

test('getDiscordUserDisplayName ignores displayName fallback and uses globalName only', () => {
  expect(getDiscordUserDisplayName({ displayName: 'john', globalName: 'John Global', username: 'john' })).toBe(
    'John Global',
  )
})

test('getDiscordUserDisplayName returns null when both are empty', () => {
  expect(getDiscordUserDisplayName({ displayName: '', globalName: null, username: 'john' })).toBeNull()
})

test('getDiscordUserDisplayName returns null for username-only users', () => {
  expect(getDiscordUserDisplayName({ displayName: 'itsmike', globalName: null, username: 'itsmike' })).toBeNull()
})

test('getDiscordMemberDisplayName prefers nickname over user globalName', () => {
  expect(
    getDiscordMemberDisplayName({
      displayName: 'ignored display name fallback',
      nickname: 'Ops Mike',
      user: { username: 'itsmike', displayName: 'ignored', globalName: 'Michael' },
    }),
  ).toBe('Ops Mike')
})

test('getDiscordMemberDisplayName falls back to user globalName', () => {
  expect(
    getDiscordMemberDisplayName({
      displayName: 'ignored display name fallback',
      nickname: null,
      user: { username: 'itsmike', displayName: 'ignored', globalName: 'Michael' },
    }),
  ).toBe('Michael')
})

test('getDiscordMemberDisplayName returns null for username-only guild members', () => {
  expect(
    getDiscordMemberDisplayName({
      displayName: 'itsmike',
      nickname: null,
      user: { username: 'itsmike', displayName: 'itsmike', globalName: null },
    }),
  ).toBeNull()
})

test('resolveDiscordUserLabel formats username-only fetched users as @username', async () => {
  const label = await resolveDiscordUserLabel(
    {
      destroy: (): Promise<void> => Promise.resolve(),
      users: {
        fetch: (): Promise<{
          username: string
          displayName: string
          globalName: null
          createDM: () => Promise<{ send: (arg: { content: string }) => Promise<unknown> }>
        }> =>
          Promise.resolve({
            username: 'itsmike',
            displayName: 'itsmike',
            globalName: null,
            createDM: () => Promise.resolve({ send: (): Promise<unknown> => Promise.resolve(null) }),
          }),
      },
    },
    'user-1',
    { contextId: 'dm-user', contextType: 'dm' },
  )

  expect(label).toBe('@itsmike')
})

test('resolveDiscordUserLabel formats username-only guild members as @username', async () => {
  const label = await resolveDiscordUserLabel(
    {
      destroy: (): Promise<void> => Promise.resolve(),
      channels: {
        cache: new Map([['chan-7', { guildId: 'guild-3' }]]),
      },
      guilds: {
        cache: new Map([
          [
            'guild-3',
            {
              members: {
                search: (): Promise<Map<string, { id: string }>> => Promise.resolve(new Map<string, { id: string }>()),
                fetch: (): Promise<{
                  displayName: string
                  nickname: null
                  user: { username: string; displayName: string; globalName: null }
                }> =>
                  Promise.resolve({
                    displayName: 'itsmike',
                    nickname: null,
                    user: { username: 'itsmike', displayName: 'itsmike', globalName: null },
                  }),
              },
            },
          ],
        ]),
      },
    },
    'user-9',
    { contextId: 'chan-7', contextType: 'group' },
  )

  expect(label).toBe('@itsmike')
})

test('resolveDiscordUserLabel fetches an uncached channel to resolve guild nicknames', async () => {
  const label = await resolveDiscordUserLabel(
    {
      destroy: (): Promise<void> => Promise.resolve(),
      channels: {
        cache: new Map(),
        fetch: (id: string): Promise<{ guildId: string }> => {
          expect(id).toBe('chan-8')
          return Promise.resolve({ guildId: 'guild-3' })
        },
      },
      guilds: {
        cache: new Map([
          [
            'guild-3',
            {
              members: {
                search: (): Promise<Map<string, { id: string }>> => Promise.resolve(new Map<string, { id: string }>()),
                fetch: (
                  id: string,
                ): Promise<{
                  displayName: string
                  nickname: string
                  user: { username: string; displayName: string; globalName: null }
                }> => {
                  expect(id).toBe('user-9')
                  return Promise.resolve({
                    displayName: 'John Johnson',
                    nickname: 'Ops Mike',
                    user: { username: 'itsmike', displayName: 'itsmike', globalName: null },
                  })
                },
              },
            },
          ],
        ]),
      },
    },
    'user-9',
    { contextId: 'chan-8', contextType: 'group' },
  )

  expect(label).toBe('Ops Mike (@itsmike)')
})
