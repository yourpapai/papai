// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { z } from 'zod'

import { isFrozenEnforcementPath } from '../../scripts/story/inputs.js'
import { STORY_SANDBOX_LINUX_IMAGE } from '../../scripts/story/sandbox.js'

const repositoryRoot = path.resolve(import.meta.dir, '../..')
const readRepositoryFile = (relative: string): string => readFileSync(path.join(repositoryRoot, relative), 'utf8')

const PULL_SCRIPT = 'scripts/ci/pull-story-sandbox-image.sh'

/**
 * The steps of one workflow job, decoded from the YAML rather than matched in
 * it: the ordering assertion below is about which step runs first, and a
 * substring search over the whole file cannot answer that.
 */
const WorkflowSchema = z.object({
  jobs: z.record(
    z.string(),
    z.object({ steps: z.array(z.object({ name: z.string().optional(), run: z.string().optional() })).optional() }),
  ),
})

const jobSteps = (workflow: string, job: string): readonly { name?: string; run?: string }[] => {
  const parsed = WorkflowSchema.parse(Bun.YAML.parse(readRepositoryFile(workflow)))
  return parsed.jobs[job]?.steps ?? []
}

describe('story sandbox image single source', () => {
  test('the checked-in image file is the exported reference', () => {
    expect(readRepositoryFile('scripts/story/sandbox-image.txt').trim()).toBe(STORY_SANDBOX_LINUX_IMAGE)
  })

  test('the pinned reference carries a sha256 digest and the required Bun tag', () => {
    expect(STORY_SANDBOX_LINUX_IMAGE).toMatch(/^docker\.io\/oven\/bun:1\.3\.13@sha256:[a-f0-9]{64}$/u)
  })

  test('sandbox.ts does not hardcode a digest', () => {
    expect(readRepositoryFile('scripts/story/sandbox.ts')).not.toContain('sha256:')
  })

  test('the image file is a frozen enforcement input', () => {
    expect(isFrozenEnforcementPath('scripts/story/sandbox-image.txt')).toBe(true)
    expect(isFrozenEnforcementPath('scripts/story/other.txt')).toBe(false)
  })

  test.each(['.github/workflows/ci.yml', '.github/workflows/story-stress.yml'])(
    '%s reads the image file instead of hardcoding it',
    (workflow) => {
      const contents = readRepositoryFile(workflow)
      expect(contents).toContain('cat scripts/story/sandbox-image.txt')
      expect(contents).not.toContain('sha256:')
    },
  )

  test.each(['.github/workflows/ci.yml', '.github/workflows/story-stress.yml'])(
    '%s pulls the image through the retrying script rather than a bare `docker pull`',
    (workflow) => {
      // A one-shot pull is one bad minute at the registry away from a red lane,
      // and Docker Hub rejects an anonymous pull per runner IP rather than per
      // repository. The script is where the retry lives, so a workflow that
      // pulls around it has quietly opted out of it.
      const contents = readRepositoryFile(workflow)
      expect(contents).toContain(PULL_SCRIPT)
      expect(contents).not.toContain('docker pull')
    },
  )

  test('the suite lane warms the image before it runs the suite that requires it', () => {
    // `CI` makes the Docker-backed boundary tests mandatory in every job that
    // discovers them, and `Checks` speaks to Docker nowhere else — so the first
    // `docker run` inside a test was also the job's first registry pull. Run
    // 31932802512 is that arrangement failing: `unauthorized: authentication
    // required`, reported as a failed boundary assertion. Order is the whole
    // point, so this asserts the position, not merely the presence.
    const steps = jobSteps('.github/workflows/ci.yml', 'check')
    const warm = steps.findIndex((step) => step.run?.includes(PULL_SCRIPT) === true)
    const suite = steps.findIndex((step) => step.run?.includes('bun check:full') === true)
    expect(warm).toBeGreaterThanOrEqual(0)
    expect(suite).toBeGreaterThan(warm)
  })

  test('the commands documentation points at the image file instead of hardcoding the digest', () => {
    const contents = readRepositoryFile('docs/architecture/commands.md')
    expect(contents).not.toMatch(/oven\/bun:[^\s`]*@sha256:/u)
    expect(contents).toContain('scripts/story/sandbox-image.txt')
  })
})
