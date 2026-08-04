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
  test('status text uses a spacing token rather than the UA default margin', () => {
    const statusErrorMatch = css.match(/\.status-error \{[^}]*\}/u)
    const statusSuccessMatch = css.match(/\.status-success \{[^}]*\}/u)
    expect(statusErrorMatch).not.toBeNull()
    expect(statusSuccessMatch).not.toBeNull()
    const [statusError] = statusErrorMatch!
    const [statusSuccess] = statusSuccessMatch!
    expect(statusError).toContain('margin: var(--gap-inline) 0 0')
    expect(statusSuccess).toContain('margin: var(--gap-inline) 0 0')
  })
  test('placeholder prose is capped at a reading measure', () => {
    const m = css.match(/\.placeholder \{[^}]*\}/u)
    expect(m).not.toBeNull()
    const [placeholder] = m!
    expect(placeholder).toContain('max-width: var(--content-max)')
  })
  test('settings-form shares grid tracks so controls align across the row', () => {
    const m = css.match(/\.settings-form \{[^}]*\}/u)
    expect(m).not.toBeNull()
    const [form] = m!
    expect(form).toContain('display: grid')
    expect(form).not.toContain('align-items: end')
    expect(css).toContain('grid-row: span 2')
  })
})
