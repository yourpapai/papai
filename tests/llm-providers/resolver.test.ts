// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// tests/llm-providers/resolver.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { encodeByokBlob, type ByokBlobV2 } from '../../src/byok-llm/blob-codec.js'
import {
  type ByokBundle,
  disableByokForContext,
  enableByokForContext,
  getByokBundle,
} from '../../src/byok-llm/store.js'
import { byokLlmCredentials } from '../../src/db/byok-llm-schema.js'
import { getDrizzleDb } from '../../src/db/drizzle.js'
import { resolveAdminLlmConfig, resolveLlmConfig } from '../../src/llm-providers/resolver.js'
import { createLlmProvider, setAdminRoleBindings } from '../../src/llm-providers/store.js'
import { clearLlmAdminCacheForTesting } from '../../src/llm-providers/store.testing.js'
import type { EffectiveLlmConfig, LlmConfigResult } from '../../src/llm-providers/types.js'
import { prewarmModelsDevSnapshot, resetModelsDevSnapshotForTest } from '../../src/models-dev/client.js'
import { encryptSecretPayload } from '../../src/secret-payload-crypto.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const UNVERIFIED = { status: 'unverified', error: null, at: null, models: [], modelsFetchedAt: null } as const

const seedAdmin = (): { main: string; small: string } => {
  const main = createLlmProvider(
    { label: 'admin-openai', providerType: 'openai', baseUrl: 'https://admin/v1', apiKey: 'sk-admin' },
    'admin',
  )
  const small = createLlmProvider(
    { label: 'admin-small', providerType: 'custom', baseUrl: 'https://admin-small/v1', apiKey: 'sk-admin-small' },
    'admin',
  )
  setAdminRoleBindings(
    {
      main: { providerId: main.id, model: 'gpt-main' },
      small: { providerId: small.id, model: 'gpt-small' },
      embedding: null,
    },
    'admin',
  )
  return { main: main.id, small: small.id }
}

const seedByok = (contextId: string, blob: ByokBlobV2): void => {
  const encryptedConfig = encryptSecretPayload({ v2: JSON.stringify(encodeByokBlob(blob)) })
  getDrizzleDb()
    .insert(byokLlmCredentials)
    .values({ contextId, enabled: true, encryptedConfig, updatedAt: 1, updatedBy: 'user' })
    .onConflictDoUpdate({
      target: byokLlmCredentials.contextId,
      set: { enabled: true, encryptedConfig, updatedAt: 1, updatedBy: 'user' },
    })
    .run()
}

const unwrapOk = (result: LlmConfigResult): EffectiveLlmConfig => {
  if (!result.ok) throw new Error(`expected ok result, got type=${result.type}`)
  return result
}

beforeEach(async () => {
  mockLogger()
  process.env['INSTANCE_CONFIG_KEY'] = 'd'.repeat(64)
  await setupTestDb()
  clearLlmAdminCacheForTesting()
})

describe('resolveLlmConfig', () => {
  test('missing when no admin binding exists', () => {
    expect(resolveLlmConfig('ctx')).toEqual({ ok: false, type: 'missing', source: 'global', missing: ['main'] })
  })

  test('uses admin bindings; embedding falls back to main when admin leaves it null', () => {
    seedAdmin()
    const r = unwrapOk(resolveLlmConfig('ctx'))
    expect(r.main.model).toBe('gpt-main')
    expect(r.main.source).toBe('global')
    expect(r.small.model).toBe('gpt-small')
    expect(r.embedding.model).toBe('gpt-main')
    expect(r.embedding.apiKey).toBe('sk-admin')
  })

  test('context overrides main only; small/embedding inherit admin (mixed source)', () => {
    seedAdmin()
    seedByok('ctx', {
      v: 2,
      providers: [
        {
          id: 'prov_local',
          label: 'ollama',
          providerType: 'ollama',
          baseUrl: 'http://ollama/v1',
          apiKey: 'local',
          baseProvider: null,
          baseModel: null,
          verification: UNVERIFIED,
        },
      ],
      roles: { main: { providerId: 'prov_local', model: 'llama3' }, small: null, embedding: null },
    })
    const r = unwrapOk(resolveLlmConfig('ctx'))
    expect(r.main.apiKey).toBe('local')
    expect(r.main.source).toBe('byok')
    expect(r.small.model).toBe('gpt-small')
    expect(r.small.source).toBe('global')
    expect(r.source).toBe('mixed')
  })

  test('disabled BYOK inherits admin', () => {
    seedAdmin()
    disableByokForContext('ctx', 'admin')
    const r = unwrapOk(resolveLlmConfig('ctx'))
    expect(r.main.source).toBe('global')
  })

  test('enabled but empty BYOK inherits admin (graceful fallback)', () => {
    seedAdmin()
    enableByokForContext('ctx', 'admin')
    expect(resolveLlmConfig('ctx').ok).toBe(true)
  })

  test('unreadable blob is an error', () => {
    seedAdmin()
    getDrizzleDb()
      .insert(byokLlmCredentials)
      .values({ contextId: 'ctx', enabled: true, encryptedConfig: 'not-base64', updatedAt: 1, updatedBy: 'x' })
      .run()
    expect(resolveLlmConfig('ctx')).toEqual({
      ok: false,
      type: 'error',
      source: 'byok',
      error: 'stored BYOK LLM credentials are unreadable',
    })
  })

  test('small/embedding without admin binding resolve entirely from context (uniform byok source)', () => {
    seedByok('ctx', {
      v: 2,
      providers: [
        {
          id: 'p1',
          label: 'local-all',
          providerType: 'ollama',
          baseUrl: 'http://ollama/v1',
          apiKey: 'local-key',
          baseProvider: null,
          baseModel: null,
          verification: UNVERIFIED,
        },
      ],
      roles: {
        main: { providerId: 'p1', model: 'llama-main' },
        small: { providerId: 'p1', model: 'llama-small' },
        embedding: { providerId: 'p1', model: 'llama-embed' },
      },
    })
    const r = unwrapOk(resolveLlmConfig('ctx'))
    expect(r.source).toBe('byok')
    expect(r.small.model).toBe('llama-small')
    expect(r.embedding.model).toBe('llama-embed')
    expect(r.embedding.source).toBe('byok')
  })

  test('small/embedding fall back to resolved main when neither context nor admin bind them', () => {
    seedByok('ctx', {
      v: 2,
      providers: [
        {
          id: 'p1',
          label: 'local-main',
          providerType: 'ollama',
          baseUrl: 'http://ollama/v1',
          apiKey: 'local-key',
          baseProvider: null,
          baseModel: null,
          verification: UNVERIFIED,
        },
      ],
      roles: { main: { providerId: 'p1', model: 'llama-main' }, small: null, embedding: null },
    })
    const r = unwrapOk(resolveLlmConfig('ctx'))
    expect(r.small.model).toBe('llama-main')
    expect(r.small.apiKey).toBe('local-key')
    expect(r.small.source).toBe('byok')
    expect(r.embedding.model).toBe('llama-main')
    expect(r.source).toBe('byok')
  })

  test('context binding whose provider is absent from the context map falls through to admin', () => {
    const ids = seedAdmin()
    seedByok('ctx', {
      v: 2,
      providers: [],
      roles: { main: { providerId: 'missing-in-context', model: 'x' }, small: null, embedding: null },
    })
    const r = unwrapOk(resolveLlmConfig('ctx'))
    expect(r.main.model).toBe('gpt-main')
    expect(r.main.apiKey).toBe('sk-admin')
    expect(r.main.source).toBe('global')
    expect(ids.main).toBeDefined()
  })

  test('unreadable bundle is reflected in getByokBundle and short-circuits resolution', (): void => {
    getDrizzleDb()
      .insert(byokLlmCredentials)
      .values({ contextId: 'ctx', enabled: true, encryptedConfig: 'not-base64', updatedAt: 1, updatedBy: 'x' })
      .run()
    const bundle: ByokBundle = getByokBundle('ctx')
    expect(bundle.enabled).toBe(true)
    expect(bundle.unreadable).toBe(true)
    expect(bundle.error).toBe('stored BYOK LLM credentials are unreadable')
  })
})

describe('resolveAdminLlmConfig', () => {
  test('missing when no admin binding exists', () => {
    expect(resolveAdminLlmConfig()).toEqual({ ok: false, type: 'missing', source: 'global', missing: ['main'] })
  })

  test('resolves admin main; small inherits admin binding, embedding falls back to main; source global', () => {
    seedAdmin()
    const r = unwrapOk(resolveAdminLlmConfig())
    expect(r.source).toBe('global')
    expect(r.main.model).toBe('gpt-main')
    expect(r.main.apiKey).toBe('sk-admin')
    expect(r.main.source).toBe('global')
    expect(r.small.model).toBe('gpt-small')
    expect(r.embedding.model).toBe('gpt-main')
    expect(r.embedding.apiKey).toBe('sk-admin')
  })
})

describe('resolved role metadata', () => {
  afterEach(() => {
    resetModelsDevSnapshotForTest()
  })

  const seedSnapshot = async (providers: unknown): Promise<void> => {
    resetModelsDevSnapshotForTest()
    await prewarmModelsDevSnapshot({
      fetchImpl: () => Promise.resolve(JSON.stringify(providers)),
      cachePath: `/tmp/opencode/resolver-${crypto.randomUUID()}/models.json`,
      now: () => 1,
    })
  }

  test('admin roles carry metadata inferred from the account type and bound model', async () => {
    await seedSnapshot({ openai: { models: { 'gpt-main': { limit: { context: 111_222, output: 3_000 } } } } })
    seedAdmin()

    const r = unwrapOk(resolveAdminLlmConfig())

    expect(r.main.metadata).toEqual({
      providerId: 'openai',
      modelId: 'gpt-main',
      contextWindow: 111_222,
      maxOutputTokens: 3_000,
      source: 'models-dev',
      via: 'inferred',
    })
  })

  test('admin roles carry override metadata from the account declared base references', async () => {
    await seedSnapshot({ anthropic: { models: { 'claude-declared': { limit: { context: 200_000, output: 8_000 } } } } })
    const provider = createLlmProvider(
      {
        label: 'gw',
        providerType: 'custom',
        baseUrl: 'https://gw.example.com/v1',
        apiKey: 'sk-gw',
        baseProvider: 'anthropic',
        baseModel: 'claude-declared',
      },
      'admin',
    )
    setAdminRoleBindings(
      { main: { providerId: provider.id, model: 'gateway-model' }, small: null, embedding: null },
      'admin',
    )

    const r = unwrapOk(resolveAdminLlmConfig())

    expect(r.main.metadata).toEqual({
      providerId: 'anthropic',
      modelId: 'claude-declared',
      contextWindow: 200_000,
      maxOutputTokens: 8_000,
      source: 'models-dev',
      via: 'override',
    })
  })

  test('byok roles carry metadata from the byok account declared base references', async () => {
    await seedSnapshot({ openai: { models: { 'gpt-byok': { limit: { context: 64_000, output: 2_000 } } } } })
    seedByok('ctx', {
      v: 2,
      providers: [
        {
          id: 'prov_byok',
          label: 'gateway',
          providerType: 'custom',
          baseUrl: 'https://byok-gw/v1',
          apiKey: 'local',
          baseProvider: 'openai',
          baseModel: 'gpt-byok',
          verification: UNVERIFIED,
        },
      ],
      roles: { main: { providerId: 'prov_byok', model: 'byok-model' }, small: null, embedding: null },
    })

    const r = unwrapOk(resolveLlmConfig('ctx'))

    expect(r.main.source).toBe('byok')
    expect(r.main.metadata).toEqual({
      providerId: 'openai',
      modelId: 'gpt-byok',
      contextWindow: 64_000,
      maxOutputTokens: 2_000,
      source: 'models-dev',
      via: 'override',
    })
  })

  test('each role carries its own metadata', async () => {
    await seedSnapshot({
      openai: { models: { 'gpt-main': { limit: { context: 111_222 } } } },
      groq: { models: { 'gpt-small': { limit: { context: 222_333 } } } },
    })
    const main = createLlmProvider(
      { label: 'main', providerType: 'openai', baseUrl: 'https://main/v1', apiKey: 'sk-main' },
      'admin',
    )
    const small = createLlmProvider(
      { label: 'small', providerType: 'groq', baseUrl: 'https://small/v1', apiKey: 'sk-small' },
      'admin',
    )
    setAdminRoleBindings(
      {
        main: { providerId: main.id, model: 'gpt-main' },
        small: { providerId: small.id, model: 'gpt-small' },
        embedding: null,
      },
      'admin',
    )

    const r = unwrapOk(resolveAdminLlmConfig())

    expect(r.main.metadata.modelId).toBe('gpt-main')
    expect(r.main.metadata.contextWindow).toBe(111_222)
    expect(r.small.metadata.modelId).toBe('gpt-small')
    expect(r.small.metadata.contextWindow).toBe(222_333)
    expect(r.embedding.metadata).toEqual(r.main.metadata)
  })

  test('metadata degrades to none when the snapshot is empty', () => {
    seedAdmin()

    const r = unwrapOk(resolveAdminLlmConfig())

    expect(r.main.metadata.source).toBe('none')
    expect(r.main.metadata.contextWindow).toBeNull()
  })
})
