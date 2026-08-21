// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { enLiveStatus } from '../../../src/i18n/locales/en-live-status.js'
import type { Dictionary } from '../../../src/i18n/types.js'

describe('enLiveStatus fragment', () => {
  test('satisfies the Dictionary liveStatus shape', () => {
    const fragment: Dictionary['liveStatus'] = enLiveStatus
    expect(fragment).toBe(enLiveStatus)
  })

  test('pins the seed status texts', () => {
    expect(enLiveStatus.thinking).toBe('💭 Thinking…')
    expect(enLiveStatus.preparingResponse).toBe('💬 Preparing response…')
    expect(enLiveStatus.runningTool).toBe('⚙️ Running {tool}…')
  })
})
