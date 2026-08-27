// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile, rename } from 'node:fs/promises'
import path from 'node:path'

import { agentWritePath } from '../../review-loop/src/agent-runner.js'
import { DepthClassificationSchema, runStageAgent } from './agent-layer.js'
import type { AgentLayerDeps, DepthSignals } from './agent-layer.js'
import { PLAN_REPLAN_PASSES, deriveChangeName } from './config.js'
import type { DepthProfile, EventInput } from './events.js'
import type { OpenSpecDriver } from './openspec-driver.js'
import { PlanSchema, topoSortChildren } from './plan.js'
import type { PlanChild } from './plan.js'

export interface TaskSource {
  readonly taskText: string
  readonly changeName: string
}

/** Resolve a start's task source (D3): inline text or task file, with the derived change name. */
export async function resolveTaskSource(options: {
  readonly taskFile?: string
  readonly taskText?: string
  readonly changeName?: string
}): Promise<TaskSource> {
  if (options.taskFile === undefined) {
    const text = options.taskText
    if (text === undefined) {
      throw new Error('runStart requires a task file or inline task text')
    }
    return { taskText: text, changeName: options.changeName ?? deriveChangeName('task.md', text) }
  }
  const taskText = await readFile(options.taskFile, 'utf8')
  return { taskText, changeName: deriveChangeName(options.taskFile, taskText) }
}

const PROFILE_RANK: Record<DepthProfile, number> = { S: 0, M: 1, L: 2 }

/** Planner draft sidecar: promoted onto `plan.json` only after structural validation passes. */
const PLAN_DRAFT = 'plan-draft.json'

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
  readonly runDir: string
  readonly cwd: string
}

export interface IntakeOptions {
  readonly changeName: string
  readonly taskText: string
  readonly depthOverride?: DepthProfile
}

export interface SingleIntakeResult {
  readonly kind: 'single'
  readonly changeName: string
  readonly depth: DepthProfile
  readonly disagreement: boolean
}

export interface PlanIntakeResult {
  readonly kind: 'plan'
  readonly children: PlanChild[]
}

export type IntakeResult = SingleIntakeResult | PlanIntakeResult

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
    ' "oversize": boolean, "rationale": string}',
    'Set oversize true only when the task declares scope too large for one change and must be',
    'decomposed into child runs; false otherwise.',
    'Judge novelty from code structure (new top-level module vs existing modules), not from openspec/specs/.',
  ].join('\n')
}

function buildPlannerPrompt(
  taskText: string,
  cwd: string,
  validationError: string | null = null,
  redirects: readonly string[] = [],
): string {
  const target = agentWritePath(cwd, PLAN_DRAFT)
  const lines = [
    'You are a read-only task planner for a spec-driven development pipeline.',
    'Decompose the task into child runs that each fit one change. Do not edit anything.',
    '',
    'Task:',
    taskText,
    '',
    `Write your plan as JSON to ${target} with this shape:`,
    '{"children": [{"id": string, "instruction": string, "deps": string[], "capabilities"?: string[]}]}',
    'Every dep must reference another child id; order children so dependencies come first.',
  ]
  if (redirects.length > 0) {
    lines.push(
      '',
      'The previous plan was vetoed. Revise it according to these redirects:',
      ...redirects.map((r) => `- ${r}`),
    )
  }
  if (validationError !== null) {
    lines.push(
      '',
      'Previous plan failed structural validation:',
      validationError,
      'Fix these errors in the revised plan.',
    )
  }
  return lines.join('\n')
}

export interface PlannerOptions {
  readonly changeName: string
  readonly taskText: string
  /** Plan-gate veto redirects (D6): appended to the replan prompt. */
  readonly redirects?: readonly string[]
}

/**
 * Structural replan loop (D3): JSON-shape failures retry inside `runStageAgent`;
 * structural failures from `validatePlan`/`topoSortChildren` run after the spawn,
 * so each pass appends the validation error and respawns, bounded by
 * `PLAN_REPLAN_PASSES`, then fails loudly naming the structural errors. Drafts
 * stage at `sidecars/plan-draft.json` and are promoted onto `plan.json` only
 * after `topoSortChildren` succeeds, so a bound-exhausted failure never leaves
 * an invalid sidecar past a still-pending plan gate.
 */
export function runPlanner(deps: IntakeDeps, options: PlannerOptions): Promise<PlanChild[]> {
  return attemptPlanner(deps, options, null, 0)
}

async function attemptPlanner(
  deps: IntakeDeps,
  options: PlannerOptions,
  validationError: string | null,
  pass: number,
): Promise<PlanChild[]> {
  const plan = await runStageAgent(deps.agent, {
    role: 'planner',
    changeName: options.changeName,
    cwd: deps.cwd,
    prompt: buildPlannerPrompt(options.taskText, deps.cwd, validationError, options.redirects ?? []),
    outputPath: PLAN_DRAFT,
    outputSchema: PlanSchema,
    label: 'planner',
    runDir: deps.runDir,
    round: 0,
    sidecarDir: deps.sidecarDir,
  })
  let ordered: PlanChild[]
  try {
    ordered = topoSortChildren(plan.value)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    if (pass >= PLAN_REPLAN_PASSES) {
      throw new Error(`planner failed structural validation after ${PLAN_REPLAN_PASSES} replan pass: ${detail}`, {
        cause: error,
      })
    }
    return attemptPlanner(deps, options, detail, pass + 1)
  }
  await rename(path.join(deps.sidecarDir, PLAN_DRAFT), path.join(deps.sidecarDir, 'plan.json'))
  return ordered
}

export async function runIntake(deps: IntakeDeps, options: IntakeOptions): Promise<IntakeResult> {
  if (options.depthOverride !== undefined) {
    deps.emit({
      altitude: 'L2',
      type: 'depth',
      profile: options.depthOverride,
      rationale: 'override via --depth',
      source: 'override',
    })
    await deps.driver.newChange(options.changeName, 'auto-sdd')
    return { kind: 'single', changeName: options.changeName, depth: options.depthOverride, disagreement: false }
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
    runDir: deps.runDir,
    round: 0,
    sidecarDir: deps.sidecarDir,
  })
  const estimated = mapSignalsToProfile(estimation.value.signals)
  const { profile, disagreement } = resolveDepth(estimated, prescreen)
  const oversize = estimation.value.oversize === true
  deps.emit({
    altitude: 'L2',
    type: 'depth',
    profile,
    rationale: estimation.value.rationale,
    source: 'estimator',
    oversize,
    ...(disagreement ? { disagreement: true } : {}),
  })
  if (oversize) {
    const children = await runPlanner(deps, options)
    return { kind: 'plan', children }
  }
  await deps.driver.newChange(options.changeName, 'auto-sdd')
  return { kind: 'single', changeName: options.changeName, depth: profile, disagreement }
}
