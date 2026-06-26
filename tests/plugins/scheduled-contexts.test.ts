// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { ensureContextPlatformInstance, setContextSettings } from '../../src/instances/context-store.js'
import { getScheduledJobContextIds } from '../../src/plugins/scheduled-contexts.js'
import { setPluginContextEnabled } from '../../src/plugins/store.js'
import type { PluginManifest } from '../../src/plugins/types.js'
import { PLUGIN_API_VERSION, pluginManifestSchema } from '../../src/plugins/types.js'
import {
  mockLogger,
  seedCommonTestPlatformInstances,
  seedTestTaskInstance,
  setupTestDb,
} from '../utils/test-helpers.js'

const makeManifest = (defaultEnabled: boolean): PluginManifest =>
  pluginManifestSchema.parse({
    id: 'sched-plugin',
    name: 'Sched Plugin',
    version: '1.0.0',
    description: 'plugin with a scheduled job',
    apiVersion: PLUGIN_API_VERSION,
    main: 'index.ts',
    contributes: { jobs: ['sweep'] },
    permissions: ['scheduler'],
    defaultEnabled,
  })

describe('getScheduledJobContextIds', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
    seedTestTaskInstance({ id: 'kaneo-default' })
  })

  test('defaultEnabled plugin excludes seeded contexts with no task instance', () => {
    setContextSettings({ contextId: 'configured', taskInstanceId: 'kaneo-default', platformInstanceId: 'tg-default' })
    ensureContextPlatformInstance('seeded-only', 'tg-default')

    const contextIds = getScheduledJobContextIds('sched-plugin', makeManifest(true))

    expect(contextIds).toContain('configured')
    expect(contextIds).not.toContain('seeded-only')
  })

  test('explicitly enabled contexts still run even with no task instance', () => {
    ensureContextPlatformInstance('seeded-only', 'tg-default')
    setPluginContextEnabled('sched-plugin', 'seeded-only', true)

    const contextIds = getScheduledJobContextIds('sched-plugin', makeManifest(true))

    expect(contextIds).toContain('seeded-only')
  })

  test('non-defaultEnabled plugin is unaffected by seeded contexts', () => {
    ensureContextPlatformInstance('seeded-only', 'tg-default')

    const contextIds = getScheduledJobContextIds('sched-plugin', makeManifest(false))

    expect(contextIds).toEqual([])
  })
})
