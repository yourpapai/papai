// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createAuth, createGroupMessage, createMockReply } from '../../utils/test-helpers.js'
import { activate } from './support.js'

describe('/nerv command', () => {
  test('registers a plain help command', () => {
    const { command } = activate(() => Promise.resolve(new Response('{}', { status: 200 })))
    expect(command).toBeDefined()
    expect(command!.name).toBe('nerv')
  })

  test('bare /nerv returns the static help text, pointing to Settings for supervised projects', async () => {
    const { command } = activate(() => Promise.resolve(new Response('{}', { status: 200 })))
    const msg = createGroupMessage('u1', '/nerv', false, 'g1')
    msg.commandMatch = ''
    const { reply, textCalls } = createMockReply()
    const auth = createAuth('u1', { allowed: true })
    await command!.execute(msg, reply, auth)
    expect(textCalls.join('\n')).toMatch(/supervised coding tasks/iu)
    expect(textCalls.join('\n')).toMatch(/Supervised Projects/u)
  })

  test('/nerv with arbitrary trailing text still returns the plain help text', async () => {
    const { command } = activate(() => Promise.resolve(new Response('{}', { status: 200 })))
    const msg = createGroupMessage('u1', '/nerv anything', false, 'g1')
    msg.commandMatch = 'anything'
    const { reply, textCalls } = createMockReply()
    const auth = createAuth('u1', { allowed: true })
    await command!.execute(msg, reply, auth)
    expect(textCalls.join('\n')).toMatch(/supervised coding tasks/iu)
  })
})
