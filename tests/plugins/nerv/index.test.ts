// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createAuth, createGroupMessage, createMockReply } from '../../utils/test-helpers.js'
import { activate } from './support.js'

const NERV_CFG: Record<string, string> = { nerv_base_url: 'http://nerv:9000', nerv_token: 'tok' }
const nervAdminConfig = { get: (k: string): string | undefined => NERV_CFG[k] }

type Captured = { url: string; body: unknown }

function parsedBody(init: RequestInit | undefined): unknown {
  const b = init?.body
  return typeof b === 'string' && b.length > 0 ? JSON.parse(b) : null
}

function capturingFetch(captured: Captured[], response: unknown, status = 200) {
  return (url: string, init?: RequestInit): Promise<Response> => {
    captured.push({ url, body: parsedBody(init) })
    return Promise.resolve(
      new Response(JSON.stringify(response), { status, headers: { 'Content-Type': 'application/json' } }),
    )
  }
}

describe('/nerv command', () => {
  test('bare /nerv still returns the static help text, now mentioning bind', async () => {
    const { command } = activate(() => Promise.resolve(new Response('{}', { status: 200 })))
    const msg = createGroupMessage('u1', '/nerv', false, 'g1')
    msg.commandMatch = ''
    const { reply, textCalls } = createMockReply()
    const auth = createAuth('u1', { allowed: true })
    await command!.execute(msg, reply, auth)
    expect(textCalls.join('\n')).toMatch(/supervised coding tasks/iu)
    expect(textCalls.join('\n')).toMatch(/\/nerv bind <projectPath>/u)
  })

  test('/nerv bind with no path replies with a usage error and never calls nerv', async () => {
    const calls: string[] = []
    const httpFetch = (url: string): Promise<Response> => {
      calls.push(url)
      return Promise.resolve(new Response('{}', { status: 200 }))
    }
    const { command } = activate(httpFetch, nervAdminConfig)
    const msg = createGroupMessage('u1', '/nerv bind', true, 'g1')
    msg.commandMatch = 'bind'
    const { reply, textCalls } = createMockReply()
    const auth = createAuth('g1', { allowed: true, isBotAdmin: true })
    await command!.execute(msg, reply, auth)
    expect(calls).toHaveLength(0)
    expect(textCalls.join('\n')).toMatch(/usage: \/nerv bind <projectPath>/iu)
  })

  test('/nerv bind with extra tokens replies with a usage error and never calls nerv', async () => {
    const calls: string[] = []
    const httpFetch = (url: string): Promise<Response> => {
      calls.push(url)
      return Promise.resolve(new Response('{}', { status: 200 }))
    }
    const { command } = activate(httpFetch, nervAdminConfig)
    const msg = createGroupMessage('u1', '/nerv bind a b', true, 'g1')
    msg.commandMatch = 'bind a b'
    const { reply, textCalls } = createMockReply()
    const auth = createAuth('g1', { allowed: true, isBotAdmin: true })
    await command!.execute(msg, reply, auth)
    expect(calls).toHaveLength(0)
    expect(textCalls.join('\n')).toMatch(/usage: \/nerv bind <projectPath>/iu)
  })

  test('admin /nerv bind <projectPath> posts to nerv with storageContextId and replies success', async () => {
    const captured: Captured[] = []
    const { command } = activate(capturingFetch(captured, { ok: true }), nervAdminConfig)
    const msg = createGroupMessage('u1', '/nerv bind acme/demo', true, 'g1')
    msg.commandMatch = 'bind acme/demo'
    const { reply, textCalls } = createMockReply()
    const auth = createAuth('g1', { allowed: true, isGroupAdmin: true })
    await command!.execute(msg, reply, auth)
    expect(captured).toEqual([
      { url: 'http://nerv:9000/projects/bind', body: { projectPath: 'acme/demo', notifyContextId: 'g1' } },
    ])
    expect(textCalls.join('\n')).toMatch(/bound.*acme\/demo/iu)
  })

  test('non-admin /nerv bind is refused and never calls nerv', async () => {
    const calls: string[] = []
    const httpFetch = (url: string): Promise<Response> => {
      calls.push(url)
      return Promise.resolve(new Response('{}', { status: 200 }))
    }
    const { command } = activate(httpFetch, nervAdminConfig)
    const msg = createGroupMessage('u1', '/nerv bind acme/demo', false, 'g1')
    msg.commandMatch = 'bind acme/demo'
    const { reply, textCalls } = createMockReply()
    const auth = createAuth('g1', { allowed: true, isBotAdmin: false, isGroupAdmin: false })
    await command!.execute(msg, reply, auth)
    expect(calls).toHaveLength(0)
    expect(textCalls.join('\n')).toMatch(/admin/iu)
  })

  test('nerv 404 on bind surfaces an unknown-project error', async () => {
    const httpFetch = (): Promise<Response> => Promise.resolve(new Response('{}', { status: 404 }))
    const { command } = activate(httpFetch, nervAdminConfig)
    const msg = createGroupMessage('u1', '/nerv bind ghost/repo', true, 'g1')
    msg.commandMatch = 'bind ghost/repo'
    const { reply, textCalls } = createMockReply()
    const auth = createAuth('g1', { allowed: true, isBotAdmin: true })
    await command!.execute(msg, reply, auth)
    expect(textCalls.join('\n')).toMatch(/unknown nerv project/iu)
  })
})
