// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { ContextViewTexts } from '../../src/i18n/context-view-types.js'
import { enContextView } from '../../src/i18n/locales/en-context-view.js'
import { ruContextView } from '../../src/i18n/locales/ru-context-view.js'

describe('ContextViewTexts', () => {
  test('en and ru context-view catalogs satisfy the shape', () => {
    const en: ContextViewTexts = enContextView
    const ru: ContextViewTexts = ruContextView
    expect(en.headerWord).toBe('Context')
    expect(ru.headerWord).toBe('Контекст')
    expect(en.sectionColumnHeader).toBe('Section')
    expect(ru.sectionColumnHeader).toBe('Раздел')
    expect(en.tokensColumnHeader).toBe('Tokens')
    expect(ru.tokensColumnHeader).toBe('Токены')
  })
})
