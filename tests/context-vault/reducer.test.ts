// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { reduceSpec, type ReduceFileInput } from '../../src/context-vault/reducer.js'

const file = (path: string, kind: string, text?: string): ReduceFileInput => ({ path, kind, text })

describe('context-vault reducer', () => {
  test('extracts the markdown heading outline from file texts in order', () => {
    const result = reduceSpec({
      changeName: 'context-vault-plugin',
      files: [
        file('a/proposal.md', 'proposal', '# Proposal\n\nintro\n\n## Why\n\n## What\n'),
        file('a/design.md', 'design', '# Design\n\n## Context\n### Detail\n'),
      ],
    })
    expect(result.outline).toEqual(['# Proposal', '## Why', '## What', '# Design', '## Context', '### Detail'])
  })

  test('outline ignores files without text and non-heading lines', () => {
    const result = reduceSpec({
      changeName: 'x',
      files: [file('a/proposal.md', 'proposal', 'no headings here\n- [ ] task'), file('a/tasks.md', 'tasks')],
    })
    expect(result.outline).toEqual([])
  })

  test('proposal only is draft with zero progress', () => {
    const result = reduceSpec({
      changeName: 'x',
      files: [file('a/proposal.md', 'proposal', '# P\n')],
    })
    expect(result.stage).toBe('draft')
    expect(result.progressPct).toBe(0)
  })

  test('a plan or design file moves the stage to approved', () => {
    const withDesign = reduceSpec({
      changeName: 'x',
      files: [file('a/proposal.md', 'proposal', '# P\n'), file('a/design.md', 'design', '# D\n')],
    })
    expect(withDesign.stage).toBe('approved')

    const withPlan = reduceSpec({
      changeName: 'x',
      files: [file('a/proposal.md', 'proposal', '# P\n'), file('a/plan.md', 'plan', '# Plan\n')],
    })
    expect(withPlan.stage).toBe('approved')
  })

  test('some ticked tasks checkboxes means in-progress with the ticked ratio', () => {
    const result = reduceSpec({
      changeName: 'x',
      files: [
        file('a/proposal.md', 'proposal', '# P\n'),
        file('a/design.md', 'design', '# D\n'),
        file('a/tasks.md', 'tasks', '# Tasks\n\n- [x] one\n- [ ] two\n- [ ] three\n- [x] four\n'),
      ],
    })
    expect(result.stage).toBe('in-progress')
    expect(result.progressPct).toBe(50)
  })

  test('unticked checkboxes alone do not make a change in-progress', () => {
    const result = reduceSpec({
      changeName: 'x',
      files: [
        file('a/proposal.md', 'proposal', '# P\n'),
        file('a/design.md', 'design', '# D\n'),
        file('a/tasks.md', 'tasks', '# Tasks\n\n- [ ] one\n- [ ] two\n'),
      ],
    })
    expect(result.stage).toBe('approved')
    expect(result.progressPct).toBe(0)
  })

  test('all checkboxes ticked means done at 100 percent', () => {
    const result = reduceSpec({
      changeName: 'x',
      files: [file('a/tasks.md', 'tasks', '# Tasks\n\n- [x] one\n- [x] two\n')],
    })
    expect(result.stage).toBe('done')
    expect(result.progressPct).toBe(100)
  })

  test('a change under the archive/ prefix is done regardless of checkboxes', () => {
    const result = reduceSpec({
      changeName: 'archive/context-vault-plugin',
      files: [
        file('openspec/changes/archive/context-vault-plugin/proposal.md', 'proposal', '# P\n'),
        file('openspec/changes/archive/context-vault-plugin/tasks.md', 'tasks', '- [ ] never\n'),
      ],
    })
    expect(result.stage).toBe('done')
    expect(result.progressPct).toBe(100)
  })

  test('checkboxes inside nested list items still count', () => {
    const result = reduceSpec({
      changeName: 'x',
      files: [file('a/tasks.md', 'tasks', '- [x] a\n  - [ ] nested\n- [ ] b\n')],
    })
    expect(result.stage).toBe('in-progress')
    expect(result.progressPct).toBe(33)
  })
})
