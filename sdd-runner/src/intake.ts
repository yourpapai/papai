// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile, rename } from 'node:fs/promises'
import path from 'node:path'

import { agentWritePath } from '../../review-loop/src/agent-runner.js'
import { runStageAgent } from './agent-layer.js'
import type { AgentLayerDeps } from './agent-layer.js'
import { PLAN_REPLAN_PASSES, deriveChangeName } from './config.js'
import { estimateDepth } from './estimator.js'
import type { DepthProfile, EventInput } from './events.js'
export { buildEstimatorPrompt, computeOversize, mapSignalsToProfile, resolveDepth } from './estimator.js'
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

/** Planner draft sidecar: promoted onto `plan.json` only after structural validation passes. */
const PLAN_DRAFT = 'plan-draft.json'

const L_KEYWORDS = /migrat|credential|encrypt|secret|provider|auth|security/iu
const S_KEYWORDS = /typo|rename|comment|docs?\b|readme|whitespace/iu

export function prescreenProfile(taskText: string): DepthProfile {
  if (L_KEYWORDS.test(taskText)) return 'L'
  if (S_KEYWORDS.test(taskText)) return 'S'
  return 'M'
}

export interface IntakeDeps {
  readonly driver: OpenSpecDriver
  readonly agent: AgentLayerDeps
  readonly emit: (event: EventInput) => void
  readonly sidecarDir: string
  readonly runDir: string
  readonly cwd: string
  /** Operator warn sink for classification caveats; omitted → silent (tests, embedders). */
  readonly stdout?: (line: string) => void
}

export interface IntakeOptions {
  readonly changeName: string
  readonly taskText: string
  readonly depthOverride?: DepthProfile
  /** Operator routing override (D3): force the plan branch regardless of the verdict. */
  readonly forcePlan?: boolean
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

/**
 * The estimator is the only source of the `oversize` verdict, so a `--depth`
 * override — which skips the estimator spawn entirely — also rules out
 * decomposition. Silence there lets a genuinely oversized task draft one
 * outsized change; the override stays, the cost is named.
 */
function warnOverrideSkipsOversize(deps: IntakeDeps, depth: DepthProfile): void {
  deps.stdout?.(
    `--depth ${depth} skips scope estimation, so no oversize verdict is computed — this run will not be decomposed into child runs`,
  )
}

/** A two-level split between the readings is worth an operator's attention, not just an event field. */
function warnDepthDisagreement(deps: IntakeDeps, estimator: DepthProfile, prescreen: DepthProfile): void {
  deps.stdout?.(
    `depth readings disagree by two levels (estimator ${estimator}, prescreen ${prescreen}) — taking the higher`,
  )
}

export async function runIntake(deps: IntakeDeps, options: IntakeOptions): Promise<IntakeResult> {
  if (options.depthOverride !== undefined && options.forcePlan === true) {
    throw new Error('--plan and --depth conflict: a forced plan branch cannot take an explicit depth')
  }
  if (options.depthOverride !== undefined) {
    deps.emit({
      altitude: 'L2',
      type: 'depth',
      profile: options.depthOverride,
      rationale: 'override via --depth',
      source: 'override',
      routeForced: 'depth',
    })
    warnOverrideSkipsOversize(deps, options.depthOverride)
    await deps.driver.newChange(options.changeName, 'auto-sdd')
    return { kind: 'single', changeName: options.changeName, depth: options.depthOverride, disagreement: false }
  }
  const prescreen = prescreenProfile(options.taskText)
  const { profile, estimated, disagreement, oversize, oversizeSignals, rationale } = await estimateDepth(
    deps,
    options,
    prescreen,
  )
  if (disagreement) warnDepthDisagreement(deps, estimated, prescreen)
  const routeToPlan = options.forcePlan === true || oversize
  deps.emit({
    altitude: 'L2',
    type: 'depth',
    profile,
    rationale,
    source: 'estimator',
    oversize,
    oversizeSignals,
    ...(options.forcePlan === true ? { routeForced: 'plan' } : {}),
    ...(disagreement ? { disagreement: true } : {}),
  })
  if (routeToPlan) {
    const children = await runPlanner(deps, options)
    return { kind: 'plan', children }
  }
  await deps.driver.newChange(options.changeName, 'auto-sdd')
  return { kind: 'single', changeName: options.changeName, depth: profile, disagreement }
}
