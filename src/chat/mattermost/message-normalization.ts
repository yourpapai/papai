// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type NormalizedMattermostText = {
  readonly text: string
  readonly isMentioned: boolean
  readonly commandInput: string | null
}

export function normalizeMattermostMessageText(message: string, botUsername: string | null): NormalizedMattermostText {
  const trimmed = message.trim()

  if (botUsername === null) {
    return { text: trimmed, isMentioned: false, commandInput: null }
  }

  const mentionPrefix = `@${botUsername}`
  if (!trimmed.startsWith(mentionPrefix)) {
    return { text: trimmed, isMentioned: false, commandInput: null }
  }

  const nextChar = trimmed.charAt(mentionPrefix.length)
  if (nextChar !== '' && !/\s/u.test(nextChar)) {
    return { text: trimmed, isMentioned: false, commandInput: null }
  }

  const remainder = trimmed.slice(mentionPrefix.length).trim()
  return {
    text: remainder,
    isMentioned: true,
    commandInput: remainder.startsWith('/') ? remainder : null,
  }
}
