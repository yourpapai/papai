// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import type { EventInput } from './events.js'
import { readEvents } from './events.js'
import { parseGateResponse, writeGateDigest } from './gate-model.js'
import type { GateAssumption, GateBlocker, GateChild, GateDigestInput } from './gate-model.js'
import { loadRunState, saveRunState } from './run-state.js'

const HashesSchema = z.record(z.string(), z.string())

const AGENT_ARTIFACT_GLOBS = ['proposal.md', 'design.md', 'tasks.md']
const DRIFT_PREFIX = 'specs/'

export type ArtifactHashes = Record<string, string>

export async function recordArtifactHashes(changeDir: string, relPaths: readonly string[]): Promise<ArtifactHashes> {
  const entries = await Promise.all(
    relPaths.map(async (rel): Promise<[string, string | null]> => {
      try {
        const content = await readFile(path.join(changeDir, rel), 'utf8')
        return [rel, createHash('sha256').update(content).digest('hex')]
      } catch {
        return [rel, null]
      }
    }),
  )
  const hashes: ArtifactHashes = {}
  for (const [rel, hash] of entries) {
    if (hash !== null) hashes[rel] = hash
  }
  return hashes
}

export function detectHandEdits(before: ArtifactHashes, after: ArtifactHashes): string[] {
  return Object.keys(after).filter((rel) => before[rel] !== after[rel])
}

export interface GateDeps {
  readonly emit: (event: EventInput) => void
  readonly runDir: string
  readonly changeDir: string
  readonly driftCheck: (editedFiles: readonly string[]) => Promise<void>
}

export type PresentGateInput = GateDigestInput

export interface PresentGateResult {
  readonly gateMdPath: string
  readonly version: number
}

/**
 * The agent-authored artifacts of a change: proposal, design, tasks and every
 * spec delta. Deliberately excludes `review.md` and `assumptions.md`, which the
 * runner regenerates wholesale each round — including them would make every
 * round look changed.
 */
export function listAgentArtifacts(changeDir: string): string[] {
  const rels = [...AGENT_ARTIFACT_GLOBS]
  const specsDir = path.join(changeDir, 'specs')
  if (existsSync(specsDir)) {
    const walk = (dir: string): string[] => {
      const out: string[] = []
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) out.push(...walk(full))
        else if (entry.name.endsWith('.md')) out.push(path.relative(changeDir, full))
      }
      return out
    }
    rels.push(...walk(specsDir))
  }
  return rels.filter((rel) => existsSync(path.join(changeDir, rel)))
}

export async function presentGate(deps: GateDeps, input: PresentGateInput): Promise<PresentGateResult> {
  const gateMdPath = path.join(deps.runDir, `gate-${input.version}.md`)
  const md = writeGateDigest(input)
  await writeFile(gateMdPath, `${md}\n`)
  const artifacts = listAgentArtifacts(deps.changeDir)
  const hashes = await recordArtifactHashes(deps.changeDir, artifacts)
  await writeFile(path.join(deps.runDir, `gate-hashes-${input.version}.json`), `${JSON.stringify(hashes, null, 2)}\n`)
  deps.emit({ altitude: 'L2', type: 'gate', action: 'presented', mode: input.mode, version: input.version })
  return { gateMdPath, version: input.version }
}

export interface ResumeGateInput {
  readonly version: number
  readonly assumptions: readonly GateAssumption[]
  readonly blockers: readonly GateBlocker[]
  readonly findings?: readonly GateBlocker[]
  readonly requiredAck?: string
  /** Plan-mode child rows (D4/D12): one `C<n>` checkbox per planned child. */
  readonly children?: readonly GateChild[]
  readonly gateMode: 'early' | 'final' | 'plan'
}

export type GateOutcome =
  | { readonly kind: 'approved' }
  | { readonly kind: 'veto'; readonly vetoes: readonly { readonly id: string; readonly redirect?: string }[] }
  | { readonly kind: 'aborted' }
  | { readonly kind: 'extend' }

/**
 * Shared integrity verification every approved gate runs — human and policy
 * paths alike: artifact-hash comparison against the presentation-time
 * `gate-hashes-<version>.json` sidecar, the drift check when spec/design
 * files were touched, and `human_edits` emission when anything changed.
 */
export async function verifyGateIntegrity(deps: GateDeps, version: number): Promise<void> {
  const beforeRaw = await readFile(path.join(deps.runDir, `gate-hashes-${version}.json`), 'utf8')
  const before = HashesSchema.parse(JSON.parse(beforeRaw))
  const artifacts = listAgentArtifacts(deps.changeDir)
  const after = await recordArtifactHashes(deps.changeDir, artifacts)
  const edited = detectHandEdits(before, after)
  if (edited.some((file) => file.startsWith(DRIFT_PREFIX) || file === 'design.md')) {
    await deps.driftCheck(edited)
  }
  if (edited.length > 0) {
    deps.emit({ altitude: 'L2', type: 'human_edits', action: 'detected', files: edited })
  }
}

export async function resumeGate(deps: GateDeps, input: ResumeGateInput): Promise<GateOutcome> {
  const gateMdPath = path.join(deps.runDir, `gate-${input.version}.md`)
  const md = await readFile(gateMdPath, 'utf8')
  const response = parseGateResponse(md, {
    assumptions: input.assumptions,
    blockers: input.blockers,
    ...(input.findings === undefined ? {} : { findings: input.findings }),
    ...(input.requiredAck === undefined ? {} : { requiredAck: input.requiredAck }),
    ...(input.children === undefined ? {} : { children: input.children }),
    gateMode: input.gateMode,
  })
  // The hard-coded 'final' on the abort/approve/veto answers is a pinned
  // early-gate quirk; plan-mode answers carry their true mode (D12).
  const answeredMode = input.gateMode === 'plan' ? 'plan' : 'final'
  if (response.abort) {
    deps.emit({ altitude: 'L2', type: 'gate', action: 'answered', mode: answeredMode, version: input.version })
    return { kind: 'aborted' }
  }
  if (response.extend) {
    deps.emit({ altitude: 'L2', type: 'gate', action: 'answered', mode: input.gateMode, version: input.version })
    return { kind: 'extend' }
  }
  await verifyGateIntegrity(deps, input.version)
  deps.emit({ altitude: 'L2', type: 'gate', action: 'answered', mode: answeredMode, version: input.version })
  if (response.approved) return { kind: 'approved' }
  return { kind: 'veto', vetoes: response.vetoes }
}

export function vetoRedirects(outcome: GateOutcome): readonly { readonly id: string; readonly redirect?: string }[] {
  if (outcome.kind === 'veto') return outcome.vetoes
  return []
}

export interface GateReopenInput {
  readonly workDir: string
  readonly runId: string
  readonly gateVersion: number
  readonly changeDir: string
}

/**
 * `sdd-runner gate reopen <runId> --gate <n>` (D9): re-present a settled
 * auto-decided gate as pending at a fresh version, re-rendered as an
 * unanswered digest (boxes unchecked, answered section cleared, digest
 * sections carried over), with a fresh `gate-hashes-<freshVersion>.json`
 * computed over current artifacts (old hashes never copied forward — they
 * would false-positive `detectHandEdits`). A terminal `completed` status
 * reverts to the pre-settle stage state (`gate`) so resume re-drives the
 * settle path; deadline fields are cleared; `state.gate` becomes pending so
 * the existing veto/abort resume mechanics apply.
 */
export async function runGateReopen(
  deps: { readonly stdout?: (line: string) => void; readonly now?: () => Date },
  workDir: string,
  runId: string,
  gateVersion: number,
): Promise<{ readonly runId: string; readonly gateVersion: number; readonly gateMdPath: string }> {
  const state = await loadRunState(workDir, runId)
  if (state.gate !== null) {
    throw new Error(`run ${runId} already has a pending gate (v${state.gate.version}) — settle or resume it first`)
  }
  const settledGate = latestSettledGate(
    readEvents(path.join(state.runDir, 'events.ndjson')).filter((event) => event.type === 'gate'),
  )
  if (settledGate === null) {
    throw new Error(`run ${runId} has no settled gate to reopen`)
  }
  if (settledGate.version !== gateVersion) {
    throw new Error(
      `gate ${gateVersion} is not the latest settled gate of run ${runId} (latest is v${settledGate.version})`,
    )
  }
  const sourceMdPath = path.join(state.runDir, `gate-${gateVersion}.md`)
  if (!existsSync(sourceMdPath)) {
    throw new Error(`gate-${gateVersion}.md does not exist for run ${runId}`)
  }
  const freshVersion = settledGate.version + 1
  if (settledGate.mode === 'plan') {
    throw new Error(
      `run ${runId}: a 'plan' gate cannot be reopened (plan gates re-present through a veto round, not reopen)`,
    )
  }
  const reopenedMd = renderUnansweredDigest(await readFile(sourceMdPath, 'utf8'))
  const gateMdPath = path.join(state.runDir, `gate-${freshVersion}.md`)
  await writeFile(gateMdPath, `${reopenedMd}\n`)
  const changeDir = path.join(state.repoRoot, 'openspec', 'changes', state.changeName)
  const artifacts = listAgentArtifacts(changeDir)
  const hashes = await recordArtifactHashes(changeDir, artifacts)
  await writeFile(path.join(state.runDir, `gate-hashes-${freshVersion}.json`), `${JSON.stringify(hashes, null, 2)}\n`)
  state.gate = { mode: settledGate.mode, version: freshVersion }
  state.status = 'running'
  state.gateDeadlineAt = null
  state.gateDeadlineReArmed = false
  await saveRunState(state, deps.now?.() ?? new Date())
  deps.stdout?.(path.relative(state.repoRoot, gateMdPath))
  deps.stdout?.(`Next: sdd ${runId}`)
  return { runId, gateVersion: freshVersion, gateMdPath }
}

function latestSettledGate(
  gateEvents: readonly {
    readonly action: string
    readonly mode: 'early' | 'final' | 'plan'
    readonly version: number
  }[],
): { readonly mode: 'early' | 'final' | 'plan'; readonly version: number } | null {
  let latest: { mode: 'early' | 'final' | 'plan'; version: number } | null = null
  for (const event of gateEvents) {
    if (event.action === 'answered') latest = { mode: event.mode, version: event.version }
  }
  return latest
}

/** Version of the run's most recently answered gate, or null when none settled. */
export async function latestSettledGateVersion(workDir: string, runId: string): Promise<number | null> {
  const state = await loadRunState(workDir, runId)
  const settled = latestSettledGate(
    readEvents(path.join(state.runDir, 'events.ndjson')).filter((event) => event.type === 'gate'),
  )
  return settled?.version ?? null
}

/**
 * Re-render a settled gate file as an unanswered digest: drop the
 * `## Gate response` section, uncheck every checkbox, carry the digest
 * sections over verbatim.
 */
function renderUnansweredDigest(md: string): string {
  const lines = md.split('\n')
  const responseStart = lines.findIndex((line) => line.trim() === '## Gate response')
  const kept = responseStart === -1 ? lines : lines.slice(0, responseStart)
  const unchecked = kept.map((line) => line.replace(/^(\s*-\s*\[)x(\])/u, '$1 $2'))
  return unchecked.join('\n').trimEnd()
}
