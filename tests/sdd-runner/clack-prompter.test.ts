// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { clackPrompter } from '../../sdd-runner/src/clack-prompter.js'
import type { ClackAdapter } from '../../sdd-runner/src/clack-prompter.js'

function scriptedClack(answers: { confirm?: boolean; text?: string | null; select?: string }): {
  adapter: ClackAdapter
  says: string[]
  spinnerCalls: number
} {
  const says: string[] = []
  let spinnerCalls = 0
  const adapter: ClackAdapter = {
    confirm: () => Promise.resolve(answers.confirm ?? false),
    text: () => Promise.resolve(answers.text ?? null),
    select: (): Promise<'option'> => Promise.resolve('option'),
    spinner: () => {
      spinnerCalls += 1
      return { start: (): void => undefined, stop: (): void => undefined }
    },
    say: (line: string): void => {
      says.push(line)
    },
  }
  return { adapter, says, spinnerCalls }
}

describe('clackPrompter', () => {
  it('ask adapts text answers and trims them', async () => {
    const { adapter } = scriptedClack({ text: '  approve  ' })
    const prompter = clackPrompter(adapter)
    expect(await prompter.ask('decision')).toBe('approve')
  })

  it('a cancel symbol maps to the null abandon signal', async () => {
    const { adapter } = scriptedClack({ text: null })
    const prompter = clackPrompter(adapter)
    expect(await prompter.ask('decision')).toBeNull()
  })

  it('say routes through the adapter output', () => {
    const { adapter, says } = scriptedClack({})
    const prompter = clackPrompter(adapter)
    prompter.say('evidence: none')
    expect(says).toContain('evidence: none')
  })
})
