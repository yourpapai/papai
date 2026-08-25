// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * The seam every model backend implements — a *session* the pipeline holds:
 * an id, a lifetime, a stop, a teardown.
 *
 * Extracted from `opencode-adapter.ts` when the claude backend arrived behind
 * the same interface, so a second adapter could implement the seam without a
 * claude session being typed as an `OpenCodeAgent` — a lie at every new import
 * site. `opencode-adapter.ts` re-exports it as the `OpenCodeAgent` alias, so
 * not one existing import changes; new modules and tests use the neutral name.
 * The arrangement is `phase-names.ts`'s: split from a module, re-exported by
 * it, so callers keep naming one module for the vocabulary.
 */

export interface AgentPromptRequest {
  prompt: string
  system?: string
  /** OpenCode agent profile (`build`, `plan`, …). */
  agent?: string
  /** Per-call tool allow/deny overrides passed straight through to the SDK. */
  tools?: Record<string, boolean>
}

export interface AgentPromptResult {
  text: string
  sessionId: string
}

/** A live model-backend session bound to one workspace directory. */
export interface AgentSession {
  readonly sessionId: string
  prompt(request: AgentPromptRequest): Promise<AgentPromptResult>
  /**
   * Tokens this session has consumed. Zero when the backend cannot say — a
   * budget is a guardrail on the work, not part of it, so a shape it fails to
   * recognise must not turn every phase into a failure.
   */
  tokensUsed(): Promise<number>
  /**
   * Stops whatever the model is running, and says whether the stop landed.
   *
   * The one boundary in this pipeline that is best-effort **and** reports.
   * Measured against a live backend: an abort kills the running tool child and
   * leaves an `opencode serve` up, while `close()` — a bare SIGTERM to one pid
   * on POSIX — kills the server and leaves the tool child running, reparented
   * to init. So this is the stop and `close()` is the leak, and the two are
   * not each other's fallback. On the claude route the same split holds by
   * construction: `abort()` kills the CLI's whole process group, `close()`
   * terminates anything abandoned and reaps.
   *
   * A refused abort must not become the run's failure — the stop it belongs to is
   * already out of time and cannot afford a second thing to go wrong — but unlike
   * the feedback channels it cannot swallow the answer either: the salvage stages
   * a working tree, and staging one whose writer may still be running is the only
   * thing that path must never do. Hence `boolean` rather than `void`.
   */
  abort(): Promise<boolean>
  close(): Promise<void>
}
