// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import fs from 'node:fs'
import path from 'node:path'

import { z } from 'zod'

import { agentWritePath } from '../../review-loop/src/agent-runner.js'
import { runStageAgent } from './agent-layer.js'
import type { AgentLayerDeps } from './agent-layer.js'
import type { DepthProfile } from './events.js'
import type { InstructionsResult, OpenSpecDriver } from './openspec-driver.js'
import { StageHaltError } from './stage-machine.js'

export const DraftReportSchema = z.object({ files_written: z.array(z.string().min(1)).min(1) })
export type DraftReport = z.infer<typeof DraftReportSchema>

export function draftArtifacts(depth: DepthProfile): readonly string[] {
  return depth === 'S' ? ['proposal', 'specs'] : ['proposal', 'specs', 'design']
}

export interface DraftDeps {
  readonly driver: OpenSpecDriver
  readonly agent: AgentLayerDeps
  readonly logPath: string
  readonly sidecarDir: string
  readonly cwd: string
  readonly now?: () => Date
}

export interface DraftOptions {
  readonly changeName: string
  readonly taskText: string
  readonly depth: DepthProfile
}

export function buildDrafterPrompt(input: {
  readonly artifactId: string
  readonly taskText: string
  readonly instr: InstructionsResult
  readonly cwd: string
  readonly lastError: string | null
}): string {
  const reportPath = agentWritePath(input.cwd, `draft-${input.artifactId}.json`)
  const parts = [
    `You are the drafter for the "${input.artifactId}" artifact of an OpenSpec change.`,
    '',
    'Task description:',
    input.taskText,
    '',
    'Artifact instruction:',
    input.instr.instruction,
  ]
  if (input.instr.template !== undefined) parts.push('', 'Template:', input.instr.template)
  if (input.instr.rules.length > 0) parts.push('', 'Project rules:', ...input.instr.rules.map((rule) => `- ${rule}`))
  parts.push(
    '',
    `Write the artifact to: ${input.instr.resolvedOutputPath}`,
    input.artifactId === 'specs'
      ? 'The specs path is a glob: create one spec file per capability at specs/<capability>/spec.md using delta headers.'
      : 'Write exactly this one file.',
    '',
    `Then write a JSON report to ${reportPath}: {"files_written": [<paths relative to the repo root>]}`,
  )
  if (input.lastError !== null) parts.push('', 'Previous attempt failed:', input.lastError)
  return parts.join('\n')
}

async function attemptDraftArtifact(
  deps: DraftDeps,
  options: DraftOptions,
  artifactId: string,
  instr: InstructionsResult,
  attempt: number,
  lastError: string | null,
): Promise<void> {
  const report = await runStageAgent(deps.agent, {
    role: 'drafter',
    changeName: options.changeName,
    cwd: deps.cwd,
    prompt: buildDrafterPrompt({ artifactId, taskText: options.taskText, instr, cwd: deps.cwd, lastError }),
    outputPath: `draft-${artifactId}.json`,
    outputSchema: DraftReportSchema,
    label: `drafter-${artifactId}`,
    logPath: `${deps.sidecarDir}/logs/drafter-${artifactId}.log`,
    sidecarDir: deps.sidecarDir,
  })
  const missing = report.value.files_written.filter((file) => !fs.existsSync(path.join(deps.cwd, file)))
  const validation =
    artifactId === 'specs' ? await deps.driver.validateStrict(options.changeName) : { ok: true, output: '' }
  if (missing.length === 0 && validation.ok) return
  const problems = [
    ...missing.map((file) => `missing file: ${file}`),
    ...(validation.ok ? [] : [`openspec validate --strict failed: ${validation.output}`]),
  ]
  if (attempt >= 2) {
    throw new StageHaltError(`draft ${artifactId} failed after 2 attempts: ${problems.join('; ')}`, `resume the run`)
  }
  await attemptDraftArtifact(deps, options, artifactId, instr, attempt + 1, problems.join('\n'))
}

export async function runDraft(deps: DraftDeps, options: DraftOptions): Promise<void> {
  const artifactIds = draftArtifacts(options.depth)
  await artifactIds.reduce<Promise<void>>(
    (chain, artifactId) =>
      chain.then(async () => {
        const instr = await deps.driver.instructions(artifactId, options.changeName)
        await attemptDraftArtifact(deps, options, artifactId, instr, 1, null)
      }),
    Promise.resolve(),
  )
}
