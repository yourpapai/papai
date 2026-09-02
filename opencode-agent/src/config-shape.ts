// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { BackendSelection, ClaudeCredential } from './config-values.js'
import type { DiffLimits } from './diff-guard.js'
import type { OpenAiSettings } from './openai-config.js'

/**
 * What a run needs, as a shape — and, in the prose on each field, why.
 *
 * Split from `config.ts` when that file passed `max-lines`, along the seam it
 * already had: this is what a configured run **is**, while `config.ts` is how one
 * is read out of an environment and what it refuses. Almost all of the length here
 * is the second kind of comment — the argument for a knob's existence and its size
 * — and those change when the design does rather than when a loader does.
 *
 * `config.ts` re-exports it, so no caller names this module. Same arrangement as
 * `config-clock-values.ts`, for the same reason.
 */

export interface PipelineConfig {
  repoRoot: string
  owner: string
  repo: string
  githubToken: string
  /**
   * Which backend serves this job's model turns (`AGENT_BACKEND`).
   *
   * One job-wide selector read before anything else in `loadConfig`: every
   * route decision — credential demands, proxy or none, which adapter
   * `contain()` builds — hangs off it. The default `opencode` route is
   * byte-identical to the pre-change pipeline.
   */
  backend: BackendSelection
  /**
   * The claude route's single chosen Anthropic credential, or `null` on the
   * opencode route (where the guard never fires and nothing is rewritten).
   *
   * Carried on config so the value-based scrub, the outbound redaction and the
   * child environment all read one source; the name rides along because it is
   * the only spelling an operator or a log reader should ever see.
   */
  claudeCredential: ClaudeCredential | null
  /**
   * `AGENT_CLAUDE_ENV`, parsed — the claude route's operator-chosen child
   * environment, or `null` when unset or blank (the house absence shape).
   *
   * Carried here and **not** on `OpenAiSettings` (design D2 of
   * `claude-route-custom-env`): the knob is claude-route-only, and a field on
   * the settings object is one spread away from `OPENCODE_CONFIG_CONTENT` and
   * the review-loop subprocesses, which the spec forbids. Parsed at load on
   * both routes regardless — a malformed document fails startup whichever
   * backend the job selected, so an operator flipping `AGENT_BACKEND` later
   * cannot inherit a document that was never validated — while the entries are
   * *applied* only on the claude route.
   */
  claudeEnv: Record<string, string> | null
  /**
   * `AGENT_SELF_LOGIN`, or `null` to derive it from the token.
   *
   * Not defaulted to the owner here: that default was indistinguishable from a
   * deliberate choice, and it is wrong for every token that posts as a bot.
   * `resolveSelfLogin` owns the fallback, and warns when it takes it.
   */
  selfLoginOverride: string | null
  /** This pipeline's workflow name, so its own red runs do not re-trigger it. */
  selfWorkflowName: string
  openai: OpenAiSettings
  /**
   * Who the agent's commits claim to be. `github-actions[bot]` by default — the
   * token's real identity, whose noreply
   * `41898282+github-actions[bot]@users.noreply.github.com` verifies on GitHub.
   * Overridden by `AGENT_COMMIT_NAME` / `AGENT_COMMIT_EMAIL` (`vars.*` in
   * `agent-pipeline.yml`), which win per field over any per-run actor resolution
   * in `commit-identity.ts` (explicit > actor > service).
   */
  commitAuthorName: string
  commitAuthorEmail: string
  /** Build gate the review loop runs between rounds. */
  checkCommand: string
  /** Argv that runs the review loop, or `null` when this repo has none. */
  reviewCommand: readonly string[] | null
  reviewMaxRounds: number
  reviewPoolSize: number
  agentTimeoutMs: number
  /**
   * How long a turn may make no progress — no finished model step, no newly
   * started tool call — while provider retries or session errors accumulate,
   * before it is aborted as a provider stall. `AGENT_STALL_TIMEOUT_MS`,
   * default five minutes; `0` switches the bound off and leaves
   * {@link agentTimeoutMs} the only turn bound, exactly as it was before this
   * knob existed.
   *
   * The whole-turn deadline is a clock and this is a health check, and the
   * incident that added it was the difference: four runs burned 90 minutes
   * each inside their deadline because the gateway answered HTTP 200 and then
   * streamed nothing, and nothing in the pipeline had a question to ask about
   * *whether the turn was being served*. Both conditions are required before
   * this bound fires — the retry evidence is what separates "provider down"
   * from "one very long generation".
   */
  stallTimeoutMs: number
  /**
   * Epoch ms at which this **job** is killed by its own `timeout-minutes`, or
   * `null` when nothing has said.
   *
   * Absolute rather than a duration, because that is the only form both halves of
   * the answer survive in: the job's start comes from a first step in the
   * workflow and its length from a repository variable, and neither is knowable
   * from the other. Derived once at load, so nothing downstream has to remember
   * to add them up.
   *
   * `null` is the ordinary local case — a `--event-path` run has no Actions job
   * and no ceiling to stay under, and is bounded by {@link agentTimeoutMs} alone,
   * exactly as every run was before this existed. It is deliberately not defaulted
   * to "now plus something": `AGENT_TIMEOUT_MS` guessed at a runner cap for
   * exactly one release and this is that mistake with a clock attached.
   */
  jobDeadlineMs: number | null
  /**
   * How much of the job is held back from the work, so the stop can be reported.
   *
   * `git add`, the diff guard, the commit, the push, the comment, the state block
   * and the label are what a stop still has to do, and the observed tail for all
   * of it is about ten seconds. Reserving minutes is cheap; not reserving them is
   * the runner death this whole bound exists to replace.
   */
  teardownReserveMs: number
  /**
   * The middle slice: how long the model gets to wrap up after a turn is stopped.
   *
   * Held back from the **work**, not from the teardown reserve: the reserve buys the
   * commit, the comment and the state block that make a stop something other than a
   * silence, and a wrap-up that ate it would leave nothing to report with.
   *
   * What it buys is the handoff note, the one thing only the model that did the work
   * can write: what it finished, what remains, and what it tried that did not work.
   * A fresh session can read the diff and the plan; it cannot recover that last line.
   */
  wrapUpMs: number
  /** Model tokens one issue may spend, across every job it runs. */
  maxTokens: number
  ciFixMaxRounds: number
  /**
   * Commit attempts one commit gets, including the first, when the repository's
   * own pre-commit checks refuse it.
   *
   * Higher than `ciFixMaxRounds` on purpose, and the two are not the same
   * quantity. A CI-fix round re-runs whole check suites and costs minutes; a
   * commit repair round is one model turn over output already in hand, and what
   * it is spent against is losing the phase — a `/retry` buys a fresh job that
   * re-runs the model turn that had already succeeded. `1` disables repair.
   */
  commitRepairMaxRounds: number
  /**
   * Model turns one `/sync` conflict gets, including the first, before the
   * merge is aborted and the human remedy is reported.
   *
   * The same `ROUND_RANGE` family as {@link commitRepairMaxRounds} for the
   * same reason: a repair round is one model turn over content already in
   * hand. There is deliberately **no** persisted per-PR counter beside it —
   * `/sync` is human-initiated like `/ask`, so the token ceiling is the bound
   * that stops a maintainer spamming it, exactly as it stops a maintainer
   * spamming questions. `1` disables repair: a conflicted sync then aborts
   * and reports the remedy immediately.
   */
  syncRepairMaxRounds: number
  /** Ceiling on CI-fix rounds across the whole life of one pull request. */
  maxCiAttempts: number
  /** Ceiling on `/review` rounds across the whole life of one pull request. */
  maxReviewAttempts: number
  /**
   * Diff size, in changed lines, above which a delivery recommends `/review`.
   *
   * A threshold rather than a rule: the delivery comment names the command
   * whatever the figure is, and this only decides whether it also says it would
   * run it. Read where the comment is written rather than baked into the state
   * block, so lowering it applies to every issue in flight rather than only to
   * the ones implemented after the change.
   */
  reviewHintLines: number
  /** Above this, a FAILED issue stops auto-retrying and waits for `/retry`. */
  maxAttempts: number
  /** Ceilings a staged change set must stay under before it is committed. */
  diffLimits: DiffLimits
  /**
   * Base URL the git credential header is scoped to. Configurable because the
   * pipeline is not GitHub.com-only: an Enterprise Server install answers on its
   * own host, and a header scoped to the wrong one is silently not sent.
   */
  gitRemoteBase: string
  /**
   * The Actions run executing this pipeline, or `null` when there is not one.
   *
   * Nullable rather than required because a local `--event-path` run is an
   * ordinary way to use this CLI, not a misconfiguration — so every renderer
   * that takes this has to be able to say nothing rather than link nowhere.
   */
  runUrl: string | null
  /**
   * Namespace every label this pipeline writes lives under, or `null` when
   * `AGENT_LABEL_PREFIX=none` switches labelling off.
   *
   * Nullable rather than an empty string: an empty prefix would make *every*
   * label on the issue look agent-owned to the reconcile, which removes any it
   * cannot account for — so the one value that reads as "no namespace" is the
   * one value that must never reach it.
   */
  labelPrefix: string | null
  /**
   * The debug transcript's AES-256-GCM key, or `null` when no transcript is
   * written.
   *
   * Raw bytes rather than the base64 the operator set, because its one consumer
   * is `crypto.subtle`. `null` rather than required: most runs have no
   * transcript, and a keyless run warns once and behaves exactly as it did
   * before this existed.
   */
  logKey: Uint8Array | null
  skillRoots: readonly string[]
}
