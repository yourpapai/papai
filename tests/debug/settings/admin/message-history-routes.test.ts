// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'
import { z } from 'zod'

import * as schema from '../../../../src/db/schema.js'
import { handleAdminMessageHistoryRoutes } from '../../../../src/debug/settings/admin/message-history-routes.js'
import { addAdmin, SUPER_ADMIN_PLATFORM_ID } from '../../../../src/instances/admin-store.js'
import { addUser } from '../../../../src/users.js'
import { getTestDb, mockLogger, seedTestPlatformInstance, setupTestDb } from '../../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from '../helpers.js'

const PurgeScopeResponseSchema = z.object({ scopeId: z.string(), purged: z.number() })
const PurgeAllResponseSchema = z.object({ purged: z.number() })

function seedRow(contextId: string, messageId: string, groupContextId: string): void {
  getTestDb()
    .insert(schema.messageMetadata)
    .values({ contextId, messageId, text: 'x', timestamp: 1, groupContextId })
    .run()
}

function rowsForScope(scopeId: string): unknown[] {
  return getTestDb()
    .select()
    .from(schema.messageMetadata)
    .where(eq(schema.messageMetadata.groupContextId, scopeId))
    .all()
}

function deleteHistory(path: string, session: SettingsSession): Promise<Response> {
  const url = new URL(`https://x${path}`)
  return handleAdminMessageHistoryRoutes(
    new Request(url, { method: 'DELETE', headers: authHeaders(session, true) }),
    url,
    path,
  )
}

describe('admin message-history purge routes', () => {
  let superSession: SettingsSession
  let botAdminSession: SettingsSession

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'sa-1', platformInstanceId: 'pi-1', addedBy: 'boot', username: undefined })
    addUser({ userId: 'ba-1', platformInstanceId: 'pi-1', addedBy: 'sa-1', username: undefined })
    addAdmin('sa-1', SUPER_ADMIN_PLATFORM_ID)
    addAdmin('ba-1', 'pi-1')
    superSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'sa-1' })
    botAdminSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'ba-1' })
  })

  test('DELETE clears one scope and preserves other scopes', async () => {
    seedRow('g', 'm1', 'g')
    seedRow('g-t1', 'm2', 'g')
    seedRow('other', 'm3', 'other')

    const res = await deleteHistory('/settings/api/admin/contexts/g/message-history', superSession)

    expect(res.status).toBe(200)
    const body = PurgeScopeResponseSchema.parse(await res.json())
    expect(body).toEqual({ scopeId: 'g', purged: 2 })
    expect(rowsForScope('g')).toHaveLength(0)
    expect(rowsForScope('other')).toHaveLength(1)
  })

  test('DELETE clear-all removes every message_metadata row', async () => {
    seedRow('g', 'm1', 'g')
    seedRow('other', 'm2', 'other')

    const res = await deleteHistory('/settings/api/admin/message-history', superSession)

    expect(res.status).toBe(200)
    const body = PurgeAllResponseSchema.parse(await res.json())
    expect(body.purged).toBe(2)
    expect(getTestDb().select().from(schema.messageMetadata).all()).toHaveLength(0)
  })

  test('bot-admin (non-super-admin) is forbidden on both endpoints', async () => {
    seedRow('g', 'm1', 'g')

    const scopeRes = await deleteHistory('/settings/api/admin/contexts/g/message-history', botAdminSession)
    const allRes = await deleteHistory('/settings/api/admin/message-history', botAdminSession)

    expect(scopeRes.status).toBe(403)
    expect(allRes.status).toBe(403)
    expect(rowsForScope('g')).toHaveLength(1)
  })

  test('non-DELETE returns 405', async () => {
    const url = new URL('https://x/settings/api/admin/message-history')
    const res = await handleAdminMessageHistoryRoutes(
      new Request(url, { method: 'GET', headers: authHeaders(superSession) }),
      url,
      '/settings/api/admin/message-history',
    )
    expect(res.status).toBe(405)
  })
})
