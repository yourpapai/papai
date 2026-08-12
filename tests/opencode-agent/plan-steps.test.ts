// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { parseTaskCheckboxes, planBoxes, stepSubject } from '../../opencode-agent/src/plan-steps.js'

describe('the commit subject a step earns', () => {
  test('is one line, however many the title had', () => {
    // The title is model-written text on its way into a commit message. It is
    // passed as argv rather than through a shell, so nothing here is a safety
    // boundary — this is about a readable `git log`.
    expect(stepSubject('first line\nsecond line')).toBe('first line')
  })

  test('is clamped, so one runaway title does not become the whole subject', () => {
    const long = stepSubject('x'.repeat(200))

    expect(long.length).toBeLessThanOrEqual(72)
  })
})

/**
 * Design D5 — tasks.md is the plan's only shape.
 *
 * `REVIEW_AND_MUTATE` walks the change's `tasks.md` checkboxes; each step's
 * commit checks its box in the same commit. These tests pin the parser that
 * turns the file into the ordered checkbox list the walk reads, including the
 * line number the box-check edit needs.
 */
describe('parseTaskCheckboxes (D5)', () => {
  const TASKS_MD = [
    '# Tasks: add retries',
    '',
    '- [x] 1.1 Add failing tests',
    '- [ ] 1.2 Implement the wrapper',
    '  - [ ] 1.2.1 Handle the timeout case',
    '- [ ] 1.3 Verify',
    '',
    'Some prose note that is not a checkbox.',
  ].join('\n')

  test('returns the checkboxes in file order with their checked state', () => {
    const boxes = parseTaskCheckboxes(TASKS_MD)
    expect(boxes.map((b) => b.text)).toEqual([
      '1.1 Add failing tests',
      '1.2 Implement the wrapper',
      '1.2.1 Handle the timeout case',
      '1.3 Verify',
    ])
    expect(boxes.map((b) => b.checked)).toEqual([true, false, false, false])
  })

  test('records the 1-based line number so the box-check edit targets the right line', () => {
    const boxes = parseTaskCheckboxes(TASKS_MD)
    expect(boxes.map((b) => b.line)).toEqual([3, 4, 5, 6])
  })

  test('ignores lines that are not checkboxes', () => {
    const boxes = parseTaskCheckboxes('just prose\n- [ ] a real task\nmore prose')
    expect(boxes).toHaveLength(1)
    expect(boxes[0]?.text).toBe('a real task')
  })

  test('returns an empty list for a tasks.md with no checkboxes', () => {
    expect(parseTaskCheckboxes('# Tasks\n\nNo steps yet.')).toEqual([])
  })
})

/**
 * The walk reads `tasks.md` as `planBoxes` — every checkbox with absolute
 * numbering — so "step 3 of 5" stays honest across a run that ticks the boxes
 * ahead of the cursor. Numbering among all boxes (not just the unchecked) is
 * what keeps a `/continue` honest about which step it is on.
 */
describe('planBoxes (D5)', () => {
  const TASKS_MD = ['- [x] 1.1 Done', '- [ ] 1.2 Next', '- [ ] 1.3 Later'].join('\n')

  test('numbers every box absolutely, checked or not', () => {
    const boxes = planBoxes(TASKS_MD)
    expect(boxes.map((b) => b.number)).toEqual([1, 2, 3])
    expect(boxes.every((b) => b.total === 3)).toBe(true)
    expect(boxes.map((b) => b.checked)).toEqual([true, false, false])
  })

  test('carries the line number the box-check edit targets', () => {
    expect(planBoxes(TASKS_MD).map((b) => b.line)).toEqual([1, 2, 3])
  })
})
