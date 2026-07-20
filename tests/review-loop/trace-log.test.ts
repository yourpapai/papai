// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { readFile, rm, mkdir } from 'node:fs/promises'
import path from 'node:path'

import {
  TraceEventSchema,
  RoundMetricSchema,
  DecisionsSchema,
  createFileTraceLogger,
  createCapturingTraceLogger,
  emptyDecisions,
  emptySeverityCounts,
} from '../../review-loop/src/trace-log.js'
import { cleanupTempDirs, makeTempDir } from './test-helpers.js'

afterEach(cleanupTempDirs)

describe('trace-log', () => {
  test('createFileTraceLogger appends JSONL and swallows fs errors', async () => {
    const dir = makeTempDir('trace-')
    const tracePath = path.join(dir, 'trace.jsonl')
    const logger = createFileTraceLogger(tracePath)
    await logger.append({
      ts: '2026-07-16T00:00:00Z',
      round: 1,
      phase: 'round',
      event: 'round_start',
      maxRounds: 10,
      maxNoProgressRounds: 2,
      checkCommand: 'bun check:full',
    })
    const raw = await readFile(tracePath, 'utf8')
    expect(raw.trim()).toBe(
      '{"ts":"2026-07-16T00:00:00Z","round":1,"phase":"round","event":"round_start","maxRounds":10,"maxNoProgressRounds":2,"checkCommand":"bun check:full"}',
    )

    // fs failure must not throw
    await mkdir(path.join(dir, 'nested'), { recursive: true })
    // a directory, not a file
    const badPath = path.join(dir, 'nested')
    await expect(
      createFileTraceLogger(badPath).append({
        ts: 'x',
        round: 1,
        phase: 'round',
        event: 'loop_end',
        doneReason: 'clean',
        rounds: 1,
        burndown: [],
      }),
    ).resolves.toBeUndefined()
    void rm(path.join(dir, 'nested'), { recursive: true }).catch(() => {})
  })

  test('TraceEventSchema validates every event variant; bad shape rejected', () => {
    const good = [
      {
        ts: 'x',
        round: 1,
        phase: 'r',
        event: 'round_start',
        maxRounds: 10,
        maxNoProgressRounds: 2,
        checkCommand: 'bun check:full',
      },
      { ts: 'x', round: 1, phase: 'r', event: 'review_complete', issueCount: 0, issues: [] },
      { ts: 'x', round: 1, phase: 'r', event: 'match_complete', newCount: 0, matchedCount: 0 },
      {
        ts: 'x',
        round: 1,
        phase: 'r',
        event: 'verify_complete',
        issueId: 'i',
        verdict: 'valid',
        fixability: 'auto',
        reviewerSeverity: 'high',
        fixerSeverity: 'medium',
        reasoning: 'r',
        targetFiles: [],
      },
      { ts: 'x', round: 1, phase: 'r', event: 'build_complete', issueId: 'i', passed: true, attempt: 1, durationMs: 5 },
      { ts: 'x', round: 1, phase: 'r', event: 'fix_complete', issueId: 'i', fixed: true, commitSha: 'abc', attempt: 1 },
      {
        ts: 'x',
        round: 1,
        phase: 'r',
        event: 'round_summary',
        newIssues: 1,
        cumulativeOpen: 1,
        noProgressRounds: 0,
        decisions: {
          fixed: 1,
          invalid: 0,
          already_fixed: 0,
          needs_human: 0,
          plan_drift: 0,
          no_commit: 0,
          inspector_rejected: 0,
        },
        reviewerSeverity: { critical: 0, high: 1, medium: 0, low: 0 },
        fixerSeverity: { critical: 0, high: 0, medium: 0, low: 0 },
        inspector: { runs: 0, rejected: 0 },
        phaseMs: { review: 0, match: 0, verify: 0, build: 0, inspect: 0, fix: 0 },
        usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0 },
      },
      { ts: 'x', round: 1, phase: 'r', event: 'loop_end', doneReason: 'clean', rounds: 1, burndown: [] },
    ] as const
    for (const e of good) expect(TraceEventSchema.safeParse(e).success).toBe(true)

    expect(TraceEventSchema.safeParse({ event: 'nope' }).success).toBe(false)
  })

  test('RoundMetricSchema validates a metric with decisions + dual severity', () => {
    const metric = {
      round: 1,
      newIssues: 3,
      cumulativeOpen: 3,
      noProgressRounds: 0,
      decisions: emptyDecisions(),
      reviewerSeverity: { ...emptySeverityCounts(), high: 2, low: 1 },
      fixerSeverity: { ...emptySeverityCounts(), high: 1 },
      inspector: { runs: 0, rejected: 0 },
      phaseMs: { review: 0, match: 0, verify: 0, build: 0, inspect: 0, fix: 0 },
      usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0 },
    }
    expect(RoundMetricSchema.safeParse(metric).success).toBe(true)
  })

  test('createCapturingTraceLogger records events in order', async () => {
    const { logger, events } = createCapturingTraceLogger()
    await logger.append({ ts: 'a', round: 1, phase: 'r', event: 'match_complete', newCount: 1, matchedCount: 0 })
    await logger.append({ ts: 'b', round: 1, phase: 'r', event: 'match_complete', newCount: 0, matchedCount: 1 })
    expect(events).toHaveLength(2)
    expect(events[0]!.ts).toBe('a')
  })
})

describe('extended schemas', () => {
  test('DecisionsSchema includes inspector_rejected', () => {
    const parsed = DecisionsSchema.parse({
      fixed: 0,
      invalid: 0,
      already_fixed: 0,
      needs_human: 0,
      plan_drift: 0,
      no_commit: 0,
      inspector_rejected: 2,
    })
    expect(parsed.inspector_rejected).toBe(2)
  })

  test('RoundMetricSchema includes inspector, phaseMs, usage', () => {
    const parsed = RoundMetricSchema.parse({
      round: 1,
      newIssues: 1,
      cumulativeOpen: 1,
      noProgressRounds: 0,
      decisions: {
        fixed: 0,
        invalid: 0,
        already_fixed: 0,
        needs_human: 0,
        plan_drift: 0,
        no_commit: 0,
        inspector_rejected: 0,
      },
      reviewerSeverity: { critical: 0, high: 0, medium: 0, low: 0 },
      fixerSeverity: { critical: 0, high: 0, medium: 0, low: 0 },
      inspector: { runs: 0, rejected: 0 },
      phaseMs: { review: 0, match: 0, verify: 0, build: 0, inspect: 0, fix: 0 },
      usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0 },
    })
    expect(parsed.inspector.runs).toBe(0)
    expect(parsed.phaseMs.review).toBe(0)
    expect(parsed.usage.costUsd).toBe(0)
  })

  test('TraceEventSchema accepts inspect_complete', () => {
    const parsed = TraceEventSchema.parse({
      ts: '2026-07-19T00:00:00.000Z',
      round: 1,
      phase: 'inspect',
      event: 'inspect_complete',
      issueId: 'rec-1',
      addresses: true,
      confidence: 0.9,
      reasoning: 'ok',
    })
    expect(parsed.event).toBe('inspect_complete')
  })
})
