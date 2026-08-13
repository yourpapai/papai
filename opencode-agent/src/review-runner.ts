// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { Logger } from './logger.js'
import { modelRef } from './openai-config.js'
import type { OpenAiSettings } from './openai-config.js'
import type { TranscriptSink } from './progress.js'
import { collectLoopTranscript, realTranscriptFiles, reportLine } from './review-transcript.js'
import type { TranscriptFiles } from './review-transcript.js'
import type { CommandResult, CommandRunner } from './shell.js'

/**
 * Drives the repository's own `review-loop/` workspace instead of a bespoke
 * loop.
 *
 * `review-loop` already implements the hard parts — a durable issue ledger,
 * multi-round reviewer/fixer cycles, worktree isolation, a build gate and a
 * merge back into the working branch — and it is separately tested and
 * maintained. Reimplementing a thinner version of that here would mean two
 * loops to keep in step. This module's only job is to generate a config, hand
 * over the approved plan, and translate the exit code back into a phase result.
 */

/** Where generated inputs and the loop's own state live, relative to the repo. */
export const AGENT_WORK_DIR = '.opencode-agent'

export interface ReviewLoopSettings {
  repoRoot: string
  /** Argv that runs the review loop, or `null` when this repo has none. */
  command: readonly string[] | null
  openai: OpenAiSettings
  /** Shell command the loop runs as its build gate between rounds. */
  checkCommand: string
  maxRounds: number
  poolSize: number
  agentTimeoutMs: number
}

/**
 * Builds `review-loop`'s config. Every agent role gets the same model because
 * the pipeline is configured with exactly one endpoint; the workspace's ability
 * to mix models per role is deliberately left unused rather than invented here.
 */
export const buildReviewLoopConfig = (settings: ReviewLoopSettings): Record<string, unknown> => {
  const agent = { model: modelRef(settings.openai), extraArgs: [], timeoutMs: settings.agentTimeoutMs }

  return {
    repoRoot: settings.repoRoot,
    workDir: path.join(AGENT_WORK_DIR, 'review-loop'),
    maxRounds: settings.maxRounds,
    maxNoProgressRounds: 2,
    agentTimeoutMs: settings.agentTimeoutMs,
    buildTimeoutMs: settings.agentTimeoutMs,
    poolSize: settings.poolSize,
    checkCommand: settings.checkCommand,
    // The one setting this pipeline needs and a laptop does not. The loop's
    // ordinary shape is one atomic merge at the very end, behind a build gate —
    // which on an Actions runner means a job that dies at minute 59, or a gate
    // that goes red, takes every fix with it: the commits live on a branch in a
    // checkout that is about to be deleted. Publishing each fix onto the working
    // branch as it lands is what lets `phases/review.ts` push it while the loop
    // is still running.
    mergeEachFix: true,
    reviewer: agent,
    fixer: agent,
    matcher: agent,
    inspector: agent,
  }
}

/**
 * `unavailable` is a distinct outcome, not a failure.
 *
 * The review loop is this repository's own workspace, so a checkout that does
 * not have it is not a repository whose review failed — it is one with no review
 * configured. Collapsing the two made every run in any other repository report a
 * permanently red review whose summary read `Module not found`.
 */
export type ReviewOutcome = 'passed' | 'failed' | 'unavailable'

export interface ReviewRunResult {
  outcome: ReviewOutcome
  /** The loop's own summary block, or the tail of its output when it crashed. */
  summary: string
  exitCode: number
  /**
   * One sentence naming *how* a failed loop failed, or `null` when it did not.
   *
   * The exit code alone is not an account of anything: a build gate that went
   * red, a runner deadline, a missing `bun`, a plan path that does not resolve
   * and a merge conflict are all `exit 1` with sixty lines of tail, and each has
   * a different remedy. See {@link describeFailure}.
   */
  failure: string | null
}

/** Where the loop's inputs land. A seam, so a test needs no filesystem. */
export type WriteReviewInputs = (
  settings: ReviewLoopSettings,
  plan: string,
) => Promise<{ planPath: string; configPath: string }>

export interface RunReviewLoopOptions {
  settings: ReviewLoopSettings
  /** Approved plan markdown, written to disk because the CLI takes `--plan`. */
  plan: string
  run: CommandRunner
  /** Extra environment for the spawned process — carries the OpenCode config. */
  env: Record<string, string>
  log: Logger
  timeoutMs: number
  /**
   * The maintainer-only transcript, when the run has an `AGENT_LOG_KEY`.
   *
   * The implement phase feeds this from the OpenCode event stream; the review
   * phase opens no session at all, so without this its hour of work left no
   * trace in the one artefact a maintainer debugging a run is told to read.
   */
  transcript?: TranscriptSink
  /**
   * Called each time the loop reports a fix landing on the working branch.
   *
   * The loop merges its own branch into the checkout as each fix passes
   * ({@link buildReviewLoopConfig}'s `mergeEachFix`); pushing that is the
   * caller's business, because the credential belongs to the pipeline and must
   * never reach a subprocess the model can read the environment of.
   */
  onFixMerged?: () => void
  /** Injected so a test can run the loop without touching a filesystem. */
  writeInputs?: WriteReviewInputs
  /** The same seam for the trace collection that follows the run. */
  files?: TranscriptFiles
  now?: () => number
}

const SUMMARY_TAIL_LINES = 60

/**
 * `review-loop` prints its summary to stdout before finalizing, so the tail of
 * stdout is the summary even on the runs that later fail their build gate —
 * which is exactly when the summary is worth reading.
 */
export const extractSummary = (result: CommandResult, tailLines = SUMMARY_TAIL_LINES): string => {
  const combined = `${result.stdout}\n${result.stderr}`.trim()
  if (combined.length === 0) return '(review-loop produced no output)'
  return combined.split('\n').slice(-tailLines).join('\n')
}

/** Writes the generated plan and config, returning their paths. */
export const writeReviewInputs = async (
  settings: ReviewLoopSettings,
  plan: string,
): Promise<{ planPath: string; configPath: string }> => {
  const workDir = path.join(settings.repoRoot, AGENT_WORK_DIR)
  await mkdir(workDir, { recursive: true })

  const planPath = path.join(workDir, 'plan.md')
  const configPath = path.join(workDir, 'review-loop.json')

  await writeFile(planPath, plan, 'utf8')
  await writeFile(configPath, `${JSON.stringify(buildReviewLoopConfig(settings), null, 2)}\n`, 'utf8')

  return { planPath, configPath }
}

/** The last line of `text` that says anything, or `null` for text that says nothing. */
const lastMeaningfulLine = (text: string): string | null => {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  return lines.at(-1) ?? null
}

const minutes = (ms: number): string => `${Math.round(ms / 60_000)}m`

/**
 * What went wrong, in one sentence a maintainer can act on — or `null` for a
 * loop that did not fail.
 *
 * Every branch here answers a failure that used to reach the issue as `exited 1`
 * beside sixty lines of tail, which names neither the cause nor the remedy. The
 * order matters: the deadline is asked first because a killed child's exit code
 * is whatever the signal left behind and says nothing, and the two sentences the
 * loop itself writes are matched before the fallback because they are the only
 * ones that already know why they lost the work.
 */
export const describeFailure = (result: CommandResult, timeoutMs: number): string | null => {
  if (result.exitCode === 0) return null

  if (result.timedOut === true) {
    return `the review loop timed out after ${minutes(timeoutMs)} and was killed; nothing it had not already published is lost`
  }

  if (result.exitCode === 127) {
    return `the review command could not be started (${lastMeaningfulLine(result.stderr) ?? 'no output'})`
  }

  const combined = `${result.stdout}\n${result.stderr}`
  if (combined.includes('Final build check failed')) {
    return "the loop's own build gate failed at the end of the run, so it merged nothing further"
  }
  if (combined.includes('Merge conflict while bringing')) {
    return 'the loop could not merge its branch back: it conflicts with the working branch'
  }

  const said = lastMeaningfulLine(result.stderr) ?? lastMeaningfulLine(result.stdout)
  return said === null
    ? `the review loop exited ${result.exitCode} silently`
    : `the review loop exited ${result.exitCode}: ${said}`
}

/**
 * Runs the review loop over the working tree. A non-zero exit is not thrown
 * here: the caller decides whether a red loop blocks delivery, and either way
 * the summary belongs on the issue.
 */
export const runReviewLoop = async (options: RunReviewLoopOptions): Promise<ReviewRunResult> => {
  const { settings, log } = options
  const now = options.now ?? ((): number => Date.now())

  if (settings.command === null) {
    log.warn({ repoRoot: settings.repoRoot }, 'No review loop configured; skipping the review')
    return {
      outcome: 'unavailable',
      summary: 'No review loop is configured for this repository.',
      exitCode: 0,
      failure: null,
    }
  }

  const write = options.writeInputs ?? writeReviewInputs
  const { planPath, configPath } = await write(settings, options.plan)
  log.info(
    { planPath, configPath, maxRounds: settings.maxRounds, timeoutMs: options.timeoutMs },
    'Starting review loop',
  )

  const result = await options.run(
    [...settings.command, '--config', configPath, '--plan', planPath, '--repo', settings.repoRoot],
    {
      cwd: settings.repoRoot,
      env: options.env,
      timeoutMs: options.timeoutMs,
      onOutput: (line, stream): void => {
        reportLine(options, now, line, stream)
      },
    },
  )

  const summary = extractSummary(result)
  const failure = describeFailure(result, options.timeoutMs)
  log.info({ exitCode: result.exitCode, timedOut: result.timedOut === true, failure }, 'Review loop finished')

  await collectTrace(options, now)

  return { outcome: result.exitCode === 0 ? 'passed' : 'failed', summary, exitCode: result.exitCode, failure }
}

/**
 * The loop's own trace, taken after the child is gone and before this workspace
 * is: it is the review phase's equivalent of the tool activity the implement
 * phase feeds the transcript from, and it lives in a directory the runner
 * deletes. Skipped entirely on a keyless run, which is the ordinary case.
 */
const collectTrace = async (options: RunReviewLoopOptions, now: () => number): Promise<void> => {
  if (options.transcript === undefined) return

  await collectLoopTranscript({
    workDir: path.join(options.settings.repoRoot, AGENT_WORK_DIR, 'review-loop'),
    transcript: options.transcript,
    files: options.files ?? realTranscriptFiles,
    log: options.log,
    now,
  })
}
