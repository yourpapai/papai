// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { getConfigFieldsForContext } from '../../../src/config-keys.js'
import { handleConfigRoutes } from '../../../src/debug/settings/config-routes.js'
import { resolveSettingsPrincipal } from '../../../src/settings/principal.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

const GetResponseSchema = z.object({
  fields: z.array(z.object({ key: z.string(), storageKey: z.string() })),
})

describe('config parity gate', () => {
  let session: SettingsSession

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
    session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
  })

  test('every config field is present in the settings API GET response', async () => {
    const { personalConfigContextId } = resolveSettingsPrincipal('pi-1', 'u-1')
    const res = await handleConfigRoutes(
      new Request('https://x/settings/api/config', { headers: authHeaders(session) }),
      new URL('https://x/settings/api/config'),
    )
    expect(res.status).toBe(200)
    const body = GetResponseSchema.parse(await res.json())
    const exposedKeys = new Set(body.fields.map((f) => f.storageKey))
    for (const field of getConfigFieldsForContext(personalConfigContextId)) {
      expect(exposedKeys.has(field.storageKey)).toBe(true)
    }
  })

  test('an unauthenticated request is rejected (authorization parity)', async () => {
    const res = await handleConfigRoutes(
      new Request('https://x/settings/api/config'),
      new URL('https://x/settings/api/config'),
    )
    expect(res.status).toBe(401)
  })
})
