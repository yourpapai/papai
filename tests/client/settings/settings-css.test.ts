// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const css = readFileSync(fileURLToPath(new URL('../../../client/settings/settings.css', import.meta.url)), 'utf8')

describe('settings.css', () => {
  test('defines the type-scale utility classes', () => {
    for (const c of ['.t-kicker', '.t-section', '.t-subhead', '.t-label', '.t-body', '.t-help', '.t-mono-data']) {
      expect(css).toContain(c)
    }
  })
  test('content column is capped at the content-max token', () => {
    expect(css).toContain('max-width: var(--content-max)')
  })
  test('group/section rhythm uses tokens not ad-hoc px', () => {
    expect(css).toContain('var(--gap-group)')
    expect(css).toContain('var(--gap-section)')
  })
  test('focus ring uses accent at reduced alpha', () => {
    expect(css).toContain(':focus-visible')
  })
  test('admin zone has a danger divider', () => {
    expect(css).toContain('.settings-admin-zone')
  })
})
