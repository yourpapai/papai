// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { ruContextView } from '../../../src/i18n/locales/ru-context-view.js'
import type { Dictionary } from '../../../src/i18n/types.js'

describe('ruContextView fragment', () => {
  test('satisfies the Dictionary contextView shape', () => {
    const fragment: Dictionary['contextView'] = ruContextView
    expect(fragment).toBe(ruContextView)
  })
})
