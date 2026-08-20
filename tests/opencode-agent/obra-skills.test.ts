// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import path from 'node:path'

import type { Logger } from '../../opencode-agent/src/logger.js'
import { loadSkills, PHASE_SKILLS, stripFrontmatter } from '../../opencode-agent/src/obra-skills.js'
import type { LoadSkillsOptions, ReadSkillFile } from '../../opencode-agent/src/obra-skills.js'
import { PHASES } from '../../opencode-agent/src/types.js'

/**
 * The skill rewiring (design D4) and loader root precedence (D11).
 *
 * D4 routes the agent onto the repo's OpenSpec skills — `INIT_OR_CLARIFY` to
 * `openspec-explore`, `PLANNING` to `openspec-propose` — and drops the retired
 * `brainstorming` / `writing-plans` / `executing-plans` names. Execution skills
 * (`test-driven-development`, `verification-before-completion`,
 * `systematic-debugging`) stay on the apply layer.
 *
 * D11 orders the loader roots so in-repo OpenSpec trees win first: `.opencode/skills/`,
 * then `.agents/skills/`, then the pinned superpowers roots. First-hit wins, so the
 * openspec skills resolve from `.opencode/skills/` and the execution skills keep
 * resolving from the pinned `.superpowers/` checkout.
 */

const RETIRED_SKILLS = ['brainstorming', 'writing-plans', 'executing-plans'] as const

describe('PHASE_SKILLS (design D4)', () => {
  it('routes INIT_OR_CLARIFY to openspec-explore and drops brainstorming', () => {
    expect(PHASE_SKILLS.INIT_OR_CLARIFY.required).toContain('openspec-explore')
    expect(PHASE_SKILLS.INIT_OR_CLARIFY.required).not.toContain('brainstorming')
    expect([...PHASE_SKILLS.INIT_OR_CLARIFY.required, ...PHASE_SKILLS.INIT_OR_CLARIFY.optional]).not.toContain(
      'writing-plans',
    )
  })

  it('routes PLANNING to openspec-propose and drops writing-plans / executing-plans', () => {
    expect(PHASE_SKILLS.PLANNING.required).toEqual(['openspec-propose'])
    const all = [...PHASE_SKILLS.PLANNING.required, ...PHASE_SKILLS.PLANNING.optional]
    expect(all).not.toContain('writing-plans')
    expect(all).not.toContain('executing-plans')
  })

  it('keeps REVIEW_AND_MUTATE on the apply layer (TDD + verification)', () => {
    expect(PHASE_SKILLS.REVIEW_AND_MUTATE.required).toContain('test-driven-development')
    expect(PHASE_SKILLS.REVIEW_AND_MUTATE.optional).toContain('verification-before-completion')
    const all = [...PHASE_SKILLS.REVIEW_AND_MUTATE.required, ...PHASE_SKILLS.REVIEW_AND_MUTATE.optional]
    expect(all).not.toContain('executing-plans')
  })

  it('keeps CI_FIX on systematic-debugging', () => {
    expect(PHASE_SKILLS.CI_FIX.required).toContain('systematic-debugging')
  })

  it('references none of the retired skill names anywhere in the table', () => {
    for (const phase of PHASES) {
      const entry = PHASE_SKILLS[phase]
      const all = [...entry.required, ...entry.optional]
      for (const retired of RETIRED_SKILLS) {
        expect(all).not.toContain(retired)
      }
    }
  })

  it('references openspec-explore and openspec-propose (the repo OpenSpec skills)', () => {
    const all = PHASES.flatMap((phase) => {
      const entry = PHASE_SKILLS[phase]
      return [...entry.required, ...entry.optional]
    })
    expect(all).toContain('openspec-explore')
    expect(all).toContain('openspec-propose')
  })
})

describe('loader root precedence (design D11)', () => {
  /**
   * A fake reader that "finds" a SKILL.md only at the paths given, returning
   * frontmatter-bearing content. Mirrors what `loadOneSkill` does on disk
   * without depending on which skill trees a given checkout has. Non-async with
   * explicit Promises (the lint-clean shape this workspace's other fake takes).
   */
  const reader =
    (files: Record<string, string>): ReadSkillFile =>
    (filePath) => {
      const content = files[filePath]
      if (content === undefined) return Promise.reject(new Error('ENOENT'))
      return Promise.resolve(content)
    }

  const options = (
    repoRoot: string,
    roots: readonly string[],
    files: Record<string, string>,
    log?: Logger,
  ): LoadSkillsOptions => ({ repoRoot, roots, read: reader(files), ...(log === undefined ? {} : { log }) })

  const skillPath = (root: string, name: string): string => path.join('/repo', root, name, 'SKILL.md')

  it('resolves a skill from the first root that has it (first-hit wins)', async () => {
    const roots = ['.opencode/skills', '.agents/skills', '.superpowers/skills']
    // openspec-explore exists in both .opencode/skills and .agents/skills; the
    // .opencode copy must win.
    const files = {
      [skillPath('.opencode/skills', 'openspec-explore')]: '---\nname: x\n---\nbody',
      [skillPath('.agents/skills', 'openspec-explore')]: '---\nname: x\n---\nother',
    }
    const [doc] = await loadSkills(['openspec-explore'], options('/repo', roots, files))
    expect(doc?.path).toBe(skillPath('.opencode/skills', 'openspec-explore'))
  })

  it('falls through to a later root when an earlier root does not have the skill', async () => {
    const roots = ['.opencode/skills', '.agents/skills', '.superpowers/skills']
    // An execution skill absent from the in-repo OpenSpec trees but present in
    // the pinned superpowers checkout resolves from .superpowers/skills.
    const files = { [skillPath('.superpowers/skills', 'test-driven-development')]: 'body' }
    const [doc] = await loadSkills(['test-driven-development'], options('/repo', roots, files))
    expect(doc?.path).toBe(skillPath('.superpowers/skills', 'test-driven-development'))
  })

  it('returns null (and logs) for a skill no root carries', async () => {
    const roots = ['.opencode/skills', '.agents/skills']
    const lines: string[] = []
    const log: Logger = {
      debug: () => {},
      info: () => {},
      warn: (_fields, message) => void lines.push(message),
      error: () => {},
    }
    const docs = await loadSkills(['missing-skill'], options('/repo', roots, {}, log))
    expect(docs).toEqual([])
    expect(lines.some((line) => line.includes('not found'))).toBe(true)
  })

  it('treats an empty file as a miss and keeps walking', async () => {
    const roots = ['.opencode/skills', '.agents/skills']
    const files = {
      [skillPath('.opencode/skills', 'x')]: '',
      [skillPath('.agents/skills', 'x')]: 'real body',
    }
    const [doc] = await loadSkills(['x'], options('/repo', roots, files))
    expect(doc?.path).toBe(skillPath('.agents/skills', 'x'))
  })
})

describe('stripFrontmatter', () => {
  it('drops a YAML frontmatter block and trims', () => {
    expect(stripFrontmatter('---\nname: hi\ndescription: x\n---\nbody')).toBe('body')
  })

  it('leaves content without frontmatter untouched (trimmed)', () => {
    expect(stripFrontmatter('just body')).toBe('just body')
  })
})
