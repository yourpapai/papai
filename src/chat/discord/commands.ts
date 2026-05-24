// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { CommandHandler } from '../types.js'

export function matchDiscordCommand(
  text: string,
  commands: ReadonlyMap<string, CommandHandler>,
): { handler: CommandHandler; match: string } | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return null
  for (const [name, handler] of commands) {
    if (trimmed === `/${name}` || trimmed.startsWith(`/${name} `)) {
      const match = trimmed.slice(name.length + 2).trim()
      return { handler, match }
    }
  }
  return null
}
