// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { LICENSE_HEADER_LINES, parseFindings, renderBacklog, resolveHeaderYear } from '../../scripts/ux-backlog-lib.js'
import { collectReviews, isReviewDocument } from '../../scripts/ux-backlog.js'

const header = ['# UX Review — Members', '', '**Date:** 2026-07-03', ''].join('\n')

const finding = (fields: readonly string[], heading = '### [High] Delete has no confirmation'): string =>
  [header, heading, '', ...fields, ''].join('\n')

const VALID = [
  '- **Id:** members-delete-no-confirm',
  '- **Status:** open',
  '- **Dimension:** 4. Feedback & state',
  '- **Source:** `client/settings/sections/MembersSection.svelte:107` calls `remove()` immediately.',
  '- **Suggested fix:** Gate Remove behind the shared Confirm dialog.',
]

const replaceLine = (lines: readonly string[], prefix: string, replacement: string): string[] =>
  lines.map((line) => (line.startsWith(prefix) ? replacement : line))

const withStatus = (status: string): string[] => replaceLine(VALID, '- **Status:** open', `- **Status:** ${status}`)

const isLiteralHeaderLine = (line: string): boolean =>
  line !== '<!--' && line !== '-->' && !line.startsWith('Copyright')

describe('parseFindings', () => {
  test('extracts the section, date, and one fully-formed finding', () => {
    const review = parseFindings(finding(VALID), 'MembersSection.md')
    expect(review.section).toBe('MembersSection')
    expect(review.date).toBe('2026-07-03')
    expect(review.findings).toEqual([
      {
        id: 'members-delete-no-confirm',
        section: 'MembersSection',
        severity: 'High',
        title: 'Delete has no confirmation',
        status: 'open',
        anchor: 'client/settings/sections/MembersSection.svelte:107',
      },
    ])
  })

  test('takes the first backtick file:line as the anchor and tolerates its absence', () => {
    const noAnchor = replaceLine(VALID, '- **Source:**', '- **Source:** prose only')
    expect(parseFindings(finding(noAnchor), 'MembersSection.md').findings[0]?.anchor).toBe('')
  })

  test('throws when a finding has no Id', () => {
    const missing = VALID.filter((line) => !line.startsWith('- **Id:**'))
    expect(() => parseFindings(finding(missing), 'MembersSection.md')).toThrow(/missing.*Id/u)
  })

  test('throws on a duplicate Id within one document', () => {
    const doubled = [finding(VALID), finding(VALID, '### [Low] Another one')].join('\n')
    expect(() => parseFindings(doubled, 'MembersSection.md')).toThrow(/duplicate Id "members-delete-no-confirm"/u)
  })

  test('throws on a Status outside the permitted values', () => {
    const bad = withStatus('partial')
    expect(() => parseFindings(finding(bad), 'MembersSection.md')).toThrow(/Status/u)
  })

  test.each(['fixed', 'superseded', 'wont-fix', 'deferred'])('throws when %s carries no Resolved line', (status) => {
    const bad = withStatus(status)
    expect(() => parseFindings(finding(bad), 'MembersSection.md')).toThrow(/Resolved/u)
  })

  test.each(['fixed', 'superseded', 'wont-fix', 'deferred'])('accepts %s when a Resolved line is present', (status) => {
    const ok = [...withStatus(status), '- **Resolved:** sub-project F, commit abc1234']
    expect(parseFindings(finding(ok), 'MembersSection.md').findings[0]?.status).toBe(status)
  })

  test('the invalid-status error names every permitted status', () => {
    const bad = withStatus('partial')
    expect(() => parseFindings(finding(bad), 'MembersSection.md')).toThrow(
      /must be one of open, fixed, superseded, wont-fix, deferred/u,
    )
  })

  test('throws on a severity outside High, Med, Low', () => {
    expect(() => parseFindings(finding(VALID, '### [Critical] Nope'), 'MembersSection.md')).toThrow(/severity/u)
  })

  test('throws when the header has no Date line', () => {
    expect(() => parseFindings(['# UX Review', '', '### [High] X', '', ...VALID].join('\n'), 'X.md')).toThrow(/Date/u)
  })

  test('names the offending file and heading in the error', () => {
    const missing = VALID.filter((line) => !line.startsWith('- **Id:**'))
    expect(() => parseFindings(finding(missing), 'MembersSection.md')).toThrow(
      /MembersSection\.md.*Delete has no confirmation/u,
    )
  })
})

describe('renderBacklog', () => {
  const review = parseFindings(finding(VALID), 'MembersSection.md')

  test('throws on a duplicate Id across two documents', () => {
    const other = parseFindings(finding(VALID), 'MemorySection.md')
    expect(() => renderBacklog([review, other], 2026)).toThrow(/duplicate Id "members-delete-no-confirm"/u)
  })

  test('opens with the markdown license header the stamper produces', () => {
    expect(renderBacklog([review], 2026)).toStartWith(
      [
        '<!--',
        'SPDX-License-Identifier: BUSL-1.1',
        'Copyright (c) 2026 Dmitriy Lazarev',
        'Use of this software is governed by the Business Source License 1.1.',
        'See LICENSE in the project root for details.',
        '-->',
        '',
        '',
      ].join('\n'),
    )
  })

  test('lists open findings with severity, section, id, title, and anchor', () => {
    const out = renderBacklog([review], 2026)
    expect(out).toContain('`members-delete-no-confirm`')
    expect(out).toContain('MembersSection')
    expect(out).toContain('Delete has no confirmation')
    expect(out).toContain('client/settings/sections/MembersSection.svelte:107')
  })

  test('counts closed findings without listing them', () => {
    const closed = parseFindings(
      finding([
        '- **Id:** members-stale-copy',
        '- **Status:** fixed',
        '- **Resolved:** sub-project F',
        '- **Dimension:** 5. Content & language',
        '- **Source:** `client/settings/sections/MembersSection.svelte:12`',
      ]),
      'MembersSection.md',
    )
    const out = renderBacklog([closed], 2026)
    expect(out).not.toContain('`members-stale-copy`')
    expect(out).toContain('| MembersSection | 0 | 1 | 0 | 0 | 0 | 2026-07-03 |')
  })

  test('the summary header carries a column for every status', () => {
    const out = renderBacklog([], 2026)
    const summaryHeader = out.split('\n').find((line) => line.startsWith('| Section |'))
    expect(summaryHeader).toBeDefined()
    const cells = summaryHeader!.split('|').map((cell) => cell.trim())
    expect(cells).toEqual(['', 'Section', 'Open', 'Fixed', 'Superseded', "Won't fix", 'Deferred', 'Last reviewed', ''])
  })

  // The header row alone is not enough: a later `STATUSES` change could re-hardcode the
  // separator or the total row and still render a header with every status. A markdown table
  // whose rows disagree on column count renders malformed, so pin all three to one another.
  test('the separator and total rows carry the same column count as the header', () => {
    const cellCount = (line: string): number => line.split('|').length
    const lines = renderBacklog([], 2026).split('\n')
    const summaryHeader = lines.find((line) => line.startsWith('| Section |'))
    const separator = lines.find((line) => line.startsWith('| --- |'))
    const totalRow = lines.find((line) => line.startsWith('| **Total** |'))
    expect(summaryHeader).toBeDefined()
    expect(separator).toBeDefined()
    expect(totalRow).toBeDefined()
    expect(cellCount(separator!)).toBe(cellCount(summaryHeader!))
    expect(cellCount(totalRow!)).toBe(cellCount(summaryHeader!))
  })

  test('is deterministic and independent of input order', () => {
    const a = parseFindings(finding(VALID), 'MembersSection.md')
    const b = parseFindings(
      finding(replaceLine(VALID, '- **Id:**', '- **Id:** memory-x'), '### [Low] Memory thing'),
      'MemorySection.md',
    )
    expect(renderBacklog([a, b], 2026)).toBe(renderBacklog([b, a], 2026))
  })

  test('deferred findings are listed but wont-fix findings are not', () => {
    const out = renderBacklog(
      [
        {
          section: 'ReposSection',
          date: '2026-07-05',
          findings: [
            {
              id: 'repos-blocked',
              section: 'ReposSection',
              severity: 'Low',
              title: 'Needs backend support',
              status: 'deferred',
              anchor: 'client/settings/repos-fetchers.ts:16',
            },
            {
              id: 'repos-accepted',
              section: 'ReposSection',
              severity: 'Low',
              title: 'Accepted as-is',
              status: 'wont-fix',
              anchor: '',
            },
          ],
        },
      ],
      2026,
    )
    expect(out).toContain('## Deferred')
    expect(out).toContain('`repos-blocked` — **ReposSection** — Needs backend support')
    expect(out).toContain('client/settings/repos-fetchers.ts:16')
    expect(out).not.toContain('repos-accepted')
  })

  test('the deferred section reads _None._ when nothing is deferred', () => {
    const out = renderBacklog([], 2026)
    const deferredSection = out.slice(out.indexOf('## Deferred'))
    expect(deferredSection).toContain('_None._')
  })
})

describe('the checked-in backlog', () => {
  test('is current — regenerating in memory reproduces it exactly', async () => {
    const expected = renderBacklog(await collectReviews(), resolveHeaderYear())
    const actual = await Bun.file('docs/ux-reviews/_BACKLOG.md').text()
    expect(actual).toBe(expected)
  })

  test('covers every review document', async () => {
    const reviews = await collectReviews()
    expect(reviews).toHaveLength(19)
    expect(reviews.every((review) => review.findings.length > 0)).toBe(true)
  })

  test('excludes reference and generated files', () => {
    expect(isReviewDocument('MembersSection.md')).toBe(true)
    expect(isReviewDocument('RUBRIC.md')).toBe(false)
    expect(isReviewDocument('_TEMPLATE.md')).toBe(false)
    expect(isReviewDocument('_BACKLOG.md')).toBe(false)
  })
})

describe('license header byte-identity', () => {
  test('matches the literals the stamper builds its markdown header from', async () => {
    const stamper = await Bun.file('scripts/add-license-headers.ts').text()
    const literalLines = LICENSE_HEADER_LINES.filter(isLiteralHeaderLine)
    for (const line of literalLines) {
      expect(stamper).toContain(`'${line}'`)
    }
    expect(stamper).toContain('`Copyright (c) ${year} ${COPYRIGHT_HOLDER}`')
  })
})
