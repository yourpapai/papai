// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import packageJson from '../../../../package.json' with { type: 'json' }
import { upsertAnnouncementDraft } from '../../../../src/announcements/store.js'
import { handleAdminReleaseNotesRoutes } from '../../../../src/debug/settings/admin/release-notes-routes.js'
import { addAdmin } from '../../../../src/instances/admin-store.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from '../helpers.js'

const PATH = '/settings/api/admin/release-notes'
const VERSION = packageJson.version

describe('admin release-notes route', () => {
  let adminSession: SettingsSession
  let userSession: SettingsSession

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addAdmin('admin-1', 'pi-1')
    adminSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'admin-1' })
    userSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'user-1' })
  })

  test('GET returns version + body + counts for an admin', async () => {
    const url = new URL(`https://x${PATH}`)
    const res = await handleAdminReleaseNotesRoutes(new Request(url, { headers: authHeaders(adminSession) }), url, PATH)
    expect(res.status).toBe(200)
    const json = z
      .object({ version: z.string(), counts: z.object({ dm: z.number(), group: z.number() }) })
      .parse(await res.json())
    expect(json.version).toBe(VERSION)
    expect(json.counts).toEqual({ dm: 0, group: 0 })
  })

  test('non-admin is forbidden', async () => {
    const url = new URL(`https://x${PATH}`)
    const res = await handleAdminReleaseNotesRoutes(new Request(url, { headers: authHeaders(userSession) }), url, PATH)
    expect(res.status).toBe(403)
  })

  test('PUT is 405', async () => {
    const url = new URL(`https://x${PATH}`)
    const res = await handleAdminReleaseNotesRoutes(
      new Request(url, { method: 'PUT', headers: authHeaders(adminSession, true) }),
      url,
      PATH,
    )
    expect(res.status).toBe(405)
  })

  test('POST with unknown action is 422', async () => {
    const url = new URL(`https://x${PATH}`)
    const res = await handleAdminReleaseNotesRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'nope' }),
      }),
      url,
      PATH,
    )
    expect(res.status).toBe(422)
  })

  test('POST save updates the humanized body', async () => {
    upsertAnnouncementDraft({ version: VERSION, rawBody: 'raw', humanizedBody: 'orig' })
    const url = new URL(`https://x${PATH}`)
    const res = await handleAdminReleaseNotesRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', body: 'edited body' }),
      }),
      url,
      PATH,
    )
    expect(res.status).toBe(200)
    const saved = z.object({ body: z.string() }).parse(await res.json())
    expect(saved.body).toBe('edited body')
  })

  test('POST save without CSRF → 403', async () => {
    upsertAnnouncementDraft({ version: VERSION, rawBody: 'raw', humanizedBody: 'orig' })
    const url = new URL(`https://x${PATH}`)
    const res = await handleAdminReleaseNotesRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession), 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', body: 'x' }),
      }),
      url,
      PATH,
    )
    expect(res.status).toBe(403)
  })

  test('POST broadcast with no draft body → 422', async () => {
    // no draft seeded for VERSION
    const url = new URL(`https://x${PATH}`)
    const res = await handleAdminReleaseNotesRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'broadcast' }),
      }),
      url,
      PATH,
    )
    expect(res.status).toBe(422)
  })
})
