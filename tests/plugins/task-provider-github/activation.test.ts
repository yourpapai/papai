// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import factory from '../../../plugins/task-provider-github/index.js'
import manifestJson from '../../../plugins/task-provider-github/plugin.json' with { type: 'json' }
import { GitHubProvider } from '../../../plugins/task-provider-github/provider.js'
import { pluginManifestSchema } from '../../../src/plugins/types.js'
import { mockLogger } from '../../utils/test-helpers.js'

describe('task-provider-github activation', () => {
  test('factory produces a GitHubProvider with name github', () => {
    mockLogger()
    const provider = new GitHubProvider({ baseUrl: 'https://api.github.com', repo: 'owner/repo', token: 'token-abc' })
    expect(provider.name).toBe('github')
  })

  test('manifest parses and declares github task provider type', () => {
    const manifest = pluginManifestSchema.parse(manifestJson)
    expect(manifest.id).toBe('task-provider-github')
    expect(manifest.contributes.taskProviderTypes).toContain('github')
    expect(manifest.providerCapabilities.length).toBeGreaterThan(0)
  })

  test('factory export is a function that returns an object with activate', () => {
    const instance = factory()
    expect(typeof instance.activate).toBe('function')
  })

  test('activate() registers a factory that builds a github provider from raw config', () => {
    mockLogger()
    type RegisterTaskProviderType = Parameters<
      ReturnType<typeof factory>['activate']
    >[0]['registration']['registerTaskProviderType']
    type RegistrationContext = Parameters<ReturnType<typeof factory>['activate']>[0]

    let capturedFactory: Parameters<RegisterTaskProviderType>[1] | undefined

    const stubRegistration: RegistrationContext['registration'] = {
      registerTaskProviderType(...args: Parameters<RegisterTaskProviderType>): void {
        const [type, input] = args
        expect(type).toBe('github')
        capturedFactory = input
      },
    }

    const mockCtx: RegistrationContext = {
      registration: stubRegistration,
    }

    factory().activate(mockCtx)

    expect(capturedFactory).toBeDefined()

    const providerFactory = capturedFactory!

    const provider = providerFactory({
      baseUrl: 'https://ghes.example.com/api/v3',
      repo: 'owner/repo',
      token: 'tkn',
    })
    expect(provider?.name).toBe('github')
    expect(provider).toBeInstanceOf(GitHubProvider)
  })
})
