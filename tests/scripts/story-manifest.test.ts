// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  buildBaselineStoryManifest,
  buildCandidateStoryManifest,
  compareStoryManifests,
  parseStoryManifestArguments,
  StoryManifestSchema,
  writeStoryManifest,
} from '../../scripts/story-manifest.js'

const roots: string[] = []
const PROJECT_ROOT = path.resolve(import.meta.dir, '../..')

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function git(root: string, ...args: readonly string[]): string {
  const result = Bun.spawnSync(['git', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  return result.stdout.toString().trim()
}

function fixture(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'papai-story-manifest-'))
  roots.push(root)
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 'stories@example.invalid')
  git(root, 'config', 'user.name', 'Story Tests')
  git(root, 'config', 'commit.gpgsign', 'false')
  mkdirSync(path.join(root, 'tests/stories/harness'), { recursive: true })
  mkdirSync(path.join(root, 'tests/stories/user stories'), { recursive: true })
  mkdirSync(path.join(root, 'tests/utils'), { recursive: true })
  mkdirSync(path.join(root, 'scripts'), { recursive: true })
  writeFileSync(path.join(root, 'bunfig.toml'), '[test]')
  writeFileSync(path.join(root, 'tests/stories/harness/helper.ts'), Buffer.from([0, 10, 255]))
  writeFileSync(
    path.join(root, 'tests/stories/user stories/example.story.test.ts'),
    `scenario('alpha story', async ({ then }) => {\n  then.replyIn(context).equals('ok')\n  await then.task('A').exists()\n})\n` +
      `test('wrapped', async () => {\n  await executeScenario('nested story', async ({ then }) => {\n    then.responseStatus(response, 200)\n  })\n})\n`,
  )
  writeFileSync(path.join(root, 'scripts/test-stories.ts'), 'runner enforcement')
  writeFileSync(path.join(root, 'scripts/story-manifest.ts'), 'manifest enforcement')
  writeFileSync(path.join(root, 'scripts/story-reports.ts'), 'report enforcement')
  writeFileSync(path.join(root, 'scripts/story-runner-arguments.ts'), 'argument enforcement')
  writeFileSync(path.join(root, 'tests/setup.ts'), 'test setup')
  writeFileSync(path.join(root, 'tests/mock-reset.ts'), 'test reset')
  writeFileSync(path.join(root, 'tests/utils/test-helpers.ts'), `export * from './logger-mock.js'`)
  writeFileSync(path.join(root, 'tests/utils/logger-mock.ts'), 'logger mock')
  git(root, 'add', '--', 'bunfig.toml', 'tests', 'scripts')
  git(root, 'commit', '-qm', 'baseline')
  return root
}

describe('story manifest', () => {
  test('hashes every regular file as raw bytes with sorted POSIX paths', async () => {
    const root = fixture()

    const manifest = await buildCandidateStoryManifest({ root, seed: 41021, bunVersion: '1.2.3' })
    const repeated = await buildCandidateStoryManifest({ root, seed: 41021, bunVersion: '1.2.3' })

    expect(StoryManifestSchema.parse(manifest)).toEqual(manifest)
    expect(repeated.treeHash).toBe(manifest.treeHash)
    expect(manifest.files.map(({ path: filePath }) => filePath)).toEqual([
      'bunfig.toml',
      'scripts/story-manifest.ts',
      'scripts/story-reports.ts',
      'scripts/story-runner-arguments.ts',
      'scripts/test-stories.ts',
      'tests/mock-reset.ts',
      'tests/setup.ts',
      'tests/stories/harness/helper.ts',
      'tests/stories/user stories/example.story.test.ts',
      'tests/utils/logger-mock.ts',
      'tests/utils/test-helpers.ts',
    ])
    expect(manifest.files.find(({ path: filePath }) => filePath.endsWith('harness/helper.ts'))?.sha256).toBe(
      'a0956176ad28cadf4a54b314f9fcd6143d7007957454286ff24580445304b558',
    )
    expect(manifest.scenarios).toEqual([
      {
        id: 'tests/stories/user stories/example.story.test.ts#alpha story',
        checkpoints: ['then.replyIn.equals', 'then.task.exists'],
      },
      {
        id: 'tests/stories/user stories/example.story.test.ts#nested story',
        checkpoints: ['then.responseStatus'],
      },
    ])
  })

  test('removes the temporary manifest when atomic publication fails', async () => {
    const root = fixture()
    const manifest = await buildCandidateStoryManifest({ root, seed: 41021 })
    const reportDirectory = path.join(root, 'reports/stories')
    const outputPath = path.join(reportDirectory, 'manifest.json')
    mkdirSync(outputPath, { recursive: true })

    await expect(writeStoryManifest(manifest, outputPath)).rejects.toThrow()

    expect(readdirSync(reportDirectory)).toEqual(['manifest.json'])
  })

  test('removes a partial temporary manifest when writing fails', async () => {
    const root = fixture()
    const manifest = await buildCandidateStoryManifest({ root, seed: 41021 })
    const outputPath = path.join(root, 'reports/stories/manifest.json')
    let temporary = ''

    await expect(
      writeStoryManifest(manifest, outputPath, {
        write: (temporaryPath): Promise<void> => {
          temporary = temporaryPath
          writeFileSync(temporaryPath, 'partial')
          return Promise.reject(new Error('write failed'))
        },
        rename: (): Promise<void> => Promise.reject(new Error('rename must not run')),
        removeTemporary: (temporaryPath): Promise<void> => {
          rmSync(temporaryPath, { force: true })
          return Promise.resolve()
        },
      }),
    ).rejects.toThrow('write failed')

    expect(temporary).not.toBe('')
    expect(existsSync(temporary)).toBe(false)
  })

  test('reads committed baseline blobs rather than worktree bytes and handles spaces', async () => {
    const root = fixture()
    const baselineRef = git(root, 'rev-parse', 'HEAD')
    const baseline = await buildBaselineStoryManifest({ root, ref: baselineRef, seed: 41021, bunVersion: '9.9.9' })
    writeFileSync(path.join(root, 'tests/stories/user stories/example.story.test.ts'), 'changed without commit\n')

    const candidate = await buildCandidateStoryManifest({ root, seed: 41021, bunVersion: '1.0.0' })

    expect(() => compareStoryManifests(candidate, baseline)).toThrow(
      'changed: tests/stories/user stories/example.story.test.ts',
    )
    expect(baseline.commit).toBe(baselineRef)
    expect(baseline.scenarios[0]?.id).toContain('#alpha story')
  })

  test('accepts identical frozen content across different run metadata', async () => {
    const root = fixture()
    const ref = git(root, 'rev-parse', 'HEAD')
    const baseline = await buildBaselineStoryManifest({ root, ref, seed: 1, bunVersion: 'old' })
    const candidate = await buildCandidateStoryManifest({ root, seed: 999, bunVersion: 'new' })

    expect(() => compareStoryManifests(candidate, baseline)).not.toThrow()
  })

  test('reports added, removed, and changed files while ignoring run metadata', async () => {
    const root = fixture()
    const ref = git(root, 'rev-parse', 'HEAD')
    const baseline = await buildBaselineStoryManifest({ root, ref, seed: 1, bunVersion: 'old' })
    writeFileSync(path.join(root, 'tests/stories/harness/helper.ts'), 'changed')
    rmSync(path.join(root, 'tests/stories/user stories/example.story.test.ts'))
    writeFileSync(path.join(root, 'tests/stories/new file.ts'), 'new')
    const candidate = await buildCandidateStoryManifest({ root, seed: 999, bunVersion: 'new' })

    expect(() => compareStoryManifests(candidate, baseline)).toThrow('added: tests/stories/new file.ts')
    expect(() => compareStoryManifests(candidate, baseline)).toThrow(
      'removed: tests/stories/user stories/example.story.test.ts',
    )
    expect(() => compareStoryManifests(candidate, baseline)).toThrow('changed: tests/stories/harness/helper.ts')
  })

  test('detects renamed paths even when bytes are identical', async () => {
    const root = fixture()
    const ref = git(root, 'rev-parse', 'HEAD')
    const baseline = await buildBaselineStoryManifest({ root, ref, seed: 41021 })
    const original = path.join(root, 'tests/stories/harness/helper.ts')
    const renamed = path.join(root, 'tests/stories/harness/renamed.ts')
    writeFileSync(renamed, Buffer.from([0, 10, 255]))
    rmSync(original)
    const candidate = await buildCandidateStoryManifest({ root, seed: 41021 })

    expect(candidate.treeHash).not.toBe(baseline.treeHash)
    expect(() => compareStoryManifests(candidate, baseline)).toThrow('added: tests/stories/harness/renamed.ts')
  })

  test('detects changed and newly added enforcement scripts', async () => {
    const root = fixture()
    const ref = git(root, 'rev-parse', 'HEAD')
    const baseline = await buildBaselineStoryManifest({ root, ref, seed: 41021 })
    writeFileSync(path.join(root, 'scripts/story-manifest.ts'), 'changed enforcement')
    writeFileSync(path.join(root, 'scripts/story-runner-new-guard.ts'), 'new enforcement')
    const candidate = await buildCandidateStoryManifest({ root, seed: 41021 })

    expect(() => compareStoryManifests(candidate, baseline)).toThrow('changed: scripts/story-manifest.ts')
    expect(() => compareStoryManifests(candidate, baseline)).toThrow('added: scripts/story-runner-new-guard.ts')
  })

  test('fails closed on symlinks in the candidate tree', async () => {
    const root = fixture()
    symlinkSync(path.join(root, 'tests/stories/harness/helper.ts'), path.join(root, 'tests/stories/link.ts'))

    await expect(buildCandidateStoryManifest({ root, seed: 41021 })).rejects.toThrow(
      'Unsupported story manifest entry: tests/stories/link.ts (symbolic link)',
    )
  })

  test('fails closed when the entire tests/stories root is a symlink', async () => {
    const root = fixture()
    const external = mkdtempSync(path.join(os.tmpdir(), 'papai-story-external-'))
    roots.push(external)
    writeFileSync(path.join(external, 'same.ts'), 'byte-identical content')
    rmSync(path.join(root, 'tests/stories'), { recursive: true })
    symlinkSync(external, path.join(root, 'tests/stories'))

    await expect(buildCandidateStoryManifest({ root, seed: 41021 })).rejects.toThrow(
      'Unsupported story manifest root: tests/stories (symbolic link)',
    )
  })

  test('reports a missing or non-directory tests/stories root actionably', async () => {
    const root = fixture()
    rmSync(path.join(root, 'tests/stories'), { recursive: true })
    await expect(buildCandidateStoryManifest({ root, seed: 41021 })).rejects.toThrow(
      'Unsupported story manifest root: tests/stories (missing)',
    )

    writeFileSync(path.join(root, 'tests/stories'), 'not a directory')
    await expect(buildCandidateStoryManifest({ root, seed: 41021 })).rejects.toThrow(
      'Unsupported story manifest root: tests/stories (not a directory)',
    )
  })

  test('rejects nonliteral and duplicate scenario identifiers', async () => {
    const root = fixture()
    writeFileSync(
      path.join(root, 'tests/stories/nonliteral.story.test.ts'),
      `scenario(name, async ({ then }) => then.x())\n`,
    )
    await expect(buildCandidateStoryManifest({ root, seed: 41021 })).rejects.toThrow(
      'Scenario name must be a string literal in tests/stories/nonliteral.story.test.ts',
    )

    rmSync(path.join(root, 'tests/stories/nonliteral.story.test.ts'))
    writeFileSync(
      path.join(root, 'tests/stories/duplicate.story.test.ts'),
      `scenario('same', async ({ then }) => then.x())\nscenario('same', async ({ then }) => then.y())\n`,
    )
    await expect(buildCandidateStoryManifest({ root, seed: 41021 })).rejects.toThrow(
      'Duplicate scenario id: tests/stories/duplicate.story.test.ts#same',
    )
  })

  test('rejects nonliteral and duplicate executeScenario identifiers', async () => {
    const root = fixture()
    writeFileSync(
      path.join(root, 'tests/stories/nonliteral-execute.story.test.ts'),
      `test('wrapped', () => executeScenario(name, async ({ then }) => then.x()))\n`,
    )
    await expect(buildCandidateStoryManifest({ root, seed: 41021 })).rejects.toThrow(
      'Scenario name must be a string literal in tests/stories/nonliteral-execute.story.test.ts',
    )

    rmSync(path.join(root, 'tests/stories/nonliteral-execute.story.test.ts'))
    writeFileSync(
      path.join(root, 'tests/stories/duplicate-execute.story.test.ts'),
      `scenario('same', async ({ then }) => then.x())\nexecuteScenario('same', async ({ then }) => then.y())\n`,
    )
    await expect(buildCandidateStoryManifest({ root, seed: 41021 })).rejects.toThrow(
      'Duplicate scenario id: tests/stories/duplicate-execute.story.test.ts#same',
    )
  })

  test('requires an explicit valid baseline ref', async () => {
    const root = fixture()

    await expect(buildBaselineStoryManifest({ root, ref: '', seed: 41021 })).rejects.toThrow(
      'Compatibility mode requires an explicit baseline ref',
    )
    await expect(buildBaselineStoryManifest({ root, ref: 'does-not-exist', seed: 41021 })).rejects.toThrow(
      'Cannot resolve baseline ref "does-not-exist"',
    )
  })

  test('repository manifest includes nested executeScenario calls as logical scenarios', async () => {
    const manifest = await buildCandidateStoryManifest({ root: PROJECT_ROOT, seed: 41021 })
    const eligibility = manifest.scenarios.filter(({ id }) => id.includes('/eligibility.story.test.ts#'))
    const filePaths = manifest.files.map(({ path: filePath }) => filePath)
    const enforcementPaths = [
      'scripts/test-stories.ts',
      'scripts/story-manifest.ts',
      'scripts/story-manifest-scenarios.ts',
      'scripts/story-reports.ts',
      'scripts/story-runner-arguments.ts',
      'scripts/story-runner-environment.ts',
      'scripts/story-runner-integers.ts',
    ]

    expect(manifest.scenarios).toHaveLength(8)
    expect(enforcementPaths.filter((enforcementPath) => !filePaths.includes(enforcementPath))).toEqual([])
    expect(eligibility).toEqual([
      {
        id: 'tests/stories/integrations/plugins/eligibility.story.test.ts#plugin context eligibility',
        checkpoints: [],
      },
      {
        id: 'tests/stories/integrations/plugins/eligibility.story.test.ts#plugin isolation after lifecycle',
        checkpoints: [],
      },
    ])
  })

  test('direct manifest CLI removes a stale standard manifest before a build failure', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'papai-story-cli-failure-'))
    roots.push(root)
    const report = path.join(root, 'reports/stories/manifest.json')
    mkdirSync(path.dirname(report), { recursive: true })
    writeFileSync(report, 'stale')
    const script = path.join(PROJECT_ROOT, 'scripts/story-manifest.ts')
    const child = Bun.spawn(['bun', script], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
    await child.exited

    expect(existsSync(report)).toBe(false)
  })

  test('direct manifest argument parser shares Bun integer lexical rules', () => {
    expect(parseStoryManifestArguments(['--seed=+001'])).toEqual({ seed: 1 })
    expect(parseStoryManifestArguments(['--seed', '0002'])).toEqual({ seed: 2 })
    expect(() => parseStoryManifestArguments(['--seed=1e2'])).toThrow('--seed requires an integer')
    expect(() => parseStoryManifestArguments(['--seed', '1.5'])).toThrow('--seed requires an integer')
    expect(() => parseStoryManifestArguments(['--seed='])).toThrow('--seed requires a non-empty value')
  })

  test('direct manifest CLI clears stale output before rejecting malformed seed syntax', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'papai-story-cli-seed-'))
    roots.push(root)
    const report = path.join(root, 'reports/stories/manifest.json')
    mkdirSync(path.dirname(report), { recursive: true })
    writeFileSync(report, 'stale')
    const script = path.join(PROJECT_ROOT, 'scripts/story-manifest.ts')
    const child = Bun.spawn(['bun', script, '--seed=1e2'], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])

    expect(exitCode).toBe(2)
    expect(stderr).toContain('--seed requires an integer')
    expect(existsSync(report)).toBe(false)
  })
})
