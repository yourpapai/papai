// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type NormalizedMattermostText = {
  readonly text: string
  readonly isMentioned: boolean
  readonly commandInput: string | null
}

function isUsernameChar(char: string): boolean {
  return /[\w.-]/u.test(char)
}

function isStandaloneMentionAt(text: string, mentionPrefix: string, startIndex: number): boolean {
  const beforeChar = startIndex === 0 ? '' : text.charAt(startIndex - 1)
  if (beforeChar !== '' && isUsernameChar(beforeChar)) {
    return false
  }

  const afterChar = text.charAt(startIndex + mentionPrefix.length)
  return afterChar === '' || !isUsernameChar(afterChar)
}

function findStandaloneMentionIndex(text: string, mentionPrefix: string): number {
  let searchIndex = text.indexOf(mentionPrefix)

  while (searchIndex >= 0) {
    if (isStandaloneMentionAt(text, mentionPrefix, searchIndex)) {
      return searchIndex
    }

    searchIndex = text.indexOf(mentionPrefix, searchIndex + mentionPrefix.length)
  }

  return -1
}

export function normalizeMattermostMessageText(message: string, botUsername: string | null): NormalizedMattermostText {
  const trimmed = message.trim()

  if (botUsername === null) {
    return { text: trimmed, isMentioned: false, commandInput: null }
  }

  const mentionPrefix = `@${botUsername}`
  const mentionIndex = findStandaloneMentionIndex(trimmed, mentionPrefix)
  const isMentioned = mentionIndex >= 0

  if (!isMentioned || mentionIndex !== 0) {
    return { text: trimmed, isMentioned, commandInput: null }
  }

  const remainder = trimmed.slice(mentionPrefix.length).trim()
  return {
    text: remainder,
    isMentioned: true,
    commandInput: remainder.startsWith('/') ? remainder : null,
  }
}
