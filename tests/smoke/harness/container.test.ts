// tests/smoke/harness/container.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildContainerEnv, settingsProbeUrl } from './container.js'

describe('container lifecycle helpers', () => {
  test('settingsProbeUrl targets the unconditional readiness route', () => {
    expect(settingsProbeUrl('http://127.0.0.1:5000')).toBe('http://127.0.0.1:5000/settings')
  })

  test('buildContainerEnv wires the fakes and the canonical defaults', () => {
    const env = buildContainerEnv({
      llmBaseUrl: 'http://host.docker.internal:1/v1',
      mattermostUrl: 'http://host.docker.internal:2',
    })
    expect(env['CHAT_PROVIDER']).toBe('mattermost')
    expect(env['ADMIN_USER_ID']).toBe('admin-user-1')
    expect(env['LLM_BASE_URL']).toBe('http://host.docker.internal:1/v1')
    expect(env['MATTERMOST_URL']).toBe('http://host.docker.internal:2')
    expect(env['DEBUG_HOSTNAME']).toBe('0.0.0.0')
    expect(env['SETTINGS_PUBLIC_BASE_URL']).toBe('http://localhost:9100')
    expect(env['INSTANCE_CONFIG_KEY']).toHaveLength(64)
    expect(env['DB_PATH']).toBe('/data/papai.db')
    expect(env['DEBUG_SERVER']).toBeUndefined()
  })

  test('buildContainerEnv honors a blank admin and the debug flag', () => {
    const env = buildContainerEnv({ llmBaseUrl: 'x', mattermostUrl: 'y' }, { adminUserId: '', debugServer: true })
    expect(env['ADMIN_USER_ID']).toBe('')
    expect(env['DEBUG_SERVER']).toBe('true')
  })
})
