// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import type { EventInput } from '../events.js'
import type { GateDigestInput } from './gate-model.js'
import { writeGateDigest } from './gate-render.js'

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

function listAgentArtifacts(changeDir: string): string[] {
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

/**
 * Full presentation (C4 seam face): write the gate digest MD and its
 * presentation-time hashes sidecar, then append the `gate presented` event
 * through the emit boundary. The sidecar is the integrity oracle every later
 * settle verifies against.
 */
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

/**
 * Shared integrity verification every settle runs — human and policy paths
 * alike: artifact-hash comparison against the presentation-time
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
