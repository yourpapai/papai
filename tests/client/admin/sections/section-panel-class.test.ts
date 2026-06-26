// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

const SECTIONS: string[] = ['BillingSection', 'IdentitiesSection', 'MemosSection', 'RemindersSection']

function parseSectionClasses(source: string): string[] {
  const tagMatch = source.match(/<section\b[^>]*class="([^"]*)"/u)
  if (tagMatch === null) return []
  return (tagMatch[1] ?? '').split(/\s+/u)
}

describe('admin sections', () => {
  test.each(SECTIONS)('%s outer <section> does not carry the legacy "panel" class', async (name) => {
    const url = new URL(`../../../../client/admin/sections/${name}.svelte`, import.meta.url)
    const source = await Bun.file(url).text()
    const classes = parseSectionClasses(source)
    expect(classes.length).toBeGreaterThan(0)
    expect(classes).not.toContain('panel')
  })

  test('admin.css no longer defines a bare .panel rule', async () => {
    const url = new URL('../../../../client/admin/admin.css', import.meta.url)
    const css = await Bun.file(url).text()
    expect(css).not.toMatch(/(^|\s)\.panel\s*\{/mu)
  })
})
