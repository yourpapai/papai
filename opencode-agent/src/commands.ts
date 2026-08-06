// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Slash commands a maintainer can issue from an issue comment. */
export const SLASH_COMMANDS = ['/approve', '/retry', '/cancel', '/replan'] as const

export type SlashCommand = (typeof SLASH_COMMANDS)[number]

/**
 * Extracts the first slash command from a comment body.
 *
 * Only a line that *starts* with the command counts, so quoting the agent's own
 * instructions ("reply with /approve to continue") does not fire the command.
 * Fenced code blocks are stripped for the same reason.
 */
export const parseSlashCommand = (body: string | null): SlashCommand | null => {
  if (body === null) return null

  for (const line of stripFencedBlocks(body).split('\n')) {
    const trimmed = line.trim().toLowerCase()
    const match = SLASH_COMMANDS.find((command) => trimmed === command || trimmed.startsWith(`${command} `))
    if (match !== undefined) return match
  }

  return null
}

const FENCE_PATTERN = /^\s*```/u

/** Drops ``` fenced regions; an unterminated fence swallows the rest of the body. */
const stripFencedBlocks = (body: string): string => {
  const kept: string[] = []
  let inside = false

  for (const line of body.split('\n')) {
    if (FENCE_PATTERN.test(line)) {
      inside = !inside
      continue
    }
    if (!inside) kept.push(line)
  }

  return kept.join('\n')
}
