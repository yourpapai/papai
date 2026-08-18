// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { extractChangeDigest } from '../../sdd-runner/src/gate-digest-extract.js'

const PROPOSAL_WITH_BOTH = [
  '## Why',
  '',
  'The slug is useless. A human needs context. This change adds a digest.',
  '',
  '## Impact',
  '',
  '- **Code**: `src/a.ts` (new)',
  '- **Tests**: `tests/a.test.ts`',
  '',
].join('\n')

const DESIGN_WITH_RISKS = ['## Risks / Trade-offs', '', '- misparse degrades to placeholder'].join('\n')

describe('extractChangeDigest — present sections (task 1.1)', () => {
  it('extracts what (first 1-2 sentences), why (full), touches (bullets), hasTasks from populated artifacts', () => {
    const digest = extractChangeDigest({
      proposalMd: PROPOSAL_WITH_BOTH,
      designMd: DESIGN_WITH_RISKS,
      hasTasksMd: false,
    })
    expect(digest.what).toBe('The slug is useless. A human needs context.')
    expect(digest.why).toBe('The slug is useless. A human needs context. This change adds a digest.')
    expect(digest.touches).toEqual(['**Code**: `src/a.ts` (new)', '**Tests**: `tests/a.test.ts`'])
    expect(digest.hasTasks).toBe(false)
  })
})

describe('extractChangeDigest — tolerance for missing/malformed sections (task 1.2)', () => {
  it('returns null for what/why when ## Why is absent', () => {
    const digest = extractChangeDigest({
      proposalMd: ['## Impact', '', '- only impact'].join('\n'),
      designMd: DESIGN_WITH_RISKS,
      hasTasksMd: false,
    })
    expect(digest.what).toBeNull()
    expect(digest.why).toBeNull()
  })

  it('returns null for touches when ## Impact is absent', () => {
    const digest = extractChangeDigest({
      proposalMd: ['## Why', '', 'Something.'].join('\n'),
      designMd: DESIGN_WITH_RISKS,
      hasTasksMd: false,
    })
    expect(digest.touches).toBeNull()
  })

  it('recognizes only ATX ## headings — setext-style headings yield nulls', () => {
    const setext = ['Why', '===', '', 'text.', '', 'Impact', '------', '', '- x'].join('\n')
    const digest = extractChangeDigest({
      proposalMd: setext,
      designMd: DESIGN_WITH_RISKS,
      hasTasksMd: false,
    })
    expect(digest.why).toBeNull()
    expect(digest.what).toBeNull()
    expect(digest.touches).toBeNull()
  })

  it('returns null for empty/malformed sections and never throws', () => {
    const emptyWhy = ['## Why', '', '## Impact', '', '- x'].join('\n')
    const digest = extractChangeDigest({
      proposalMd: emptyWhy,
      designMd: DESIGN_WITH_RISKS,
      hasTasksMd: false,
    })
    expect(digest.why).toBeNull()
    expect(digest.what).toBeNull()
    expect(() => extractChangeDigest({ proposalMd: '', designMd: '', hasTasksMd: false })).not.toThrow()
  })
})

describe('extractChangeDigest — tasks.md mode signal (task 1.3)', () => {
  const proposal = ['## Why', '', 'One. Two.', '', '## Impact', '', '- file-a', '- file-b'].join('\n')

  it('appends a trailing tasks: done/total entry when hasTasksMd is true with counts', () => {
    const digest = extractChangeDigest({
      proposalMd: proposal,
      designMd: '',
      hasTasksMd: true,
      tasksDone: 8,
      tasksTotal: 12,
    })
    expect(digest.touches).toEqual(['file-a', 'file-b', 'tasks: 8/12'])
    expect(digest.hasTasks).toBe(true)
  })

  it('renders tasks: ?/? when hasTasksMd is true without counts', () => {
    const digest = extractChangeDigest({
      proposalMd: proposal,
      designMd: '',
      hasTasksMd: true,
    })
    expect(digest.touches).toEqual(['file-a', 'file-b', 'tasks: ?/?'])
  })

  it('renders tasks: ?/? when only one of done/total is known', () => {
    const doneOnly = extractChangeDigest({ proposalMd: proposal, designMd: '', hasTasksMd: true, tasksDone: 3 })
    expect(doneOnly.touches?.at(-1)).toBe('tasks: ?/?')
    const totalOnly = extractChangeDigest({ proposalMd: proposal, designMd: '', hasTasksMd: true, tasksTotal: 3 })
    expect(totalOnly.touches?.at(-1)).toBe('tasks: ?/?')
  })
})

describe('extractChangeDigest — sentence and bullet normalization', () => {
  it('what is the first two sentences with whitespace collapsed', () => {
    const digest = extractChangeDigest({
      proposalMd: ['## Why', '', '  First   sentence.', 'Second\tone!  Third?', ''].join('\n'),
      designMd: '',
      hasTasksMd: false,
    })
    expect(digest.what).toBe('First sentence. Second one!')
    expect(digest.why).toBe(['First   sentence.', 'Second\tone!  Third?'].join('\n'))
  })

  it('what falls back to the whole body when no sentence terminator exists', () => {
    const digest = extractChangeDigest({
      proposalMd: ['## Why', '', 'no terminator anywhere', ''].join('\n'),
      designMd: '',
      hasTasksMd: false,
    })
    expect(digest.what).toBe('no terminator anywhere')
  })

  it('recognizes dash and asterisk bullets, including indented ones', () => {
    const digest = extractChangeDigest({
      proposalMd: ['## Impact', '', '- dash', '* star', '   - indented dash', '  plain line'].join('\n'),
      designMd: '',
      hasTasksMd: false,
    })
    expect(digest.touches).toEqual(['dash', 'star', 'indented dash'])
  })

  it('nulls touches when the Impact section exists but holds no bullets', () => {
    const digest = extractChangeDigest({
      proposalMd: ['## Impact', '', 'prose only, nothing to list'].join('\n'),
      designMd: '',
      hasTasksMd: false,
    })
    expect(digest.touches).toBeNull()
  })
})
