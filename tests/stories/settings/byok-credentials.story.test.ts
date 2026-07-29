// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { z } from 'zod'

import { byokLlmCredentials } from '../../../src/db/byok-llm-schema.js'
import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { resolveLlmConfig } from '../../../src/llm-providers/resolver.js'
import { scenario } from '../harness/scenario.js'

const ByokStateSchema = z.object({
  enabled: z.boolean(),
  complete: z.boolean(),
  missing: z.array(z.string()),
  unreadable: z.literal(true).optional(),
  fields: z.array(z.object({ key: z.string(), hasValue: z.boolean(), value: z.string() })),
  providers: z.array(z.unknown()),
  roles: z.object({
    main: z.object({ providerId: z.string(), model: z.string() }),
    small: z.null(),
    embedding: z.null(),
  }),
})

type ByokField = z.infer<typeof ByokStateSchema>['fields'][number]

const field = (state: z.infer<typeof ByokStateSchema>, key: string): ByokField => {
  const value = state.fields.find((candidate) => candidate.key === key)
  expect(value).toBeDefined()
  if (value === undefined) throw new Error(`Missing BYOK field: ${key}`)
  return value
}

scenario(
  'SCN-byok-context-credentials: context credentials merge and clear without disclosure',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const bob = given.user('bob')
    const aliceDm = given.dm(alice)
    given.dm(bob)
    const aliceSession = await given.settingsSession(alice)
    const bobSession = await when.settingsSession(bob)
    const opaqueCredential = ['opaque', 'non-production', 'credential'].join('-')

    const bobInitial = await when.settingsRequest(bobSession, '/settings/api/byok')
    then.responseStatus(bobInitial, 200)
    const bobInitialState = ByokStateSchema.parse(await bobInitial.json())
    expect(bobInitialState).toMatchObject({ enabled: false, complete: false, missing: [], fields: [] })

    const enabled = await when.settingsRequest(aliceSession, '/settings/api/byok', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'enable' }),
    })
    then.responseStatus(enabled, 200)

    const saved = await when.settingsRequest(aliceSession, '/settings/api/byok', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        values: {
          llm_apikey: opaqueCredential,
          llm_baseurl: 'https://opaque.example.invalid/v1',
          main_model: 'first-main-model',
          small_model: 'first-small-model',
        },
      }),
    })
    then.responseStatus(saved, 200)
    expect(await saved.clone().text()).not.toContain(opaqueCredential)
    const changed = await when.settingsRequest(aliceSession, '/settings/api/byok', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: { main_model: 'second-main-model', small_model: '' } }),
    })
    then.responseStatus(changed, 200)
    expect(await changed.clone().text()).not.toContain(opaqueCredential)

    const aliceReadback = await when.settingsRequest(aliceSession, '/settings/api/byok')
    then.responseStatus(aliceReadback, 200)
    expect(await aliceReadback.clone().text()).not.toContain(opaqueCredential)
    const aliceState = ByokStateSchema.parse(await aliceReadback.json())
    expect(aliceState).toMatchObject({ enabled: true, complete: true })
    expect(field(aliceState, 'main_model')).toMatchObject({ hasValue: true, value: 'second-main-model' })
    expect(field(aliceState, 'small_model')).toMatchObject({ hasValue: false })

    const bobReadback = await when.settingsRequest(bobSession, '/settings/api/byok')
    then.responseStatus(bobReadback, 200)
    expect(ByokStateSchema.parse(await bobReadback.json())).toMatchObject({
      enabled: false,
      complete: false,
      missing: [],
      fields: [],
    })
    expect(JSON.stringify(world.events.all())).not.toContain(opaqueCredential)
    expect(world.scopedStorageContextId(aliceDm)).not.toBe(world.scopedStorageContextId(given.dm(bob)))
  },
)

scenario(
  'SCN-byok-unreadable-credentials: unreadable credentials fail closed without disclosure',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const unreadable = given.user('unreadable')
    given.dm(alice)
    const unreadableDm = given.dm(unreadable)
    const aliceSession = await given.settingsSession(alice)
    const unreadableSession = await when.settingsSession(unreadable)
    const opaqueCredential = ['opaque', 'readable', 'credential'].join('-')
    const unreadableMarker = ['opaque', 'unreadable', 'marker'].join('-')

    const enabled = await when.settingsRequest(aliceSession, '/settings/api/byok', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'enable' }),
    })
    then.responseStatus(enabled, 200)
    const saved = await when.settingsRequest(aliceSession, '/settings/api/byok', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        values: {
          llm_apikey: opaqueCredential,
          llm_baseurl: 'https://opaque.example.invalid/v1',
          main_model: 'readable-main-model',
        },
      }),
    })
    then.responseStatus(saved, 200)
    expect(await saved.clone().text()).not.toContain(opaqueCredential)

    const unreadableContextId = world.scopedStorageContextId(unreadableDm)
    getDrizzleDb()
      .insert(byokLlmCredentials)
      .values({
        contextId: unreadableContextId,
        enabled: true,
        encryptedConfig: unreadableMarker,
        updatedAt: 1,
        updatedBy: 'scenario-writer',
      })
      .run()

    const unreadableReadback = await when.settingsRequest(unreadableSession, '/settings/api/byok')
    then.responseStatus(unreadableReadback, 200)
    expect(await unreadableReadback.clone().text()).not.toContain(unreadableMarker)
    const unreadableState = ByokStateSchema.parse(await unreadableReadback.json())
    expect(unreadableState).toMatchObject({
      enabled: true,
      complete: false,
      unreadable: true,
      missing: ['llm_apikey', 'llm_baseurl', 'main_model'],
      fields: [],
      providers: [],
      roles: { main: { providerId: '', model: '' }, small: null, embedding: null },
    })
    expect(resolveLlmConfig(unreadableContextId)).toEqual({
      ok: false,
      type: 'error',
      source: 'byok',
      error: 'stored BYOK LLM credentials are unreadable',
    })
    expect(JSON.stringify(world.events.all())).not.toContain(opaqueCredential)
    expect(JSON.stringify(world.events.all())).not.toContain(unreadableMarker)

    const aliceReadback = await when.settingsRequest(aliceSession, '/settings/api/byok')
    then.responseStatus(aliceReadback, 200)
    expect(ByokStateSchema.parse(await aliceReadback.json())).toMatchObject({ enabled: true, complete: true })
  },
)
