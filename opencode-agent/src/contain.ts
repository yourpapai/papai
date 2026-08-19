// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { memoizeAgent } from './agent-handle.js'
import type { AgentHandle } from './agent-handle.js'
import type { MainOptions } from './cli-args.js'
import type { PipelineConfig } from './config.js'
import { assembleDeps, memoize } from './deps.js'
import type { GitHubApi } from './github.js'
import { resolveSelfLogin } from './identity.js'
import type { Logger } from './logger.js'
import { createOpenCodeAgent } from './opencode-adapter.js'
import type { OpenCodeAgent, OpenCodeAgentOptions } from './opencode-adapter.js'
import type { PhaseDeps } from './phase-context.js'
import type { TranscriptSink } from './progress.js'
import { proxiedSettings, startProviderProxy } from './provider-proxy.js'
import type { ProviderProxy } from './provider-proxy.js'
import { createReplyBuffer } from './reply-buffer.js'
import { pipelineSecrets } from './secrets.js'
import type { CommandRunner } from './shell.js'
import { turnTimeoutMs } from './time-budget.js'
import type { TriggerEvent } from './trigger-events.js'

/**
 * Assembling a run with the provider credential held back, split from
 * `index.ts` when the transcript lifecycle pushed the entry point past
 * `max-lines`. `index.ts` owns the CLI; this owns the containment. Re-exported
 * from `index.ts`, so callers keep naming one module.
 */

export interface ContainInput {
  config: PipelineConfig
  event: TriggerEvent
  log: Logger
  run: CommandRunner
  options: MainOptions
  /**
   * The GitHub adapter, built by the caller.
   *
   * It used to be built here, and moved out when the pull-request door arrived:
   * a comment typed on a pull request names no issue, so `runCli` has to ask
   * `getPullRequestHead` which issue this run is even about *before* there is a
   * `TriggerEvent` to contain. Passed in rather than built twice, because two
   * construction sites for one credentialled client is how one of them ends up
   * missing the secrets that redact its outbound text.
   */
  github: GitHubApi
  /**
   * The encrypted debug transcript, when the run has an `AGENT_LOG_KEY`.
   *
   * Typed as the minimal sink rather than `DebugTranscript`: `contain` only
   * ever *writes* to it — the close that flushes it lives in `runCli`'s
   * teardown, beside the proxy and the session it outranks in shutdown order.
   */
  transcript?: TranscriptSink
  /**
   * Seam for tests, defaulting to the real adapter.
   *
   * Here because the recurring bug in this workspace is not a broken adapter but
   * a correct one that is never handed anything — outbound redaction, the
   * provider proxy and the logger's secret list each shipped that way. What
   * `contain` passes to the session is only observable through a seam.
   */
  createAgent?: (options: OpenCodeAgentOptions) => Promise<OpenCodeAgent>
  /**
   * The run's clock, defaulting to the real one. A seam because three things read
   * it — the status comment's start time, the cascade's job-deadline check and the
   * per-turn bound — and a bound reading `Date.now()` is one no test can stand on
   * either side of.
   */
  now?: () => number
}

export interface Contained {
  proxy: ProviderProxy
  agent: AgentHandle
  deps: PhaseDeps
}

/**
 * What the session is opened with — the one place most of this file's reasoning
 * lives, and its own function so `contain` stays inside
 * `max-lines-per-function`.
 *
 * Takes the whole `ContainInput` rather than eight arguments, plus the three
 * things `contain` derived before it: a parameter list restating the input's
 * fields is the input's shape kept in step by hand.
 */
const sessionOptions = ({
  input,
  contained,
  clock,
}: {
  input: ContainInput
  contained: PipelineConfig
  clock: () => number
}): OpenCodeAgentOptions => ({
  directory: contained.repoRoot,
  openai: contained.openai,
  sessionTitle: `issue-${input.event.issueNumber}`,
  // Shrunk to fit what is left of the job, never the bare `AGENT_TIMEOUT_MS`: a
  // per-turn cap outliving the runner is a bound that fires after the process
  // is gone, which posts nothing. A **function**, so it is re-read for every turn
  // rather than once when the session boots: this session is memoized for the
  // whole job and the job now runs a turn per plan step, so a number computed at
  // the first prompt would hand the last step a bound sized for a clock half an
  // hour stale — and a bound that outlives the runner posts nothing at all, which
  // is exactly what it exists to prevent.
  timeoutMs: (): number => turnTimeoutMs(contained, clock()),
  log: input.log,
  transcript: input.transcript,
})

/**
 * Assembles the run with the provider credential held back.
 *
 * Everything downstream — the in-process session and the review loop's
 * `opencode run` subprocesses — is configured with the proxy and a placeholder
 * key, because the SDK puts the config into the spawned server's environment
 * where the model's `bash` can read it. `secrets` is taken from the **real**
 * config, so scrubbing, redaction and the diff guard still know the value they
 * are protecting.
 */
export const contain = async (input: ContainInput): Promise<Contained> => {
  const { config, event, log, run, options, github, createAgent, now } = input
  const secrets = pipelineSecrets(config)
  const proxy = startProviderProxy(config.openai, log)
  const contained: PipelineConfig = { ...config, openai: proxiedSettings(config.openai, proxy) }
  const create = createAgent ?? createOpenCodeAgent
  const clock = now ?? ((): number => Date.now())

  // The reply buffer is built before the session because `assembleDeps` hands it
  // to every phase, not because the session needs it: the heartbeat used to feed
  // the live status comment its ticks, and with the comment posted once at the
  // end there is nothing live to feed. The buffer collects sections in memory
  // and writes through the GitHub adapter exactly once, when the run settles.
  // Resolved once and shared: the buffer checks the author GitHub recorded
  // against this same answer, and two memoizations would be two `GET /user`
  // calls that could disagree.
  const selfLogin = memoize(() => resolveSelfLogin({ override: contained.selfLoginOverride, api: github, log }))
  const reply = createReplyBuffer({ github, log, config: contained, selfLogin }, clock())

  const agent = memoizeAgent(() => create(sessionOptions({ input, contained, clock })))

  const env = options.env
  const deps = await assembleDeps({
    selfLogin,
    config: contained,
    secrets,
    event,
    env,
    run,
    log,
    agent,
    github,
    reply,
    now: clock,
    transcript: input.transcript,
  })

  return { proxy, agent, deps }
}
