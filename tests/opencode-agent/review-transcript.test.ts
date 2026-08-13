// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { TranscriptRow } from '../../opencode-agent/src/activity-detail.js'
import type { LogFields, Logger } from '../../opencode-agent/src/logger.js'
import { collectLoopTranscript } from '../../opencode-agent/src/review-transcript.js'
import type { TranscriptFiles } from '../../opencode-agent/src/review-transcript.js'

const quietLogger = (): { logger: Logger; warnings: string[] } => {
  const warnings: string[] = []
  const nothing = (): void => {}
  return {
    logger: {
      debug: nothing,
      info: nothing,
      warn: (_fields: LogFields, message: string): void => {
        warnings.push(message)
      },
      error: nothing,
    },
    warnings,
  }
}

const collect = async (
  files: TranscriptFiles,
  maxLines?: number,
): Promise<{ rows: TranscriptRow[]; warnings: string[] }> => {
  const rows: TranscriptRow[] = []
  const log = quietLogger()

  await collectLoopTranscript({
    workDir: '/repo/.opencode-agent/review-loop',
    transcript: {
      write: (row): void => {
        rows.push(row)
      },
    },
    files,
    log: log.logger,
    now: () => 0,
    maxLines,
  })

  return { rows, warnings: log.warnings }
}

describe('collectLoopTranscript', () => {
  test("folds the newest run's trace into the encrypted transcript", async () => {
    const read: string[] = []
    const files: TranscriptFiles = {
      listRuns: () => Promise.resolve(['2026-08-13T03-00-00-000Z-aaaa', '2026-08-13T09-00-00-000Z-bbbb']),
      readText: (path) => {
        read.push(path)
        return Promise.resolve('{"event":"round_start"}\n{"event":"fix_complete"}\n')
      },
    }

    const { rows } = await collect(files)

    // The newest run, picked lexically: the id starts with an ISO timestamp.
    expect(read).toEqual(['/repo/.opencode-agent/review-loop/runs/2026-08-13T09-00-00-000Z-bbbb/trace.jsonl'])
    expect(rows.map((row) => row.detail)).toEqual(['{"event":"round_start"}', '{"event":"fix_complete"}'])
    expect(rows[0]?.tool).toBe('review-loop-trace')
  })

  test('keeps the tail when a long run wrote more than the bound', async () => {
    const lines = Array.from({ length: 10 }, (_, index) => `line-${index}`).join('\n')
    const files: TranscriptFiles = {
      listRuns: () => Promise.resolve(['run-1']),
      readText: () => Promise.resolve(lines),
    }

    const { rows } = await collect(files, 3)

    expect(rows.map((row) => row.detail)).toEqual(['line-7', 'line-8', 'line-9'])
  })

  test('a run that left no trace is not an error', async () => {
    const files: TranscriptFiles = {
      listRuns: () => Promise.resolve([]),
      readText: () => Promise.reject(new Error('should not be read')),
    }

    const { rows, warnings } = await collect(files)

    expect(rows).toEqual([])
    expect(warnings).toEqual([])
  })

  test('an unreadable trace warns once and never throws', async () => {
    const files: TranscriptFiles = {
      listRuns: () => Promise.resolve(['run-1']),
      readText: () => Promise.reject(new Error('ENOENT')),
    }

    const { rows, warnings } = await collect(files)

    expect(rows).toEqual([])
    expect(warnings).toHaveLength(1)
  })
})
