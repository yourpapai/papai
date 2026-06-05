// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js'

import type { ChatButton } from '../../src/chat/types.js'

export const DISCORD_CUSTOM_ID_MAX = 100
export const DISCORD_BUTTONS_PER_ROW = 5
export const DISCORD_ROWS_PER_MESSAGE = 5

type DiscordMessageRef = { messageReference: string; failIfNotExists: boolean }
type DiscordEditPayload = Partial<{ content: string; components: unknown[] }>
type DiscordSendPayload = Partial<{
  content: string
  components: unknown[]
  reply: DiscordMessageRef
}>

/** Channel interface for button interactions. */
export type ButtonChannelLike = {
  id: string
  type: number
  send: (arg: DiscordSendPayload) => Promise<{ id: string; edit: (arg: DiscordEditPayload) => Promise<unknown> }>
  sendTyping: () => Promise<void>
}

/** Structural type for a Discord button interaction. */
export type ButtonInteractionLike = {
  user: { id: string; username: string } & Partial<{ bot: boolean; isAdmin: boolean }>
  customId: string
  channelId: string
  channel: ButtonChannelLike | null
  message: {
    id: string
  } & Partial<{
    channelId: string
    threadId: string
    editable: boolean
    edit: (arg: DiscordEditPayload) => Promise<unknown>
  }>
  deferUpdate(): Promise<void>
}

// discord.js enum values: InteractionType.MessageComponent = 3, ComponentType.Button = 2
const INTERACTION_TYPE_MESSAGE_COMPONENT = 3
const COMPONENT_TYPE_BUTTON = 2

/** Runtime type guard for discord.js button interactions. */
export function isButtonInteraction(i: unknown): i is ButtonInteractionLike {
  if (typeof i !== 'object' || i === null) return false
  if (!('type' in i) || !('componentType' in i)) return false
  return i.type === INTERACTION_TYPE_MESSAGE_COMPONENT && i.componentType === COMPONENT_TYPE_BUTTON
}

const styleMap: Record<NonNullable<ChatButton['style']>, ButtonStyle> = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  danger: ButtonStyle.Danger,
}

/** Convert papai ChatButtons to discord.js ActionRow components. */
export function toActionRows(buttons: ChatButton[]): ActionRowBuilder<ButtonBuilder>[] {
  const maxTotal = DISCORD_BUTTONS_PER_ROW * DISCORD_ROWS_PER_MESSAGE
  if (buttons.length > maxTotal) {
    throw new Error(
      `too many buttons: got ${String(buttons.length)}, max ${String(maxTotal)} (${String(DISCORD_ROWS_PER_MESSAGE)} rows × ${String(DISCORD_BUTTONS_PER_ROW)} per row)`,
    )
  }

  for (const btn of buttons) {
    if (btn.callbackData.length > DISCORD_CUSTOM_ID_MAX) {
      throw new Error(`custom_id exceeds ${String(DISCORD_CUSTOM_ID_MAX)} chars: "${btn.callbackData.slice(0, 20)}…"`)
    }
  }

  const rows: ActionRowBuilder<ButtonBuilder>[] = []
  for (let i = 0; i < buttons.length; i += DISCORD_BUTTONS_PER_ROW) {
    const slice = buttons.slice(i, i + DISCORD_BUTTONS_PER_ROW)
    const row = new ActionRowBuilder<ButtonBuilder>()
    for (const btn of slice) {
      const style = btn.style === undefined ? ButtonStyle.Secondary : styleMap[btn.style]
      row.addComponents(new ButtonBuilder().setCustomId(btn.callbackData).setLabel(btn.text).setStyle(style))
    }
    rows.push(row)
  }
  return rows
}
