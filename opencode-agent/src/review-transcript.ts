// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import type { Logger } from './logger.js'
import type { TranscriptSink } from './progress.js'
import type { OutputStream } from './shell.js'
import { errorMessage } from './types.js'

/**
 * Everything the review loop says about itself, and where each of it goes.
 *
 * Two halves, both of which the review phase used to lack entirely. Line by line
 * while it runs — into the **public** Actions log, because a subprocess that
 * works for an hour in silence is indistinguishable from a hang and gets
 * cancelled, and into the **encrypted** transcript unabridged. And the loop's own
 * `trace.jsonl` once it has stopped, which is the second half:
 *
 * The implement phase leaves a transcript because it holds an OpenCode session and every
 * tool call passes through `activity.ts` on the way out. The review phase holds
 * no session at all — its work happens in `opencode run` subprocesses the
 * `review-loop/` workspace spawns — so the only thing this process ever sees is
 * what they print, and the detail a maintainer actually wants (which issue the
 * reviewer raised, what the fixer decided, which round it was) is written by the
 * loop to a file in the runner's workspace and deleted with it.
 *
 * That file is `trace.jsonl`, and this is what carries it out: **encrypted**,
 * under `AGENT_LOG_KEY`, into the same artefact the implement phase's transcript
 * rides in. It is not uploaded in the clear and must not be — an Actions artefact
 * is downloadable by anyone with repository read access, which is the whole
 * reason the transcript is encrypted at all, and a review trace carries
 * model-authored text about a codebase.
 *
 * Everything here degrades to a `warn`. It is a debugging aid riding on a phase
 * that has already done its work: a missing directory, an unreadable file or a
 * run that never got as far as writing one are all "nothing to collect", and
 * none of them is a reason to fail a review whose findings are already pushed.
 */

/**
 * The marker the loop prints when a fix is on the working branch.
 *
 * A line rather than a file or an exit code, because the loop is a subprocess
 * with one stream back to here and this has to arrive *while it runs* — the
 * whole point is that the fix is durable before the thing that kills the job
 * happens. `review-loop/src/cli.ts` writes it; the two are tested against this
 * constant on both sides.
 */
export const FIX_MERGED_MARKER = '[review-loop] published'

/** Longest line this repeats into the world-readable Actions log. */
const PUBLIC_LINE_MAX = 500

/** Longest line the encrypted transcript keeps. Generous — it is a debugging aid. */
const TRANSCRIPT_LINE_MAX = 4_000

/** What repeating one line needs, which `RunReviewLoopOptions` satisfies as it is. */
export interface LineSink {
  log: Logger
  transcript?: TranscriptSink
  onFixMerged?: () => void
}

/**
 * Repeats one line of the loop into the two places it belongs.
 *
 * The **public** Actions log, because a subprocess that runs for an hour and
 * prints nothing is indistinguishable from a hang and gets cancelled — which is
 * exactly what happened to the review of #268. The loop's non-TTY output is its
 * own progress vocabulary (rounds, decisions, counts) rather than model text,
 * and the logger redacts this pipeline's credentials by value on the way out.
 *
 * And the **encrypted** transcript, unabridged, for the same reason the implement
 * phase feeds one: the public log is bounded on purpose, and a maintainer holding
 * the key should not have to guess what the bound removed.
 */
export const reportLine = (options: LineSink, now: () => number, line: string, stream: OutputStream): void => {
  options.log.info({ source: 'review-loop', stream }, line.slice(0, PUBLIC_LINE_MAX))
  options.transcript?.write({
    time: new Date(now()).toISOString(),
    tool: 'review-loop',
    status: stream,
    detail: line.slice(0, TRANSCRIPT_LINE_MAX),
    durationMs: null,
  })
  if (line.startsWith(FIX_MERGED_MARKER)) options.onFixMerged?.()
}

/** The two filesystem reads this needs, injected so a test needs no fixtures. */
export interface TranscriptFiles {
  /** The run directories under `<workDir>/runs`, in any order. */
  listRuns: (runsDir: string) => Promise<string[]>
  readText: (filePath: string) => Promise<string>
}

export const realTranscriptFiles: TranscriptFiles = {
  listRuns: (runsDir) => readdir(runsDir),
  readText: (filePath) => readFile(filePath, 'utf8'),
}

/**
 * How much of one run's trace is kept.
 *
 * A bound rather than the whole file, for the reason the prompt budget is a
 * bound: the transcript is queued in memory and written line by line, and a
 * four-hour run with a large pool can leave a very long trace. The **tail** is
 * the half worth keeping — a run is read backwards from whatever went wrong.
 */
const DEFAULT_MAX_LINES = 2_000

export interface CollectLoopTranscriptOptions {
  /** `<repoRoot>/.opencode-agent/review-loop`, the loop's generated workDir. */
  workDir: string
  transcript: TranscriptSink
  files: TranscriptFiles
  log: Logger
  now: () => number
  maxLines?: number
}

/**
 * The newest run directory, or `null`.
 *
 * Lexical maximum, which is not a shortcut: `makeRunId` in
 * `review-loop/src/run-state.ts` prefixes the id with an ISO-8601 timestamp
 * whose punctuation is replaced, so string order *is* time order. Sorting by
 * mtime would need a `stat` per entry to learn the same thing.
 */
const newestRun = (entries: readonly string[]): string | null =>
  entries.length === 0 ? null : ([...entries].sort().at(-1) ?? null)

export const collectLoopTranscript = async (options: CollectLoopTranscriptOptions): Promise<void> => {
  const runsDir = path.join(options.workDir, 'runs')

  try {
    const runId = newestRun(await options.files.listRuns(runsDir))
    if (runId === null) return

    const tracePath = path.join(runsDir, runId, 'trace.jsonl')
    const lines = (await options.files.readText(tracePath))
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(-(options.maxLines ?? DEFAULT_MAX_LINES))

    const time = new Date(options.now()).toISOString()
    for (const line of lines) {
      options.transcript.write({ time, tool: 'review-loop-trace', status: 'trace', detail: line, durationMs: null })
    }

    options.log.debug({ runId, lines: lines.length }, "Collected the review loop's trace into the debug transcript")
  } catch (error) {
    options.log.warn(
      { runsDir, error: errorMessage(error) },
      "Could not collect the review loop's trace; the run is unaffected",
    )
  }
}
