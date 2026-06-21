// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq, and } from 'drizzle-orm'

import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { kaneoWorkspaceMembers } from '../../../src/db/schema.js'
import type { AppError } from '../../../src/errors.js'
import { getIdentityMapping } from '../../../src/identity/mapping.js'
import { ensureWorkspaceMember, type MembershipDeps } from '../../../src/providers/membership/ensure-member.js'
import type { TaskProvider } from '../../../src/providers/types.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

const GROUP_CTX = 'grp-ctx-1'
const CHAT_USER = 'chat-user-1'
const KANEO_USER_ID = 'kaneo-uid-1'

function makeFakeProvider(overrides: Partial<TaskProvider> = {}): TaskProvider {
  return {
    name: 'kaneo',
    capabilities: new Set(['members.provision']),
    traits: new Set(),
    preferredUserIdentifier: 'id',
    createTask: () => Promise.reject(new Error('not impl')),
    getTask: () => Promise.reject(new Error('not impl')),
    updateTask: () => Promise.reject(new Error('not impl')),
    listTasks: () => Promise.resolve([]),
    searchTasks: () => Promise.resolve([]),
    buildTaskUrl: () => '',
    buildProjectUrl: () => '',
    classifyError: (e): AppError => ({
      type: 'system',
      code: 'unexpected',
      originalError: e instanceof Error ? e : new Error(String(e)),
    }),
    getPromptAddendum: () => '',
    normalizeDueDateInput: () => undefined,
    formatDueDateOutput: () => undefined,
    normalizeListTaskParams: (p) => p,
    provisionWorkspaceMember: () =>
      Promise.resolve({ providerUserId: KANEO_USER_ID, login: 'u@pap.ai', password: 'gen-pass' }),
    ...overrides,
  }
}

function makeDeps(overrides: Partial<MembershipDeps> = {}): MembershipDeps {
  return {
    resolveProvider: () => Promise.resolve(makeFakeProvider()),
    getContextSettings: () => ({ taskInstanceId: 'ti-1', platformInstanceId: 'pi-1' }),
    resolveUserLabel: () => Promise.resolve('Alice'),
    ...overrides,
  }
}

describe('ensureWorkspaceMember', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns "created" on first call, writes the member row, and persists encrypted password', async () => {
    const result = await ensureWorkspaceMember(GROUP_CTX, CHAT_USER, makeDeps())
    expect(result).toBe('created')
    const db = getDrizzleDb()
    const row = db
      .select()
      .from(kaneoWorkspaceMembers)
      .where(and(eq(kaneoWorkspaceMembers.groupContextId, GROUP_CTX), eq(kaneoWorkspaceMembers.chatUserId, CHAT_USER)))
      .get()
    expect(row?.providerUserId).toBe(KANEO_USER_ID)
    expect(row?.status).toBe('active')
    // encrypted_password must be non-null after provision (the sole credential mechanism)
    expect(row?.encryptedPassword).not.toBeNull()
  })

  test('returns "exists" when row already present', async () => {
    await ensureWorkspaceMember(GROUP_CTX, CHAT_USER, makeDeps())
    const result = await ensureWorkspaceMember(GROUP_CTX, CHAT_USER, makeDeps())
    expect(result).toBe('exists')
  })

  test('writes a "provisioned" identity mapping on success', async () => {
    await ensureWorkspaceMember(GROUP_CTX, CHAT_USER, makeDeps())
    const mapping = getIdentityMapping(CHAT_USER, 'kaneo')
    expect(mapping?.matchMethod).toBe('provisioned')
    expect(mapping?.providerUserId).toBe(KANEO_USER_ID)
  })

  test('returns "skipped" when provider lacks members.provision capability', async () => {
    const result = await ensureWorkspaceMember(
      GROUP_CTX,
      CHAT_USER,
      makeDeps({ resolveProvider: () => Promise.resolve(makeFakeProvider({ capabilities: new Set() })) }),
    )
    expect(result).toBe('skipped')
  })

  test('returns "skipped" when no provider resolved', async () => {
    const result = await ensureWorkspaceMember(
      GROUP_CTX,
      CHAT_USER,
      makeDeps({ resolveProvider: () => Promise.resolve(null) }),
    )
    expect(result).toBe('skipped')
  })

  test('returns "skipped" when no context settings', async () => {
    const result = await ensureWorkspaceMember(GROUP_CTX, CHAT_USER, makeDeps({ getContextSettings: () => null }))
    expect(result).toBe('skipped')
  })

  test('returns "failed" when provisioning throws, records failed row', async () => {
    const result = await ensureWorkspaceMember(
      GROUP_CTX,
      CHAT_USER,
      makeDeps({
        resolveProvider: () =>
          Promise.resolve(
            makeFakeProvider({
              provisionWorkspaceMember: () => Promise.reject(new Error('Kaneo down')),
            }),
          ),
      }),
    )
    expect(result).toBe('failed')
    const db = getDrizzleDb()
    const row = db
      .select()
      .from(kaneoWorkspaceMembers)
      .where(and(eq(kaneoWorkspaceMembers.groupContextId, GROUP_CTX), eq(kaneoWorkspaceMembers.chatUserId, CHAT_USER)))
      .get()
    expect(row?.status).toBe('failed')
  })

  test('uses resolveUserLabel fallback chain: null → "User <chatUserId>"', async () => {
    let usedLabel = ''
    const result = await ensureWorkspaceMember(
      GROUP_CTX,
      CHAT_USER,
      makeDeps({
        resolveUserLabel: () => Promise.resolve(null),
        resolveProvider: () =>
          Promise.resolve(
            makeFakeProvider({
              provisionWorkspaceMember: (member) => {
                usedLabel = member.displayName
                return Promise.resolve({ providerUserId: KANEO_USER_ID, login: 'u@pap.ai', password: 'gen-pass' })
              },
            }),
          ),
      }),
    )
    expect(result).toBe('created')
    expect(usedLabel).toBe(`User ${CHAT_USER}`)
  })

  test('reuse path: fetches stored encrypted password and passes all three existing opts', async () => {
    // Pre-insert a member row in a DIFFERENT group with an encrypted password
    // (simulate: user was provisioned in another group, `encrypted_password` was stored)
    const db = getDrizzleDb()
    // For the test, we insert a plaintext sentinel and use a deps override for decryption:
    db.insert(kaneoWorkspaceMembers)
      .values({
        groupContextId: 'other-group',
        chatUserId: CHAT_USER,
        providerName: 'kaneo',
        providerUserId: 'pre-uid',
        login: 'pre@pap.ai',
        status: 'active',
        encryptedPassword: 'ENCRYPTED:StoredPass1!Aa',
        createdAt: new Date().toISOString(),
      })
      .run()

    const receivedOpts: Array<{ existingProviderUserId?: string; existingLogin?: string; existingPassword?: string }> =
      []
    await ensureWorkspaceMember(
      GROUP_CTX,
      CHAT_USER,
      makeDeps({
        resolveProvider: () =>
          Promise.resolve(
            makeFakeProvider({
              provisionWorkspaceMember: (_member, opts) => {
                receivedOpts.push({
                  existingProviderUserId: opts?.existingProviderUserId,
                  existingLogin: opts?.existingLogin,
                  existingPassword: opts?.existingPassword,
                })
                return Promise.resolve({ providerUserId: 'pre-uid', login: 'pre@pap.ai', password: 'StoredPass1!Aa' })
              },
            }),
          ),
        // Override decrypt to decode the test sentinel
        decryptPassword: (encrypted) => encrypted.replace('ENCRYPTED:', ''),
      }),
    )

    expect(receivedOpts[0]?.existingProviderUserId).toBe('pre-uid')
    expect(receivedOpts[0]?.existingLogin).toBe('pre@pap.ai')
    expect(receivedOpts[0]?.existingPassword).toBe('StoredPass1!Aa')
  })

  test('falls back to new-member path when stored row has no encrypted_password', async () => {
    // Pre-insert a member row with no password (pre-credential row from an older provisioning)
    const db = getDrizzleDb()
    db.insert(kaneoWorkspaceMembers)
      .values({
        groupContextId: 'other-group',
        chatUserId: CHAT_USER,
        providerName: 'kaneo',
        providerUserId: 'old-uid',
        login: 'old@pap.ai',
        status: 'active',
        encryptedPassword: null,
        createdAt: new Date().toISOString(),
      })
      .run()

    const receivedOpts: Array<{ existingProviderUserId?: string }> = []
    await ensureWorkspaceMember(
      GROUP_CTX,
      CHAT_USER,
      makeDeps({
        resolveProvider: () =>
          Promise.resolve(
            makeFakeProvider({
              provisionWorkspaceMember: (_member, opts) => {
                receivedOpts.push({ existingProviderUserId: opts?.existingProviderUserId })
                return Promise.resolve({ providerUserId: KANEO_USER_ID, login: 'u@pap.ai', password: 'new-gen-pass' })
              },
            }),
          ),
      }),
    )

    // No existingProviderUserId because the stored row had no password
    expect(receivedOpts[0]?.existingProviderUserId).toBeUndefined()
  })

  test('does NOT pass existingProviderUserId when no prior member row exists at all', async () => {
    const receivedOpts: Array<{ existingProviderUserId?: string }> = []

    await ensureWorkspaceMember(
      'grp-ctx-new',
      'chat-user-new',
      makeDeps({
        resolveProvider: () =>
          Promise.resolve(
            makeFakeProvider({
              provisionWorkspaceMember: (_member, opts) => {
                receivedOpts.push({ existingProviderUserId: opts?.existingProviderUserId })
                return Promise.resolve({ providerUserId: KANEO_USER_ID, login: 'u@pap.ai', password: 'gen-pass' })
              },
            }),
          ),
      }),
    )

    expect(receivedOpts[0]?.existingProviderUserId).toBeUndefined()
  })

  // Carry-forward fix B: failed/inactive rows must not block retry
  test('a "failed" row is retried and becomes "active" on success', async () => {
    const db = getDrizzleDb()
    // Pre-insert a failed row
    db.insert(kaneoWorkspaceMembers)
      .values({
        groupContextId: GROUP_CTX,
        chatUserId: CHAT_USER,
        providerName: 'kaneo',
        providerUserId: '',
        login: '',
        status: 'failed',
        encryptedPassword: null,
        createdAt: new Date().toISOString(),
      })
      .run()

    const result = await ensureWorkspaceMember(GROUP_CTX, CHAT_USER, makeDeps())
    expect(result).toBe('created')
    const row = db
      .select()
      .from(kaneoWorkspaceMembers)
      .where(and(eq(kaneoWorkspaceMembers.groupContextId, GROUP_CTX), eq(kaneoWorkspaceMembers.chatUserId, CHAT_USER)))
      .get()
    expect(row?.status).toBe('active')
    expect(row?.providerUserId).toBe(KANEO_USER_ID)
  })

  test('an "inactive" row is retried and becomes "active" on success', async () => {
    const db = getDrizzleDb()
    // Pre-insert an inactive row
    db.insert(kaneoWorkspaceMembers)
      .values({
        groupContextId: GROUP_CTX,
        chatUserId: CHAT_USER,
        providerName: 'kaneo',
        providerUserId: 'old-uid',
        login: 'old@pap.ai',
        status: 'inactive',
        encryptedPassword: null,
        createdAt: new Date().toISOString(),
      })
      .run()

    const result = await ensureWorkspaceMember(GROUP_CTX, CHAT_USER, makeDeps())
    expect(result).toBe('created')
    const row = db
      .select()
      .from(kaneoWorkspaceMembers)
      .where(and(eq(kaneoWorkspaceMembers.groupContextId, GROUP_CTX), eq(kaneoWorkspaceMembers.chatUserId, CHAT_USER)))
      .get()
    expect(row?.status).toBe('active')
    expect(row?.providerUserId).toBe(KANEO_USER_ID)
  })

  test('an "active" row still short-circuits to "exists"', async () => {
    const db = getDrizzleDb()
    db.insert(kaneoWorkspaceMembers)
      .values({
        groupContextId: GROUP_CTX,
        chatUserId: CHAT_USER,
        providerName: 'kaneo',
        providerUserId: 'active-uid',
        login: 'active@pap.ai',
        status: 'active',
        encryptedPassword: null,
        createdAt: new Date().toISOString(),
      })
      .run()

    const result = await ensureWorkspaceMember(GROUP_CTX, CHAT_USER, makeDeps())
    expect(result).toBe('exists')
  })

  test('ensureWorkspaceMember is exported from src/providers/membership/index.ts', async () => {
    const mod = await import('../../../src/providers/membership/index.js')
    expect(typeof mod.ensureWorkspaceMember).toBe('function')
  })
})
