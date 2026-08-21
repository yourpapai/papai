// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { enContextView } from '../../../src/i18n/locales/en-context-view.js'
import type { Dictionary } from '../../../src/i18n/types.js'

describe('enContextView fragment', () => {
  test('satisfies the Dictionary contextView shape', () => {
    const fragment: Dictionary['contextView'] = enContextView
    expect(fragment).toBe(enContextView)
  })

  test('pins the chrome texts byte-identical to the current renderer strings', () => {
    expect(enContextView.headerWord).toBe('Context')
    expect(enContextView.tokensUnit).toBe('tokens')
    expect(enContextView.tokenSuffix).toBe('tk')
    expect(enContextView.approximateMarker).toBe('(approximate)')
    expect(enContextView.approximateFooter).toBe('token counts are approximate')
  })
})
