// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { makeCreateDeferredPromptTool } from '../../src/tools/create-deferred-prompt.js'

const USER_ID = 'create-deferred-prompt-user'

describe('makeCreateDeferredPromptTool', () => {
  test('description no longer mentions execution mode classification', () => {
    const tool = makeCreateDeferredPromptTool(USER_ID, USER_ID, 'dm')
    expect(tool.description).not.toContain('execution mode')
  })
})
