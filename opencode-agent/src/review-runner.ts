// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { Logger } from './logger.js'
import { modelRef } from './openai-config.js'
import type { OpenAiSettings } from './openai-config.js'
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
}

export interface RunReviewLoopOptions {
  settings: ReviewLoopSettings
  /** Approved plan markdown, written to disk because the CLI takes `--plan`. */
  plan: string
  run: CommandRunner
  /** Extra environment for the spawned process — carries the OpenCode config. */
  env: Record<string, string>
  log: Logger
  timeoutMs: number
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

/**
 * Runs the review loop over the working tree. A non-zero exit is not thrown
 * here: the caller decides whether a red loop blocks delivery, and either way
 * the summary belongs on the issue.
 */
export const runReviewLoop = async (options: RunReviewLoopOptions): Promise<ReviewRunResult> => {
  const { settings, log } = options

  if (settings.command === null) {
    log.warn({ repoRoot: settings.repoRoot }, 'No review loop configured; skipping the review')
    return { outcome: 'unavailable', summary: 'No review loop is configured for this repository.', exitCode: 0 }
  }

  const { planPath, configPath } = await writeReviewInputs(settings, options.plan)
  log.info({ planPath, configPath, maxRounds: settings.maxRounds }, 'Starting review loop')

  const result = await options.run(
    [...settings.command, '--config', configPath, '--plan', planPath, '--repo', settings.repoRoot],
    { cwd: settings.repoRoot, env: options.env, timeoutMs: options.timeoutMs },
  )

  const summary = extractSummary(result)
  log.info({ exitCode: result.exitCode }, 'Review loop finished')

  return { outcome: result.exitCode === 0 ? 'passed' : 'failed', summary, exitCode: result.exitCode }
}
