// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import { agentWritePath, type AgentRunResult } from '../../review-loop/src/agent-runner.js'
import type { ExecGitFn } from './diff-guard.js'
import { runDiffGuard } from './diff-guard.js'
import { buildFixPrompt } from './prompt-templates.js'
import type { Result } from './result-schema.js'

export interface BuildFailureOutput {
  readonly stdout: string
  readonly stderr: string
}

// bun always writes `error: script ... exited with code 1` to stderr when the
// check command fails, so a `stderr || stdout` reason never surfaces check.sh's
// stdout breakdown naming the failing check. Persist the FULL combined output
// to build-output.log in the iteration dir and return only a tail-bounded
// reason for state.json / failure.json.
const BUILD_REASON_TAIL = 4000

export async function recordBuildFailure(iterPath: string, output: BuildFailureOutput): Promise<string> {
  const combined = [output.stderr, output.stdout].filter((s) => s.length > 0).join('\n')
  await writeFile(path.join(iterPath, 'build-output.log'), combined)
  return combined.slice(-BUILD_REASON_TAIL)
}

export interface BuildGateDeps {
  execGit: ExecGitFn
  runBuildCheck: (worktreePath: string) => Promise<{ passed: boolean; stdout: string; stderr: string }>
  runImproveAgent: (worktreePath: string, prompt: string, outputPath: string) => Promise<AgentRunResult<Result>>
  log: { log: (msg: string) => void }
}

export interface BuildGateInput {
  iterPath: string
  worktreePath: string
  file: string
  attempt: number
  maxAttempts: number
  improved: Result
}

export type BuildGateOutcome = { ok: true; value: Result } | { ok: false; gate: string; reason: string }

// A failed build check does not fail the iteration outright: the failed check
// output is fed back to the agent, which fixes its files in place, and the gate
// re-runs — up to maxAttempts times. Diff-guard re-runs after every fix (the
// fix itself could touch forbidden paths). Each failure overwrites
// build-output.log so it always holds the LATEST gate output. Recursion instead
// of `for + await` trips no-await-in-loop; the chain is strictly sequential
// because each re-gate observes the previous fix's file changes.
export async function runBuildGateWithRetries(deps: BuildGateDeps, input: BuildGateInput): Promise<BuildGateOutcome> {
  const build = await deps.runBuildCheck(input.worktreePath)
  if (build.passed) return { ok: true, value: input.improved }
  const reason = await recordBuildFailure(input.iterPath, build)
  if (input.attempt > input.maxAttempts) return { ok: false, gate: 'build', reason }
  deps.log.log(`[build] failed; agent fix attempt ${input.attempt}/${input.maxAttempts}`)
  const fixOut = path.join(input.iterPath, 'result.json')
  const fixRes = await deps.runImproveAgent(
    input.worktreePath,
    buildFixPrompt({
      file: input.file,
      attempt: input.attempt,
      maxAttempts: input.maxAttempts,
      buildOutput: reason,
      outputPath: agentWritePath(input.worktreePath, fixOut),
    }),
    fixOut,
  )
  const recheck = await runDiffGuard(deps.execGit, input.worktreePath)
  if (!recheck.ok) {
    return { ok: false, gate: 'diff-scope', reason: `forbidden paths changed: ${recheck.violations.join(', ')}` }
  }
  return runBuildGateWithRetries(deps, { ...input, attempt: input.attempt + 1, improved: fixRes.value })
}
