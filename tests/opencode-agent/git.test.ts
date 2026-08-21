// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createGit } from '../../opencode-agent/src/git.js'
import type { Git } from '../../opencode-agent/src/git.js'
import { runCommand } from '../../opencode-agent/src/shell.js'
import { silentLogger } from './test-helpers.js'

/**
 * The three `Git` operations a `/sync` runs on, against real fixture
 * repositories.
 *
 * A merge is not judgeable through a stub: its three outcomes — clean,
 * up-to-date, conflicted — are facts about git's own index and graph, and the
 * point of `mergeBase` returning them as *values* rather than throws is that a
 * conflict is an outcome the handler plans around, not an error it catches. So
 * each fixture below is a real repository with a real `origin`, built the way
 * `ensureBranch` expects to find one.
 *
 * The fourth property pinned here is the one the spec calls "merged base
 * content is preserved verbatim": `completeMerge` never passes the staged tree
 * through `stageAllowed` or the diff guard, so a merge carrying base's own
 * `.github/workflows/` edit lands with that file's base version — where
 * `commitAll` would have dropped it and silently un-merged base.
 */

interface Fixture {
  git: Git
  work: string
  run: (argv: readonly string[], cwd?: string) => Promise<string>
}

const fixtures: Fixture[] = []

afterAll(() => {
  for (const fixture of fixtures) rmSync(fixture.work, { recursive: true, force: true })
})

/** Runs git in a directory and returns stdout, refusing a non-zero exit. */
const gitIn = async (argv: readonly string[], cwd: string): Promise<string> => {
  const result = await runCommand(['git', ...argv], { cwd })
  if (result.exitCode !== 0) throw new Error(`git ${argv[0]} failed: ${result.stderr}`)
  return result.stdout
}

/**
 * A working clone whose `origin` is a bare repo, on the agent branch.
 *
 * `main` carries one commit; `agent/issue-42` is cut from it. Each test then
 * moves the two branches however its scenario needs and pushes, so `origin`
 * is always the source of truth the way it is on a runner.
 */
const makeFixture = async (): Promise<Fixture> => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-git-merge-'))
  const origin = join(dir, 'origin.git')
  const work = join(dir, 'work')
  await gitIn(['init', '--bare', '-b', 'main', origin], dir)
  await gitIn(['init', '-b', 'main', work], dir)
  await gitIn(['remote', 'add', 'origin', origin], work)
  await gitIn(['commit', '--allow-empty', '-m', 'base root'], work)
  await gitIn(['push', '-u', 'origin', 'main'], work)
  await gitIn(['checkout', '-b', 'agent/issue-42'], work)
  await gitIn(['push', '-u', 'origin', 'agent/issue-42'], work)

  const git = createGit({
    run: runCommand,
    cwd: work,
    authorName: 'Maintainer Author',
    authorEmail: 'author@example.test',
    limits: { maxFiles: 100, maxLines: 20_000 },
    secrets: [],
    log: silentLogger(),
    credential: null,
  })
  const fixture: Fixture = {
    git,
    work,
    run: (argv: readonly string[], cwd: string = work) => gitIn(argv, cwd),
  }
  fixtures.push(fixture)
  return fixture
}

/** A commit on `branch` touching `path` with `content`, pushed to origin. */
const commitOn = async (
  fixture: Fixture,
  branch: string,
  path: string,
  content: string,
  message: string,
): Promise<void> => {
  await fixture.run(['checkout', branch])
  mkdirSync(join(fixture.work, ...path.split('/').slice(0, -1)), { recursive: true })
  writeFileSync(join(fixture.work, path), content)
  await fixture.run(['add', '--all'])
  await fixture.run(['commit', '-m', message])
  await fixture.run(['push', 'origin', branch])
}

describe('mergeBase', () => {
  it('reports a clean merge with the number of commits base was ahead', async () => {
    const fixture = await makeFixture()
    // The branches diverge: base moves a README, the agent branch moves its own
    // file — different paths, so the merge is clean.
    await commitOn(fixture, 'main', 'README.md', 'from base\n', 'base moves readme')
    await commitOn(fixture, 'main', 'docs/notes.md', 'also base\n', 'base again')
    await commitOn(fixture, 'agent/issue-42', 'src/feature.ts', 'export {}\n', 'agent work')
    await fixture.run(['checkout', 'agent/issue-42'])

    const outcome = await fixture.git.mergeBase('main')

    expect(outcome).toEqual({ kind: 'clean', commits: 2 })
    // A real merge commit: two parents, and base's commits now reachable.
    const parents = await fixture.run(['log', '-1', '--format=%P'])
    expect(parents.trim().split(' ')).toHaveLength(2)
    const log = await fixture.run(['log', '--oneline'])
    expect(log).toContain('base again')
  })

  it('reports up-to-date when the branch already contains base', async () => {
    const fixture = await makeFixture()
    await commitOn(fixture, 'main', 'README.md', 'from base\n', 'base moves')
    await commitOn(fixture, 'agent/issue-42', 'src/feature.ts', 'export {}\n', 'agent work')
    await fixture.run(['checkout', 'agent/issue-42'])
    // The first sync merges base in; the second finds nothing left to merge.
    const first = await fixture.git.mergeBase('main')
    expect(first).toEqual({ kind: 'clean', commits: 1 })

    const second = await fixture.git.mergeBase('main')

    expect(second).toEqual({ kind: 'up-to-date' })
  })

  it('reports a fast-forward as clean when the branch is strictly behind base', async () => {
    const fixture = await makeFixture()
    await commitOn(fixture, 'main', 'README.md', 'from base\n', 'base only move')
    await fixture.run(['checkout', 'agent/issue-42'])

    const outcome = await fixture.git.mergeBase('main')

    // No unique agent commits: the merge fast-forwards, an ordinary clean sync.
    expect(outcome).toEqual({ kind: 'clean', commits: 1 })
  })

  it('reports the conflicted paths from the unmerged index', async () => {
    const fixture = await makeFixture()
    await commitOn(fixture, 'main', 'src/same.txt', 'base version\n', 'base edits')
    await commitOn(fixture, 'agent/issue-42', 'src/same.txt', 'agent version\n', 'agent edits')
    await fixture.run(['checkout', 'agent/issue-42'])

    const outcome = await fixture.git.mergeBase('main')

    expect(outcome).toEqual({ kind: 'conflicted', paths: ['src/same.txt'] })
  })
})

describe('completeMerge', () => {
  it('commits the resolution with the configured author, no stageAllowed on the path', async () => {
    const fixture = await makeFixture()
    await commitOn(fixture, 'main', 'src/same.txt', 'base version\n', 'base edits')
    await commitOn(fixture, 'agent/issue-42', 'src/same.txt', 'agent version\n', 'agent edits')
    await fixture.run(['checkout', 'agent/issue-42'])
    const conflicted = await fixture.git.mergeBase('main')
    expect(conflicted).toEqual({ kind: 'conflicted', paths: ['src/same.txt'] })

    // The model's repair turn would edit the markers in the working tree; the
    // pipeline alone completes the merge.
    writeFileSync(join(fixture.work, 'src/same.txt'), 'resolved version\n')
    await fixture.git.completeMerge('chore(agent): sync with main\n\nRefs #42')

    const log = await fixture.run(['log', '-1', '--format=%an%n%cn%n%P%n%s'])
    const [author, committer, parents, subject] = log.split('\n')
    expect(subject).toBe('chore(agent): sync with main')
    // Author vs committer split, as every commit this pipeline makes.
    expect(author).toBe('Maintainer Author')
    expect(committer).toBe('Maintainer Author')
    // Two parents: a real merge commit, not a squashed resolution.
    expect(parents?.split(' ')).toHaveLength(2)
    // The tree carries the resolution and nothing is left unmerged.
    const content = await fixture.run(['show', 'HEAD:src/same.txt'])
    expect(content).toBe('resolved version\n')
  })

  it('keeps base workflow edits that stageAllowed would have dropped', async () => {
    const fixture = await makeFixture()
    // Base moved a workflow file — the exact file class the commit path drops.
    await commitOn(fixture, 'main', '.github/workflows/ci.yml', 'base workflow\n', 'base moves workflow')
    await commitOn(fixture, 'agent/issue-42', 'src/feature.ts', 'export {}\n', 'agent work')
    await fixture.run(['checkout', 'agent/issue-42'])

    const outcome = await fixture.git.mergeBase('main')
    expect(outcome).toEqual({ kind: 'clean', commits: 1 })

    // The clean merge auto-commits; the pushed tree must carry base's version.
    const content = await fixture.run(['show', 'HEAD:.github/workflows/ci.yml'])
    expect(content).toBe('base workflow\n')
  })
})

describe('abortMerge', () => {
  it('leaves a clean tree after a conflicted merge', async () => {
    const fixture = await makeFixture()
    await commitOn(fixture, 'main', 'src/same.txt', 'base version\n', 'base edits')
    await commitOn(fixture, 'agent/issue-42', 'src/same.txt', 'agent version\n', 'agent edits')
    await fixture.run(['checkout', 'agent/issue-42'])
    const conflicted = await fixture.git.mergeBase('main')
    expect(conflicted).toEqual({ kind: 'conflicted', paths: ['src/same.txt'] })

    await fixture.git.abortMerge()

    const status = await fixture.run(['status', '--porcelain'])
    expect(status.trim()).toBe('')
    // The branch is exactly where it was: agent's version, no merge parent.
    const parents = await fixture.run(['log', '-1', '--format=%P'])
    expect(parents.trim().split(' ')).toHaveLength(1)
    const content = await fixture.run(['show', 'HEAD:src/same.txt'])
    expect(content).toBe('agent version\n')
  })
})
