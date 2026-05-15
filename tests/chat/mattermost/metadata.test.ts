// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import {
  mattermostCapabilities,
  mattermostConfigRequirements,
  mattermostTraits,
} from '../../../src/chat/mattermost/metadata.js'

describe('mattermost metadata', () => {
  it('should export required config requirements', () => {
    expect(mattermostConfigRequirements.length).toBe(2)
    expect(mattermostConfigRequirements[0]?.key).toBe('MATTERMOST_URL')
    expect(mattermostConfigRequirements[1]?.key).toBe('MATTERMOST_BOT_TOKEN')
  })

  it('should export capabilities as ReadonlySet', () => {
    expect(mattermostCapabilities.has('users.resolve')).toBe(true)
  })

  it('should export traits', () => {
    expect(mattermostTraits.observedGroupMessages).toBe('all')
    expect(mattermostTraits.maxMessageLength).toBe(16383)
  })
})
