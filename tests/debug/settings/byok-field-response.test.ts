// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { z } from 'zod'

import { enableByokForContext, setByokRoles, upsertByokProvider } from '../../../src/byok-llm/store.js'
import { byokLlmCredentials } from '../../../src/db/byok-llm-schema.js'
import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { buildByokFieldResponse } from '../../../src/debug/settings/byok-field-response.js'
import type { LlmProviderAccount, Verification } from '../../../src/llm-providers/types.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

const ProviderPublicSchema = z.object({
  id: z.string(),
  label: z.string(),
  providerType: z.string(),
  baseUrl: z.string(),
  apiKeyMasked: z.string(),
})

const RolesSchema = z.object({
  main: z.object({ providerId: z.string(), model: z.string() }),
  small: z.object({ providerId: z.string(), model: z.string() }).nullable(),
  embedding: z.object({ providerId: z.string(), model: z.string() }).nullable(),
})

const FieldResponseSchema = z.object({
  enabled: z.boolean(),
  complete: z.boolean(),
  missing: z.array(z.string()),
  fields: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      required: z.boolean(),
      sensitive: z.boolean(),
      hasValue: z.boolean(),
      value: z.string(),
    }),
  ),
  providers: z.array(ProviderPublicSchema),
  roles: RolesSchema,
})

const emptyRoles = { main: { providerId: '', model: '' }, small: null, embedding: null }

const unverified = (): Verification => ({
  status: 'unverified',
  error: null,
  at: null,
  models: [],
  modelsFetchedAt: null,
})

const makeProvider = (overrides: Partial<LlmProviderAccount> = {}): LlmProviderAccount => ({
  id: 'prov-1',
  label: 'Test Provider',
  providerType: 'ollama',
  baseUrl: 'http://localhost:11434/v1',
  apiKey: 'sk-test-key',
  verification: unverified(),
  ...overrides,
})

const insertCorruptedByokRow = (contextId: string): void => {
  getDrizzleDb()
    .insert(byokLlmCredentials)
    .values({
      contextId,
      enabled: true,
      encryptedConfig: 'not-base64',
      updatedAt: Date.now(),
      updatedBy: 'seed-user',
    })
    .run()
}

describe('buildByokFieldResponse', () => {
  beforeEach(async () => {
    mockLogger()
    process.env['INSTANCE_CONFIG_KEY'] = 'e'.repeat(64)
    await setupTestDb()
  })

  test('disabled context returns empty providers and roles', () => {
    const body = FieldResponseSchema.parse(buildByokFieldResponse('ctx:disabled'))

    expect(body.enabled).toBe(false)
    expect(body.fields).toEqual([])
    expect(body.providers).toEqual([])
    expect(body.roles).toEqual(emptyRoles)
  })

  test('enabled v2 context returns masked providers and role bindings', () => {
    const contextId = 'ctx:v2'
    enableByokForContext(contextId, 'admin')
    upsertByokProvider(contextId, makeProvider(), 'admin')
    setByokRoles(contextId, { main: { providerId: 'prov-1', model: 'llama3' }, small: null, embedding: null }, 'admin')

    const raw = buildByokFieldResponse(contextId)
    expect(JSON.stringify(raw)).not.toContain('sk-test-key')

    const body = FieldResponseSchema.parse(raw)
    expect(body.providers).toHaveLength(1)
    const provider = body.providers[0]
    assert(provider !== undefined, 'provider should be present')
    expect(provider.apiKeyMasked).toBe('****-key')
    expect(provider.label).toBe('Test Provider')
    expect(body.roles.main).toEqual({ providerId: 'prov-1', model: 'llama3' })
    expect(body.roles.small).toBeNull()
  })

  test('unreadable credentials return empty providers and roles', () => {
    const contextId = 'ctx:corrupt'
    insertCorruptedByokRow(contextId)

    const body = FieldResponseSchema.parse(buildByokFieldResponse(contextId))

    expect(body.enabled).toBe(true)
    expect(body.providers).toEqual([])
    expect(body.roles).toEqual(emptyRoles)
  })
})
