// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { buildProviderlessSystemPrompt } from '../src/system-prompt.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

describe('discovery preamble', () => {
  const enabled = new Set(['get_current_time', 'search_tools', 'load_tool'])

  beforeEach(async () => {
    mockLogger()
    mock.restore()
    await setupTestDb()
  })

  it('includes the discovery preamble when progressiveDisclosure is true', () => {
    const prompt = buildProviderlessSystemPrompt('ctx-1', enabled, {
      askPermissionAvailable: false,
      progressiveDisclosure: true,
    })
    expect(prompt).toContain('search_tools')
    expect(prompt).toContain('load_tool')
    expect(prompt.toLowerCase()).toContain('not loaded')
  })

  it('omits the preamble when progressiveDisclosure is false', () => {
    const prompt = buildProviderlessSystemPrompt('ctx-1', enabled, {
      askPermissionAvailable: false,
      progressiveDisclosure: false,
    })
    expect(prompt.toLowerCase()).not.toContain('most tools are not loaded')
  })
})
