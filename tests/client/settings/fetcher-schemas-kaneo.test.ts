// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import {
  KaneoCredentialsSchema,
  KaneoMembershipSchema,
  KaneoMembershipsSchema,
  KaneoRevealSchema,
} from '../../../client/settings/fetcher-schemas-kaneo.js'
import { fetchKaneoMemberships, revealKaneoSelfPassword, setCsrfToken } from '../../../client/settings/fetchers.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

describe('KaneoCredentialsSchema', () => {
  test('parses a valid credentials response', () => {
    const result = KaneoCredentialsSchema.parse({
      contextId: 'grp-1',
      login: 'user@pap.ai',
      status: 'active',
      kaneoUrl: 'http://kaneo.example.com',
    })
    expect(result.login).toBe('user@pap.ai')
    expect(result.status).toBe('active')
  })

  test('parses with null kaneoUrl', () => {
    const result = KaneoCredentialsSchema.parse({
      contextId: 'grp-1',
      login: 'user@pap.ai',
      status: 'active',
      kaneoUrl: null,
    })
    expect(result.kaneoUrl).toBeNull()
  })

  test('rejects unknown status values', () => {
    expect(() =>
      KaneoCredentialsSchema.parse({ contextId: 'g', login: 'x@pap.ai', status: 'unknown', kaneoUrl: null }),
    ).toThrow()
  })
})

describe('KaneoRevealSchema', () => {
  test('parses a valid reveal response', () => {
    const result = KaneoRevealSchema.parse({
      password: 'S3cr3tP@ss',
      warning: 'This password is shown once. Store it securely.',
    })
    expect(result.password).toBe('S3cr3tP@ss')
  })
})

describe('KaneoMembershipSchema', () => {
  test('parses a membership row with a workspace URL', () => {
    const result = KaneoMembershipSchema.parse({
      contextId: 'grp-1',
      groupLabel: 'Team A',
      login: 'user@pap.ai',
      status: 'active',
      kaneoUrl: 'http://kaneo.example.com',
    })
    expect(result.groupLabel).toBe('Team A')
    expect(result.login).toBe('user@pap.ai')
  })

  test('parses a membership row with a null workspace URL', () => {
    const result = KaneoMembershipSchema.parse({
      contextId: 'grp-1',
      groupLabel: 'Team A',
      login: 'user@pap.ai',
      status: 'inactive',
      kaneoUrl: null,
    })
    expect(result.kaneoUrl).toBeNull()
  })

  test('rejects unknown status values', () => {
    expect(() =>
      KaneoMembershipSchema.parse({
        contextId: 'g',
        groupLabel: 'G',
        login: 'x@pap.ai',
        status: 'unknown',
        kaneoUrl: null,
      }),
    ).toThrow()
  })

  test('the list schema accepts an empty membership list', () => {
    expect(KaneoMembershipsSchema.parse({ memberships: [] })).toEqual({ memberships: [] })
  })
})

describe('Kaneo self fetchers', () => {
  type CapturedRequest = { url: string; method: string; headers: Record<string, string>; body: unknown }

  const captureFetch =
    (calls: CapturedRequest[], response: Response) =>
    (url: string, init?: RequestInit): Promise<Response> => {
      const headers: Record<string, string> = {}
      new Headers(init?.headers).forEach((value, key) => {
        headers[key] = value
      })
      calls.push({ url, method: (init?.method ?? 'GET').toUpperCase(), headers, body: init?.body ?? null })
      return Promise.resolve(response)
    }

  const json = (payload: unknown, status = 200): Response =>
    new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

  afterEach(() => {
    restoreFetch()
    setCsrfToken('')
  })

  test('fetchKaneoMemberships GETs the self endpoint and parses the list', async () => {
    const calls: CapturedRequest[] = []
    setMockFetch(
      captureFetch(
        calls,
        json({
          memberships: [
            { contextId: 'grp-1', groupLabel: 'Team A', login: 'a@pap.ai', status: 'active', kaneoUrl: null },
          ],
        }),
      ),
    )

    const result = await fetchKaneoMemberships()

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('/settings/api/kaneo/credentials/self')
    expect(calls[0]?.method).toBe('GET')
    expect(result.memberships).toHaveLength(1)
    expect(result.memberships[0]?.groupLabel).toBe('Team A')
  })

  test('revealKaneoSelfPassword POSTs the reveal action with CSRF and parses the password', async () => {
    setCsrfToken('csrf-self')
    const calls: CapturedRequest[] = []
    setMockFetch(
      captureFetch(calls, json({ password: 'S3cr3tP@ss', warning: 'This password is shown once. Store it securely.' })),
    )

    const result = await revealKaneoSelfPassword('grp-1')

    expect(calls[0]?.url).toBe('/settings/api/kaneo/credentials/self')
    expect(calls[0]?.method).toBe('POST')
    const csrfHeader = Object.entries(calls[0]?.headers ?? {}).find(([key]) => key.toLowerCase() === 'x-settings-csrf')
    expect(csrfHeader?.[1]).toBe('csrf-self')
    expect(JSON.parse(String(calls[0]?.body))).toEqual({ action: 'reveal', contextId: 'grp-1' })
    expect(result.password).toBe('S3cr3tP@ss')
  })

  test('fetchKaneoMemberships surfaces the server error message on failure', async () => {
    setMockFetch(() => Promise.resolve(json({ error: 'unauthenticated' }, 401)))

    await expect(fetchKaneoMemberships()).rejects.toThrow(/unauthenticated/u)
  })
})
