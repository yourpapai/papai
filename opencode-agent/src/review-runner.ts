// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { BackendSelection } from './config-backend-values.js'
import type { Logger } from './logger.js'
import { modelRef } from './openai-config.js'
import type { OpenAiSettings } from './openai-config.js'
import type { TranscriptSink } from './progress.js'
import { describeFailure, extractSummary, reviewOutcome, type ReviewRunResult } from './review-outcome.js'
import { collectLoopTranscript, realTranscriptFiles, reportLine } from './review-transcript.js'
import type { TranscriptFiles } from './review-transcript.js'
import type { CommandRunner } from './shell.js'

export {
  describeFailure,
  extractSummary,
  REVIEW_STOPPED_EXIT_CODE,
  type ReviewOutcome,
  type ReviewRunResult,
} from './review-outcome.js'

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
  /**
   * The budget the loop is **told** about, shorter than the one it is killed at.
   *
   * See `reviewBudget`: the gap between the two is what publishing the last fix,
   * writing the summary and printing it costs, and handing the loop the shorter
   * figure is the difference between a stop it carries out and a kill it is
   * subjected to.
   */
  softStopMs: number
  /**
   * Who the loop's commits are by — the same identity this pipeline's own
   * commits carry.
   *
   * Not decoration. A hosted runner has no `user.name` in any config file, so
   * `git commit` inside the loop's worktree fails with *Author identity unknown*
   * and the fix is recorded as `needs_human` with git's advice pasted into the
   * reasoning. Run 31803380299 lost an accepted `high`-severity finding exactly
   * that way, having already paid for the turn that wrote it.
   */
  commitAuthor: { name: string; email: string }
  /**
   * Which backend the loop's role subprocesses run on — the job's own route,
   * handed through (design D9). On `claude` every agent block names the backend
   * and the model crosses as the plain id, never the `OpenAiSettings` object
   * whose gateway half must not reach a claude path.
   */
  backend: BackendSelection
}

/**
 * The per-role agent block: one shape for every role, differing only by route
 * (design D9). The tier the loop's role subprocesses run at rides here too
 * (design D4): every worker resolves to the primary `build` agent on the
 * opencode route — where the tier reaches it as `agent.build.variant` inside
 * `OPENCODE_CONFIG_CONTENT` — so on the claude route the same fact is written
 * into the role config each spawn reads, and the opencode branch is left alone.
 * Absent stays absent, never `null`: the loop's schema types the tier as an
 * optional string, and a written null would refuse the whole config.
 */
const roleAgentBlock = (settings: ReviewLoopSettings, subprocessTimeoutMs: number): Record<string, unknown> => {
  if (settings.backend !== 'claude') {
    return { model: modelRef(settings.openai), extraArgs: [], timeoutMs: subprocessTimeoutMs }
  }

  const effort = settings.openai.profiles?.buildEffort ?? null
  return {
    model: settings.openai.model,
    backend: 'claude',
    extraArgs: [],
    timeoutMs: subprocessTimeoutMs,
    ...(effort === null ? {} : { effort }),
  }
}

export const buildReviewLoopConfig = (settings: ReviewLoopSettings): Record<string, unknown> => {
  // No subprocess may outlive the run it is part of. The loop honours its stop
  // *between* issues, so a fixer already running when the budget expires is
  // waited for — and a fixer bounded by the pipeline's turn cap could be waited
  // for an hour past the point the loop agreed to stop, which is the whole
  // budget spent on one subprocess nobody will read the result of.
  const subprocessTimeoutMs = Math.min(settings.agentTimeoutMs, settings.softStopMs)
  const agent = roleAgentBlock(settings, subprocessTimeoutMs)

  return {
    repoRoot: settings.repoRoot,
    workDir: path.join(AGENT_WORK_DIR, 'review-loop'),
    maxRounds: settings.maxRounds,
    maxNoProgressRounds: 2,
    agentTimeoutMs: subprocessTimeoutMs,
    buildTimeoutMs: subprocessTimeoutMs,
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
    // The loop's own deadline, shorter than the kill that backs it. It stops
    // between issues and between rounds — the two boundaries where the fix in
    // hand is committed, built, merged and published — and finalizes there.
    runTimeoutMs: settings.softStopMs,
    commitAuthor: settings.commitAuthor,
    reviewer: agent,
    fixer: agent,
    matcher: agent,
    inspector: agent,
  }
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
      // The loop handles `SIGTERM` as a request to stop between issues, which is
      // what its own soft budget already asked of it a wrap-up slice ago. This
      // deadline is the answer to a loop that did not honour that, so it has to
      // be one nothing can absorb.
      killSignal: 'SIGKILL',
      onOutput: (line, stream): void => {
        reportLine(options, now, line, stream)
      },
    },
  )

  const summary = extractSummary(result)
  const failure = describeFailure(result, options.timeoutMs)
  const outcome = reviewOutcome(result.exitCode)
  log.info({ exitCode: result.exitCode, outcome, timedOut: result.timedOut === true, failure }, 'Review loop finished')

  await collectTrace(options, now)

  return { outcome, summary, exitCode: result.exitCode, failure }
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
