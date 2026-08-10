import { describe, expect, test } from 'bun:test'

import { formatCheckResult } from '../../../tdd/checks/check-full.mjs'

describe('formatCheckResult', () => {
  test('names the files it parsed and points at the persisted log', () => {
    const result = formatCheckResult([{ check: 'lint', files: ['src/foo.ts', 'src/bar.ts'] }])
    expect(result).toBe(
      ['`bun check:full` failed:', '- lint (2 files) — src/foo.ts, src/bar.ts', '  → reports/checks/lint.log'].join(
        '\n',
      ),
    )
  })

  test('points test failures at the query command, not at a re-run', () => {
    const result = formatCheckResult([
      { check: 'lint', files: ['src/a.ts'] },
      { check: 'typecheck', files: ['src/b.ts'] },
      { check: 'test', files: ['tests/c.test.ts', 'tests/d.test.ts'] },
    ])
    expect(result).toBe(
      [
        '`bun check:full` failed:',
        '- lint (1 file) — src/a.ts',
        '  → reports/checks/lint.log',
        '- typecheck (1 file) — src/b.ts',
        '  → reports/checks/typecheck.log',
        '- test (2 files) — tests/c.test.ts, tests/d.test.ts',
        '  → bun run test:failures      (report already on disk; do not re-run to look)',
      ].join('\n'),
    )
  })

  test('formats failure with no parseable files', () => {
    const result = formatCheckResult([{ check: 'knip', files: [] }])
    expect(result).toBe(['`bun check:full` failed:', '- knip', '  → reports/checks/knip.log'].join('\n'))
  })

  test('caps the inline file list at five and counts the remainder', () => {
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name) => `src/${name}.ts`)
    const result = formatCheckResult([{ check: 'typecheck', files }])
    expect(result).toBe(
      [
        '`bun check:full` failed:',
        '- typecheck (7 files) — src/a.ts, src/b.ts, src/c.ts, src/d.ts, src/e.ts +2 more',
        '  → reports/checks/typecheck.log',
      ].join('\n'),
    )
  })

  test('sanitizes colon-bearing check names into their log filenames', () => {
    const result = formatCheckResult([{ check: 'review-loop:lint', files: [] }])
    expect(result).toBe(
      ['`bun check:full` failed:', '- review-loop:lint', '  → reports/checks/review-loop_lint.log'].join('\n'),
    )
  })

  test('routes every test-bearing check to the query command', () => {
    const result = formatCheckResult([
      { check: 'test:client', files: [] },
      { check: 'review-loop:test', files: [] },
    ])
    expect(result).toBe(
      [
        '`bun check:full` failed:',
        '- test:client',
        '  → bun run test:failures      (report already on disk; do not re-run to look)',
        '- review-loop:test',
        '  → bun run test:failures      (report already on disk; do not re-run to look)',
      ].join('\n'),
    )
  })
})
