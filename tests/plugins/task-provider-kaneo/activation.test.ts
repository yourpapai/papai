// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import factory from '../../../plugins/task-provider-kaneo/index.js'
import manifestJson from '../../../plugins/task-provider-kaneo/plugin.json' with { type: 'json' }
import { KaneoProvider } from '../../../plugins/task-provider-kaneo/provider.js'
import { pluginManifestSchema } from '../../../src/plugins/types.js'
import { mockLogger } from '../../utils/test-helpers.js'

type RegisterTaskProviderType = Parameters<
  ReturnType<typeof factory>['activate']
>[0]['registration']['registerTaskProviderType']
type RegisterTaskProviderInput = Parameters<RegisterTaskProviderType>[1]

function getCapturedFactory(
  input: RegisterTaskProviderInput,
): (config: Record<string, string>) => { readonly name: string } {
  return typeof input === 'function' ? input : input.factory
}

function getCapturedAutoProvision(
  input: RegisterTaskProviderInput,
):
  | ((context: {
      contextId: string
      chatUserId: string
      username: string | null
      reply: unknown
    }) => Promise<boolean> | boolean)
  | undefined {
  return typeof input === 'function' ? undefined : input.autoProvision
}

describe('task-provider-kaneo activation', () => {
  // NOTE: full registry registration (activate() → registerContributedTaskProviderType) will only work
  // after Task 3.6 removes the kaneo built-in descriptor. Until then, calling activate() on the real
  // ctx throws because the built-in guard blocks overriding built-in provider types.
  // This test exercises the factory and provider construction path directly.

  test('factory produces a KaneoProvider with name kaneo (api-key path)', () => {
    mockLogger()
    const provider = new KaneoProvider({ apiKey: 'test-api-key', baseUrl: 'https://kaneo.invalid' }, 'ws-1')
    expect(provider.name).toBe('kaneo')
  })

  test('factory produces a KaneoProvider with name kaneo (session-cookie path)', () => {
    mockLogger()
    const provider = new KaneoProvider(
      {
        apiKey: '',
        baseUrl: 'https://kaneo.invalid',
        sessionCookie: 'better-auth.session_token=abc123',
      },
      'ws-1',
    )
    expect(provider.name).toBe('kaneo')
  })

  test('manifest parses and declares kaneo task provider type', () => {
    const manifest = pluginManifestSchema.parse(manifestJson)
    expect(manifest.id).toBe('task-provider-kaneo')
    expect(manifest.contributes.taskProviderTypes).toContain('kaneo')
    expect(manifest.providerCapabilities.length).toBeGreaterThan(0)
  })

  test('factory export is a function that returns an object with activate', () => {
    const instance = factory()
    expect(typeof instance.activate).toBe('function')
  })

  test('activate() registers a factory that builds a kaneo provider from raw config (both credential shapes)', () => {
    mockLogger()
    type RegistrationContext = Parameters<ReturnType<typeof factory>['activate']>[0]

    let capturedInput: RegisterTaskProviderInput | undefined

    const stubRegistration: RegistrationContext['registration'] = {
      registerTaskProviderType(...args: Parameters<RegisterTaskProviderType>): void {
        const [type, input] = args
        expect(type).toBe('kaneo')
        capturedInput = input
      },
    }

    const mockCtx: RegistrationContext = {
      registration: stubRegistration,
    }

    factory().activate(mockCtx)

    expect(capturedInput).toBeDefined()

    const capturedFactory = getCapturedFactory(capturedInput!)
    const capturedAutoProvision = getCapturedAutoProvision(capturedInput!)

    expect(capturedAutoProvision).toBeDefined()

    // Plain api-key credential → Authorization: Bearer path (isKaneoSessionCookie returns false)
    const apiKeyProvider = capturedFactory?.({
      baseUrl: 'https://kaneo.invalid',
      credential: 'plain-api-key',
      workspaceId: 'ws-1',
    })
    expect(apiKeyProvider?.name).toBe('kaneo')

    // Session-cookie credential (starts with 'better-auth.session_token=') → isKaneoSessionCookie returns true
    const cookieProvider = capturedFactory?.({
      baseUrl: 'https://kaneo.invalid',
      credential: 'better-auth.session_token=abc123',
      workspaceId: 'ws-1',
    })
    expect(cookieProvider?.name).toBe('kaneo')
  })
})
