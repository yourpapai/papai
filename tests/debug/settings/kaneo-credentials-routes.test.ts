// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { addAuthorizedGroup } from '../../../src/authorized-groups.js'
import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { taskProviderMembers } from '../../../src/db/schema.js'
import { handleKaneoCredentialsRoutes } from '../../../src/debug/settings/kaneo-credentials-routes.js'
import { upsertGroupAdminObservation, upsertKnownGroupContext } from '../../../src/group-settings/registry.js'
import { encryptInstanceConfig } from '../../../src/instances/encryption.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

const PLATFORM_INSTANCE_ID = 'pi-cred'
const USER_ID = 'u-cred-1'

const GetResponseSchema = z.object({
  contextId: z.string(),
  login: z.string(),
  status: z.string(),
  kaneoUrl: z.string().nullable().optional(),
})

const RevealResponseSchema = z.object({
  password: z.string(),
  warning: z.string(),
})

const ErrorResponseSchema = z.object({ error: z.string() })

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

/** Seed a manageable group for the test principal and return its contextId. */
function seedManageableGroup(platformInstanceId: string, userId: string): string {
  const scopedGroupId = toScopedContextId({ platformInstanceId, nativeContextId: 'grp-cred-1' })
  upsertKnownGroupContext({
    contextId: scopedGroupId,
    provider: 'telegram',
    displayName: 'Test Group',
    parentName: null,
  })
  upsertGroupAdminObservation({
    contextId: scopedGroupId,
    provider: 'telegram',
    userId,
    username: userId,
    isAdmin: true,
  })
  addAuthorizedGroup(scopedGroupId, userId)
  return scopedGroupId
}

describe('GET /settings/api/kaneo/credentials', () => {
  let session: SettingsSession
  let groupContextId: string

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: PLATFORM_INSTANCE_ID })
    addUser({ userId: USER_ID, platformInstanceId: PLATFORM_INSTANCE_ID, addedBy: 'admin', username: undefined })
    session = await establishSession({ platformInstanceId: PLATFORM_INSTANCE_ID, platformUserId: USER_ID })
    groupContextId = seedManageableGroup(PLATFORM_INSTANCE_ID, USER_ID)
  })

  test('handler function is exported and callable', () => {
    expect(typeof handleKaneoCredentialsRoutes).toBe('function')
  })

  test('returns 404 when no member row exists for this user in the group', async () => {
    const url = new URL(`https://x/settings/api/kaneo/credentials?contextId=${encodeURIComponent(groupContextId)}`)
    const res = await handleKaneoCredentialsRoutes(
      request(`/settings/api/kaneo/credentials?contextId=${encodeURIComponent(groupContextId)}`, session),
      url,
    )
    expect(res.status).toBe(404)
    const body = ErrorResponseSchema.parse(await res.json())
    expect(body.error).toContain('No Kaneo account')
  })

  test('returns 200 with login and status when member row exists (password not revealed)', async () => {
    const db = getDrizzleDb()
    db.insert(taskProviderMembers)
      .values({
        groupContextId,
        chatUserId: USER_ID,
        providerName: 'kaneo',
        providerUserId: 'pid-1',
        login: 'u-cred-1@pap.ai',
        status: 'active',
        encryptedPassword: encryptInstanceConfig({ password: 'S3cr3tP@ss' }),
        createdAt: new Date().toISOString(),
      })
      .run()

    const url = new URL(`https://x/settings/api/kaneo/credentials?contextId=${encodeURIComponent(groupContextId)}`)
    const res = await handleKaneoCredentialsRoutes(
      request(`/settings/api/kaneo/credentials?contextId=${encodeURIComponent(groupContextId)}`, session),
      url,
    )
    expect(res.status).toBe(200)
    const body = GetResponseSchema.parse(await res.json())
    expect(body.login).toBe('u-cred-1@pap.ai')
    expect(body.status).toBe('active')
  })

  test('returns 401 when unauthenticated', async () => {
    const url = new URL(`https://x/settings/api/kaneo/credentials?contextId=${encodeURIComponent(groupContextId)}`)
    const res = await handleKaneoCredentialsRoutes(
      new Request(`https://x/settings/api/kaneo/credentials?contextId=${encodeURIComponent(groupContextId)}`),
      url,
    )
    expect(res.status).toBe(401)
  })

  test('scope isolation: authenticated user sees their own row (404 when absent), not another users row', async () => {
    const db = getDrizzleDb()
    db.insert(taskProviderMembers)
      .values({
        groupContextId,
        chatUserId: 'other-user',
        providerName: 'kaneo',
        providerUserId: 'pid-other',
        login: 'other@pap.ai',
        status: 'active',
        createdAt: new Date().toISOString(),
      })
      .run()

    const url = new URL(`https://x/settings/api/kaneo/credentials?contextId=${encodeURIComponent(groupContextId)}`)
    const res = await handleKaneoCredentialsRoutes(
      request(`/settings/api/kaneo/credentials?contextId=${encodeURIComponent(groupContextId)}`, session),
      url,
    )
    // Our user (USER_ID) has no row — they should get 404, not the other user's row
    expect(res.status).toBe(404)
  })
})

describe('POST /settings/api/kaneo/credentials', () => {
  let session: SettingsSession
  let groupContextId: string

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: PLATFORM_INSTANCE_ID })
    addUser({ userId: USER_ID, platformInstanceId: PLATFORM_INSTANCE_ID, addedBy: 'admin', username: undefined })
    session = await establishSession({ platformInstanceId: PLATFORM_INSTANCE_ID, platformUserId: USER_ID })
    groupContextId = seedManageableGroup(PLATFORM_INSTANCE_ID, USER_ID)
  })

  test('returns 409 when member row has no encrypted_password', async () => {
    const db = getDrizzleDb()
    db.insert(taskProviderMembers)
      .values({
        groupContextId,
        chatUserId: USER_ID,
        providerName: 'kaneo',
        providerUserId: 'pid-1',
        login: 'u-cred-1@pap.ai',
        status: 'active',
        encryptedPassword: null,
        createdAt: new Date().toISOString(),
      })
      .run()

    const res = await handleKaneoCredentialsRoutes(
      request('/settings/api/kaneo/credentials', session, {
        method: 'POST',
        csrf: true,
        body: { action: 'reveal', contextId: groupContextId },
      }),
      new URL('https://x/settings/api/kaneo/credentials'),
    )
    expect(res.status).toBe(409)
  })

  test('returns password once and clears encrypted_password column (reveal-once semantics)', async () => {
    const plainPassword = 'Rev3alM3!'
    const db = getDrizzleDb()
    db.insert(taskProviderMembers)
      .values({
        groupContextId,
        chatUserId: USER_ID,
        providerName: 'kaneo',
        providerUserId: 'pid-1',
        login: 'u-cred-1@pap.ai',
        status: 'active',
        encryptedPassword: encryptInstanceConfig({ password: plainPassword }),
        createdAt: new Date().toISOString(),
      })
      .run()

    const res = await handleKaneoCredentialsRoutes(
      request('/settings/api/kaneo/credentials', session, {
        method: 'POST',
        csrf: true,
        body: { action: 'reveal', contextId: groupContextId },
      }),
      new URL('https://x/settings/api/kaneo/credentials'),
    )
    expect(res.status).toBe(200)
    const body = RevealResponseSchema.parse(await res.json())
    expect(body.password).toBe(plainPassword)

    // Verify encrypted_password was cleared (reveal-once semantics)
    const rawRow = db.$client
      .query<{ encrypted_password: string | null }, [string, string]>(
        `SELECT encrypted_password FROM task_provider_members WHERE group_context_id = ? AND chat_user_id = ?`,
      )
      .get(groupContextId, USER_ID)
    expect(rawRow?.encrypted_password).toBeNull()
  })

  test('returns 404 when no member row exists', async () => {
    const res = await handleKaneoCredentialsRoutes(
      request('/settings/api/kaneo/credentials', session, {
        method: 'POST',
        csrf: true,
        body: { action: 'reveal', contextId: groupContextId },
      }),
      new URL('https://x/settings/api/kaneo/credentials'),
    )
    expect(res.status).toBe(404)
  })

  test('returns 403 when CSRF header is missing on POST', async () => {
    const db = getDrizzleDb()
    db.insert(taskProviderMembers)
      .values({
        groupContextId,
        chatUserId: USER_ID,
        providerName: 'kaneo',
        providerUserId: 'pid-1',
        login: 'u-cred-1@pap.ai',
        status: 'active',
        encryptedPassword: encryptInstanceConfig({ password: 'test' }),
        createdAt: new Date().toISOString(),
      })
      .run()

    const res = await handleKaneoCredentialsRoutes(
      request('/settings/api/kaneo/credentials', session, {
        method: 'POST',
        csrf: false,
        body: { action: 'reveal', contextId: groupContextId },
      }),
      new URL('https://x/settings/api/kaneo/credentials'),
    )
    expect(res.status).toBe(403)
  })

  test('returns 405 for unsupported methods', async () => {
    const res = await handleKaneoCredentialsRoutes(
      request('/settings/api/kaneo/credentials', session, { method: 'DELETE' }),
      new URL('https://x/settings/api/kaneo/credentials'),
    )
    expect(res.status).toBe(405)
  })
})
