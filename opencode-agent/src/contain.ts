// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { memoizeAgent } from './agent-handle.js'
import type { AgentHandle } from './agent-handle.js'
import type { AgentSession } from './agent-session.js'
import { createClaudeAgent as defaultClaudeAgent } from './claude-adapter.js'
import type { ClaudeAgentOptions } from './claude-adapter.js'
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
import type { ReplyDeps } from './reply-buffer.js'
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
   * The claude-route seam, the `createAgent` doctrine on the second backend:
   * selected only when `AGENT_BACKEND=claude`, tested through this injection
   * point and defaulting to the real adapter.
   */
  createClaudeAgent?: (options: ClaudeAgentOptions) => Promise<AgentSession>
  /**
   * The run's clock, defaulting to the real one. A seam because three things read
   * it — the status comment's start time, the cascade's job-deadline check and the
   * per-turn bound — and a bound reading `Date.now()` is one no test can stand on
   * either side of.
   */
  now?: () => number
}

export interface Contained {
  /**
   * The loopback credential proxy, or `null` on the claude route — nothing
   * there speaks to a gateway, so the one teardown call site gates on it.
   */
  proxy: ProviderProxy | null
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
  // The health bound beside the clock one, from `AGENT_STALL_TIMEOUT_MS`: a
  // turn that has made no progress for this long while the provider keeps
  // failing it is aborted as a stall, long before the cap above would fire.
  // Not shrunk to fit the job — the window is a property of the provider's
  // behaviour, not of the runner's remaining clock, and shrinking it would
  // make the bound fiercer exactly when the job is richest in excuses to stop.
  stallTimeoutMs: contained.stallTimeoutMs,
  // The same clock the per-turn bound reads, so the stamp the tracker keeps
  // and the instant it is judged against cannot disagree.
  now: clock,
  log: input.log,
  transcript: input.transcript,
})

/** The claude session's options — plain values crossing the seam (design D5). */
const claudeSessionOptions = ({
  input,
  contained,
  clock,
}: {
  input: ContainInput
  contained: PipelineConfig
  clock: () => number
}): ClaudeAgentOptions => {
  const credential = contained.claudeCredential
  if (credential === null) throw new Error('The claude route carries no credential — loadConfig guarantees one')

  const profiles = contained.openai.profiles
  return {
    directory: contained.repoRoot,
    // The contained settings, carrying the placeholder key: only `provider` and
    // `model` are read, and design D5's rule is that the *credential* never
    // crosses this seam — not the model's name.
    pricing: contained.openai,
    knobs: {
      model: contained.openai.model,
      lightModel: profiles?.light ?? null,
      planEffort: profiles?.planEffort ?? null,
      proposeEffort: profiles?.proposeEffort ?? null,
      buildEffort: profiles?.buildEffort ?? null,
    },
    credential,
    env: input.options.env,
    log: input.log,
    transcript: input.transcript,
    // The same bounds the OpenCode session gets: the per-turn bound shrunk to
    // what is left of the job, re-read per turn, and the (no-op here) stall
    // window beside it — wired for parity, inert by design D6.
    timeoutMs: (): number => turnTimeoutMs(contained, clock()),
    stallTimeoutMs: contained.stallTimeoutMs,
    now: clock,
  }
}

/**
 * The memoized session for whichever backend this run selected.
 *
 * Memoized *before* the reply buffer, where the note in {@link contain} used to
 * say the order did not matter. It still does not for the reason that note gives
 * — the buffer is handed to every phase and the session needs none of it — but
 * the buffer's `windows` thunk reads the session, so the reference has to exist
 * first. Nothing is booted by being named: `memoizeAgent` starts nothing until
 * something asks, and a run that never prompts answers without a server.
 */
const sessionFor = ({
  input,
  contained,
  clock,
  create,
  createClaude,
}: {
  input: ContainInput
  contained: PipelineConfig
  clock: () => number
  create: (options: OpenCodeAgentOptions) => Promise<AgentSession>
  createClaude: (options: ClaudeAgentOptions) => Promise<AgentSession>
}): AgentHandle =>
  memoizeAgent(() =>
    contained.backend === 'claude'
      ? createClaude(claudeSessionOptions({ input, contained, clock }))
      : create(sessionOptions({ input, contained, clock })),
  )

/**
 * The reply channel's collaborators, with the rate-limit thunk bound to the
 * session.
 *
 * Its own function because {@link contain} is an assembly sequence and this is
 * the one member of it that reaches back into another — inlined, it pushed that
 * function past `max-lines-per-function`, which is the seam declaring itself.
 *
 * `windows` reads the whole `spend()` and keeps one field of it. Cheap and
 * deliberate: a session that never opened answers without booting one, and a
 * second seam method for the other half would be two samples of one accumulating
 * state — the thing `RunSpend` exists to avoid.
 */
const replyDeps = ({
  github,
  log,
  config,
  selfLogin,
  agent,
}: {
  github: GitHubApi
  log: Logger
  config: PipelineConfig
  selfLogin: () => Promise<string>
  agent: AgentHandle
}): ReplyDeps => ({
  github,
  log,
  config,
  selfLogin,
  windows: async () => (await agent.spend()).windows,
})

/**
 * Assembles the run with the provider credential held back.
 *
 * On the opencode route everything downstream — the in-process session and the
 * review loop's `opencode run` subprocesses — is configured with the proxy and
 * a placeholder key, because the SDK puts the config into the spawned server's
 * environment where the model's `bash` can read it. `secrets` is taken from the
 * **real** config, so scrubbing, redaction and the diff guard still know the
 * value they are protecting. On the claude route no proxy starts at all: the
 * credential goes to the spawned CLI's environment alone, and the model knobs
 * cross as plain values rather than the `OpenAiSettings` object.
 */
export const contain = async (input: ContainInput): Promise<Contained> => {
  const { config, event, log, run, options, github, createAgent, now } = input
  const secrets = pipelineSecrets(config)
  let proxy: ProviderProxy | null = null
  let contained: PipelineConfig = config
  if (config.backend !== 'claude') {
    proxy = startProviderProxy(config.openai, log)
    contained = { ...config, openai: proxiedSettings(config.openai, proxy) }
  }
  const create = createAgent ?? createOpenCodeAgent
  const createClaude = input.createClaudeAgent ?? defaultClaudeAgent
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

  const agent = sessionFor({ input, contained, clock, create, createClaude })

  const reply = createReplyBuffer(replyDeps({ github, log, config: contained, selfLogin, agent }), clock())

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
