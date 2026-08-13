// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mkdir, writeFile as writeFileNode, readFile as readFileNode } from 'node:fs/promises'
import path from 'node:path'

import type { AgentHandle } from './agent-handle.js'
import type { CheckRunner } from './check-loop.js'
import { createCiGroups } from './ci-groups.js'
import { resolveBaseBranch } from './config-discovery.js'
import type { Env, PipelineConfig } from './config.js'
import { createGit } from './git.js'
import type { GitHubApi } from './github.js'
import { resolveSelfLogin } from './identity.js'
import type { Logger } from './logger.js'
import { loadPhaseSkills } from './obra-skills.js'
import type { SkillDocument } from './obra-skills.js'
import { opencodeConfigEnv } from './openai-config.js'
import { createOpenSpecDriver } from './openspec-driver.js'
import type { PhaseDeps, RunReview } from './phase-context.js'
import type { TranscriptSink } from './progress.js'
import { runReviewLoop } from './review-runner.js'
import type { CommandRunner } from './shell.js'
import type { StatusReporter } from './status-reporter.js'
import { turnTimeoutMs } from './time-budget.js'
import type { TriggerEvent } from './trigger-events.js'
import type { Phase } from './types.js'

/**
 * Wiring only: every external boundary the phases touch, built from config.
 *
 * Split from `index.ts`, which owns the CLI entry — flags, credential
 * containment and process lifetime. The two change for different reasons.
 */

/**
 * Writes an artifact, creating the directories it needs.
 *
 * `openspec new change` scaffolds a folder holding `.openspec.yaml` and nothing
 * else, so every artifact but the flat ones is the first thing in its directory
 * — a delta spec lands at `specs/<capability-path>/spec.md`, up to two levels
 * deep, and a bare `writeFile` there fails with the same `ENOENT` the glob path
 * failed with. The drafter chooses the path (`glob-output.ts` judges it), so
 * this is the one place that can know the directory has to exist.
 */
const writeArtifactFile = async (filePath: string, content: string): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFileNode(filePath, content, 'utf8')
}

const makeCheckRunner =
  (run: CommandRunner, config: PipelineConfig): CheckRunner =>
  (check) =>
    run(check.argv, { cwd: config.repoRoot, timeoutMs: config.agentTimeoutMs })

interface ReviewRunnerInput {
  run: CommandRunner
  config: PipelineConfig
  log: Logger
  now: () => number
  transcript: TranscriptSink | undefined
}

const makeReviewRunner =
  ({ run, config, log, now, transcript }: ReviewRunnerInput): RunReview =>
  (plan, onFixMerged) =>
    runReviewLoop({
      settings: {
        repoRoot: config.repoRoot,
        command: config.reviewCommand,
        openai: config.openai,
        checkCommand: config.checkCommand,
        maxRounds: config.reviewMaxRounds,
        poolSize: config.reviewPoolSize,
        agentTimeoutMs: config.agentTimeoutMs,
      },
      plan,
      run,
      env: opencodeConfigEnv(config.openai),
      log,
      // Shrunk to fit what is left of the job, exactly as a model turn's bound
      // is and for the same reason: `AGENT_TIMEOUT_MS` alone let the loop run
      // past the moment the runner is taken away, which posts nothing at all.
      // A loop stopped by its own deadline is a failure the pipeline can report.
      timeoutMs: turnTimeoutMs(config, now()),
      transcript,
      onFixMerged,
    })

const makeSkillLoader = (config: PipelineConfig, log: Logger): ((phase: Phase) => Promise<SkillDocument[]>) => {
  const cache = new Map<Phase, Promise<SkillDocument[]>>()

  return (phase) => {
    const cached = cache.get(phase)
    if (cached !== undefined) return cached
    const loading = loadPhaseSkills(phase, { repoRoot: config.repoRoot, roots: config.skillRoots, log })
    cache.set(phase, loading)
    return loading
  }
}

/**
 * Defers a one-shot async lookup until something asks for it, then keeps the
 * answer. Used for the base branch, whose resolution can cost a round trip.
 */
const memoize = <T>(load: () => Promise<T>): (() => Promise<T>) => {
  let pending: Promise<T> | null = null
  return () => (pending ??= load())
}

export interface DepsInput {
  config: PipelineConfig
  /** Real credential values, which `config` deliberately no longer carries. */
  secrets: readonly string[]
  event: TriggerEvent
  env: Env
  run: CommandRunner
  log: Logger
  agent: AgentHandle
  /**
   * Built by `runCli` rather than here, unlike every other boundary below.
   *
   * The status reporter needs it, and the OpenCode session needs the *reporter*
   * — its heartbeat is what feeds the live status comment — so the session
   * cannot be built before both. One of the three has to be assembled outside
   * this function, and the GitHub adapter is the one with no other dependency.
   * It has since moved one step further out again, past `contain`: a comment
   * typed on a pull request names no issue, so the adapter has to answer
   * `getPullRequestHead` before there is a `TriggerEvent` to assemble against.
   */
  github: GitHubApi
  status: StatusReporter
  /**
   * The run's clock, built by `runCli` for the same reason `github` is: the status
   * reporter and the per-turn deadline are both handed it before this function
   * runs, and three readers of one clock have to be one clock.
   */
  now: () => number
  /**
   * The encrypted transcript, when the run has a key.
   *
   * Here as well as on the session, because the review phase opens no session:
   * its work happens in `opencode run` subprocesses, so the only account of it
   * this process ever sees is what they print — and without this the phase that
   * can spend the whole job left nothing in the artefact a maintainer is told
   * to read.
   */
  transcript?: TranscriptSink
}

export const assembleDeps = ({
  config,
  secrets,
  event,
  env,
  run,
  log,
  agent,
  github,
  status,
  now,
  transcript,
}: DepsInput): PhaseDeps => {
  const git = createGit({
    run,
    cwd: config.repoRoot,
    authorName: config.commitAuthorName,
    authorEmail: config.commitAuthorEmail,
    limits: config.diffLimits,
    secrets,
    log,
    credential: { remote: config.gitRemoteBase, token: config.githubToken },
  })

  return {
    github,
    status,
    git,
    runCheck: makeCheckRunner(run, config),
    runReview: makeReviewRunner({ run, config, log, now, transcript }),
    openspec: createOpenSpecDriver({ runner: run, cwd: config.repoRoot }),
    agent: agent.get,
    tokensUsed: agent.tokensUsed,
    skills: makeSkillLoader(config, log),
    writeFile: (filePath, content) => writeArtifactFile(filePath, content),
    readFile: (filePath) => readFileNode(filePath, 'utf8'),
    baseBranch: memoize(() =>
      resolveBaseBranch(env, { fromEvent: event.defaultBranch, fromGit: () => git.defaultBranch() }),
    ),
    selfLogin: memoize(() => resolveSelfLogin({ override: config.selfLoginOverride, api: github, log })),
    now,
    groups: createCiGroups(),
    config,
    log,
  }
}
