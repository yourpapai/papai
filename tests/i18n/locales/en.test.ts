// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { en } from '../../../src/i18n/locales/en.js'
import type { Dictionary } from '../../../src/i18n/types.js'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const subtreeOf = (node: unknown, key: string): Record<string, unknown> => {
  const value = isRecord(node) ? node[key] : undefined
  return isRecord(value) ? value : {}
}

describe('en dictionary', () => {
  test('satisfies the Dictionary type', () => {
    const catalog: Dictionary = en
    expect(catalog).toBe(en)
  })

  test('pins the framework texts it is seeded with', () => {
    expect(en.commands.stop.nothingRunning).toBe('Nothing is running right now.')
    expect(en.commands.stop.stoppingNow).toBe('🛑 Stopping immediately…')
    expect(en.commands.stop.windingDown).toBe('🛑 winding down after this step…')
    expect(en.auth.groupNotAllowed).toBe(
      'This group ({groupId}) is not authorized to use this bot. Ask the bot admin to authorize it in the settings web UI — they can open it with `/config` in a DM.',
    )
    expect(en.auth.groupMemberNotAllowed).toBe(
      "You're not authorized to use this bot in this group. Ask a group admin to add you in the settings web UI — they can open it with `/config` in a DM.",
    )
    expect(en.auth.dmNotAllowed).toBe('You are not authorized to use this bot.')
    expect(en.auth.userBlocked).toBe('You are not authorized to use this bot.')
    expect(en.progress.toolStarted).toBe('Tool `{toolName}` started')
    expect(en.progress.toolFinished).toBe('Tool `{toolName}` {status}')
    expect(en.progress.reasoningHidden).toBe(
      'Provider reasoning available ({count} characters). Enable raw detail to view.',
    )
    expect(en.commands.start.welcome).toContain('Welcome to papai!')
  })

  test('pins the liveStatus seed texts byte-identical to the pre-i18n constants', () => {
    const liveStatus = subtreeOf(en, 'liveStatus')
    expect(liveStatus['thinking']).toBe('💭 Thinking…')
    expect(liveStatus['preparingResponse']).toBe('💬 Preparing response…')
    expect(liveStatus['runningTool']).toBe('⚙️ Running {tool}…')
  })
})
