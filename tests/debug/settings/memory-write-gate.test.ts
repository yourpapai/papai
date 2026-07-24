// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { z } from 'zod'

import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import { authenticateForWrite, resolveWriteBody } from '../../../src/debug/settings/memory-write-gate.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

const BodySchema = z.object({
  contextId: z.string().optional(),
  value: z.string(),
})

const PLATFORM_INSTANCE_ID = 'pi-1'
const USER_ID = 'u-1'

function request(
  path: string,
  session: SettingsSession | null,
  options: Readonly<{ csrf?: boolean; body?: unknown }> = {},
): Request {
  return new Request(`https://x${path}`, {
    method: 'PATCH',
    headers: {
      ...(session === null ? {} : authHeaders(session, options.csrf === true)),
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
}

describe('memory write gate', () => {
  let session: SettingsSession
  let personalContextId: string

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: PLATFORM_INSTANCE_ID })
    addUser({ userId: USER_ID, platformInstanceId: PLATFORM_INSTANCE_ID, addedBy: 'admin', username: undefined })
    session = await establishSession({ platformInstanceId: PLATFORM_INSTANCE_ID, platformUserId: USER_ID })
    personalContextId = toScopedContextId({ platformInstanceId: PLATFORM_INSTANCE_ID, nativeContextId: USER_ID })
  })

  describe('authenticateForWrite', () => {
    test('rejects an unauthenticated request with 401', () => {
      const gate = authenticateForWrite(request('/x', null))
      expect(gate.ok).toBe(false)
      assert(!gate.ok)
      expect(gate.response.status).toBe(401)
    })

    test('rejects a request missing the CSRF header with 403', () => {
      const gate = authenticateForWrite(request('/x', session))
      expect(gate.ok).toBe(false)
      assert(!gate.ok)
      expect(gate.response.status).toBe(403)
    })

    test('resolves the authenticated principal when auth and CSRF succeed', () => {
      const gate = authenticateForWrite(request('/x', session, { csrf: true }))
      expect(gate.ok).toBe(true)
      assert(gate.ok)
      expect(gate.authed.principal.platformUserId).toBe(USER_ID)
    })
  })

  describe('resolveWriteBody', () => {
    test('returns a controlled JSON error for malformed JSON', async () => {
      const req = new Request('https://x/x', {
        method: 'PATCH',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: 'not-json',
      })
      const gate = authenticateForWrite(req)
      expect(gate.ok).toBe(true)
      assert(gate.ok)

      const resolved = await resolveWriteBody(req, gate.authed, BodySchema)
      expect(resolved.ok).toBe(false)
      assert(!resolved.ok)
      expect(resolved.response.status).toBe(400)
    })

    test('returns 422 when the body fails schema validation', async () => {
      const req = request('/x', session, { csrf: true, body: { value: 42 } })
      const gate = authenticateForWrite(req)
      expect(gate.ok).toBe(true)
      assert(gate.ok)

      const resolved = await resolveWriteBody(req, gate.authed, BodySchema)
      expect(resolved.ok).toBe(false)
      assert(!resolved.ok)
      expect(resolved.response.status).toBe(422)
    })

    test('returns 403 for a contextId the principal cannot write to', async () => {
      addUser({ userId: 'u-2', platformInstanceId: PLATFORM_INSTANCE_ID, addedBy: 'admin', username: undefined })
      const victimContextId = toScopedContextId({ platformInstanceId: PLATFORM_INSTANCE_ID, nativeContextId: 'u-2' })

      const req = request('/x', session, { csrf: true, body: { contextId: victimContextId, value: 'v' } })
      const gate = authenticateForWrite(req)
      expect(gate.ok).toBe(true)
      assert(gate.ok)

      const resolved = await resolveWriteBody(req, gate.authed, BodySchema)
      expect(resolved.ok).toBe(false)
      assert(!resolved.ok)
      expect(resolved.response.status).toBe(403)
    })

    test('resolves the memory scope and parsed data on success', async () => {
      const req = request('/x', session, { csrf: true, body: { value: 'hello' } })
      const gate = authenticateForWrite(req)
      expect(gate.ok).toBe(true)
      assert(gate.ok)

      const resolved = await resolveWriteBody(req, gate.authed, BodySchema)
      expect(resolved.ok).toBe(true)
      assert(resolved.ok)
      expect(resolved.memoryScope).toEqual({ scopeId: personalContextId, scopeType: 'personal' })
      expect(resolved.data).toEqual({ value: 'hello' })
    })
  })
})
