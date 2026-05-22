// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  extractCapabilityStrings,
  extractToolKeys,
  filterInputPaths,
  parseInventoryPackageJson,
  resolveOutputRoot,
  shouldIgnoreAbsoluteDirectory,
  type InventoryPackageJson,
} from './architecture-inventory-cli-support.js'
import { discoverFilesystemPieceCandidates, extractTopDownPieceCandidates } from './architecture-inventory-discovery.js'
import type { PieceCandidate, PieceRecord } from './architecture-inventory-model.js'
import { attachRepositoryAssets, buildCanonicalRegistry } from './architecture-inventory-registry.js'
import { buildInventoryOutputFiles, type InventoryOutputFile } from './architecture-inventory-report.js'
import { collectPieceSignals, loadCodeindexSummary } from './architecture-inventory-signals.js'

export interface ArchitectureInventoryArgs {
  readonly repoRoot: string
  readonly outputDir: string
  readonly reindexCodeindex: boolean
}

export interface ArchitectureInventoryDeps {
  readonly readTextFile: (filePath: string) => Promise<string>
  readonly listRelativePaths: (repoRoot: string) => Promise<readonly string[]>
  readonly mkdirp: (dirPath: string) => Promise<void>
  readonly writeTextFile: (filePath: string, content: string) => Promise<void>
  readonly runCodeindexReindex: (repoRoot: string) => Promise<void>
  readonly openCodeindexDb: (dbPath: string) => Database
}

interface InventoryInputs {
  readonly readme: string
  readonly claude: string
  readonly roadmap: string
  readonly packageJson: Readonly<InventoryPackageJson>
  readonly providerTypes: string
  readonly toolsBuilder: string
  readonly relativePaths: readonly string[]
}

const byPrefix = (relativePaths: readonly string[], prefix: string): readonly string[] =>
  relativePaths.filter((relativePath) => relativePath.startsWith(prefix)).toSorted()

const uniqueTopLevelDirectories = (relativePaths: readonly string[]): readonly string[] =>
  [
    ...new Set(
      relativePaths.flatMap((relativePath) => {
        const firstSegment = relativePath.split('/')[0]
        return firstSegment === undefined || firstSegment.length === 0 ? [] : [firstSegment]
      }),
    ),
  ].toSorted()

const isSourcePath = (relativePath: string): boolean =>
  ['src/', 'client/', 'codeindex/', 'review-loop/'].some((prefix) => relativePath.startsWith(prefix))

const isDocPath = (relativePath: string): boolean => {
  if (relativePath === 'README.md' || relativePath === 'CLAUDE.md') return true
  return relativePath.startsWith('docs/')
}

const walkRelativePaths = async (
  repoRoot: string,
  outputDir: string,
  currentDirectory: string,
): Promise<readonly string[]> => {
  const entries = await readdir(currentDirectory, { withFileTypes: true })
  const nestedPaths = await Promise.all(
    entries.map((entry): Promise<readonly string[]> => {
      const absolutePath = path.join(currentDirectory, entry.name)
      if (entry.isDirectory()) {
        if (shouldIgnoreAbsoluteDirectory(absolutePath, repoRoot, outputDir)) {
          return Promise.resolve([])
        }

        return walkRelativePaths(repoRoot, outputDir, absolutePath)
      }

      return Promise.resolve([path.relative(repoRoot, absolutePath).split(path.sep).join('/')])
    }),
  )

  return nestedPaths.flat()
}

const defaultDeps: ArchitectureInventoryDeps = {
  readTextFile: (filePath) => readFile(filePath, 'utf-8'),
  listRelativePaths: (repoRoot) => walkRelativePaths(repoRoot, 'docs/architecture', repoRoot),
  mkdirp: async (dirPath) => {
    await mkdir(dirPath, { recursive: true })
  },
  writeTextFile: (filePath, content) => writeFile(filePath, content, 'utf-8'),
  runCodeindexReindex: async (repoRoot) => {
    const processHandle = Bun.spawn(['bun', 'run', 'codeindex:reindex'], {
      cwd: repoRoot,
      stdout: 'ignore',
      stderr: 'pipe',
    })
    const stderr = await new Response(processHandle.stderr).text()
    const exitCode = await processHandle.exited
    if (exitCode !== 0) {
      const errorMessage = stderr.trim()
      throw new Error(errorMessage.length > 0 ? errorMessage : 'codeindex reindex failed')
    }
  },
  openCodeindexDb: (dbPath) => new Database(dbPath, { readonly: true }),
}

const requiredFlagValue = (args: readonly string[], flag: string): string => {
  const index = args.indexOf(flag)
  const value = index === -1 ? undefined : args[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`)
  }
  return value
}

export const parseArchitectureInventoryArgs = (args: readonly string[]): ArchitectureInventoryArgs => ({
  repoRoot: args.includes('--repo-root') ? requiredFlagValue(args, '--repo-root') : process.cwd(),
  outputDir: args.includes('--output-dir') ? requiredFlagValue(args, '--output-dir') : 'docs/architecture',
  reindexCodeindex: !args.includes('--skip-codeindex-reindex'),
})

const readInventoryInputs = async (
  repoRoot: string,
  outputDir: string,
  deps: Readonly<ArchitectureInventoryDeps>,
): Promise<Readonly<InventoryInputs>> => {
  const [readme, claude, roadmap, packageJsonText, providerTypes, toolsBuilder, relativePaths] = await Promise.all([
    deps.readTextFile(path.join(repoRoot, 'README.md')),
    deps.readTextFile(path.join(repoRoot, 'CLAUDE.md')),
    deps.readTextFile(path.join(repoRoot, 'docs/ROADMAP.md')),
    deps.readTextFile(path.join(repoRoot, 'package.json')),
    deps.readTextFile(path.join(repoRoot, 'src/providers/types.ts')),
    deps.readTextFile(path.join(repoRoot, 'src/tools/tools-builder.ts')),
    deps.listRelativePaths(repoRoot),
  ])

  return {
    readme,
    claude,
    roadmap,
    packageJson: parseInventoryPackageJson(packageJsonText),
    providerTypes,
    toolsBuilder,
    relativePaths: filterInputPaths(relativePaths, repoRoot, outputDir),
  }
}

const buildDiscoveryCandidates = (inputs: Readonly<InventoryInputs>): readonly PieceCandidate[] => {
  const topDownCandidates = extractTopDownPieceCandidates({
    readme: inputs.readme,
    claude: inputs.claude,
    roadmap: inputs.roadmap,
    packageJson: inputs.packageJson,
  })
  const filesystemCandidates = discoverFilesystemPieceCandidates({
    topLevelEntries: uniqueTopLevelDirectories(inputs.relativePaths),
    srcEntries: byPrefix(inputs.relativePaths, 'src/').filter((entry) => entry.split('/').length <= 2),
    clientEntries: byPrefix(inputs.relativePaths, 'client/').filter((entry) => entry.split('/').length <= 2),
    scriptEntries: byPrefix(inputs.relativePaths, 'scripts/'),
    testEntries: byPrefix(inputs.relativePaths, 'tests/'),
    historicalDocEntries: byPrefix(inputs.relativePaths, 'docs/archive/').concat(
      byPrefix(inputs.relativePaths, 'docs/superpowers/remaining/'),
    ),
  })

  return [...topDownCandidates, ...filesystemCandidates]
}

const buildRegistry = (inputs: Readonly<InventoryInputs>): readonly PieceRecord[] =>
  attachRepositoryAssets(buildCanonicalRegistry(buildDiscoveryCandidates(inputs)), {
    sourcePaths: inputs.relativePaths.filter((relativePath) => isSourcePath(relativePath)),
    scriptPaths: byPrefix(inputs.relativePaths, 'scripts/'),
    testPaths: byPrefix(inputs.relativePaths, 'tests/'),
    docPaths: inputs.relativePaths.filter((relativePath) => isDocPath(relativePath)),
  })

const collectSignalsForPiece = (
  piece: PieceRecord,
  codeindexSummary: ReturnType<typeof loadCodeindexSummary>,
  inputs: Readonly<InventoryInputs>,
): PieceRecord['signals'] =>
  collectPieceSignals({
    piece,
    codeindexSummary,
    providerCapabilities: extractCapabilityStrings(inputs.providerTypes),
    toolKeys: extractToolKeys(inputs.toolsBuilder),
  })

const pieceWithSignals = (
  piece: PieceRecord,
  codeindexSummary: ReturnType<typeof loadCodeindexSummary>,
  inputs: Readonly<InventoryInputs>,
): PieceRecord => ({
  pieceId: piece.pieceId,
  name: piece.name,
  type: piece.type,
  status: piece.status,
  summary: piece.summary,
  declaredPaths: piece.declaredPaths,
  aliases: piece.aliases,
  tags: piece.tags,
  sources: piece.sources,
  primaryPaths: piece.primaryPaths,
  secondaryPaths: piece.secondaryPaths,
  entrypoints: piece.entrypoints,
  relatedTests: piece.relatedTests,
  relatedDocs: piece.relatedDocs,
  relatedScripts: piece.relatedScripts,
  configOrEnvDependencies: piece.configOrEnvDependencies,
  runtimeDependencies: piece.runtimeDependencies,
  dependents: piece.dependents,
  signals: collectSignalsForPiece(piece, codeindexSummary, inputs),
  manualReviewQuestions: piece.manualReviewQuestions,
})

const buildOutputFiles = (
  repoRoot: string,
  inputs: Readonly<InventoryInputs>,
  deps: Readonly<ArchitectureInventoryDeps>,
): readonly InventoryOutputFile[] => {
  const codeindexDb = deps.openCodeindexDb(path.join(repoRoot, '.codeindex', 'index.db'))
  const codeindexSummary = loadCodeindexSummary(codeindexDb)
  codeindexDb.close()

  return buildInventoryOutputFiles({
    generatedAt: new Date().toISOString(),
    pieces: buildRegistry(inputs).map((piece) => pieceWithSignals(piece, codeindexSummary, inputs)),
  })
}

const writeOutputFiles = async (
  repoRoot: string,
  outputDir: string,
  outputFiles: ReturnType<typeof buildInventoryOutputFiles>,
  deps: Readonly<ArchitectureInventoryDeps>,
): Promise<void> => {
  const outputRoot = resolveOutputRoot(repoRoot, outputDir)

  await Promise.all(
    outputFiles.map(async (file) => {
      const absolutePath = path.join(outputRoot, file.relativePath)
      await deps.mkdirp(path.dirname(absolutePath))
      await deps.writeTextFile(absolutePath, file.content)
    }),
  )
}

export const runArchitectureInventory = async (
  args: Readonly<ArchitectureInventoryArgs>,
  deps: Readonly<ArchitectureInventoryDeps>,
): Promise<void> => {
  if (args.reindexCodeindex) {
    await deps.runCodeindexReindex(args.repoRoot)
  }

  const inputs = await readInventoryInputs(args.repoRoot, args.outputDir, deps)
  const outputFiles = buildOutputFiles(args.repoRoot, inputs, deps)
  await writeOutputFiles(args.repoRoot, args.outputDir, outputFiles, deps)
}

if (process.argv[1] === import.meta.filename) {
  const args = parseArchitectureInventoryArgs(Bun.argv.slice(2))
  await runArchitectureInventory(args, defaultDeps).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
