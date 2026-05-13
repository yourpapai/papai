import { describe, expect, mock, test } from 'bun:test'

import {
  createProgressReporter,
  createTextProgressReporter,
  resolveProgressRenderer,
  type BehaviorAuditProgressReporter,
  type ProgressEvent,
} from '../../../scripts/behavior-audit/progress-reporter.js'

function createHarness(): {
  readonly reporter: BehaviorAuditProgressReporter
  readonly lines: string[]
} {
  const lines: string[] = []
  const reporter = createTextProgressReporter({
    log: mock((line: string) => {
      lines.push(line)
    }),
  })

  return { reporter, lines }
}

function emitAll(reporter: BehaviorAuditProgressReporter, events: readonly ProgressEvent[]): void {
  for (const event of events) {
    reporter.emit(event)
  }
  reporter.end()
}

describe('behavior-audit progress reporter', () => {
  test('renders stable item identity and success lines from item start metadata', () => {
    const { reporter, lines } = createHarness()

    emitAll(reporter, [
      {
        kind: 'item-start',
        phase: 'phase1',
        itemId: 'tests/group-settings/dispatch.test.ts::suite > fallback case',
        context: 'tests/group-settings/dispatch.test.ts',
        title: 'fallback case',
        index: 2,
        total: 2,
      },
      {
        kind: 'item-start',
        phase: 'phase1',
        itemId: 'tests/group-settings/dispatch.test.ts::suite > authFailed creates correct structure',
        context: 'tests/group-settings/dispatch.test.ts',
        title: 'authFailed creates correct structure',
        index: 1,
        total: 2,
      },
      {
        kind: 'item-finish',
        phase: 'phase1',
        itemId: 'tests/group-settings/dispatch.test.ts::suite > authFailed creates correct structure',
        context: 'wrong-context.ts',
        title: 'wrong title',
        outcome: {
          kind: 'done',
          usage: {
            inputTokens: 734,
            outputTokens: 171,
            toolCalls: 0,
          },
          elapsedMs: 17_100,
        },
      },
      {
        kind: 'item-finish',
        phase: 'phase1',
        itemId: 'tests/group-settings/dispatch.test.ts::suite > fallback case',
        context: 'ignored-context.ts',
        title: 'ignored title',
        outcome: {
          kind: 'done',
          usage: {
            inputTokens: 200,
            outputTokens: 40,
            toolCalls: 1,
          },
          elapsedMs: 2_000,
        },
      },
    ])

    expect(lines).toEqual([
      '[Phase 1] [tests/group-settings/dispatch.test.ts] [1/2] "authFailed creates correct structure" — 0 tools, 905 tok in 17.1s (10 tok/s) ✓',
      '[Phase 1] [tests/group-settings/dispatch.test.ts] [2/2] "fallback case" — 1 tool, 240 tok in 2.0s (20 tok/s) ✓',
    ])
  })

  test('renders failure, skipped, reused, and artifact lines with attribution', () => {
    const { reporter, lines } = createHarness()

    emitAll(reporter, [
      {
        kind: 'item-start',
        phase: 'phase2a',
        itemId: 'behavior-1',
        context: 'tests/tools/sample.test.ts',
        title: 'suite > first case',
        index: 1,
        total: 3,
      },
      {
        kind: 'item-start',
        phase: 'phase2a',
        itemId: 'behavior-2',
        context: 'tests/tools/sample.test.ts',
        title: 'suite > second case',
        index: 2,
        total: 3,
      },
      {
        kind: 'item-start',
        phase: 'phase3',
        itemId: 'feature-1',
        context: 'tools::selected-case',
        title: 'Selected Case',
        index: 1,
        total: 1,
      },
      {
        kind: 'item-finish',
        phase: 'phase2a',
        itemId: 'behavior-1',
        context: 'tests/tools/sample.test.ts',
        title: 'suite > first case',
        outcome: {
          kind: 'failed',
          detail: 'classification failed after retries',
        },
      },
      {
        kind: 'item-finish',
        phase: 'phase2a',
        itemId: 'behavior-2',
        context: 'tests/tools/sample.test.ts',
        title: 'suite > second case',
        outcome: {
          kind: 'skipped',
          detail: 'max retries reached',
        },
      },
      {
        kind: 'item-finish',
        phase: 'phase3',
        itemId: 'feature-1',
        context: 'tools::selected-case',
        title: 'Selected Case',
        outcome: {
          kind: 'reused',
          detail: 'already evaluated',
        },
      },
      {
        kind: 'artifact-write',
        phase: 'phase1',
        context: 'tests/group-settings/dispatch.test.ts',
        detail: 'wrote 7 behaviors',
      },
    ])

    expect(lines).toEqual([
      '[Phase 2a] [tests/tools/sample.test.ts] [1/3] "suite > first case" — classification failed after retries ✗',
      '[Phase 2a] [tests/tools/sample.test.ts] [2/3] "suite > second case" — max retries reached (skipped)',
      '[Phase 3] [tools::selected-case] [1/1] "Selected Case" — already evaluated (reused)',
      '[Phase 1] [tests/group-settings/dispatch.test.ts] wrote 7 behaviors',
    ])
  })

  test('removes completed item metadata so later events cannot reuse stale start identity', () => {
    const { reporter, lines } = createHarness()

    emitAll(reporter, [
      {
        kind: 'item-start',
        phase: 'phase1',
        itemId: 'tests/tools/sample.test.ts::suite > selected case',
        context: 'tests/tools/sample.test.ts',
        title: 'selected case',
        index: 3,
        total: 9,
      },
      {
        kind: 'item-finish',
        phase: 'phase1',
        itemId: 'tests/tools/sample.test.ts::suite > selected case',
        context: 'ignored-after-start.ts',
        title: 'ignored after start',
        outcome: {
          kind: 'done',
          usage: {
            inputTokens: 100,
            outputTokens: 50,
            toolCalls: 2,
          },
          elapsedMs: 4_200,
        },
      },
      {
        kind: 'item-finish',
        phase: 'phase1',
        itemId: 'tests/tools/sample.test.ts::suite > selected case',
        context: 'fallback-context.ts',
        title: 'fallback title',
        outcome: {
          kind: 'failed',
          detail: 'stale start metadata was not reused',
        },
      },
    ])

    expect(lines).toEqual([
      '[Phase 1] [tests/tools/sample.test.ts] [3/9] "selected case" — 2 tools, 150 tok in 4.2s (12 tok/s) ✓',
      '[Phase 1] [fallback-context.ts] "fallback title" — stale start metadata was not reused ✗',
    ])
  })

  test('keeps active items with the same itemId distinct across phases and contexts', () => {
    const { reporter, lines } = createHarness()

    emitAll(reporter, [
      {
        kind: 'item-start',
        phase: 'phase1',
        itemId: 'shared-item',
        context: 'tests/group-settings/dispatch.test.ts',
        title: 'phase 1 version',
        index: 1,
        total: 4,
      },
      {
        kind: 'item-start',
        phase: 'phase3',
        itemId: 'shared-item',
        context: 'tools::dispatch-auth',
        title: 'phase 3 version',
        index: 4,
        total: 9,
      },
      {
        kind: 'item-finish',
        phase: 'phase1',
        itemId: 'shared-item',
        context: 'ignored-phase1-context.ts',
        title: 'ignored phase1 title',
        outcome: {
          kind: 'done',
          usage: {
            inputTokens: 20,
            outputTokens: 10,
            toolCalls: 0,
          },
          elapsedMs: 500,
        },
      },
      {
        kind: 'item-finish',
        phase: 'phase3',
        itemId: 'shared-item',
        context: 'ignored-phase3-context.ts',
        title: 'ignored phase3 title',
        outcome: {
          kind: 'reused',
          detail: 'already evaluated',
        },
      },
    ])

    expect(lines).toEqual([
      '[Phase 1] [tests/group-settings/dispatch.test.ts] [1/4] "phase 1 version" — 0 tools, 30 tok in 500ms (20 tok/s) ✓',
      '[Phase 3] [tools::dispatch-auth] [4/9] "phase 3 version" — already evaluated (reused)',
    ])
  })

  test('cleans up same-phase cross-context duplicates deterministically when finish context does not match exactly', () => {
    const { reporter, lines } = createHarness()

    emitAll(reporter, [
      {
        kind: 'item-start',
        phase: 'phase1',
        itemId: 'shared-same-phase',
        context: 'tests/a.test.ts',
        title: 'first started item',
        index: 1,
        total: 2,
      },
      {
        kind: 'item-start',
        phase: 'phase1',
        itemId: 'shared-same-phase',
        context: 'tests/b.test.ts',
        title: 'second started item',
        index: 2,
        total: 2,
      },
      {
        kind: 'item-finish',
        phase: 'phase1',
        itemId: 'shared-same-phase',
        context: 'finish-without-exact-context.ts',
        title: 'fallback finish title',
        outcome: {
          kind: 'failed',
          detail: 'uses fallback when duplicate match is ambiguous',
        },
      },
      {
        kind: 'item-finish',
        phase: 'phase1',
        itemId: 'shared-same-phase',
        context: 'tests/b.test.ts',
        title: 'ignored exact finish title',
        outcome: {
          kind: 'reused',
          detail: 'remaining duplicate still matches exact context',
        },
      },
      {
        kind: 'item-finish',
        phase: 'phase1',
        itemId: 'shared-same-phase',
        context: 'fallback-after-cleanup.ts',
        title: 'post-cleanup fallback title',
        outcome: {
          kind: 'skipped',
          detail: 'ambiguous duplicate did not linger in state',
        },
      },
    ])

    expect(lines).toEqual([
      '[Phase 1] [finish-without-exact-context.ts] "fallback finish title" — uses fallback when duplicate match is ambiguous ✗',
      '[Phase 1] [tests/b.test.ts] [2/2] "second started item" — remaining duplicate still matches exact context (reused)',
      '[Phase 1] [fallback-after-cleanup.ts] "post-cleanup fallback title" — ambiguous duplicate did not linger in state (skipped)',
    ])
  })

  test('end clears in-flight state so later emits cannot reuse stale start metadata', () => {
    const { reporter, lines } = createHarness()

    reporter.emit({
      kind: 'item-start',
      phase: 'phase1',
      itemId: 'shutdown-item',
      context: 'tests/shutdown.test.ts',
      title: 'started before shutdown',
      index: 7,
      total: 8,
    })
    reporter.end()
    reporter.emit({
      kind: 'item-finish',
      phase: 'phase1',
      itemId: 'shutdown-item',
      context: 'post-end-context.ts',
      title: 'post-end fallback title',
      outcome: {
        kind: 'failed',
        detail: 'state cleared on shutdown',
      },
    })

    expect(lines).toEqual(['[Phase 1] [post-end-context.ts] "post-end fallback title" — state cleared on shutdown ✗'])
  })

  test('resolves explicit listr2 selection to text when the environment does not support it', () => {
    expect(resolveProgressRenderer({ renderer: 'listr2', isTTY: false, isTestEnvironment: false })).toBe('text')
    expect(resolveProgressRenderer({ renderer: 'listr2', isTTY: true, isTestEnvironment: true })).toBe('text')
    expect(resolveProgressRenderer({ renderer: 'listr2', isTTY: true, isTestEnvironment: false })).toBe('listr2')
  })

  test('createProgressReporter falls back to deterministic text output when listr2 is unsupported', () => {
    const lines: string[] = []
    const reporter = createProgressReporter({
      renderer: 'listr2',
      isTTY: false,
      isTestEnvironment: false,
      log: (line) => {
        lines.push(line)
      },
    })

    emitAll(reporter, [
      {
        kind: 'item-start',
        phase: 'phase2b',
        itemId: 'task-creation',
        context: 'task-creation',
        title: 'task-creation',
        index: 1,
        total: 1,
      },
      {
        kind: 'item-finish',
        phase: 'phase2b',
        itemId: 'task-creation',
        context: 'task-creation',
        title: 'task-creation',
        outcome: {
          kind: 'done',
          usage: {
            inputTokens: 200,
            outputTokens: 100,
            toolCalls: 2,
          },
          elapsedMs: 2_000,
        },
      },
    ])

    expect(lines).toEqual(['[Phase 2b] [task-creation] [1/1] "task-creation" — 2 tools, 300 tok in 2.0s (50 tok/s) ✓'])
  })
})
