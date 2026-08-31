// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  auditFragmentation,
  type AuditDeps,
  type FileFragmentation,
  type FragmentationReport,
} from '../../../scripts/test-audit/fragmentation.js'

// In-memory fs: scan answers the audit's tests/**/*.test.ts pattern from the map's keys,
// read serves contents, exists probes presence. Nothing here touches the real filesystem.
const makeDeps = (files: Record<string, string>): AuditDeps => {
  const keys = Object.keys(files)
  const patternToRegExp = (pattern: string): RegExp =>
    new RegExp(`^${pattern.replaceAll('.', '\\.').replaceAll('**', '.*')}$`, 'u')
  return {
    scan: (pattern) => {
      const matcher = patternToRegExp(pattern)
      return keys.filter((key) => matcher.test(key))
    },
    read: (relPath) => files[relPath] ?? null,
    exists: (relPath) => relPath in files,
  }
}

const singleFileReport = (content: string, file = 'tests/unit/example.test.ts'): FragmentationReport =>
  auditFragmentation(makeDeps({ [file]: content }))

const row = (report: FragmentationReport, file: string): FileFragmentation => {
  const found = report.files.find((entry) => entry.file === file)
  if (found === undefined) throw new Error(`no audit row for ${file}`)
  return found
}

describe('auditFragmentation case counting', () => {
  test('counts test(/it( call sites only when the first argument is a literal', () => {
    const report = singleFileReport(`
      describe('suite', () => {
        test('literal single quotes', () => {})
        test("literal double quotes", () => {})
        test(\`literal template\`, () => {})
        it('it form', () => {})
        test(computedName, () => {})
        test(nameFromHelper(), () => {})
        foo.test('property access is not a case site', () => {})
        items.it('property access it', () => {})
      })
    `)
    const entry = row(report, 'tests/unit/example.test.ts')
    expect(entry.caseCount).toBe(4)
  })

  test('counts test.each(/it.each( at their literal row count when the rows are a static array literal', () => {
    const report = singleFileReport(`
      test.each(['a', 'b', 'c'])('name %s', (value) => {
        expect(value).toBe('a')
      })
      it.each([
        [1, 2],
        [3, 4],
      ])('pair', (a, b) => {
        expect(a).toBe(b)
      })
      test.each([{ x: 1 }, { x: 2 }, { x: 3 }, { x: 4 }])('objects', (row) => {
        expect(row.x).toBe(1)
      })
      test('plain case', () => {
        expect(1).toBe(1)
      })
    `)
    const entry = row(report, 'tests/unit/example.test.ts')
    expect(entry.caseCount).toBe(3 + 2 + 4 + 1)
  })

  test('counts a computed test.each argument as one case', () => {
    const report = singleFileReport(`
      const rows = [['a', 'b'], ['c', 'd']]
      test.each(rows)('computed rows', (a, b) => {
        expect(a).toBe(b)
      })
      test.each(buildRows())('computed call', () => {
        expect(1).toBe(1)
      })
      test.each\`
        x    | y
        \${1} | \${2}
      \`('tagged template', (x, y) => {
        expect(x).toBe(y)
      })
    `)
    const entry = row(report, 'tests/unit/example.test.ts')
    expect(entry.caseCount).toBe(3)
  })

  test('describe and describe.each are never case sites', () => {
    const report = singleFileReport(`
      describe.each([1, 2])('group %s', () => {
        describe('inner', () => {
          test('only case', () => {
            expect(1).toBe(1)
          })
        })
      })
    `)
    const entry = row(report, 'tests/unit/example.test.ts')
    expect(entry.caseCount).toBe(1)
  })
})

describe('auditFragmentation matcher attribution', () => {
  test('attributes expect/assert/schemaValidates/expectAppError calls to the enclosing case segment', () => {
    const report = singleFileReport(`
      import { expect, test } from 'bun:test'
      import assert from 'node:assert'

      const moduleLevelHelper = () => {
        expect(0).toBe(0)
        assert.equal(0, 0)
      }

      describe('suite', () => {
        test('single expect', () => {
          expect(1).toBe(1)
        })

        test('two expects', () => {
          expect(1).toBe(1)
          expect(2).toBe(2)
        })

        test('node assert call', () => {
          assert.equal(1, 1)
        })

        test('helper matchers', () => {
          schemaValidates(schema, value)
          expectAppError(fn, 'CODE')
        })

        test('property-access calls are not matcher calls', () => {
          runner.expect(1).toBe(1)
          this.assert.equal(1, 1)
          helper.schemaValidates(x)
        })
      })
    `)
    const entry = row(report, 'tests/unit/example.test.ts')
    expect(entry.caseCount).toBe(5)
    expect(entry.matcherCallCount).toBe(6)
    expect(entry.singleOrZeroAssertShare).toBe(0.6)
  })
})

describe('auditFragmentation report shape and scan set', () => {
  test('records heuristicVersion and per-file rows with totals', () => {
    const report = auditFragmentation(
      makeDeps({
        'tests/a.test.ts': `
          test('one', () => { expect(1).toBe(1) })
        `,
        'tests/b.test.ts': `
          test('two asserts', () => { expect(1).toBe(1); expect(2).toBe(2) })
        `,
      }),
    )
    expect(report.heuristicVersion).toBe(2)
    expect(report.files).toHaveLength(2)
    expect(report.totals.files).toBe(2)
    expect(report.totals.caseCount).toBe(2)
    expect(report.totals.matcherCallCount).toBe(3)
    expect(report.totals.singleOrZeroAssertShare).toBe(0.5)
  })

  test('excludes the stories, e2e, client, visual, operational, smoke, and platform trees', () => {
    const content = `
      test('case', () => { expect(1).toBe(1) })
    `
    const report = auditFragmentation(
      makeDeps({
        'tests/stories/story.test.ts': content,
        'tests/e2e/flow.test.ts': content,
        'tests/client/widget.test.ts': content,
        'tests/visual/shot.test.ts': content,
        'tests/operational/catalog-crosscheck.test.ts': content,
        'tests/smoke/catalog-crosscheck.test.ts': content,
        'tests/platform/catalog-crosscheck.test.ts': content,
        'tests/kept.test.ts': content,
        'tests/utils/kept.test.ts': content,
      }),
    )
    expect(report.files.map((entry) => entry.file)).toEqual(['tests/kept.test.ts', 'tests/utils/kept.test.ts'])
    expect(report.totals.files).toBe(2)
  })

  test('drops zero-case files from the report', () => {
    const report = auditFragmentation(
      makeDeps({
        'tests/empty.test.ts': `export const nothing = true\n`,
        'tests/full.test.ts': `test('case', () => { expect(1).toBe(1) })\n`,
      }),
    )
    expect(report.files.map((entry) => entry.file)).toEqual(['tests/full.test.ts'])
  })
})
