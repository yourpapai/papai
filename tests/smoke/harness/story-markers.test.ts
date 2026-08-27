// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { createSourceParser, type SourceParser } from '../../../src/ts-ast/source-parser.js'
import { scanStoryMarkers } from './story-markers.js'

describe('scanStoryMarkers', () => {
  let parser: SourceParser

  beforeAll(() => {
    parser = createSourceParser()
  })

  afterAll(async () => {
    await parser.close()
  })

  test('extracts the registry key from a title() marker', async () => {
    const source = `
      describe('lane', () => {
        test(title('SCN-boot-serve-empty-db'), async () => {})
      })
    `

    expect(await scanStoryMarkers(parser, 'a.smoke.ts', source)).toEqual({
      keys: ['SCN-boot-serve-empty-db'],
      violations: [],
    })
  })

  test('flags a test that bypasses the title helper with a literal', async () => {
    const source = `test('boots and serves', async () => {})`
    const scan = await scanStoryMarkers(parser, 'a.smoke.ts', source)

    expect(scan.keys).toEqual([])
    expect(scan.violations).toEqual(["a.smoke.ts: 'boots and serves'"])
  })

  test('reads markers through test modifiers and a timeout argument', async () => {
    const source = `
      test.skipIf(process.env['CI'] === 'true')(title('SCN-graceful-shutdown'), async () => {}, 30_000)
      test.skip(title('SCN-required-env-admin'), async () => {})
    `

    expect(await scanStoryMarkers(parser, 'a.smoke.ts', source)).toEqual({
      keys: ['SCN-graceful-shutdown', 'SCN-required-env-admin'],
      violations: [],
    })
  })

  test('reads a marker through a test.each curried call', async () => {
    const source = `
      test.each(cases)(title('SCN-each-case'), async () => {})
    `

    expect(await scanStoryMarkers(parser, 'a.smoke.ts', source)).toEqual({
      keys: ['SCN-each-case'],
      violations: [],
    })
  })

  test("sees bun:test's it() alias, so a bypass under it() is loud rather than silent", async () => {
    const source = `
      it(title('SCN-alias-marked'), async () => {})
      it('bypasses the helper', async () => {})
    `

    expect(await scanStoryMarkers(parser, 'a.smoke.ts', source)).toEqual({
      keys: ['SCN-alias-marked'],
      violations: ["a.smoke.ts: 'bypasses the helper'"],
    })
  })

  test('flags a title() call whose key is not a string literal', async () => {
    const source = `test(title(key), async () => {})`

    expect((await scanStoryMarkers(parser, 'a.smoke.ts', source)).violations).toEqual(['a.smoke.ts: title(key)'])
  })

  test('ignores non-test calls that take a string first argument', async () => {
    const source = `
      describe('lane', () => {
        expect('x').toBe('x')
      })
    `

    expect(await scanStoryMarkers(parser, 'a.smoke.ts', source)).toEqual({ keys: [], violations: [] })
  })
})
