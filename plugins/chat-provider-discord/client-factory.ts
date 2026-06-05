// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Client, GatewayIntentBits } from 'discord.js'

import type { DiscordMessageLike } from './map-message.js'
import type { SendableChannel } from './reply-helpers.js'

export type DispatchableMessage = DiscordMessageLike & {
  channel: SendableChannel &
    Partial<{
      messages: {
        fetch: (id: string) => Promise<{ id: string; author: { id: string; username: string }; content: string }>
      }
    }>
}

type EventListener = (...args: unknown[]) => void

/** Structural type covering the discord.js Client API surface we use. */
export type DiscordClientLike = {
  destroy: () => Promise<void>
} & Partial<{
  users: {
    fetch: (id: string) => Promise<
      {
        createDM: () => Promise<{ send: (arg: { content: string }) => Promise<unknown> }>
      } & Partial<{
        username: string
        displayName: string
        globalName: string | null
      }>
    >
  }
  channels: {
    cache: { get(id: string): unknown }
  } & Partial<{
    fetch: (id: string) => Promise<unknown>
  }>
  guilds: { cache: { get(id: string): unknown } }
}>

/** Narrowed guild shape returned by cache.get — used in resolveUserId and resolveUserLabel. */
export type GuildLike = {
  members: {
    search: (arg: { query: string; limit: number }) => Promise<Map<string, { id: string }>>
  } & Partial<{
    fetch: (id: string) => Promise<{
      displayName: string | undefined
      nickname: string | null | undefined
      user:
        | {
            username: string | undefined
            displayName: string | undefined
            globalName: string | null | undefined
          }
        | undefined
    }>
  }>
}

/** Payload type for Discord ready event. */
export type ReadyPayload = { user: { id: string; username: string } }

/** Minimal event-emitter + login surface used inside start(). */
export type LiveDiscordClient = DiscordClientLike & {
  on(event: string, listener: EventListener): unknown
  once(event: string, listener: EventListener): unknown
  login(token: string): Promise<string>
  user: { id: string; username: string } | null
}

/** Factory that produces a LiveDiscordClient. Overridable in tests via the constructor. */
export type DiscordClientFactory = () => LiveDiscordClient

/** Create a discord.js Client configured with the intents papai needs. */
export function defaultClientFactory(): LiveDiscordClient {
  // Client satisfies LiveDiscordClient structurally — the declared return
  // type lets TypeScript verify the assignment without an unsafe assertion.
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
  })
}
