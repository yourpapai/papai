// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readdir, readFile, rename } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import { extractStoryScenarios } from './story-manifest-scenarios.js'
import { removeStoryReport, STORY_MANIFEST_REPORT_PATH } from './story-reports.js'
import { parseBunInteger } from './story-runner-integers.js'

const FILE_HASH = /^[a-f0-9]{64}$/u
const STORIES_PREFIX = 'tests/stories'

const StoryFileSchema = z.strictObject({ path: z.string(), sha256: z.string().regex(FILE_HASH) })
const StoryScenarioSchema = z.strictObject({ id: z.string(), checkpoints: z.array(z.string()) })

export const StoryManifestSchema = z.strictObject({
  version: z.literal(1),
  commit: z.string().min(7),
  bunVersion: z.string().min(1),
  seed: z.number().int(),
  treeHash: z.string().regex(FILE_HASH),
  files: z.array(StoryFileSchema),
  scenarios: z.array(StoryScenarioSchema),
})

export type StoryManifest = z.infer<typeof StoryManifestSchema>
type StoryFile = z.infer<typeof StoryFileSchema>
type StoryScenario = z.infer<typeof StoryScenarioSchema>
type ManifestOptions = Readonly<{ root: string; seed: number; bunVersion?: string }>
type BaselineOptions = ManifestOptions & Readonly<{ ref: string }>
type LoadedFile = Readonly<{ path: string; bytes: Uint8Array }>

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function hashTree(files: readonly StoryFile[]): string {
  const hash = createHash('sha256')
  hash.update('papai-story-tree-v1\0')
  for (const file of files) {
    const pathname = Buffer.from(file.path)
    hash.update(`${pathname.byteLength}:`)
    hash.update(pathname)
    hash.update('\0')
    hash.update(file.sha256)
    hash.update('\0')
  }
  return hash.digest('hex')
}

async function gitBytes(root: string, args: readonly string[], context: string): Promise<Uint8Array> {
  const child = Bun.spawn(['git', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(`${context}: ${stderr.trim() || `git exited ${exitCode}`}`)
  return new Uint8Array(stdout)
}

async function resolveCommit(root: string, ref: string): Promise<string> {
  if (ref.trim() === '') throw new Error('Compatibility mode requires an explicit baseline ref')
  try {
    const bytes = await gitBytes(
      root,
      ['rev-parse', '--verify', `${ref}^{commit}`],
      `Cannot resolve baseline ref "${ref}"`,
    )
    return new TextDecoder().decode(bytes).trim()
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Cannot resolve baseline ref')) throw error
    throw new Error(`Cannot resolve baseline ref "${ref}"`, { cause: error })
  }
}

async function currentCommit(root: string): Promise<string> {
  const bytes = await gitBytes(root, ['rev-parse', '--verify', 'HEAD^{commit}'], 'Cannot resolve candidate HEAD')
  return new TextDecoder().decode(bytes).trim()
}

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join('/')
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function isFrozenEnforcementPath(filePath: string): boolean {
  return (
    filePath === 'scripts/test-stories.ts' ||
    filePath === 'scripts/story-reports.ts' ||
    /^scripts\/story-(?:manifest|runner).*\.ts$/u.test(filePath)
  )
}

function isFrozenPath(filePath: string): boolean {
  return filePath.startsWith(`${STORIES_PREFIX}/`) || isFrozenEnforcementPath(filePath)
}

async function loadCandidateFiles(root: string): Promise<readonly LoadedFile[]> {
  const storiesRoot = path.join(root, STORIES_PREFIX)
  const rootEntry = await lstat(storiesRoot).catch((error: unknown) => {
    throw new Error(`Unsupported story manifest root: ${STORIES_PREFIX} (missing)`, { cause: error })
  })
  if (rootEntry.isSymbolicLink()) {
    throw new Error(`Unsupported story manifest root: ${STORIES_PREFIX} (symbolic link)`)
  }
  if (!rootEntry.isDirectory()) throw new Error(`Unsupported story manifest root: ${STORIES_PREFIX} (not a directory)`)
  const files: LoadedFile[] = []
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => compareText(left.name, right.name))
    await Promise.all(
      entries.map(async (entry): Promise<void> => {
        const absolute = path.join(directory, entry.name)
        const relative = toPosix(path.relative(root, absolute))
        if (entry.isDirectory()) await visit(absolute)
        else if (entry.isFile()) files.push({ path: relative, bytes: await readFile(absolute) })
        else {
          const kind = entry.isSymbolicLink() ? 'symbolic link' : 'special file'
          throw new Error(`Unsupported story manifest entry: ${relative} (${kind})`)
        }
      }),
    )
  }
  await visit(storiesRoot)
  const scriptEntries = await readdir(path.join(root, 'scripts'), { withFileTypes: true })
  await Promise.all(
    scriptEntries.map(async (entry): Promise<void> => {
      const relative = `scripts/${entry.name}`
      if (!isFrozenEnforcementPath(relative)) return
      if (!entry.isFile()) {
        const kind = entry.isSymbolicLink() ? 'symbolic link' : 'special file'
        throw new Error(`Unsupported story manifest entry: ${relative} (${kind})`)
      }
      files.push({ path: relative, bytes: await readFile(path.join(root, relative)) })
    }),
  )
  return files.sort((left, right) => compareText(left.path, right.path))
}

type GitTreeEntry = Readonly<{ mode: string; object: string; path: string }>

function parseGitTree(bytes: Uint8Array): readonly GitTreeEntry[] {
  const records = new TextDecoder().decode(bytes).split('\0').filter(Boolean)
  return records.flatMap((record): readonly GitTreeEntry[] => {
    const tab = record.indexOf('\t')
    const metadata = record.slice(0, tab).split(' ')
    const mode = metadata[0]
    const type = metadata[1]
    const object = metadata[2]
    const pathname = record.slice(tab + 1)
    if (!isFrozenPath(pathname)) return []
    if (tab < 0 || mode === undefined || object === undefined || type !== 'blob') {
      throw new Error(`Malformed Git tree entry for ${pathname || STORIES_PREFIX}`)
    }
    if (mode !== '100644' && mode !== '100755') {
      throw new Error(`Unsupported story manifest entry at baseline: ${pathname} (mode ${mode})`)
    }
    return [{ mode, object, path: pathname }]
  })
}

async function loadBaselineFiles(root: string, commit: string): Promise<readonly LoadedFile[]> {
  const tree = await gitBytes(
    root,
    ['ls-tree', '-rz', '--full-tree', commit, '--', STORIES_PREFIX, 'scripts'],
    `Cannot read frozen story inputs at ${commit}`,
  )
  const entries = [...parseGitTree(tree)].sort((left, right) => compareText(left.path, right.path))
  return Promise.all(
    entries.map(
      async (entry): Promise<LoadedFile> => ({
        path: entry.path,
        bytes: await gitBytes(root, ['cat-file', 'blob', entry.object], `Cannot read baseline blob ${entry.path}`),
      }),
    ),
  )
}

function assembleManifest(
  loaded: readonly LoadedFile[],
  metadata: Readonly<{ commit: string; bunVersion: string; seed: number }>,
): StoryManifest {
  const files = loaded.map((file): StoryFile => ({ path: file.path, sha256: sha256(file.bytes) }))
  const scenarios: StoryScenario[] = loaded
    .flatMap((file) => extractStoryScenarios(file.path, file.bytes))
    .map((scenario) => ({ ...scenario, checkpoints: [...scenario.checkpoints] }))
    .sort((left, right) => compareText(left.id, right.id))
  for (let index = 1; index < scenarios.length; index += 1) {
    if (scenarios[index - 1]?.id === scenarios[index]?.id)
      throw new Error(`Duplicate scenario id: ${scenarios[index]?.id}`)
  }
  return StoryManifestSchema.parse({
    version: 1,
    ...metadata,
    treeHash: hashTree(files),
    files,
    scenarios,
  })
}

export async function buildCandidateStoryManifest(options: ManifestOptions): Promise<StoryManifest> {
  const [commit, files] = await Promise.all([currentCommit(options.root), loadCandidateFiles(options.root)])
  return assembleManifest(files, { commit, bunVersion: options.bunVersion ?? Bun.version, seed: options.seed })
}

export async function buildBaselineStoryManifest(options: BaselineOptions): Promise<StoryManifest> {
  const commit = await resolveCommit(options.root, options.ref)
  const files = await loadBaselineFiles(options.root, commit)
  return assembleManifest(files, { commit, bunVersion: options.bunVersion ?? Bun.version, seed: options.seed })
}

export function compareStoryManifests(candidate: StoryManifest, baseline: StoryManifest): void {
  const current = new Map(candidate.files.map((file) => [file.path, file.sha256]))
  const previous = new Map(baseline.files.map((file) => [file.path, file.sha256]))
  const added = [...current.keys()].filter((file) => !previous.has(file)).sort()
  const removed = [...previous.keys()].filter((file) => !current.has(file)).sort()
  const changed = [...current.keys()]
    .filter((file) => previous.has(file) && current.get(file) !== previous.get(file))
    .sort()
  const scenariosMatch = JSON.stringify(candidate.scenarios) === JSON.stringify(baseline.scenarios)
  if (
    candidate.treeHash === baseline.treeHash &&
    added.length === 0 &&
    removed.length === 0 &&
    changed.length === 0 &&
    scenariosMatch
  )
    return
  const details = [
    added.length === 0 ? undefined : `added: ${added.join(', ')}`,
    removed.length === 0 ? undefined : `removed: ${removed.join(', ')}`,
    changed.length === 0 ? undefined : `changed: ${changed.join(', ')}`,
    scenariosMatch ? undefined : 'scenario metadata changed',
  ].filter((line): line is string => line !== undefined)
  if (details.length === 0) details.push('tree hash changed')
  throw new Error(`Story compatibility check failed against ${baseline.commit}: ${details.join('; ')}`)
}

export async function writeStoryManifest(manifest: StoryManifest, outputPath: string): Promise<void> {
  StoryManifestSchema.parse(manifest)
  await mkdir(path.dirname(outputPath), { recursive: true })
  const temporary = `${outputPath}.${process.pid}.${randomUUID()}.tmp`
  await Bun.write(temporary, `${JSON.stringify(manifest, null, 2)}\n`)
  await rename(temporary, outputPath)
}

export function parseStoryManifestArguments(args: readonly string[]): Readonly<{ seed: number }> {
  let seed = 41021
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    let token: string
    if (argument !== undefined && argument.startsWith('--seed=')) token = argument.slice('--seed='.length)
    else if (argument === '--seed') {
      const value = args[index + 1]
      if (value === undefined) throw new Error('--seed requires a value')
      token = value
      index += 1
    } else throw new Error(`Unsupported story manifest argument: ${argument}`)
    if (token.trim() === '') throw new Error('--seed requires a non-empty value')
    seed = parseBunInteger(token, {
      flag: '--seed',
      minimum: 0,
      maximum: 4_294_967_295,
      expectation: 'an integer between 0 and 4294967295',
    })
  }
  return { seed }
}

async function main(): Promise<number> {
  const outputPath = path.join(process.cwd(), STORY_MANIFEST_REPORT_PATH)
  await removeStoryReport(outputPath)
  const { seed } = parseStoryManifestArguments(process.argv.slice(2))
  const manifest = await buildCandidateStoryManifest({ root: process.cwd(), seed })
  await writeStoryManifest(manifest, outputPath)
  console.log(`Story manifest: ${manifest.treeHash}`)
  return 0
}

if (import.meta.main) {
  try {
    process.exitCode = await main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 2
  }
}
