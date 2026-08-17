// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { TaskListItem } from '../providers/types.js'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** Centralized ranking score constants (design D2). Magnitudes are chosen so one
 *  overdue day (30) outranks the strongest future due window (20) and priority
 *  stacks within a due tier without crossing a full tier gap. */
const SCORES = {
  overduePerDay: 30,
  dueSoonWithinMs: 48 * HOUR_MS,
  dueSoon: 20,
  dueThisWeekWithinMs: 7 * DAY_MS,
  dueThisWeek: 10,
  priorityTiers: [
    { tokens: ['urgent', 'critical', 'blocker'], points: 25 },
    { tokens: ['high'], points: 20 },
    { tokens: ['major'], points: 15 },
    { tokens: ['medium', 'normal'], points: 5 },
  ],
  newestCreated: 2,
} as const

/** Candidate accepted by `rankTasks`; `createdAt` rides along until the list type carries it (design D3). */
export type RankableTask = TaskListItem & { createdAt?: string | null }

export type RankedTask = RankableTask & { score: number; reason: string }

type RankedEntry = {
  ranked: RankedTask
  index: number
  hasDueOrPrioritySignal: boolean
  createdAtMs: number | null
}

function parseTimeMs(value: string | null | undefined): number | null {
  if (value === undefined || value === null || value === '') return null
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? null : ms
}

function scoreDueDate(dueMs: number, nowMs: number): { score: number; reason: string | null } {
  if (dueMs < nowMs) {
    const overdueDays = Math.floor((nowMs - dueMs) / DAY_MS)
    return {
      score: Math.max(1, overdueDays) * SCORES.overduePerDay,
      reason:
        overdueDays >= 1 ? `${overdueDays} ${overdueDays === 1 ? 'day' : 'days'} overdue` : 'less than a day overdue',
    }
  }
  const untilDueMs = dueMs - nowMs
  if (untilDueMs <= SCORES.dueSoonWithinMs) {
    return { score: SCORES.dueSoon, reason: 'due within 48 hours' }
  }
  if (untilDueMs <= SCORES.dueThisWeekWithinMs) {
    return { score: SCORES.dueThisWeek, reason: 'due within 7 days' }
  }
  return { score: 0, reason: null }
}

function scorePriority(priority: string | undefined): { score: number; matchedTokens: string[] } {
  if (priority === undefined || priority === '') return { score: 0, matchedTokens: [] }
  const lowered = priority.toLowerCase()
  let score = 0
  const matchedTokens: string[] = []
  for (const tier of SCORES.priorityTiers) {
    const matched = tier.tokens.find((token): boolean => lowered.includes(token))
    if (matched !== undefined) {
      score += tier.points
      matchedTokens.push(matched)
    }
  }
  return { score, matchedTokens }
}

function newestNoSignalCreatedAt(candidates: readonly RankableTask[]): number | null {
  let newest: number | null = null
  for (const task of candidates) {
    const dueMs = parseTimeMs(task.dueDate)
    if (dueMs !== null) continue
    if (scorePriority(task.priority).score > 0) continue
    const createdMs = parseTimeMs(task.createdAt)
    if (createdMs !== null && (newest === null || createdMs > newest)) {
      newest = createdMs
    }
  }
  return newest
}

function evaluateTask(task: RankableTask, index: number, nowMs: number, newestCreatedMs: number | null): RankedEntry {
  const dueMs = parseTimeMs(task.dueDate)
  const due = dueMs === null ? { score: 0, reason: null } : scoreDueDate(dueMs, nowMs)
  const priority = scorePriority(task.priority)
  const hasDueOrPrioritySignal = dueMs !== null || priority.score > 0

  const reasonParts: string[] = []
  if (due.reason !== null) reasonParts.push(due.reason)
  if (priority.matchedTokens.length > 0) reasonParts.push(`priority ${priority.matchedTokens.join(', ')}`)

  let score = due.score + priority.score
  const createdMs = parseTimeMs(task.createdAt)
  if (!hasDueOrPrioritySignal && createdMs !== null && createdMs === newestCreatedMs) {
    score += SCORES.newestCreated
    reasonParts.push('created most recently')
  }

  return {
    ranked: {
      ...task,
      score,
      reason: reasonParts.length > 0 ? reasonParts.join('; ') : 'no urgency signals',
    },
    index,
    hasDueOrPrioritySignal,
    createdAtMs: createdMs,
  }
}

function compareRanked(a: RankedEntry, b: RankedEntry): number {
  if (a.ranked.score !== b.ranked.score) return b.ranked.score - a.ranked.score
  if (!a.hasDueOrPrioritySignal && !b.hasDueOrPrioritySignal) {
    const aCreated = a.createdAtMs ?? Number.NEGATIVE_INFINITY
    const bCreated = b.createdAtMs ?? Number.NEGATIVE_INFINITY
    if (aCreated !== bCreated) return bCreated - aCreated
  }
  return a.index - b.index
}

/** Deterministically rank open tasks against `now` (design D2): due-date urgency,
 *  stacking priority tokens, creation-recency fallback. Resolved tasks are excluded. */
export function rankTasks(tasks: readonly RankableTask[], now: Date): RankedTask[] {
  const candidates = tasks.filter((task): boolean => task.resolved === undefined)
  const newestCreatedMs = newestNoSignalCreatedAt(candidates)
  return candidates
    .map((task, index): RankedEntry => evaluateTask(task, index, now.getTime(), newestCreatedMs))
    .sort(compareRanked)
    .map((entry): RankedTask => entry.ranked)
}
