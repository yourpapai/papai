// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createCiGroups } from '../../opencode-agent/src/ci-groups.js'

/**
 * The `::group::` / `::endgroup::` workflow commands, which fold a phase's log
 * lines into a collapsible section in the Actions viewer. They are interpreted
 * by the runner only when they arrive as **raw** stdout lines — routed through
 * the NDJSON logger they would be escaped into a JSON string and print
 * literally, which is why this module takes its own sink and the command
 * syntax lives in exactly this one place.
 */

describe('createCiGroups', () => {
  test('opens a section with the headline as a raw command line', () => {
    const written: string[] = []
    const groups = createCiGroups((line) => void written.push(line))

    groups.startGroup('🛠️ Writing the code')

    expect(written).toEqual(['::group::🛠️ Writing the code\n'])
  })

  test('closes a section with the bare endgroup command', () => {
    const written: string[] = []
    const groups = createCiGroups((line) => void written.push(line))

    groups.startGroup('🗺️ Breaking the spec into steps')
    groups.endGroup()

    expect(written).toEqual(['::group::🗺️ Breaking the spec into steps\n', '::endgroup::\n'])
  })

  test('writes to stdout by default, not through the logger', () => {
    // The default sink is the point: a `::group::` line only folds the log if
    // the runner sees it raw.
    const groups = createCiGroups()

    expect(() => groups.endGroup()).not.toThrow()
  })
})
