// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import { PassThrough } from 'node:stream'

import { readlinePrompter, scriptedPrompter, stdinIsInteractive } from '../../sdd-runner/src/prompter.js'

describe('scriptedPrompter', () => {
  it('returns scripted answers in order and null once exhausted, recording the transcript', async () => {
    const { prompter, transcript } = scriptedPrompter(['a', 'approve'])
    expect(await prompter.ask('item?')).toBe('a')
    expect(await prompter.ask('decision?')).toBe('approve')
    expect(await prompter.ask('extra?')).toBeNull()
    expect(transcript).toEqual(['? item?', '> a', '? decision?', '> approve', '? extra?'])
  })

  it('say records lines without consuming the script', () => {
    const { prompter, transcript } = scriptedPrompter(['x'])
    prompter.say('a line')
    expect(transcript).toEqual(['a line'])
  })
})

describe('readlinePrompter', () => {
  it('asks via readline and echoes said lines to the output stream', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const prompter = readlinePrompter({ input, output })
    prompter.say('hello')
    expect(output.read()).toEqual(Buffer.from('hello\n'))
    const answer = prompter.ask('name?')
    input.write('someone\n')
    expect(await answer).toBe('someone')
  })
})

describe('stdinIsInteractive', () => {
  it('is true when stdin reports a TTY and false otherwise', () => {
    expect(stdinIsInteractive({ isTTY: true })).toBe(true)
    expect(stdinIsInteractive({ isTTY: false })).toBe(false)
    expect(stdinIsInteractive({})).toBe(false)
  })
})
