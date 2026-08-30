// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { agentWritePath } from '../../review-loop/src/agent-runner.js'
import { DepthClassificationSchema, runStageAgent } from './agent-layer.js'
import type { AgentLayerDeps, DepthSignals } from './agent-layer.js'
import { OVERSIZE_MIN_IMPLICATED_FILES } from './config.js'
import type { DepthProfile, OversizeSignals } from './events.js'

const PROFILE_RANK: Record<DepthProfile, number> = { S: 0, M: 1, L: 2 }

export function mapSignalsToProfile(signals: DepthSignals): DepthProfile {
  if (signals.db_migration || signals.credentials || signals.provider_surface || signals.novelty === 'new-subsystem') {
    return 'L'
  }
  if (signals.cross_module) return 'M'
  return 'S'
}

export function resolveDepth(
  estimator: DepthProfile,
  prescreen: DepthProfile,
): { readonly profile: DepthProfile; readonly disagreement: boolean } {
  const profile = PROFILE_RANK[estimator] >= PROFILE_RANK[prescreen] ? estimator : prescreen
  const disagreement = Math.abs(PROFILE_RANK[estimator] - PROFILE_RANK[prescreen]) >= 2
  return { profile, disagreement }
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
    'Report your observations only — be exhaustive about implicated_files; the pipeline itself decides',
    'whether the scope routes to decomposition from your signals.',
    'Judge novelty from code structure (new top-level module vs existing modules), not from openspec/specs/.',
  ].join('\n')
}

/**
 * Signal-grounded oversize verdict (D1): true only when the conjunction
 * holds — novelty `new-subsystem` AND cross-module AND implicated-file count
 * at/above the compiled threshold. The agent-emitted `oversize` boolean is
 * never consulted; the estimator reports observations, deterministic code
 * decides.
 */
export function computeOversize(
  signals: DepthSignals,
  implicatedFiles: readonly string[],
): { readonly oversize: boolean; readonly oversizeSignals: OversizeSignals } {
  const oversizeSignals: OversizeSignals = {
    novelty: signals.novelty,
    cross_module: signals.cross_module,
    implicatedFiles: implicatedFiles.length,
  }
  const oversize =
    signals.novelty === 'new-subsystem' &&
    signals.cross_module &&
    implicatedFiles.length >= OVERSIZE_MIN_IMPLICATED_FILES
  return { oversize, oversizeSignals }
}

/** Amend the depth sidecar with the computed verdict and its weighed signals (D2). */
async function recordOversizeVerdict(
  sidecarDir: string,
  oversize: boolean,
  oversizeSignals: OversizeSignals,
): Promise<void> {
  const sidecarPath = path.join(sidecarDir, 'depth.json')
  const parsed: unknown = JSON.parse(await readFile(sidecarPath, 'utf8'))
  const amended = {
    ...(isJsonObject(parsed) ? parsed : {}),
    oversize,
    oversize_signals: oversizeSignals,
  }
  await writeFile(sidecarPath, `${JSON.stringify(amended, null, 2)}\n`)
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Estimator spawn + deterministic verdict fold: everything the depth event and routing need. */
export async function estimateDepth(
  deps: {
    readonly agent: AgentLayerDeps
    readonly sidecarDir: string
    readonly runDir: string
    readonly cwd: string
  },
  options: { readonly changeName: string; readonly taskText: string },
  prescreen: DepthProfile,
): Promise<{
  readonly profile: DepthProfile
  /** The estimator's own reading, before the prescreen is folded in — named by the disagreement warning. */
  readonly estimated: DepthProfile
  readonly disagreement: boolean
  readonly oversize: boolean
  readonly oversizeSignals: OversizeSignals
  readonly rationale: string
}> {
  const estimation = await runStageAgent(deps.agent, {
    role: 'estimator',
    changeName: options.changeName,
    cwd: deps.cwd,
    prompt: buildEstimatorPrompt(options.taskText, deps.cwd),
    outputPath: 'depth.json',
    outputSchema: DepthClassificationSchema,
    label: 'estimator',
    runDir: deps.runDir,
    round: 0,
    sidecarDir: deps.sidecarDir,
  })
  const estimated = mapSignalsToProfile(estimation.value.signals)
  const { profile, disagreement } = resolveDepth(estimated, prescreen)
  const { oversize, oversizeSignals } = computeOversize(estimation.value.signals, estimation.value.implicated_files)
  await recordOversizeVerdict(deps.sidecarDir, oversize, oversizeSignals)
  return { profile, estimated, disagreement, oversize, oversizeSignals, rationale: estimation.value.rationale }
}
