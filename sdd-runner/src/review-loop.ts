// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import pLimit from 'p-limit'
import { z } from 'zod'

import { agentWritePath } from '../../review-loop/src/agent-runner.js'
import { AssumptionRecordSchema, FindingsSidecarSchema, ResolutionSchema, runStageAgent } from './agent-layer.js'
import type { AgentLayerDeps, Finding, Resolution } from './agent-layer.js'
import type { DepthProfile, EventInput } from './events.js'
import {
  buildResolverPrompt,
  buildReviewerPrompt,
  evaluateConvergence,
  lensesForRound,
  mergeLensFindings,
  readResolutionsLedger,
  readReviewArtifacts,
  ROUND_CAPS,
} from './review-model.js'

export const ResolverOutputSchema = z.object({
  resolutions: z.array(ResolutionSchema),
  assumptions: z.array(AssumptionRecordSchema),
})
export type ResolverOutput = z.infer<typeof ResolverOutputSchema>

/** Queued steering grammar (D6): `extend`, `veto <id>=<redirect>`, `abort`. */
export type SteerDirective =
  | { readonly kind: 'extend' }
  | { readonly kind: 'veto'; readonly id: string; readonly redirect?: string }
  | { readonly kind: 'abort' }

export interface ParsedSteer {
  readonly valid: readonly SteerDirective[]
  readonly warnings: readonly string[]
}

/**
 * Parse `steer.md` content line by line against the fixed grammar. Unknown
 * directives (and, when `knownIds` is given, unknown veto ids) surface as
 * warn lines and are skipped — never fatal, never an `events.ndjson`
 * variant. Directive text is never interpolated into shell commands, file
 * paths, or prompts: each line maps to the closed `SteerDirective` union.
 */
export function parseSteerDirectives(
  content: string,
  options: { readonly knownIds?: ReadonlySet<string> } = {},
): ParsedSteer {
  const valid: SteerDirective[] = []
  const warnings: string[] = []
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    if (line === 'extend') {
      valid.push({ kind: 'extend' })
      continue
    }
    if (line === 'abort') {
      valid.push({ kind: 'abort' })
      continue
    }
    const vetoMatch = line.match(/^veto\s+(\S+)=(.*)$/u)
    if (vetoMatch !== null) {
      const id = vetoMatch[1] ?? ''
      if (options.knownIds !== undefined && !options.knownIds.has(id)) {
        warnings.push(`unknown veto id: ${id}`)
        continue
      }
      const redirect = vetoMatch[2] ?? ''
      valid.push(redirect === '' ? { kind: 'veto', id } : { kind: 'veto', id, redirect })
      continue
    }
    warnings.push(`unknown directive: ${line}`)
  }
  return { valid, warnings }
}

/** Build the standard steering seam for a run state (D6). */
export const StagedSteerSchema = z.object({
  directives: z.array(
    z.union([
      z.object({ kind: z.literal('extend') }),
      z.object({ kind: z.literal('abort') }),
      z.object({ kind: z.literal('veto'), id: z.string().min(1), redirect: z.string().optional() }),
    ]),
  ),
})
export type StagedSteer = z.infer<typeof StagedSteerSchema>

function nextConsumedName(runDir: string): string {
  let n = 1
  while (existsSync(path.join(runDir, `steer.consumed.${n}.md`))) n += 1
  return `steer.consumed.${n}.md`
}

/**
 * Round-boundary consumption (D6): read `steer.md` if present, persist the
 * staged set to `steer.staged.json` BEFORE the rename (a crash mid-tick
 * re-consumes idempotently — the staged set survives), then rename to
 * `steer.consumed.<n>.md` (append-only audit; never delete).
 */
export function consumeSteerFile(runDir: string): ParsedSteer {
  const steerPath = path.join(runDir, 'steer.md')
  if (!existsSync(steerPath)) return { valid: [], warnings: [] }
  const parsed = parseSteerDirectives(readFileSync(steerPath, 'utf8'))
  const staged: StagedSteer = { directives: [...parsed.valid] }
  writeFileSync(path.join(runDir, 'steer.staged.json'), `${JSON.stringify(staged)}\n`)
  renameSync(steerPath, path.join(runDir, nextConsumedName(runDir)))
  return parsed
}

/** Reload the persisted staged set (resume-after-crash; missing file = none). */
export async function reloadStagedSteer(runDir: string): Promise<StagedSteer> {
  try {
    const raw = await readFile(path.join(runDir, 'steer.staged.json'), 'utf8')
    return StagedSteerSchema.parse(JSON.parse(raw))
  } catch {
    return { directives: [] }
  }
}

export interface ReviewLoopDeps {
  readonly agent: AgentLayerDeps
  readonly emit: (event: EventInput) => void
  readonly runDir: string
  readonly sidecarDir: string
  readonly cwd: string
  readonly materialize: (round: number) => Promise<void>
  /**
   * Round-boundary steering seam (D6): consume `steer.md` at each round-cap
   * evaluation point and re-read the persisted round cap so a steered
   * `extend` takes effect at the next boundary without consuming
   * `autoExtendsUsed`. Omitted → no steering (today's behavior).
   */
  readonly steer?: {
    readonly runDir: string
    readonly onWarning: (line: string) => void
    readonly onDirectives?: (directives: readonly SteerDirective[]) => void
    readonly readRoundCap: () => number
  }
}

export interface ReviewLoopOptions {
  readonly changeName: string
  readonly changeDir: string
  readonly depth: DepthProfile
  readonly taskText: string
  readonly conventions: string
}

export interface ReviewLoopResult {
  readonly outcome: 'converged' | 'cap-hit'
  readonly rounds: number
  readonly openBlockers: readonly Resolution[]
  readonly openMaterial: readonly Resolution[]
  readonly openNitpicks: readonly Resolution[]
}

async function runLens(
  deps: ReviewLoopDeps,
  options: ReviewLoopOptions,
  lens: 'reviewer' | 'skeptic',
  round: number,
  artifacts: string,
  ledger: readonly Resolution[],
): Promise<Finding[]> {
  const outputPath = lens === 'skeptic' ? `findings-skeptic-${round}.json` : `findings-${round}.json`
  const result = await runStageAgent(deps.agent, {
    role: lens,
    changeName: options.changeName,
    cwd: deps.cwd,
    prompt: buildReviewerPrompt({
      lens,
      artifacts,
      conventions: options.conventions,
      ledger,
      outputTarget: agentWritePath(deps.cwd, outputPath),
    }),
    outputPath,
    outputSchema: FindingsSidecarSchema,
    label: `${lens}-r${round}`,
    runDir: deps.runDir,
    round,
    sidecarDir: deps.sidecarDir,
  })
  return result.value.findings
}

async function runResolver(
  deps: ReviewLoopDeps,
  options: ReviewLoopOptions,
  round: number,
  artifacts: string,
  merged: readonly Finding[],
): Promise<ResolverOutput> {
  const result = await runStageAgent(deps.agent, {
    role: 'resolver',
    changeName: options.changeName,
    cwd: deps.cwd,
    prompt: buildResolverPrompt({
      artifacts,
      findings: merged,
      conventions: options.conventions,
      taskText: options.taskText,
      outputTarget: agentWritePath(deps.cwd, `resolutions-${round}.json`),
    }),
    outputPath: `resolutions-${round}.json`,
    outputSchema: ResolverOutputSchema,
    label: `resolver-r${round}`,
    runDir: deps.runDir,
    round,
    sidecarDir: deps.sidecarDir,
  })
  for (const entry of result.value.resolutions) {
    const action = entry.resolution === 'dismissed' ? 'dismissed' : 'resolved'
    deps.emit({ altitude: 'L2', type: 'finding', action, id: entry.id, round, class: entry.class })
  }
  for (const assumption of result.value.assumptions) {
    deps.emit({ altitude: 'L2', type: 'assumption', action: 'logged', id: assumption.id })
  }
  return result.value
}

/**
 * Round-boundary steer consumption (D6): at each round-cap evaluation point
 * consume `steer.md` (rename-on-consume, staged set persisted first), surface
 * unknown directives as warn lines, and re-read the persisted round cap so a
 * steered `extend` takes effect at this boundary — never consuming
 * `autoExtendsUsed`.
 */
function applySteerAtBoundary(deps: ReviewLoopDeps, entryCap: number): number {
  const steer = deps.steer
  if (steer === undefined) return entryCap
  const consumed = consumeSteerFile(steer.runDir)
  for (const warning of consumed.warnings) steer.onWarning(warning)
  if (consumed.valid.length > 0) steer.onDirectives?.(consumed.valid)
  return steer.readRoundCap()
}

async function runRound(
  deps: ReviewLoopDeps,
  options: ReviewLoopOptions,
  round: number,
  cap: number,
  prevOpenBlockers: number,
): Promise<ReviewLoopResult> {
  const effectiveCap = applySteerAtBoundary(deps, cap)
  deps.emit({ altitude: 'L2', type: 'round_open', round, cap: effectiveCap })
  const artifacts = await readReviewArtifacts(options.changeDir)
  const ledger = await readResolutionsLedger(deps.sidecarDir, round)
  const lenses = lensesForRound(options.depth, round, prevOpenBlockers)
  const limit = pLimit(2)
  const perLens = await Promise.all(
    lenses.map((lens) => limit(() => runLens(deps, options, lens, round, artifacts, ledger))),
  )
  const merged = mergeLensFindings(...perLens)
  for (const finding of merged) {
    deps.emit({ altitude: 'L2', type: 'finding', action: 'classified', id: finding.id, round, class: finding.class })
  }
  const resolved = await runResolver(deps, options, round, artifacts, merged)
  const { verdict, counts } = evaluateConvergence(resolved.resolutions)
  deps.emit({ altitude: 'L2', type: 'convergence', round, verdict, counts })
  await deps.materialize(round)
  deps.emit({ altitude: 'L2', type: 'round_close', round, cap: effectiveCap })
  if (verdict === 'converged') {
    const openNitpicks = resolved.resolutions.filter((entry) => entry.class === 'NITPICK')
    return { outcome: 'converged', rounds: round, openBlockers: [], openMaterial: [], openNitpicks }
  }
  const openBlockers = resolved.resolutions.filter((entry) => entry.class === 'BLOCKER')
  const openMaterial = resolved.resolutions.filter((entry) => entry.class === 'MATERIAL')
  const openNitpicks = resolved.resolutions.filter((entry) => entry.class === 'NITPICK')
  const nextCap = applySteerAtBoundary(deps, effectiveCap)
  if (round >= nextCap) return { outcome: 'cap-hit', rounds: round, openBlockers, openMaterial, openNitpicks }
  return runRound(deps, options, round + 1, nextCap, openBlockers.length)
}

export function runReviewLoop(
  deps: ReviewLoopDeps,
  options: ReviewLoopOptions,
  entry: { readonly startRound?: number; readonly cap?: number } = {},
): Promise<ReviewLoopResult> {
  const startRound = entry.startRound ?? 1
  const cap = entry.cap ?? ROUND_CAPS[options.depth]
  return runRound(deps, options, startRound, cap, 0)
}
