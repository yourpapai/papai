// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { kaneoProvisionMember } from '../../../../plugins/task-provider-kaneo/operations/members.js'
import { KaneoProvider } from '../../../../plugins/task-provider-kaneo/provider.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const TEST_CONFIG = { apiKey: 'test-key', baseUrl: 'http://kaneo-test' }
const WORKSPACE_ID = 'ws-1'

function makeProvider(): KaneoProvider {
  return new KaneoProvider(TEST_CONFIG, WORKSPACE_ID)
}

// ---------------------------------------------------------------------------
// Reusable response factories
// ---------------------------------------------------------------------------

function signUpResponse(userId: string, token: string): Response {
  return new Response(JSON.stringify({ user: { id: userId }, token }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function signInResponse(userId: string, token: string): Response {
  return new Response(JSON.stringify({ user: { id: userId }, token }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function inviteResponse(invitationId: string): Response {
  return new Response(JSON.stringify({ id: invitationId, status: 'pending' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function acceptResponse(): Response {
  return new Response(JSON.stringify({ status: 'accepted' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function parseBody(init: RequestInit): unknown {
  const { body } = init
  if (body === undefined || body === null) return undefined
  // In tests bodies are always plain JSON strings
  if (typeof body !== 'string') throw new Error(`Unexpected non-string body in test handler: ${typeof body}`)
  return JSON.parse(body) as unknown
}

function parseHeaders(init: RequestInit): Record<string, string> {
  const result: Record<string, string> = {}
  const { headers } = init
  if (headers === undefined || headers === null) return result
  // Normalise: in tests headers are always set as plain HeadersInit objects
  const h = new Headers(headers)
  h.forEach((v, k) => {
    result[k] = v
  })
  return result
}

// ---------------------------------------------------------------------------
// Module-level mock handlers (no conditionals inside test bodies)
// ---------------------------------------------------------------------------

type MockCall = { url: string; body: unknown; headers: Record<string, string> }

let newMemberCalls: MockCall[] = []
let reuseCalls: { url: string; body: unknown }[] = []

function newMemberHandler(url: string, init: RequestInit): Promise<Response> {
  newMemberCalls.push({ url, body: parseBody(init), headers: parseHeaders(init) })
  if (url.includes('/api/auth/sign-up/email'))
    return Promise.resolve(signUpResponse('new-user-id', 'member-session-token'))
  if (url.includes('/api/auth/organization/invite-member')) return Promise.resolve(inviteResponse('inv-001'))
  if (url.includes('/api/auth/organization/accept-invitation')) return Promise.resolve(acceptResponse())
  return Promise.resolve(new Response('not found', { status: 404 }))
}

function alreadyInvitedHandler(url: string): Promise<Response> {
  if (url.includes('/api/auth/sign-up/email')) return Promise.resolve(signUpResponse('uid-2', 'tok2'))
  if (url.includes('/api/auth/organization/invite-member')) return Promise.resolve(inviteResponse('inv-existing'))
  if (url.includes('/api/auth/organization/accept-invitation')) return Promise.resolve(acceptResponse())
  return Promise.resolve(new Response('not found', { status: 404 }))
}

function reuseHandler(url: string, init: RequestInit): Promise<Response> {
  reuseCalls.push({ url, body: parseBody(init) })
  if (url.includes('/api/auth/sign-in/email')) return Promise.resolve(signInResponse('existing-uid', 'reuse-token'))
  if (url.includes('/api/auth/organization/invite-member')) return Promise.resolve(inviteResponse('inv-reuse'))
  if (url.includes('/api/auth/organization/accept-invitation')) return Promise.resolve(acceptResponse())
  return Promise.resolve(new Response('unexpected', { status: 500 }))
}

// ---------------------------------------------------------------------------

describe('KaneoProvider.listUsers', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('is defined on KaneoProvider', () => {
    const provider = makeProvider()
    expect(typeof provider.listUsers).toBe('function')
  })

  test('forwards to kaneoListUsers and returns UserRef[]', async () => {
    setMockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify([
            { id: 'u1', name: 'Alice', email: 'alice@example.com', role: 'member' },
            { id: 'u2', name: 'Bob', email: 'bob@example.com', role: 'admin' },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )
    const provider = makeProvider()
    const result = await provider.listUsers()
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ id: 'u1', login: 'alice@example.com', name: 'Alice' })
    restoreFetch()
  })

  test('respects capabilities: members.provision is set', () => {
    const provider = makeProvider()
    expect(provider.capabilities.has('members.provision')).toBe(true)
  })
})

describe('kaneoProvisionMember', () => {
  beforeEach(() => {
    mockLogger()
    newMemberCalls = []
    reuseCalls = []
  })

  test('new-member path: sign-up → invite-member (service auth + organizationId) → accept-invitation (member cookie + invitationId)', async () => {
    setMockFetch(newMemberHandler)

    const result = await kaneoProvisionMember(
      TEST_CONFIG,
      WORKSPACE_ID,
      { chatUserId: 'chat-1', displayName: 'Alice Liddell', username: 'alice' },
      'http://kaneo-public',
    )

    expect(result.providerUserId).toBe('new-user-id')
    expect(result.login).toMatch(/@pap\.ai$/u)
    expect(result.password).toBeTruthy()

    const signUpCall = newMemberCalls.find((c) => c.url.includes('/api/auth/sign-up/email'))
    expect(signUpCall?.body).toMatchObject({ name: 'Alice Liddell' })

    const inviteCall = newMemberCalls.find((c) => c.url.includes('/api/auth/organization/invite-member'))
    expect(inviteCall?.body).toMatchObject({ organizationId: WORKSPACE_ID, role: 'member' })
    // invite uses the SERVICE credential (api-key), not the member cookie
    expect(inviteCall?.headers['authorization']).toMatch(/^Bearer /u)

    const acceptCall = newMemberCalls.find((c) => c.url.includes('/api/auth/organization/accept-invitation'))
    expect(acceptCall?.body).toMatchObject({ invitationId: 'inv-001' })
    // accept uses the MEMBER session cookie, not the service key
    expect(acceptCall?.headers['cookie']).toBeDefined()
    expect(acceptCall?.headers['authorization']).toBeUndefined()

    restoreFetch()
  })

  test('invite-member treats 200 already-invited as success and proceeds to accept', async () => {
    setMockFetch(alreadyInvitedHandler)

    const result = await kaneoProvisionMember(
      TEST_CONFIG,
      WORKSPACE_ID,
      { chatUserId: 'chat-2', displayName: 'Bob', username: null },
      'http://kaneo-public',
    )
    expect(result.providerUserId).toBe('uid-2')
    restoreFetch()
  })

  test('reuse path: sign-IN (not sign-up) → invite-member → accept-invitation; returns existing id and stored password', async () => {
    setMockFetch(reuseHandler)

    const result = await kaneoProvisionMember(
      TEST_CONFIG,
      WORKSPACE_ID,
      { chatUserId: 'chat-3', displayName: 'Carol', username: 'carol' },
      'http://kaneo-public',
      { providerUserId: 'existing-uid', login: 'carol@pap.ai', password: 'StoredPass1!Aa' },
    )

    expect(result.providerUserId).toBe('existing-uid')
    expect(result.login).toBe('carol@pap.ai')
    expect(result.password).toBe('StoredPass1!Aa')

    // Must call sign-IN, not sign-up
    const signUpCall = reuseCalls.find((c) => c.url.includes('/api/auth/sign-up/email'))
    expect(signUpCall).toBeUndefined()
    const signInCall = reuseCalls.find((c) => c.url.includes('/api/auth/sign-in/email'))
    expect(signInCall?.body).toMatchObject({ email: 'carol@pap.ai', password: 'StoredPass1!Aa' })

    const inviteCall = reuseCalls.find((c) => c.url.includes('/api/auth/organization/invite-member'))
    expect(inviteCall?.body).toMatchObject({ organizationId: WORKSPACE_ID, role: 'member' })

    const acceptCall = reuseCalls.find((c) => c.url.includes('/api/auth/organization/accept-invitation'))
    expect(acceptCall?.body).toMatchObject({ invitationId: 'inv-reuse' })

    restoreFetch()
  })
})
