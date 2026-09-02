// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * The argv half of the claude CLI doctrine for the loop's four roles — the
 * profile block, the per-role allowlists, the model-id strip and the
 * single-argument cap.
 *
 * Duplicated from `opencode-agent/src/claude-argv.ts` across the documented
 * subprocess boundary, never imported: the two workspaces are separated so
 * that neither compiles against the other, and the duplicated constants are
 * pinned equal by a test (`tests/opencode-agent/claude-doctrine.test.ts`).
 */

/**
 * The Linux single-argument cap (`MAX_ARG_STRLEN`). The role prompt dodges it
 * by riding stdin, but an appended system prompt cannot — the builder refuses
 * to compose an invocation that would die in `spawn` with an `E2BIG` the
 * failure classifier would misread as a dead backend.
 */
export const MAX_ARG_STRLEN = 131_072

/** The role → allowlist mapping. Closed lists; no wildcard tool entry exists here. */
export const ALLOWLISTS = {
  /** Analysis base set — mirrors the parent route's `plan` string verbatim, unscoped reads included. */
  analysis: 'Read,Glob,Grep',
  /** Artifact-writing set — mirrors the parent route's `propose` string verbatim: edits the tree, no execute. */
  author: 'Read,Edit,Write,Glob,Grep',
  /** The fixing role: edits the tree and runs the check command. */
  fixer: 'Read,Edit,Write,Bash,Glob,Grep',
} as const

/**
 * The analysis roles' full set: the base tools plus `Write` scoped to the
 * scratch directory as an absolute permission rule composed from the spawn
 * cwd — the prompts name the absolute scratch path, and a bare relative
 * pattern could fail to match an absolute-path write.
 */
export function analysisAllowlist(cwd: string): string {
  return `${ALLOWLISTS.analysis},Write(${cwd}/.review-loop/**)`
}

/** Which CLI invocation shape a turn runs — selected by the credential spelling, not a knob. */
export type ClaudeInvocationProfile = 'bare' | 'native'

/**
 * The argv block that carries the invocation profile: `--bare` on the bare
 * profile; the neutralization pair on the native one — `--setting-sources ''`
 * kills repo-skill discovery and settings-file loads, and
 * `--strict-mcp-config --mcp-config <empty>` kills `.mcp.json` auto-connect.
 * Both flags on every native invocation, because either alone leaves one
 * discovery surface open.
 */
export function profileBlock(profile: ClaudeInvocationProfile, mcpConfigPath: string | null): readonly string[] {
  if (profile === 'native') {
    if (mcpConfigPath === null) {
      throw new Error(
        'The native claude invocation profile needs the empty-MCP document path for --mcp-config, and none was given. ' +
          'The attempt layer writes that document into the spawn config dir before composing the command; ' +
          'a missing one is a composition bug in the caller, not a condition an operator can set.',
      )
    }
    return ['--setting-sources', '', '--strict-mcp-config', '--mcp-config', mcpConfigPath]
  }
  return ['--bare']
}

/**
 * Only the model id crosses: one model knob serves either backend, and a
 * value spelled `provider/model` (the opencode form) keeps its model id here —
 * everything before the first slash is the provider prefix.
 */
export function modelIdForCli(raw: string): string {
  const slash = raw.indexOf('/')
  return slash === -1 ? raw : raw.slice(slash + 1)
}

/**
 * The sdd-runner roles that write the change's artifacts or the tracked files
 * a round settles: the drafters, the round resolvers (`drift` and
 * `veto-updater` spawn under that same role), and the decomposition pair.
 */
const AUTHOR_LABEL_PREFIXES = ['drafter', 'resolver', 'decomposer', 'atomicity', 'drift', 'veto-updater'] as const

/**
 * The read-and-judge roles across both callers: the loop's own `reviewer*` /
 * `matcher*` / `inspector*` (`-w<n>`, `-aggregated`, bare) and the runner's
 * review lenses, estimator and planner.
 */
const ANALYSIS_LABEL_PREFIXES = ['reviewer', 'matcher', 'inspector', 'skeptic', 'estimator', 'planner'] as const

/**
 * The per-spawn allowlist, keyed on the label by documented prefix: `fixer*`
 * (pooled `fixer-w<n>[-retry]`, batched `fixer-batch-<cluster.id>`, bare
 * pooled-less `fixer`) maps to the fixer set, the artifact writers to the
 * author set and the analysts to the analysis set. Any other label inherits
 * the analysis (weakest) set and the condition is logged — the
 * weaker-profile-is-the-default doctrine.
 */
export function allowlistForLabel(label: string, cwd: string, log: (message: string) => void = console.warn): string {
  if (label.startsWith('fixer')) {
    return ALLOWLISTS.fixer
  }
  if (AUTHOR_LABEL_PREFIXES.some((prefix) => label.startsWith(prefix))) {
    return ALLOWLISTS.author
  }
  if (ANALYSIS_LABEL_PREFIXES.some((prefix) => label.startsWith(prefix))) {
    return analysisAllowlist(cwd)
  }
  log(
    `[review-loop] role label "${label}" is not one the claude allowlist mapping pins; ` +
      'the analysis (weakest) allowlist applies',
  )
  return analysisAllowlist(cwd)
}
