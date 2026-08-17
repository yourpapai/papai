// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { TaskListItem } from '../../src/providers/domain-types.js'
import { rankTasks } from '../../src/tools/suggest-next-task.js'

type RankCandidate = TaskListItem & { createdAt?: string | null }

const NOW = new Date('2026-04-01T12:00:00.000Z')
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const at = (offsetMs: number): string => new Date(NOW.getTime() + offsetMs).toISOString()

function makeTask(overrides: Partial<RankCandidate> & Pick<RankCandidate, 'id'>): RankCandidate {
  return {
    title: 'Fix login form',
    url: 'https://tracker.example/tasks/1',
    ...overrides,
  }
}

function scoresById(ranked: Array<{ id: string; score: number }>): Map<string, number> {
  return new Map(ranked.map((task): [string, number] => [task.id, task.score]))
}

function reasonsById(ranked: Array<{ id: string; reason: string }>): Map<string, string> {
  return new Map(ranked.map((task): [string, string] => [task.id, task.reason]))
}

describe('rankTasks', () => {
  test('returns an empty array for empty input', () => {
    expect(rankTasks([], NOW)).toEqual([])
  })

  test('orders overdue tasks by overdue-days magnitude', () => {
    const ranked = rankTasks(
      [makeTask({ id: 'one-day', dueDate: at(-DAY) }), makeTask({ id: 'five-days', dueDate: at(-5 * DAY) })],
      NOW,
    )

    expect(ranked.map((task) => task.id)).toEqual(['five-days', 'one-day'])
    expect(ranked.map((task) => task.score)).toEqual([150, 30])
    expect(ranked.map((task) => ({ id: task.id, title: task.title, url: task.url, dueDate: task.dueDate }))).toEqual([
      { id: 'five-days', title: 'Fix login form', url: 'https://tracker.example/tasks/1', dueDate: at(-5 * DAY) },
      { id: 'one-day', title: 'Fix login form', url: 'https://tracker.example/tasks/1', dueDate: at(-DAY) },
    ])
  })

  test('floors partial overdue days to whole days', () => {
    const ranked = rankTasks([makeTask({ id: 'partial', dueDate: at(-36 * HOUR) })], NOW)

    expect(ranked.map((task) => task.score)).toEqual([30])
  })

  test('ranks overdue above due within 48h above due within 7d above no signal', () => {
    const ranked = rankTasks(
      [
        makeTask({ id: 'no-signal' }),
        makeTask({ id: 'due-this-week', dueDate: at(5 * DAY) }),
        makeTask({ id: 'due-soon', dueDate: at(24 * HOUR) }),
        makeTask({ id: 'overdue', dueDate: at(-DAY) }),
      ],
      NOW,
    )

    expect(ranked.map((task) => task.id)).toEqual(['overdue', 'due-soon', 'due-this-week', 'no-signal'])
    expect(ranked.map((task) => task.score)).toEqual([30, 20, 10, 0])
  })

  test('treats the 48-hour and 7-day due windows as inclusive bounds', () => {
    const scores = scoresById(
      rankTasks(
        [
          makeTask({ id: 'at-48h', dueDate: at(48 * HOUR) }),
          makeTask({ id: 'just-over-48h', dueDate: at(48 * HOUR + MINUTE) }),
          makeTask({ id: 'at-7d', dueDate: at(7 * DAY) }),
          makeTask({ id: 'beyond-7d', dueDate: at(8 * DAY) }),
        ],
        NOW,
      ),
    )

    expect(scores.get('at-48h')).toBe(20)
    expect(scores.get('just-over-48h')).toBe(10)
    expect(scores.get('at-7d')).toBe(10)
    expect(scores.get('beyond-7d')).toBe(0)
  })

  test('scores priority tokens by case-insensitive containment, stacking across tiers', () => {
    const scores = scoresById(
      rankTasks(
        [
          makeTask({ id: 'urgent-upper', priority: 'Urgent' }),
          makeTask({ id: 'critical', priority: 'critical' }),
          makeTask({ id: 'blocker-contained', priority: 'P0 blocker' }),
          makeTask({ id: 'high', priority: 'High' }),
          makeTask({ id: 'major', priority: 'major' }),
          makeTask({ id: 'medium', priority: 'Medium' }),
          makeTask({ id: 'normal', priority: 'normal' }),
          makeTask({ id: 'unrecognized', priority: 'wishlist' }),
          makeTask({ id: 'stacked-tiers', priority: 'critical high' }),
          makeTask({ id: 'same-tier-twice', priority: 'urgent critical' }),
        ],
        NOW,
      ),
    )

    expect(scores.get('urgent-upper')).toBe(25)
    expect(scores.get('critical')).toBe(25)
    expect(scores.get('blocker-contained')).toBe(25)
    expect(scores.get('high')).toBe(20)
    expect(scores.get('major')).toBe(15)
    expect(scores.get('medium')).toBe(5)
    expect(scores.get('normal')).toBe(5)
    expect(scores.get('unrecognized')).toBe(0)
    expect(scores.get('stacked-tiers')).toBe(45)
    expect(scores.get('same-tier-twice')).toBe(25)
  })

  test('orders equally overdue tasks by priority strength', () => {
    const ranked = rankTasks(
      [
        makeTask({ id: 'plain', dueDate: at(-2 * DAY) }),
        makeTask({ id: 'urgent', dueDate: at(-2 * DAY), priority: 'urgent' }),
      ],
      NOW,
    )

    expect(ranked.map((task) => task.id)).toEqual(['urgent', 'plain'])
    expect(ranked.map((task) => task.score)).toEqual([85, 60])
  })

  test('applies the +2 creation-recency tiebreak among no-signal tasks, newest first', () => {
    const ranked = rankTasks(
      [
        makeTask({ id: 'oldest', createdAt: at(-90 * DAY) }),
        makeTask({ id: 'middle', createdAt: at(-60 * DAY) }),
        makeTask({ id: 'newest', createdAt: at(-30 * DAY) }),
      ],
      NOW,
    )

    expect(ranked.map((task) => task.id)).toEqual(['newest', 'middle', 'oldest'])
    expect(ranked.map((task) => task.score)).toEqual([2, 0, 0])
  })

  test('withholds the recency bonus when a due date or recognized priority signal exists', () => {
    const ranked = rankTasks(
      [
        makeTask({ id: 'far-due', dueDate: at(30 * DAY), createdAt: at(-DAY) }),
        makeTask({ id: 'high-priority', priority: 'high', createdAt: at(-2 * DAY) }),
        makeTask({ id: 'plain', createdAt: at(-3 * DAY) }),
      ],
      NOW,
    )
    const scores = scoresById(ranked)
    const reasons = reasonsById(ranked)

    expect(scores.get('far-due')).toBe(0)
    expect(scores.get('high-priority')).toBe(20)
    expect(scores.get('plain')).toBe(2)
    expect(reasons.get('far-due')).not.toMatch(/created/iu)
    expect(reasons.get('far-due')).not.toMatch(/due within/iu)
    expect(reasons.get('far-due')).not.toMatch(/priority/iu)
    expect(reasons.get('high-priority')).not.toMatch(/created/iu)
  })

  test('treats an unrecognized priority value as no priority signal for the recency tiebreak', () => {
    const ranked = rankTasks(
      [
        makeTask({ id: 'unrecognized-priority', priority: 'wishlist', createdAt: at(-10 * DAY) }),
        makeTask({ id: 'older-plain', createdAt: at(-40 * DAY) }),
      ],
      NOW,
    )
    const scores = scoresById(ranked)
    const reasons = reasonsById(ranked)

    expect(ranked.map((task) => task.id)).toEqual(['unrecognized-priority', 'older-plain'])
    expect(scores.get('unrecognized-priority')).toBe(2)
    expect(scores.get('older-plain')).toBe(0)
    expect(reasons.get('unrecognized-priority')).toMatch(/created/iu)
    expect(reasons.get('unrecognized-priority')).not.toMatch(/priority/iu)
  })

  test('excludes tasks with resolved set', () => {
    const ranked = rankTasks(
      [
        makeTask({
          id: 'resolved-top',
          dueDate: at(-5 * DAY),
          priority: 'urgent',
          resolved: '2026-03-20T00:00:00.000Z',
        }),
        makeTask({ id: 'open-overdue', dueDate: at(-DAY) }),
        makeTask({ id: 'open-soon', dueDate: at(24 * HOUR) }),
        makeTask({ id: 'open-plain' }),
      ],
      NOW,
    )

    expect(ranked.map((task) => task.id)).toEqual(['open-overdue', 'open-soon', 'open-plain'])
  })

  test('keeps input order when no candidate carries createdAt', () => {
    const ranked = rankTasks([makeTask({ id: 'first' }), makeTask({ id: 'second' }), makeTask({ id: 'third' })], NOW)

    expect(ranked.map((task) => task.id)).toEqual(['first', 'second', 'third'])
    expect(ranked.map((task) => task.score)).toEqual([0, 0, 0])
  })

  test('returns identical output for identical inputs', () => {
    const build = (): RankCandidate[] => [
      makeTask({ id: 'tie-a' }),
      makeTask({ id: 'tie-b' }),
      makeTask({ id: 'fresh', createdAt: at(-5 * DAY) }),
      makeTask({ id: 'due-soon', dueDate: at(30 * HOUR) }),
      makeTask({ id: 'urgent-overdue', dueDate: at(-3 * DAY), priority: 'URGENT' }),
      makeTask({ id: 'plain-overdue', dueDate: at(-3 * DAY) }),
    ]

    expect(rankTasks(build(), NOW)).toEqual(rankTasks(build(), NOW))
  })

  test('assembles reason lines from exactly the facts that scored', () => {
    const ranked = rankTasks(
      [
        makeTask({ id: 'overdue-high', dueDate: at(-2 * DAY), priority: 'high' }),
        makeTask({ id: 'overdue-plain', dueDate: at(-2 * DAY) }),
        makeTask({ id: 'due-soon', dueDate: at(20 * HOUR) }),
        makeTask({ id: 'due-this-week', dueDate: at(6 * DAY) }),
        makeTask({ id: 'fresh', createdAt: at(-2 * DAY) }),
      ],
      NOW,
    )
    const reasons = reasonsById(ranked)

    expect(ranked.map((task) => task.id)).toEqual([
      'overdue-high',
      'overdue-plain',
      'due-soon',
      'due-this-week',
      'fresh',
    ])

    expect(reasons.get('overdue-high')).toMatch(/overdue/iu)
    expect(reasons.get('overdue-high')).toMatch(/high/iu)
    expect(reasons.get('overdue-high')).toMatch(/priority/iu)
    expect(reasons.get('overdue-high')).not.toMatch(/due within/iu)
    expect(reasons.get('overdue-high')).not.toMatch(/created/iu)

    expect(reasons.get('overdue-plain')).toMatch(/overdue/iu)
    expect(reasons.get('overdue-plain')).not.toMatch(/priority/iu)

    expect(reasons.get('due-soon')).toMatch(/due within/iu)
    expect(reasons.get('due-soon')).toMatch(/48/u)
    expect(reasons.get('due-soon')).not.toMatch(/overdue/iu)
    expect(reasons.get('due-soon')).not.toMatch(/priority/iu)

    expect(reasons.get('due-this-week')).toMatch(/due within/iu)
    expect(reasons.get('due-this-week')).toMatch(/7/u)
    expect(reasons.get('due-this-week')).not.toMatch(/48/u)

    expect(reasons.get('fresh')).toMatch(/created/iu)
    expect(reasons.get('fresh')).not.toMatch(/overdue/iu)
    expect(reasons.get('fresh')).not.toMatch(/due within/iu)
    expect(reasons.get('fresh')).not.toMatch(/priority/iu)
  })
})
