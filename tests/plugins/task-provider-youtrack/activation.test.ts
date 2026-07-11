// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import factory from '../../../plugins/task-provider-youtrack/index.js'
import manifestJson from '../../../plugins/task-provider-youtrack/plugin.json' with { type: 'json' }
import { YouTrackProvider } from '../../../plugins/task-provider-youtrack/provider.js'
import { pluginManifestSchema } from '../../../src/plugins/types.js'
import { mockLogger } from '../../utils/test-helpers.js'

describe('task-provider-youtrack activation', () => {
  test('factory produces a YouTrackProvider with name youtrack', () => {
    mockLogger()
    const provider = new YouTrackProvider({ baseUrl: 'https://youtrack.invalid', token: 'token-abc' })
    expect(provider.name).toBe('youtrack')
  })

  test('manifest parses and declares youtrack task provider type', () => {
    const manifest = pluginManifestSchema.parse(manifestJson)
    expect(manifest.id).toBe('task-provider-youtrack')
    expect(manifest.contributes.taskProviderTypes).toContain('youtrack')
    expect(manifest.providerCapabilities.length).toBeGreaterThan(0)
  })

  test('factory export is a function that returns an object with activate', () => {
    const instance = factory()
    expect(typeof instance.activate).toBe('function')
  })

  test('activate() registers a factory that builds a youtrack provider from raw config', () => {
    mockLogger()
    type RegisterTaskProviderType = Parameters<
      ReturnType<typeof factory>['activate']
    >[0]['registration']['registerTaskProviderType']
    type RegistrationContext = Parameters<ReturnType<typeof factory>['activate']>[0]

    let capturedFactory: Parameters<RegisterTaskProviderType>[1] | undefined
    let capturedToolName: string | undefined

    const stubRegistration: RegistrationContext['registration'] = {
      registerTaskProviderType(...args: Parameters<RegisterTaskProviderType>): void {
        const [type, input] = args
        expect(type).toBe('youtrack')
        capturedFactory = input
      },
      registerTool(tool): void {
        capturedToolName = tool.name
      },
    }

    const mockCtx: RegistrationContext = {
      registration: stubRegistration,
    }

    factory().activate(mockCtx)

    expect(capturedFactory).toBeDefined()
    expect(capturedToolName).toBe('apply_youtrack_command')

    const providerFactory = capturedFactory!

    const provider = providerFactory({
      baseUrl: 'https://yt.invalid',
      token: 'tkn',
    })
    expect(provider?.name).toBe('youtrack')
    expect(provider).toBeInstanceOf(YouTrackProvider)
  })
})
