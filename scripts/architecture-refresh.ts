// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  cruise,
  type DependencyType,
  type ICruiseOptions,
  type ICruiseResult,
  type IReporterOutput,
} from 'dependency-cruiser'
import extractDepcruiseOptions from 'dependency-cruiser/config-utl/extract-depcruise-options'

import {
  ARCHITECTURE_OUTPUT_DIR,
  dependencyCruiserOptions,
  isArchitectureRuntimePath,
} from './architecture-refresh-config.js'
import { normalizeArchitectureGraph } from './architecture-refresh-normalize.js'
import { buildArchitectureOutputFiles } from './architecture-refresh-report.js'

export interface RunArchitectureRefreshDeps {
  readonly cruiseGraph?: () => Promise<ICruiseResult>
  readonly formatGeneratedFiles?: (filePaths: readonly string[]) => Promise<void>
  readonly rmDir?: (dirPath: string) => Promise<void>
  readonly mkdirp?: (dirPath: string) => Promise<void>
  readonly writeTextFile?: (filePath: string, content: string) => Promise<void>
}

type ArchitectureModel = ReturnType<typeof normalizeArchitectureGraph>

const DEPENDENCY_CRUISER_CONFIG_PATH = '.dependency-cruiser.mjs'
const DO_NOT_FOLLOW_DEPENDENCY_TYPES = [
  'npm',
  'npm-dev',
  'npm-optional',
  'npm-peer',
  'npm-bundled',
] as const satisfies readonly DependencyType[]

const dependencyCruiserApiOptions: ICruiseOptions = {
  tsConfig: dependencyCruiserOptions.tsConfig,
  exclude: dependencyCruiserOptions.exclude,
  includeOnly: dependencyCruiserOptions.includeOnly,
  doNotFollow: {
    dependencyTypes: [...DO_NOT_FOLLOW_DEPENDENCY_TYPES],
  },
}

const reporterOutputToCruiseResult = (output: IReporterOutput['output']): ICruiseResult => {
  if (typeof output === 'string') {
    throw new Error('Expected dependency-cruiser graph output, received formatted text output')
  }

  return output
}

const splitNullDelimitedPaths = (value: string): readonly string[] =>
  value.split('\0').filter((relativePath) => relativePath.length > 0)

const spawnText = (command: string, args: readonly string[]): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    const child = spawn(command, [...args], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) {
        resolve(stdout)
        return
      }

      reject(new Error(stderr.trim() || `${command} exited with code ${code ?? 1}`))
    })
  })

const listTrackedArchitectureInputs = (): Promise<readonly string[]> =>
  spawnText('git', ['ls-files', '-z', '--', 'src', 'client']).then((stdout) =>
    splitNullDelimitedPaths(stdout).filter(isArchitectureRuntimePath),
  )

const defaultCruiseGraph = async (): Promise<ICruiseResult> => {
  const trackedInputs = await listTrackedArchitectureInputs()
  const cruiseOptions = await extractDepcruiseOptions(path.join(process.cwd(), DEPENDENCY_CRUISER_CONFIG_PATH))
  const result = await cruise([...trackedInputs], {
    ...cruiseOptions,
    ...dependencyCruiserApiOptions,
  })
  return reporterOutputToCruiseResult(result.output)
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const defaultRmDir = (dirPath: string): Promise<void> => rm(dirPath, { recursive: true, force: true })

const defaultMkdirp = (dirPath: string): Promise<void> => mkdir(dirPath, { recursive: true }).then(() => undefined)

const defaultWriteTextFile = (filePath: string, content: string): Promise<void> => writeFile(filePath, content, 'utf8')

const defaultFormatGeneratedFiles = (filePaths: readonly string[]): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(path.join(process.cwd(), 'node_modules/.bin/oxfmt'), ['--write', ...filePaths], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(stderr.trim() || `oxfmt exited with code ${code ?? 1}`))
    })
  })

export const runArchitectureRefresh = async (
  _argv: readonly string[],
  deps: RunArchitectureRefreshDeps = {},
): Promise<void> => {
  const cruiseGraph = deps.cruiseGraph ?? defaultCruiseGraph
  const formatGeneratedFiles = deps.formatGeneratedFiles ?? defaultFormatGeneratedFiles
  const rmDir = deps.rmDir ?? defaultRmDir
  const mkdirp = deps.mkdirp ?? defaultMkdirp
  const writeTextFile = deps.writeTextFile ?? defaultWriteTextFile

  let raw: ICruiseResult
  try {
    raw = await cruiseGraph()
  } catch (error) {
    throw new Error(`Architecture refresh graph generation failed: ${errorMessage(error)}`, { cause: error })
  }
  let model: ArchitectureModel
  try {
    model = normalizeArchitectureGraph(raw)
  } catch (error) {
    throw new Error(`Architecture refresh normalization failed: ${errorMessage(error)}`, { cause: error })
  }
  const outputFiles = buildArchitectureOutputFiles(model),
    outputRoot = path.join(process.cwd(), ARCHITECTURE_OUTPUT_DIR)
  const writeManagedFile = async (relativePath: string, content: string): Promise<void> =>
    writeTextFile(
      await mkdirp(path.dirname(path.join(outputRoot, relativePath))).then(() => path.join(outputRoot, relativePath)),
      content,
    )
  try {
    await rmDir(outputRoot)
    await Promise.all(outputFiles.map((file) => writeManagedFile(file.relativePath, file.content)))
    await formatGeneratedFiles(outputFiles.map((file) => path.join(outputRoot, file.relativePath)))
  } catch (error) {
    throw new Error(`Architecture refresh rendering failed: ${errorMessage(error)}`, { cause: error })
  }
}

if (import.meta.main) await runArchitectureRefresh(process.argv.slice(2))
