// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { ruLiveStatus } from '../../../src/i18n/locales/ru-live-status.js'
import type { Dictionary } from '../../../src/i18n/types.js'

describe('ruLiveStatus fragment', () => {
  test('satisfies the Dictionary liveStatus shape', () => {
    const fragment: Dictionary['liveStatus'] = ruLiveStatus
    expect(fragment).toBe(ruLiveStatus)
  })

  test('pins the Russian status texts', () => {
    expect(ruLiveStatus.thinking).toBe('💭 Думаю…')
    expect(ruLiveStatus.preparingResponse).toBe('💬 Готовлю ответ…')
    expect(ruLiveStatus.runningTool).toBe('⚙️ Выполняю {tool}…')
  })
})
