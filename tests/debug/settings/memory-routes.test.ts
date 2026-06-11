// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import { routeSettingsApi } from '../../../src/debug/settings-api-router.js'
import { handleMemoryRoutes } from '../../../src/debug/settings/memory-routes.js'
import {
  getMemoryProfile,
  listMemoryRecords,
  saveMemoryProfile,
  saveMemoryRecord,
} from '../../../src/long-term-memory/store.js'
import type { MemoryRecordInput, MemoryScope } from '../../../src/long-term-memory/types.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

const MemoryRecordViewSchema = z.object({
  id: z.string(),
  scopeId: z.string(),
  scopeType: z.enum(['personal', 'group']),
  kind: z.string(),
  content: z.string(),
  status: z.string(),
})

const GetMemoryResponseSchema = z.object({
  contextId: z.string(),
  scopeType: z.enum(['personal', 'group']),
  enabled: z.boolean(),
  profile: z.string(),
  records: z.array(MemoryRecordViewSchema),
})

const ProfilePatchResponseSchema = z.object({
  ok: z.literal(true),
  contextId: z.string(),
  scopeType: z.enum(['personal', 'group']),
  profile: z.string(),
})

const CapturePatchResponseSchema = z.object({
  ok: z.literal(true),
  contextId: z.string(),
  scopeType: z.enum(['personal', 'group']),
  enabled: z.boolean(),
})

const DeleteRecordResponseSchema = z.object({
  ok: z.literal(true),
  status: z.enum(['archived', 'not_found']),
})

const ClearResponseSchema = z.object({
  ok: z.literal(true),
  contextId: z.string(),
  scopeType: z.enum(['personal', 'group']),
  profileDeleted: z.number(),
  recordsDeleted: z.number(),
})

const PLATFORM_INSTANCE_ID = 'pi-1'
const USER_ID = 'u-1'

const memoryRecordInput = (overrides: Partial<MemoryRecordInput>): MemoryRecordInput => ({
  id: 'mem-1',
  scopeId: 'unused-context',
  scopeType: 'personal',
  kind: 'preference',
  content: 'User prefers concise implementation plans.',
  summary: 'Concise plans',
  tags: ['style'],
  confidence: 1,
  status: 'active',
  source: 'explicit',
  evidence: {},
  createdAt: '2026-06-11T00:00:00.000Z',
  updatedAt: '2026-06-11T00:00:00.000Z',
  lastSeenAt: '2026-06-11T00:00:00.000Z',
  ...overrides,
})

function request(
  path: string,
  session: SettingsSession,
  options: Readonly<{ method?: string; csrf?: boolean; body?: unknown }> = {},
): Request {
  return new Request(`https://x${path}`, {
    method: options.method,
    headers: {
      ...authHeaders(session, options.csrf === true),
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
}

describe('settings memory routes', () => {
  let session: SettingsSession
  let personalContextId: string
  let personalScope: MemoryScope

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: PLATFORM_INSTANCE_ID })
    addUser({ userId: USER_ID, platformInstanceId: PLATFORM_INSTANCE_ID, addedBy: 'admin', username: undefined })
    session = await establishSession({ platformInstanceId: PLATFORM_INSTANCE_ID, platformUserId: USER_ID })
    personalContextId = toScopedContextId({ platformInstanceId: PLATFORM_INSTANCE_ID, nativeContextId: USER_ID })
    personalScope = { scopeId: personalContextId, scopeType: 'personal' }
  })

  test('GET returns profile and active records for authorized personal scope', async () => {
    saveMemoryProfile(personalScope, '## Preferences\n- Keep answers concise', '2026-06-11T00:00:00.000Z')
    saveMemoryRecord(memoryRecordInput({ id: 'active-1', scopeId: personalContextId, status: 'active' }))
    saveMemoryRecord(memoryRecordInput({ id: 'archived-1', scopeId: personalContextId, status: 'archived' }))

    const url = new URL('https://x/settings/api/memory')
    const res = await handleMemoryRoutes(request('/settings/api/memory', session), url)

    expect(res.status).toBe(200)
    const body = GetMemoryResponseSchema.parse(await res.json())
    expect(body.contextId).toBe(personalContextId)
    expect(body.scopeType).toBe('personal')
    expect(body.enabled).toBe(true)
    expect(body.profile).toBe('## Preferences\n- Keep answers concise')
    expect(body.records.map((record) => record.id)).toEqual(['active-1'])
  })

  test('GET defaults profile to empty and capture enabled when no profile row exists', async () => {
    const routed = await routeSettingsApi(
      request('/settings/api/memory', session),
      new URL('https://x/settings/api/memory'),
    )

    expect(routed?.status).toBe(200)
    const body = GetMemoryResponseSchema.parse(await routed?.json())
    expect(body.contextId).toBe(personalContextId)
    expect(body.profile).toBe('')
    expect(body.enabled).toBe(true)
    expect(body.records).toEqual([])
  })

  test('PATCH profile updates profile with CSRF and rejects without CSRF', async () => {
    const missingCsrf = await handleMemoryRoutes(
      request('/settings/api/memory/profile', session, {
        method: 'PATCH',
        body: { profile: '## Preferences\n- Remember task context' },
      }),
      new URL('https://x/settings/api/memory/profile'),
    )
    expect(missingCsrf.status).toBe(403)

    const res = await handleMemoryRoutes(
      request('/settings/api/memory/profile', session, {
        method: 'PATCH',
        csrf: true,
        body: { profile: '## Preferences\n- Remember task context' },
      }),
      new URL('https://x/settings/api/memory/profile'),
    )

    expect(res.status).toBe(200)
    const body = ProfilePatchResponseSchema.parse(await res.json())
    expect(body.contextId).toBe(personalContextId)
    expect(body.profile).toBe('## Preferences\n- Remember task context')
    expect(getMemoryProfile(personalScope)?.profile).toBe('## Preferences\n- Remember task context')
  })

  test('PATCH capture toggles enabled', async () => {
    const res = await handleMemoryRoutes(
      request('/settings/api/memory/capture', session, {
        method: 'PATCH',
        csrf: true,
        body: { enabled: false },
      }),
      new URL('https://x/settings/api/memory/capture'),
    )

    expect(res.status).toBe(200)
    const body = CapturePatchResponseSchema.parse(await res.json())
    expect(body.contextId).toBe(personalContextId)
    expect(body.enabled).toBe(false)
    expect(getMemoryProfile(personalScope)?.enabled).toBe(false)
  })

  test('DELETE archives only records in authorized full scope', async () => {
    saveMemoryRecord(memoryRecordInput({ id: 'personal-record', scopeId: personalContextId, scopeType: 'personal' }))
    saveMemoryRecord(
      memoryRecordInput({ id: 'group-record', scopeId: personalContextId, scopeType: 'group', kind: 'decision' }),
    )

    const res = await handleMemoryRoutes(
      request('/settings/api/memory/records/personal-record', session, {
        method: 'DELETE',
        csrf: true,
        body: {},
      }),
      new URL('https://x/settings/api/memory/records/personal-record'),
    )

    expect(res.status).toBe(200)
    expect(DeleteRecordResponseSchema.parse(await res.json()).status).toBe('archived')
    expect(listMemoryRecords({ scopeId: personalContextId, scopeType: 'personal', status: 'active' })).toEqual([])
    expect(
      listMemoryRecords({ scopeId: personalContextId, scopeType: 'group', status: 'active' }).map((r) => r.id),
    ).toEqual(['group-record'])
  })

  test('POST clear clears only authorized scope', async () => {
    saveMemoryProfile(personalScope, 'Personal profile', '2026-06-11T00:00:00.000Z')
    saveMemoryProfile({ scopeId: personalContextId, scopeType: 'group' }, 'Group profile', '2026-06-11T00:00:00.000Z')
    saveMemoryRecord(memoryRecordInput({ id: 'personal-record', scopeId: personalContextId, scopeType: 'personal' }))
    saveMemoryRecord(
      memoryRecordInput({ id: 'group-record', scopeId: personalContextId, scopeType: 'group', kind: 'decision' }),
    )

    const res = await handleMemoryRoutes(
      request('/settings/api/memory/clear', session, {
        method: 'POST',
        csrf: true,
        body: {},
      }),
      new URL('https://x/settings/api/memory/clear'),
    )

    expect(res.status).toBe(200)
    const body = ClearResponseSchema.parse(await res.json())
    expect(body.profileDeleted).toBe(1)
    expect(body.recordsDeleted).toBe(1)
    expect(getMemoryProfile(personalScope)).toBeNull()
    expect(getMemoryProfile({ scopeId: personalContextId, scopeType: 'group' })?.profile).toBe('Group profile')
    expect(
      listMemoryRecords({ scopeId: personalContextId, scopeType: 'group', status: 'active' }).map((r) => r.id),
    ).toEqual(['group-record'])
  })

  test('GET returns 401 when unauthenticated', async () => {
    const url = new URL('https://x/settings/api/memory')
    const res = await handleMemoryRoutes(new Request(url), url)
    expect(res.status).toBe(401)
  })

  test("GET rejects another user's personal context", async () => {
    addUser({ userId: 'u-2', platformInstanceId: PLATFORM_INSTANCE_ID, addedBy: 'admin', username: undefined })
    const victimContextId = toScopedContextId({ platformInstanceId: PLATFORM_INSTANCE_ID, nativeContextId: 'u-2' })
    const url = new URL(`https://x/settings/api/memory?contextId=${encodeURIComponent(victimContextId)}`)

    const res = await handleMemoryRoutes(new Request(url, { headers: authHeaders(session) }), url)

    expect(res.status).toBe(403)
  })
})
