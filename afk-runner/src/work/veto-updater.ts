// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { existsSync, readdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import { agentWritePath } from '../../../review-loop/src/agent-runner.js'
import { FindingsSidecarSchema, runStageAgent } from '../agent-layer.js'
import type { AgentLayerDeps } from '../agent-layer.js'
import type { OpenSpecDriver } from '../openspec-driver.js'
import type { GateAssumption, GateFinding } from './gate-model.js'
import { ResolverOutputSchema } from './review-loop.js'

export type VetoEntry = { readonly id: string; readonly redirect?: string }

export interface VetoUpdaterArtifactContent {
  readonly proposal?: string
  readonly design?: string
  readonly specs?: string
  readonly tasks?: string
}

export interface VetoUpdaterPromptInput {
  readonly changeName: string
  readonly assumptions: readonly GateAssumption[]
  readonly findings: readonly GateFinding[]
  readonly vetoes: readonly VetoEntry[]
  readonly artifacts: VetoUpdaterArtifactContent
  readonly reportPath: string
}

const ASSUMPTION_ID_PATTERN = /^A\d+$/u
const FINDING_ID_PATTERN = /^F\d+$/u

function formatVetoEntries(vetoes: readonly VetoEntry[], lookup: Map<string, string>): string[] {
  return vetoes.map((veto) => {
    const original = lookup.get(veto.id) ?? '(unknown)'
    const redirect = veto.redirect ?? '(no redirect — suppress this entry)'
    return `- ${veto.id} "${original}" → ${redirect}`
  })
}

export function buildVetoUpdaterPrompt(input: VetoUpdaterPromptInput): string {
  const assumptionLookup = new Map(input.assumptions.map((a) => [a.id, a.text]))
  const findingLookup = new Map(input.findings.map((f) => [f.id, f.gap]))
  const assumptionVetoes = input.vetoes.filter((v) => ASSUMPTION_ID_PATTERN.test(v.id))
  const findingVetoes = input.vetoes.filter((v) => FINDING_ID_PATTERN.test(v.id))
  const parts = [
    `You are revising the "${input.changeName}" OpenSpec change. The human reviewed the gate and redirected.`,
    '',
  ]
  if (assumptionVetoes.length > 0) {
    parts.push('Vetoed assumptions:', ...formatVetoEntries(assumptionVetoes, assumptionLookup), '')
  }
  if (findingVetoes.length > 0) {
    parts.push('Vetoed findings:', ...formatVetoEntries(findingVetoes, findingLookup), '')
  }
  parts.push('Current artifacts:')
  if (input.artifacts.proposal !== undefined) parts.push(`<proposal.md>\n${input.artifacts.proposal}\n</proposal.md>`)
  if (input.artifacts.design !== undefined) parts.push(`<design.md>\n${input.artifacts.design}\n</design.md>`)
  if (input.artifacts.specs !== undefined) parts.push(`<specs>\n${input.artifacts.specs}\n</specs>`)
  if (input.artifacts.tasks !== undefined) parts.push(`<tasks.md>\n${input.artifacts.tasks}\n</tasks.md>`)
  parts.push(
    '',
    'Apply each redirect to the affected artifact(s) at their existing paths under openspec/changes/' +
      `${input.changeName}/. After applying, scan the other artifacts for stale references to what you ` +
      'changed and update them.',
    'Do not rewrite the artifacts wholesale — apply the redirects and fix obvious staleness only.',
    `Write a JSON report to ${input.reportPath}: {"files_updated": ["<paths relative to the repo root>"]}`,
  )
  return parts.join('\n')
}

export async function updateAssumptionsFromVetoes(
  sidecarDir: string,
  round: number,
  vetoes: readonly VetoEntry[],
): Promise<void> {
  const sidecarPath = path.join(sidecarDir, `resolutions-${round}.json`)
  let raw: string
  try {
    raw = await readFile(sidecarPath, 'utf8')
  } catch {
    return
  }
  const parsed = ResolverOutputSchema.parse(JSON.parse(raw))
  const vetoById = new Map(vetoes.map((v) => [v.id, v]))
  for (const assumption of parsed.assumptions) {
    const veto = vetoById.get(assumption.id)
    if (veto === undefined) continue
    if (veto.redirect !== undefined && veto.redirect.length > 0) {
      assumption.text = veto.redirect
    } else {
      assumption.status = 'vetoed'
    }
  }
  for (const resolution of parsed.resolutions) {
    const veto = vetoById.get(resolution.id)
    if (veto === undefined || veto.redirect === undefined || veto.redirect.length === 0) continue
    resolution.outcome = veto.redirect
  }
  await writeFile(sidecarPath, `${JSON.stringify(parsed)}\n`)
}

const ARTIFACT_FILE_NAMES = ['proposal.md', 'design.md', 'tasks.md'] as const
type ArtifactField = 'proposal' | 'design' | 'tasks'
const ARTIFACT_FIELD_BY_FILE: Record<(typeof ARTIFACT_FILE_NAMES)[number], ArtifactField> = {
  'proposal.md': 'proposal',
  'design.md': 'design',
  'tasks.md': 'tasks',
}

function walkMarkdown(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkMarkdown(full))
    else if (entry.name.endsWith('.md')) out.push(full)
  }
  return out
}

async function readArtifactContent(changeDir: string): Promise<VetoUpdaterArtifactContent> {
  const result: { proposal?: string; design?: string; specs?: string; tasks?: string } = {}
  await Promise.all(
    ARTIFACT_FILE_NAMES.map(async (name) => {
      try {
        result[ARTIFACT_FIELD_BY_FILE[name]] = await readFile(path.join(changeDir, name), 'utf8')
      } catch {
        /* file does not exist — skip */
      }
    }),
  )
  const specsDir = path.join(changeDir, 'specs')
  if (existsSync(specsDir)) {
    const files = walkMarkdown(specsDir).map((p) => path.relative(specsDir, p))
    if (files.length > 0) {
      const contents = await Promise.all(files.map((f) => readFile(path.join(specsDir, f), 'utf8').catch(() => '')))
      result.specs = files.map((f, i) => `<!-- ${f} -->\n${contents[i] ?? ''}`).join('\n\n')
    }
  }
  return result
}

async function readAssumptionLookup(sidecarDir: string, round: number): Promise<readonly GateAssumption[]> {
  try {
    const raw = await readFile(path.join(sidecarDir, `resolutions-${round}.json`), 'utf8')
    const parsed = ResolverOutputSchema.parse(JSON.parse(raw))
    return parsed.assumptions.map((a) => ({ id: a.id, text: a.text, blast_radius: a.blast_radius }))
  } catch {
    return []
  }
}

async function readFindingLookup(sidecarDir: string, round: number): Promise<readonly GateFinding[]> {
  try {
    const raw = await readFile(path.join(sidecarDir, `findings-${round}.json`), 'utf8')
    const parsed = FindingsSidecarSchema.parse(JSON.parse(raw))
    return parsed.findings.map((f) => ({ id: f.id, gap: f.gap, evidence: f.question }))
  } catch {
    return []
  }
}

export const VetoUpdaterReportSchema = z.object({ files_updated: z.array(z.string()) })

export interface VetoUpdaterDeps {
  readonly driver: OpenSpecDriver
  readonly agent: AgentLayerDeps
  readonly runDir: string
  readonly sidecarDir: string
  readonly cwd: string
}

export interface VetoUpdaterInput {
  readonly changeName: string
  readonly round: number
  readonly vetoes: readonly VetoEntry[]
}

export interface VetoUpdaterResult {
  readonly filesUpdated: readonly string[]
}

const VETO_UPDATER_MAX_ATTEMPTS = 2

async function attemptVetoUpdater(
  deps: VetoUpdaterDeps,
  input: VetoUpdaterInput,
  changeDir: string,
  artifacts: VetoUpdaterArtifactContent,
  assumptions: readonly GateAssumption[],
  findings: readonly GateFinding[],
  attempt: number,
  lastError: string | null,
): Promise<VetoUpdaterResult> {
  const basePrompt = buildVetoUpdaterPrompt({
    changeName: input.changeName,
    assumptions,
    findings,
    vetoes: input.vetoes,
    artifacts,
    reportPath: agentWritePath(deps.cwd, 'veto-updater.json'),
  })
  const prompt = lastError === null ? basePrompt : `${basePrompt}\n\nPrevious attempt failed validation:\n${lastError}`
  const result = await runStageAgent(deps.agent, {
    role: 'resolver',
    changeName: input.changeName,
    cwd: deps.cwd,
    prompt,
    outputPath: 'veto-updater.json',
    outputSchema: VetoUpdaterReportSchema,
    label: 'veto-updater',
    runDir: deps.runDir,
    round: input.round,
    sidecarDir: deps.sidecarDir,
  })
  const validation = await deps.driver.validateStrict(input.changeName)
  if (validation.ok) return { filesUpdated: result.value.files_updated }
  if (attempt >= VETO_UPDATER_MAX_ATTEMPTS) {
    throw new Error(`veto updater failed validation after ${VETO_UPDATER_MAX_ATTEMPTS} attempts: ${validation.output}`)
  }
  return attemptVetoUpdater(deps, input, changeDir, artifacts, assumptions, findings, attempt + 1, validation.output)
}

/**
 * The veto-updater revision pass (C4 D8): one resolver agent applies the
 * vetoes' redirects to the existing artifacts (never a wholesale rewrite),
 * re-validated strictly, reporting the files it touched.
 */
export async function runVetoUpdater(deps: VetoUpdaterDeps, input: VetoUpdaterInput): Promise<VetoUpdaterResult> {
  const changeDir = path.join(deps.cwd, 'openspec', 'changes', input.changeName)
  const [artifacts, assumptions, findings] = await Promise.all([
    readArtifactContent(changeDir),
    readAssumptionLookup(deps.sidecarDir, input.round),
    readFindingLookup(deps.sidecarDir, input.round),
  ])
  return attemptVetoUpdater(deps, input, changeDir, artifacts, assumptions, findings, 1, null)
}
