// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { DictionaryKey } from '../../src/i18n/types.js'

describe('DictionaryKey', () => {
  test('accepts every dotted leaf path of the Dictionary', () => {
    const keys: DictionaryKey[] = [
      'commands.start.welcome',
      'commands.stop.nothingRunning',
      'commands.stop.stoppingNow',
      'commands.stop.windingDown',
      'auth.groupNotAllowed',
      'auth.groupMemberNotAllowed',
      'auth.dmNotAllowed',
      'auth.userBlocked',
      'progress.toolStarted',
      'progress.toolFinished',
      'progress.statusSuccess',
      'progress.statusFailed',
      'progress.durationSuffix',
      'progress.inputLabel',
      'progress.outputLabel',
      'progress.errorLabel',
      'progress.reasoningTitle',
      'progress.reasoningHidden',
      'picker.prompt',
      'picker.english',
      'picker.russian',
    ]
    expect(keys).toHaveLength(21)
  })
})
