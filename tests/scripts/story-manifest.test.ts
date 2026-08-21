// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { StoryDependencySnapshot } from '../../scripts/story/dependencies.js'
import {
  buildBaselineStoryManifest,
  buildCandidateStoryManifest as acquireCandidateStoryManifest,
  compareStoryManifests,
  StoryManifestSchema,
  writeStoryManifest,
} from '../../scripts/story/manifest.js'
import { writeFrozenCoverageSupport } from './story-frozen-inputs.helpers.js'

const roots: string[] = []
const PROJECT_ROOT = path.resolve(import.meta.dir, '../..')
const TEST_DEPENDENCY_SNAPSHOT: StoryDependencySnapshot = {
  key: 'a'.repeat(64),
  root: '/dependency-cache/node_modules',
  treeHash: 'b'.repeat(64),
}

function buildCandidateStoryManifest(
  options: Readonly<{
    root: string
    seed: number
    bunVersion?: string
    sandboxBackend?: 'linux-docker'
  }>,
  dependencySnapshot: StoryDependencySnapshot = TEST_DEPENDENCY_SNAPSHOT,
): Promise<Awaited<ReturnType<typeof acquireCandidateStoryManifest>>> {
  return acquireCandidateStoryManifest(options, {
    acquireDependencySnapshot: (): Promise<StoryDependencySnapshot> => Promise.resolve(dependencySnapshot),
  })
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function git(root: string, ...args: readonly string[]): string {
  const result = Bun.spawnSync(['git', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  return result.stdout.toString().trim()
}

function fixture(options: Readonly<{ includePublic?: boolean }> = {}): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'papai-story-manifest-'))
  const includesPublic = options.includePublic ?? true
  roots.push(root)
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 'stories@example.invalid')
  git(root, 'config', 'user.name', 'Story Tests')
  git(root, 'config', 'commit.gpgsign', 'false')
  mkdirSync(path.join(root, 'tests/stories/harness'), { recursive: true })
  mkdirSync(path.join(root, 'tests/stories/user stories'), { recursive: true })
  mkdirSync(path.join(root, 'tests/utils'), { recursive: true })
  mkdirSync(path.join(root, 'scripts/story'), { recursive: true })
  mkdirSync(path.join(root, 'src'), { recursive: true })
  mkdirSync(path.join(root, 'plugins/example'), { recursive: true })
  mkdirSync(path.join(root, 'context-vault-indexer'), { recursive: true })
  if (includesPublic) mkdirSync(path.join(root, 'public'), { recursive: true })
  writeFileSync(path.join(root, 'bunfig.toml'), '[test]')
  writeFileSync(path.join(root, 'tests/stories/harness/helper.ts'), Buffer.from([0, 10, 255]))
  writeFileSync(
    path.join(root, 'tests/stories/user stories/example.story.test.ts'),
    `scenario('alpha story', async ({ then }) => {\n  then.replyIn(context).equals('ok')\n  await then.task('A').exists()\n})\n` +
      `test('wrapped', async () => {\n  await executeScenario('nested story', async ({ then }) => {\n    then.responseStatus(response, 200)\n  })\n})\n`,
  )
  writeFrozenCoverageSupport(root)
  writeFileSync(path.join(root, 'scripts/story/test-stories.ts'), 'runner enforcement')
  writeFileSync(path.join(root, 'scripts/story/dependencies-install.ts'), 'dependency installer enforcement')
  writeFileSync(path.join(root, 'scripts/story/dependencies-tree.ts'), 'dependency tree enforcement')
  writeFileSync(path.join(root, 'scripts/story/dependencies.ts'), 'dependency snapshot enforcement')
  writeFileSync(path.join(root, 'scripts/story/cli.ts'), 'argument enforcement')
  writeFileSync(path.join(root, 'scripts/story/manifest.ts'), 'manifest enforcement')
  writeFileSync(path.join(root, 'scripts/story/reports.ts'), 'report enforcement')
  writeFileSync(path.join(root, 'scripts/story/sandbox.ts'), 'sandbox enforcement')
  writeFileSync(path.join(root, 'scripts/story/test-story-sandbox.ts'), 'sandbox launcher enforcement')
  writeFileSync(path.join(root, 'tests/setup.ts'), 'test setup')
  writeFileSync(path.join(root, 'tests/mock-reset.ts'), 'test reset')
  writeFileSync(path.join(root, 'tests/utils/test-helpers.ts'), `export * from './logger-mock.js'`)
  writeFileSync(path.join(root, 'tests/utils/logger-mock.ts'), 'logger mock')
  writeFileSync(path.join(root, 'src/runtime.ts'), 'runtime source')
  writeFileSync(path.join(root, 'plugins/example/plugin.json'), '{"name":"example"}')
  writeFileSync(path.join(root, 'context-vault-indexer/lock.ts'), 'lock source')
  writeFileSync(path.join(root, 'package.json'), '{"name":"story-fixture"}')
  writeFileSync(path.join(root, 'bun.lock'), 'lockfile')
  if (includesPublic) writeFileSync(path.join(root, 'public/settings.js'), 'settings asset')
  git(
    root,
    'add',
    '--',
    'bunfig.toml',
    'tests',
    'scripts',
    'src',
    'plugins',
    'context-vault-indexer',
    'package.json',
    'bun.lock',
    ...(includesPublic ? ['public'] : []),
  )
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
      'scripts/coverage/normalize-lcov.ts',
      'scripts/coverage/ratchet-lib.ts',
      'scripts/coverage/story-coverage-gate.ts',
      'scripts/coverage/story-coverage-report.ts',
      'scripts/coverage/story-scope.ts',
      'scripts/story/cli.ts',
      'scripts/story/dependencies-install.ts',
      'scripts/story/dependencies-tree.ts',
      'scripts/story/dependencies.ts',
      'scripts/story/manifest.ts',
      'scripts/story/reports.ts',
      'scripts/story/sandbox.ts',
      'scripts/story/test-stories.ts',
      'scripts/story/test-story-sandbox.ts',
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

  test('captures runtime inputs separately from frozen harness inputs', async () => {
    const root = fixture()
    const manifest = await buildCandidateStoryManifest({ root, seed: 41021, bunVersion: '1.2.3' })
    writeFileSync(path.join(root, 'src/runtime.ts'), 'changed runtime source')
    const rebuilt = await buildCandidateStoryManifest({ root, seed: 41021, bunVersion: '1.2.3' })

    expect(manifest.runtimeInputs.files.map(({ path: filePath }) => filePath)).toEqual([
      'bun.lock',
      'context-vault-indexer/lock.ts',
      'package.json',
      'plugins/example/plugin.json',
      'public/settings.js',
      'src/runtime.ts',
    ])
    expect(manifest.runtimeInputs.files.find(({ path: filePath }) => filePath === 'src/runtime.ts')?.sha256).toBe(
      'c66ab3c24521ad1065019facb8f0ec2727e8cae52d4e1f1f21108bd3abdb7a65',
    )
    expect(rebuilt.runtimeInputs.treeHash).not.toBe(manifest.runtimeInputs.treeHash)
    expect(rebuilt.treeHash).toBe(manifest.treeHash)
  })

  test('emits schema version 4 and runtime directory topology for candidate and baseline manifests', async () => {
    const root = fixture()
    const ref = git(root, 'rev-parse', 'HEAD')
    const [candidate, baseline] = await Promise.all([
      buildCandidateStoryManifest({ root, seed: 41021 }),
      buildBaselineStoryManifest({ root, ref, seed: 41021 }),
    ])

    expect(candidate.version).toBe(4)
    expect(baseline.version).toBe(4)
    expect(candidate.runtimeInputs.directories).toEqual([
      'context-vault-indexer',
      'plugins',
      'plugins/example',
      'public',
      'src',
    ])
    expect(baseline.runtimeInputs.directories).toEqual([
      'context-vault-indexer',
      'plugins',
      'plugins/example',
      'public',
      'src',
    ])
    expect(StoryManifestSchema.safeParse({ ...candidate, version: 3 }).success).toBe(false)
  })

  test('captures empty required and present optional runtime directories', async () => {
    const root = fixture()
    rmSync(path.join(root, 'src'), { recursive: true })
    rmSync(path.join(root, 'plugins'), { recursive: true })
    rmSync(path.join(root, 'context-vault-indexer'), { recursive: true })
    rmSync(path.join(root, 'public'), { recursive: true })
    mkdirSync(path.join(root, 'src'))
    mkdirSync(path.join(root, 'plugins'))
    mkdirSync(path.join(root, 'context-vault-indexer'))
    mkdirSync(path.join(root, 'public'))

    const manifest = await buildCandidateStoryManifest({ root, seed: 41021, bunVersion: '1.2.3' })

    expect(manifest.version).toBe(4)
    expect(manifest.runtimeInputs.directories).toEqual(['context-vault-indexer', 'plugins', 'public', 'src'])
  })

  test('omits an absent optional public root deterministically', async () => {
    const root = fixture({ includePublic: false })
    const manifest = await buildCandidateStoryManifest({ root, seed: 41021, bunVersion: '1.2.3' })
    const repeated = await buildCandidateStoryManifest({ root, seed: 41021, bunVersion: '1.2.3' })

    expect(manifest.runtimeInputs.files.map(({ path: filePath }) => filePath)).toEqual([
      'bun.lock',
      'context-vault-indexer/lock.ts',
      'package.json',
      'plugins/example/plugin.json',
      'src/runtime.ts',
    ])
    expect(repeated.runtimeInputs).toEqual(manifest.runtimeInputs)
  })

  test('captures the documented behavior source doc as an optional runtime input', async () => {
    const root = fixture()
    mkdirSync(path.join(root, 'docs/architecture'), { recursive: true })
    writeFileSync(path.join(root, 'docs/architecture/behaviors.md'), '<!-- behavior:scope-model -->\n')

    const manifest = await buildCandidateStoryManifest({ root, seed: 41021, bunVersion: '1.2.3' })
    writeFileSync(path.join(root, 'docs/architecture/behaviors.md'), '<!-- behavior:mid-run-control -->\n')
    const rebuilt = await buildCandidateStoryManifest({ root, seed: 41021, bunVersion: '1.2.3' })

    expect(manifest.runtimeInputs.files.map(({ path: filePath }) => filePath)).toEqual([
      'bun.lock',
      'context-vault-indexer/lock.ts',
      'docs/architecture/behaviors.md',
      'package.json',
      'plugins/example/plugin.json',
      'public/settings.js',
      'src/runtime.ts',
    ])
    expect(rebuilt.runtimeInputs.treeHash).not.toBe(manifest.runtimeInputs.treeHash)
    expect(rebuilt.treeHash).toBe(manifest.treeHash)
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
    expect(StoryManifestSchema.parse(baseline)).toEqual(baseline)
    expect(baseline.runtimeInputs.files.map(({ kind, path: filePath }) => ({ kind, path: filePath }))).toEqual([
      { kind: 'file', path: 'bun.lock' },
      { kind: 'file', path: 'context-vault-indexer/lock.ts' },
      { kind: 'file', path: 'package.json' },
      { kind: 'file', path: 'plugins/example/plugin.json' },
      { kind: 'file', path: 'public/settings.js' },
      { kind: 'file', path: 'src/runtime.ts' },
    ])
    expect(baseline.scenarios[0]?.id).toContain('#alpha story')
  })

  test('captures candidate dependency evidence while omitting it from the historical baseline', async () => {
    const root = fixture()
    const ref = git(root, 'rev-parse', 'HEAD')
    const dependencySnapshot = { key: 'c'.repeat(64), root: '/cache/node_modules', treeHash: 'd'.repeat(64) }
    const [candidate, baseline] = await Promise.all([
      buildCandidateStoryManifest({ root, seed: 41021, bunVersion: '1.2.3' }, dependencySnapshot),
      buildBaselineStoryManifest({ root, ref, seed: 41021, bunVersion: '1.2.3' }),
    ])

    expect(candidate.dependencySnapshot).toEqual({
      key: dependencySnapshot.key,
      treeHash: dependencySnapshot.treeHash,
      bunVersion: '1.2.3',
    })
    expect(baseline.dependencySnapshot).toBeUndefined()
    expect(StoryManifestSchema.parse(baseline)).toEqual(baseline)
  })

  test('captures the selected sandbox backend while omitting it from historical baselines', async () => {
    const root = fixture()
    const ref = git(root, 'rev-parse', 'HEAD')
    const candidate = await buildCandidateStoryManifest({ root, seed: 41021, sandboxBackend: 'linux-docker' })
    const baseline = await buildBaselineStoryManifest({ root, ref, seed: 41021 })

    expect(candidate.sandboxBackend).toBe('linux-docker')
    expect(baseline.sandboxBackend).toBeUndefined()
    expect(StoryManifestSchema.parse(baseline)).toEqual(baseline)
    expect(() => compareStoryManifests(candidate, baseline)).not.toThrow()
  })

  test('rejects a baseline ref without every required runtime input', async () => {
    const root = fixture()
    rmSync(path.join(root, 'package.json'))
    git(root, 'rm', '--', 'package.json')
    git(root, 'commit', '-qm', 'remove runtime metadata')

    await expect(buildBaselineStoryManifest({ root, ref: 'HEAD', seed: 41021 })).rejects.toThrow(
      'Baseline runtime inputs missing: package.json',
    )
  })

  test('captures the documented behavior source doc at baseline without emitting docs directories', async () => {
    const root = fixture()
    mkdirSync(path.join(root, 'docs/architecture'), { recursive: true })
    writeFileSync(path.join(root, 'docs/architecture/behaviors.md'), '<!-- behavior:scope-model -->\n')
    git(root, 'add', '--', 'docs/architecture/behaviors.md')
    git(root, 'commit', '-qm', 'add documented behavior source')
    const ref = git(root, 'rev-parse', 'HEAD')

    const baseline = await buildBaselineStoryManifest({ root, ref, seed: 41021, bunVersion: '1.2.3' })

    expect(baseline.runtimeInputs.files.map(({ path: filePath }) => filePath)).toContain(
      'docs/architecture/behaviors.md',
    )
    expect(baseline.runtimeInputs.directories.filter((directory) => directory.startsWith('docs'))).toEqual([])
    expect(StoryManifestSchema.parse(baseline)).toEqual(baseline)
  })

  test('accepts identical frozen content across different run metadata', async () => {
    const root = fixture()
    const ref = git(root, 'rev-parse', 'HEAD')
    const baseline = await buildBaselineStoryManifest({ root, ref, seed: 1, bunVersion: 'old' })
    const candidate = await buildCandidateStoryManifest({ root, seed: 999, bunVersion: 'new' })

    expect(() => compareStoryManifests(candidate, baseline)).not.toThrow()
  })

  test('ignores runtime input changes during compatibility comparison', async () => {
    const root = fixture()
    const ref = git(root, 'rev-parse', 'HEAD')
    const baseline = await buildBaselineStoryManifest({ root, ref, seed: 41021 })
    writeFileSync(path.join(root, 'src/runtime.ts'), 'changed runtime source')
    const candidate = await buildCandidateStoryManifest({ root, seed: 41021 })

    expect(candidate.runtimeInputs.treeHash).not.toBe(baseline.runtimeInputs.treeHash)
    expect(() => compareStoryManifests(candidate, baseline)).not.toThrow()
  })

  test('ignores candidate dependency evidence during compatibility comparison', async () => {
    const root = fixture()
    const ref = git(root, 'rev-parse', 'HEAD')
    const baseline = await buildBaselineStoryManifest({ root, ref, seed: 41021 })
    const candidate = await buildCandidateStoryManifest(
      { root, seed: 41021 },
      { key: 'e'.repeat(64), root: '/cache/node_modules', treeHash: 'f'.repeat(64) },
    )

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
    writeFileSync(path.join(root, 'scripts/story/manifest.ts'), 'changed enforcement')
    writeFileSync(path.join(root, 'scripts/story/new-guard.ts'), 'new enforcement')
    const candidate = await buildCandidateStoryManifest({ root, seed: 41021 })

    expect(() => compareStoryManifests(candidate, baseline)).toThrow('changed: scripts/story/manifest.ts')
    expect(() => compareStoryManifests(candidate, baseline)).toThrow('added: scripts/story/new-guard.ts')
  })

  test('fails closed on symlinks in the candidate tree', async () => {
    const root = fixture()
    symlinkSync(path.join(root, 'tests/stories/harness/helper.ts'), path.join(root, 'tests/stories/link.ts'))

    await expect(buildCandidateStoryManifest({ root, seed: 41021 })).rejects.toThrow(
      'Unsupported story manifest entry: tests/stories/link.ts (symbolic link)',
    )
  })

  test('rejects runtime symlinks that escape declared inputs', async () => {
    const root = fixture()
    symlinkSync('../../external', path.join(root, 'src/escaped.ts'))

    await expect(buildCandidateStoryManifest({ root, seed: 41021 })).rejects.toThrow(
      'Unsupported story runtime symlink: src/escaped.ts -> ../../external',
    )
  })

  test.each([
    ['backslash traversal', '..\\..\\external'],
    ['drive-root target', 'C:\\external'],
  ])('rejects runtime symlinks with %s', async (_description, target) => {
    const root = fixture()
    symlinkSync(target, path.join(root, 'src/escaped.ts'))

    await expect(buildCandidateStoryManifest({ root, seed: 41021 })).rejects.toThrow(
      `Unsupported story runtime symlink: src/escaped.ts -> ${target}`,
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
      'scripts/story/cli.ts',
      'scripts/story/manifest.ts',
      'scripts/story/reports.ts',
      'scripts/story/scenarios.ts',
      'scripts/story/test-stories.ts',
    ]

    expect(enforcementPaths.filter((enforcementPath) => !filePaths.includes(enforcementPath))).toEqual([])
    const target = 'CLAUDE.md'
    expect(manifest.runtimeInputs.files).toContainEqual({
      kind: 'symlink',
      path: 'src/tools/AGENTS.md',
      sha256: createHash('sha256').update(target).digest('hex'),
      target,
    })
    expect(eligibility).toEqual([
      {
        id: 'tests/stories/integrations/plugins/eligibility.story.test.ts#SCN-plugin-deny-gating: unavailable plugin capabilities are removed before execution',
        checkpoints: [],
      },
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
})
