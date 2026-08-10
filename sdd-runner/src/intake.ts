// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { agentWritePath } from '../../review-loop/src/agent-runner.js'
import { DepthClassificationSchema, runStageAgent } from './agent-layer.js'
import type { AgentLayerDeps, DepthSignals } from './agent-layer.js'
import type { DepthProfile, EventInput } from './events.js'
import type { OpenSpecDriver } from './openspec-driver.js'

const PROFILE_RANK: Record<DepthProfile, number> = { S: 0, M: 1, L: 2 }

export function mapSignalsToProfile(signals: DepthSignals): DepthProfile {
  if (signals.db_migration || signals.credentials || signals.provider_surface || signals.novelty === 'new-subsystem') {
    return 'L'
  }
  if (signals.cross_module) return 'M'
  return 'S'
}

const L_KEYWORDS = /migrat|credential|encrypt|secret|provider|auth|security/iu
const S_KEYWORDS = /typo|rename|comment|docs?\b|readme|whitespace/iu

export function prescreenProfile(taskText: string): DepthProfile {
  if (L_KEYWORDS.test(taskText)) return 'L'
  if (S_KEYWORDS.test(taskText)) return 'S'
  return 'M'
}

export function resolveDepth(
  estimator: DepthProfile,
  prescreen: DepthProfile,
): { readonly profile: DepthProfile; readonly disagreement: boolean } {
  const profile = PROFILE_RANK[estimator] >= PROFILE_RANK[prescreen] ? estimator : prescreen
  const disagreement = Math.abs(PROFILE_RANK[estimator] - PROFILE_RANK[prescreen]) >= 2
  return { profile, disagreement }
}

export interface IntakeDeps {
  readonly driver: OpenSpecDriver
  readonly agent: AgentLayerDeps
  readonly emit: (event: EventInput) => void
  readonly sidecarDir: string
  readonly cwd: string
}

export interface IntakeOptions {
  readonly changeName: string
  readonly taskText: string
  readonly depthOverride?: DepthProfile
}

export interface IntakeResult {
  readonly changeName: string
  readonly depth: DepthProfile
  readonly disagreement: boolean
}

export function buildEstimatorPrompt(taskText: string, cwd: string): string {
  const target = agentWritePath(cwd, 'depth.json')
  return [
    'You are a read-only scope estimator for a spec-driven development pipeline.',
    'Estimate which files and modules this task implicates. Do not edit anything.',
    '',
    'Task:',
    taskText,
    '',
    `Write your classification as JSON to ${target} with this shape:`,
    '{"implicated_files": string[], "signals": {"cross_module": boolean, "db_migration": boolean,',
    ' "provider_surface": boolean, "credentials": boolean, "novelty": "new-subsystem" | "existing-modules"},',
    ' "rationale": string}',
    'Judge novelty from code structure (new top-level module vs existing modules), not from openspec/specs/.',
  ].join('\n')
}

export async function runIntake(deps: IntakeDeps, options: IntakeOptions): Promise<IntakeResult> {
  await deps.driver.newChange(options.changeName, 'auto-sdd')
  if (options.depthOverride !== undefined) {
    deps.emit({
      altitude: 'L2',
      type: 'depth',
      profile: options.depthOverride,
      rationale: 'override via --depth',
      source: 'override',
    })
    return { changeName: options.changeName, depth: options.depthOverride, disagreement: false }
  }
  const prescreen = prescreenProfile(options.taskText)
  const estimation = await runStageAgent(deps.agent, {
    role: 'estimator',
    changeName: options.changeName,
    cwd: deps.cwd,
    prompt: buildEstimatorPrompt(options.taskText, deps.cwd),
    outputPath: 'depth.json',
    outputSchema: DepthClassificationSchema,
    label: 'estimator',
    logPath: `${deps.sidecarDir}/logs/estimator.log`,
    sidecarDir: deps.sidecarDir,
  })
  const estimated = mapSignalsToProfile(estimation.value.signals)
  const { profile, disagreement } = resolveDepth(estimated, prescreen)
  deps.emit({
    altitude: 'L2',
    type: 'depth',
    profile,
    rationale: estimation.value.rationale,
    source: 'estimator',
    ...(disagreement ? { disagreement: true } : {}),
  })
  return { changeName: options.changeName, depth: profile, disagreement }
}
