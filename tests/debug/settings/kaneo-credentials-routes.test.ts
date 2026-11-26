// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { addAuthorizedGroup } from '../../../src/authorized-groups.js'
import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { kaneoWorkspaceMembers } from '../../../src/db/schema.js'
import { routeSettingsApi } from '../../../src/debug/settings-api-router.js'
import {
  handleKaneoCredentialsRoutes,
  handleKaneoCredentialsSelfRoutes,
} from '../../../src/debug/settings/kaneo-credentials-routes.js'
import { upsertGroupAdminObservation, upsertKnownGroupContext } from '../../../src/group-settings/registry.js'
import { setContextSettings } from '../../../src/instances/context-store.js'
import { encryptInstanceConfig } from '../../../src/instances/encryption.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, seedTestTaskInstance, setupTestDb } from '../../utils/test-helpers.js'
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
    db.insert(kaneoWorkspaceMembers)
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
    db.insert(kaneoWorkspaceMembers)
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
    db.insert(kaneoWorkspaceMembers)
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
    db.insert(kaneoWorkspaceMembers)
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
        `SELECT encrypted_password FROM kaneo_workspace_members WHERE group_context_id = ? AND chat_user_id = ?`,
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
    db.insert(kaneoWorkspaceMembers)
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

// ---------------------------------------------------------------------------
// Member-scoped self routes (GET/POST /settings/api/kaneo/credentials/self)
// ---------------------------------------------------------------------------

const SELF_PATH = '/settings/api/kaneo/credentials/self'
const OTHER_USER_ID = 'u-cred-other'
const OTHER_PLATFORM_INSTANCE_ID = 'pi-cred-other'
const KANEO_TASK_INSTANCE_ID = 'ti-cred-kaneo'

const SelfMembershipSchema = z.object({
  contextId: z.string(),
  groupLabel: z.string(),
  login: z.string(),
  status: z.string(),
  kaneoUrl: z.string().nullable(),
})

const SelfListResponseSchema = z.object({ memberships: z.array(SelfMembershipSchema) })

type MemberRow = Readonly<{
  contextId: string
  chatUserId: string
  login: string
  status?: 'active' | 'inactive' | 'failed'
  encryptedPassword?: string | null
}>

function insertMemberRow(row: MemberRow): void {
  getDrizzleDb()
    .insert(kaneoWorkspaceMembers)
    .values({
      groupContextId: row.contextId,
      chatUserId: row.chatUserId,
      providerName: 'kaneo',
      providerUserId: `pid-${row.chatUserId}`,
      login: row.login,
      status: row.status ?? 'active',
      encryptedPassword: row.encryptedPassword ?? null,
      createdAt: new Date().toISOString(),
    })
    .run()
}

/** Create a group context with a known display name; callers choose whether it is authorized. */
function seedGroupContext(platformInstanceId: string, nativeContextId: string, displayName: string): string {
  const contextId = toScopedContextId({ platformInstanceId, nativeContextId })
  upsertKnownGroupContext({ contextId, provider: 'telegram', displayName, parentName: null })
  return contextId
}

function rawEncryptedPassword(contextId: string, chatUserId: string): string | null {
  const row = getDrizzleDb()
    .$client.query<{ encrypted_password: string | null }, [string, string]>(
      'SELECT encrypted_password FROM kaneo_workspace_members WHERE group_context_id = ? AND chat_user_id = ?',
    )
    .get(contextId, chatUserId)
  return row === null || row === undefined ? null : row.encrypted_password
}

type SelfFixture = Readonly<{
  session: SettingsSession
  configuredGroupId: string
  unconfiguredGroupId: string
  deauthorizedGroupId: string
  otherPlatformGroupId: string
}>

async function seedSelfFixture(): Promise<SelfFixture> {
  mockLogger()
  await setupTestDb()
  seedTestPlatformInstance({ id: PLATFORM_INSTANCE_ID })
  seedTestPlatformInstance({ id: OTHER_PLATFORM_INSTANCE_ID })
  seedTestTaskInstance({ id: KANEO_TASK_INSTANCE_ID, config: { baseUrl: 'https://kaneo.example.com' } })
  addUser({ userId: USER_ID, platformInstanceId: PLATFORM_INSTANCE_ID, addedBy: 'admin', username: undefined })
  addUser({
    userId: OTHER_USER_ID,
    platformInstanceId: PLATFORM_INSTANCE_ID,
    addedBy: 'admin',
    username: undefined,
  })
  const session = await establishSession({ platformInstanceId: PLATFORM_INSTANCE_ID, platformUserId: USER_ID })

  const configuredGroupId = seedGroupContext(PLATFORM_INSTANCE_ID, 'grp-self-configured', 'Configured Group')
  const unconfiguredGroupId = seedGroupContext(PLATFORM_INSTANCE_ID, 'grp-self-null-task', 'No Task Group')
  const deauthorizedGroupId = seedGroupContext(PLATFORM_INSTANCE_ID, 'grp-self-revoked', 'Revoked Group')
  const otherPlatformGroupId = seedGroupContext(OTHER_PLATFORM_INSTANCE_ID, 'grp-self-other-pi', 'Other Platform Group')

  addAuthorizedGroup(configuredGroupId, USER_ID)
  addAuthorizedGroup(unconfiguredGroupId, USER_ID)
  addAuthorizedGroup(otherPlatformGroupId, USER_ID)

  setContextSettings({
    contextId: configuredGroupId,
    taskInstanceId: KANEO_TASK_INSTANCE_ID,
    platformInstanceId: PLATFORM_INSTANCE_ID,
  })
  setContextSettings({ contextId: unconfiguredGroupId, taskInstanceId: null, platformInstanceId: PLATFORM_INSTANCE_ID })

  insertMemberRow({
    contextId: configuredGroupId,
    chatUserId: USER_ID,
    login: 'caller-configured@pap.ai',
    encryptedPassword: encryptInstanceConfig({ password: 'OneShot1!Aa' }),
  })
  insertMemberRow({ contextId: unconfiguredGroupId, chatUserId: USER_ID, login: 'caller-null-task@pap.ai' })
  insertMemberRow({ contextId: deauthorizedGroupId, chatUserId: USER_ID, login: 'caller-revoked@pap.ai' })
  insertMemberRow({ contextId: otherPlatformGroupId, chatUserId: USER_ID, login: 'caller-other-pi@pap.ai' })
  insertMemberRow({ contextId: configuredGroupId, chatUserId: OTHER_USER_ID, login: 'other-member@pap.ai' })

  return { session, configuredGroupId, unconfiguredGroupId, deauthorizedGroupId, otherPlatformGroupId }
}

describe('GET /settings/api/kaneo/credentials/self', () => {
  let fixture: SelfFixture

  beforeEach(async () => {
    fixture = await seedSelfFixture()
  })

  test('lists only the caller’s rows for authorized groups on the caller’s platform instance', async () => {
    const res = await handleKaneoCredentialsSelfRoutes(request(SELF_PATH, fixture.session))
    expect(res.status).toBe(200)
    const body = SelfListResponseSchema.parse(await res.json())

    expect(body.memberships.map((m) => m.contextId).toSorted()).toEqual(
      [fixture.configuredGroupId, fixture.unconfiguredGroupId].toSorted(),
    )
    expect(body.memberships.find((m) => m.contextId === fixture.deauthorizedGroupId)).toBeUndefined()
    expect(body.memberships.find((m) => m.contextId === fixture.otherPlatformGroupId)).toBeUndefined()
    expect(body.memberships.map((m) => m.login)).not.toContain('other-member@pap.ai')
  })

  test('resolves the group label, workspace URL, and nulls the URL for an unconfigured task instance', async () => {
    const res = await handleKaneoCredentialsSelfRoutes(request(SELF_PATH, fixture.session))
    const body = SelfListResponseSchema.parse(await res.json())

    const configured = body.memberships.find((m) => m.contextId === fixture.configuredGroupId)
    expect(configured).toMatchObject({
      groupLabel: 'Configured Group',
      login: 'caller-configured@pap.ai',
      status: 'active',
      kaneoUrl: 'https://kaneo.example.com',
    })
    const unconfigured = body.memberships.find((m) => m.contextId === fixture.unconfiguredGroupId)
    expect(unconfigured?.kaneoUrl).toBeNull()
    expect(unconfigured?.groupLabel).toBe('No Task Group')
  })

  test('returns an empty list when the caller has no memberships', async () => {
    const session = await establishSession({
      platformInstanceId: PLATFORM_INSTANCE_ID,
      platformUserId: 'u-cred-nobody',
    })
    addUser({
      userId: 'u-cred-nobody',
      platformInstanceId: PLATFORM_INSTANCE_ID,
      addedBy: 'admin',
      username: undefined,
    })

    const res = await handleKaneoCredentialsSelfRoutes(request(SELF_PATH, session))
    expect(res.status).toBe(200)
    const body = SelfListResponseSchema.parse(await res.json())
    expect(body.memberships).toEqual([])
  })

  test('returns 401 when unauthenticated', async () => {
    const res = await handleKaneoCredentialsSelfRoutes(new Request(`https://x${SELF_PATH}`))
    expect(res.status).toBe(401)
  })

  test('returns 403 for an unauthorized principal', async () => {
    const session = await establishSession({
      platformInstanceId: PLATFORM_INSTANCE_ID,
      platformUserId: 'u-cred-unauthorized',
    })

    const res = await handleKaneoCredentialsSelfRoutes(request(SELF_PATH, session))
    expect(res.status).toBe(403)
  })
})

describe('POST /settings/api/kaneo/credentials/self', () => {
  let fixture: SelfFixture

  beforeEach(async () => {
    fixture = await seedSelfFixture()
  })

  test('reveals the caller’s own password once and clears the stored ciphertext', async () => {
    const res = await handleKaneoCredentialsSelfRoutes(
      request(SELF_PATH, fixture.session, {
        method: 'POST',
        csrf: true,
        body: { action: 'reveal', contextId: fixture.configuredGroupId },
      }),
    )
    expect(res.status).toBe(200)
    const body = RevealResponseSchema.parse(await res.json())
    expect(body.password).toBe('OneShot1!Aa')
    expect(body.warning).toContain('once')
    expect(rawEncryptedPassword(fixture.configuredGroupId, USER_ID)).toBeNull()
  })

  test('refuses a second reveal with 409', async () => {
    const reveal = (): Promise<Response> =>
      handleKaneoCredentialsSelfRoutes(
        request(SELF_PATH, fixture.session, {
          method: 'POST',
          csrf: true,
          body: { action: 'reveal', contextId: fixture.configuredGroupId },
        }),
      )

    expect((await reveal()).status).toBe(200)
    const second = await reveal()
    expect(second.status).toBe(409)
    const body = ErrorResponseSchema.parse(await second.json())
    expect(body.error).not.toContain('OneShot1!Aa')
  })

  test('rejects an authenticated reveal without CSRF and leaves the row unchanged', async () => {
    const res = await handleKaneoCredentialsSelfRoutes(
      request(SELF_PATH, fixture.session, {
        method: 'POST',
        csrf: false,
        body: { action: 'reveal', contextId: fixture.configuredGroupId },
      }),
    )
    expect(res.status).toBe(403)
    expect(rawEncryptedPassword(fixture.configuredGroupId, USER_ID)).not.toBeNull()
  })

  test('denies another member’s row with a non-disclosing 404', async () => {
    const onlyOtherOwns = seedGroupContext(PLATFORM_INSTANCE_ID, 'grp-self-other-row', 'Other Row Group')
    addAuthorizedGroup(onlyOtherOwns, OTHER_USER_ID)
    insertMemberRow({
      contextId: onlyOtherOwns,
      chatUserId: OTHER_USER_ID,
      login: 'other-only@pap.ai',
      encryptedPassword: encryptInstanceConfig({ password: 'NotYours1!' }),
    })

    const res = await handleKaneoCredentialsSelfRoutes(
      request(SELF_PATH, fixture.session, {
        method: 'POST',
        csrf: true,
        body: { action: 'reveal', contextId: onlyOtherOwns },
      }),
    )
    expect(res.status).toBe(404)
    expect(rawEncryptedPassword(onlyOtherOwns, OTHER_USER_ID)).not.toBeNull()
  })

  test('returns a generic 500 when the stored ciphertext cannot be decrypted', async () => {
    const brokenGroupId = seedGroupContext(PLATFORM_INSTANCE_ID, 'grp-self-broken', 'Broken Group')
    addAuthorizedGroup(brokenGroupId, USER_ID)
    insertMemberRow({
      contextId: brokenGroupId,
      chatUserId: USER_ID,
      login: 'broken@pap.ai',
      encryptedPassword: 'not-a-valid-ciphertext',
    })

    const res = await handleKaneoCredentialsSelfRoutes(
      request(SELF_PATH, fixture.session, {
        method: 'POST',
        csrf: true,
        body: { action: 'reveal', contextId: brokenGroupId },
      }),
    )
    expect(res.status).toBe(500)
    const body = ErrorResponseSchema.parse(await res.json())
    expect(body.error).not.toContain('not-a-valid-ciphertext')
    expect(rawEncryptedPassword(brokenGroupId, USER_ID)).toBe('not-a-valid-ciphertext')
  })

  test('returns 405 for unsupported methods', async () => {
    const res = await handleKaneoCredentialsSelfRoutes(request(SELF_PATH, fixture.session, { method: 'DELETE' }))
    expect(res.status).toBe(405)
  })
})

describe('routeSettingsApi dispatch for Kaneo credentials', () => {
  let fixture: SelfFixture

  beforeEach(async () => {
    fixture = await seedSelfFixture()
  })

  test('dispatches the self path to the member-scoped handler', async () => {
    const res = await routeSettingsApi(request(SELF_PATH, fixture.session), new URL(`https://x${SELF_PATH}`))
    expect(res).not.toBeNull()
    expect(res?.status).toBe(200)
    expect(SelfListResponseSchema.parse(await res?.json()).memberships).toHaveLength(2)
  })

  test('keeps the group path on the group-manager handler', async () => {
    const res = await routeSettingsApi(
      request('/settings/api/kaneo/credentials', fixture.session),
      new URL('https://x/settings/api/kaneo/credentials'),
    )
    expect(res?.status).toBe(404)
    const body = ErrorResponseSchema.parse(await res?.json())
    expect(body.error).toContain('in this group')
  })
})
