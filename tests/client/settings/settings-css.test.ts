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
  test('the focus ring uses the shared tokens rather than a copied literal', () => {
    const m = css.match(/[^}]*:focus-visible \{[^}]*\}/u)
    expect(m).not.toBeNull()
    const [rule] = m!
    expect(rule).toContain('outline: var(--focus-ring)')
    expect(rule).toContain('outline-offset: var(--focus-ring-offset)')
    expect(css).not.toContain('rgba(82, 224, 138, 0.4)')
  })

  test('the focus ring covers the chrome outside the grid, not just the grid', () => {
    const m = css.match(/[^}]*:focus-visible \{[^}]*\}/u)
    const [rule] = m!
    expect(rule).toContain('.ui-shell')
    expect(rule).toContain('.settings-gate')
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
  })
  test('non-field form children span label and control only, so buttons sit level with inputs', () => {
    const m = css.match(/\.settings-form > :not\(\.ui-field\) \{[^}]*\}/u)
    expect(m).not.toBeNull()
    const [rule] = m!
    expect(rule).toContain('grid-row: span 2')
    expect(rule).toContain('align-self: end')
  })
  test('the settings shell is a contained full-height column, not a page scroller', () => {
    const m = css.match(/\.settings-shell \{[^}]*\}/u)
    expect(m).not.toBeNull()
    const [shell] = m!
    expect(shell).toContain('height: 100%')
    expect(shell).toContain('min-height: 0')
  })

  test('the grid fills the remaining height so its columns can scroll independently', () => {
    const m = css.match(/\.settings-grid \{[^}]*\}/u)
    expect(m).not.toBeNull()
    const [grid] = m!
    expect(grid).toContain('flex: 1 1 auto')
    expect(grid).toContain('min-height: 0')
  })

  test('the main column owns its own scroll', () => {
    const m = css.match(/\.settings-grid__main \{[^}]*\}/u)
    expect(m).not.toBeNull()
    const [main] = m!
    expect(main).toContain('overflow-y: auto')
  })

  test('the single-column cutover happens at 900px, above the squeeze band', () => {
    expect(css).toContain('@media (max-width: 900px)')
    expect(css).not.toContain('@media (max-width: 720px)')
  })
})
