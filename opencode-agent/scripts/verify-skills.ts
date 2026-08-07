// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Fails when the vendored superpowers checkout does not satisfy what the phases
 * require.
 *
 * The workflow runs this straight after fetching `obra/superpowers`, before any
 * model credentials are used. It drives the real `loadPhaseSkills`, so it
 * verifies the production code path rather than a bash reimplementation of it —
 * a checkout that is missing, empty, or has renamed a required skill fails here
 * with the skill named, instead of silently producing a thinner prompt.
 *
 * That silent-degradation mode is the whole reason this exists: the skill layer
 * was completely inert for a long time and nothing distinguished it from a
 * working one.
 */

import path from 'node:path'
import process from 'node:process'

import { loadPhaseSkills, PHASE_SKILLS } from '../src/obra-skills.js'
import { mapSeries } from '../src/sequence.js'
import { errorMessage, PHASES } from '../src/types.js'
import type { Phase } from '../src/types.js'

const DEFAULT_ROOTS = ['.superpowers/skills', '.claude/skills']

const verifyPhase = async (phase: Phase, repoRoot: string, roots: readonly string[]): Promise<boolean> => {
  const wanted = [...PHASE_SKILLS[phase].required, ...PHASE_SKILLS[phase].optional]
  if (wanted.length === 0) return true

  try {
    const skills = await loadPhaseSkills(phase, { repoRoot, roots })
    const found = new Set(skills.map((skill) => skill.name))
    const optionalMissing = PHASE_SKILLS[phase].optional.filter((name) => !found.has(name))

    const note = optionalMissing.length === 0 ? '' : ` (optional missing: ${optionalMissing.join(', ')})`
    process.stdout.write(`✓ ${phase}: ${skills.length}/${wanted.length} skills${note}\n`)
    return true
  } catch (error) {
    process.stdout.write(`::error::${phase}: ${errorMessage(error)}\n`)
    return false
  }
}

const run = async (repoRoot: string, roots: readonly string[]): Promise<number> => {
  const results = await mapSeries(PHASES, (phase) => verifyPhase(phase, repoRoot, roots))
  return results.every(Boolean) ? 0 : 1
}

const repoRoot = path.resolve(process.argv[2] ?? process.env['GITHUB_WORKSPACE'] ?? process.cwd())
process.exit(await run(repoRoot, DEFAULT_ROOTS))
