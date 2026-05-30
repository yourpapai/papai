import { describe, expect, test } from 'bun:test'

import { formatCheckResult } from '../../../tdd/checks/check-full.mjs'

describe('formatCheckResult', () => {
  test('formats single failure', () => {
    const result = formatCheckResult([{ check: 'lint', files: ['src/foo.ts', 'src/bar.ts'] }])
    expect(result).toBe('- lint -> rerun: bun run lint')
  })

  test('formats multiple failures', () => {
    const result = formatCheckResult([
      { check: 'lint', files: ['src/a.ts'] },
      { check: 'typecheck', files: ['src/b.ts'] },
      { check: 'test', files: ['tests/c.test.ts', 'tests/d.test.ts'] },
    ])
    expect(result).toBe(
      [
        '- lint -> rerun: bun run lint',
        '- typecheck -> rerun: bun run typecheck',
        '- test -> rerun: bun run test',
      ].join('\n'),
    )
  })

  test('formats failure with no parseable files', () => {
    const result = formatCheckResult([{ check: 'knip', files: [] }])
    expect(result).toBe('- knip -> rerun: bun run knip')
  })
})
