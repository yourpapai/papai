// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import packageJson from '../../../../package.json' with { type: 'json' }
import {
  getAnnouncementDraft,
  updateHumanizedBodies,
  upsertAnnouncementDraft,
} from '../../../../src/announcements/store.js'
import { handleAdminReleaseNotesRoutes } from '../../../../src/debug/settings/admin/release-notes-routes.js'
import { addAdmin } from '../../../../src/instances/admin-store.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from '../helpers.js'

const PATH = '/settings/api/admin/release-notes'
const VERSION = packageJson.version

const post = (session: SettingsSession, payload: unknown): Promise<Response> => {
  const url = new URL(`https://x${PATH}`)
  return handleAdminReleaseNotesRoutes(
    new Request(url, {
      method: 'POST',
      headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    url,
    PATH,
  )
}

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

  test('GET returns version + per-locale bodies + counts for an admin', async () => {
    updateHumanizedBodies(VERSION, { en: 'EN body', ru: 'RU body' })
    const url = new URL(`https://x${PATH}`)
    const res = await handleAdminReleaseNotesRoutes(new Request(url, { headers: authHeaders(adminSession) }), url, PATH)
    expect(res.status).toBe(200)
    const json = z
      .object({
        version: z.string(),
        bodies: z.object({ en: z.string().nullable(), ru: z.string().nullable() }),
        counts: z.object({ dm: z.number(), group: z.number() }),
      })
      .parse(await res.json())
    expect(json.version).toBe(VERSION)
    expect(json.bodies).toEqual({ en: 'EN body', ru: 'RU body' })
    expect(json.counts).toEqual({ dm: 0, group: 0 })
  })

  test('GET returns bodies plus rawBody when no humanized body exists', async () => {
    upsertAnnouncementDraft({ version: VERSION, rawBody: 'raw section', humanizedBody: null })
    const url = new URL(`https://x${PATH}`)
    const res = await handleAdminReleaseNotesRoutes(new Request(url, { headers: authHeaders(adminSession) }), url, PATH)
    expect(res.status).toBe(200)
    const json = z
      .object({ bodies: z.object({ en: z.string().nullable(), ru: z.string().nullable() }), rawBody: z.string() })
      .parse(await res.json())
    expect(json.bodies).toEqual({ en: null, ru: null })
    expect(json.rawBody).toBe('raw section')
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

  test('POST save updates only the requested locale', async () => {
    updateHumanizedBodies(VERSION, { en: 'orig en', ru: 'orig ru' })
    const res = await post(adminSession, { action: 'save', locale: 'ru', body: 'edited ru' })
    expect(res.status).toBe(200)
    const saved = z
      .object({ bodies: z.object({ en: z.string().nullable(), ru: z.string().nullable() }) })
      .parse(await res.json())
    expect(saved.bodies).toEqual({ en: 'orig en', ru: 'edited ru' })
    expect(getAnnouncementDraft(VERSION)?.humanizedBodies).toEqual({ en: 'orig en', ru: 'edited ru' })
  })

  test('POST save without locale defaults to en', async () => {
    const res = await post(adminSession, { action: 'save', body: 'edited en' })
    expect(res.status).toBe(200)
    expect(getAnnouncementDraft(VERSION)?.humanizedBodies).toEqual({ en: 'edited en' })
  })

  test('POST save with unsupported locale → 422 invalid request', async () => {
    const res = await post(adminSession, { action: 'save', locale: 'fr', body: 'x' })
    expect(res.status).toBe(422)
    const json = z.object({ error: z.string() }).parse(await res.json())
    expect(json.error).toBe('invalid request')
    expect(getAnnouncementDraft(VERSION)).toBeNull()
  })

  test('POST regenerate with unsupported locale → 422 invalid request', async () => {
    const res = await post(adminSession, { action: 'regenerate', locale: 'fr' })
    expect(res.status).toBe(422)
    const json = z.object({ error: z.string() }).parse(await res.json())
    expect(json.error).toBe('invalid request')
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

  test('POST save without pre-seeded row → 200 with bodies (proves upsert)', async () => {
    // no upsertAnnouncementDraft call — row absent
    const res = await post(adminSession, { action: 'save', locale: 'en', body: 'edited body' })
    expect(res.status).toBe(200)
    const saved = z.object({ bodies: z.object({ en: z.string().nullable() }) }).parse(await res.json())
    expect(saved.bodies.en).toBe('edited body')
  })

  test('POST regenerate with no LLM creds → 422', async () => {
    // fresh DB: no system_config LLM creds; humanizeChangelog returns {} or changelog missing
    const res = await post(adminSession, { action: 'regenerate', locale: 'ru' })
    expect(res.status).toBe(422)
  })

  test('POST regenerate failure leaves the other locale untouched', async () => {
    updateHumanizedBodies(VERSION, { en: 'kept en' })
    const res = await post(adminSession, { action: 'regenerate', locale: 'ru' })
    expect(res.status).toBe(422)
    expect(getAnnouncementDraft(VERSION)?.humanizedBodies).toEqual({ en: 'kept en' })
  })

  test('POST broadcast with body but no running router → 422', async () => {
    updateHumanizedBodies(VERSION, { en: 'h', ru: 'ru h' })
    const res = await post(adminSession, { action: 'broadcast' })
    expect(res.status).toBe(422)
    const json = z.object({ error: z.string() }).parse(await res.json())
    expect(json.error).toBe('chat router not running')
  })

  test('POST broadcast with only a raw draft body and no router → 422 chat router error', async () => {
    // map + raw are both resolved from the draft; raw alone is still broadcastable
    upsertAnnouncementDraft({ version: VERSION, rawBody: 'r', humanizedBody: null })
    const res = await post(adminSession, { action: 'broadcast' })
    expect(res.status).toBe(422)
    const json = z.object({ error: z.string() }).parse(await res.json())
    expect(json.error).toBe('chat router not running')
  })
})
