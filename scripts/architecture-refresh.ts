// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  cruise,
  format,
  type DependencyType,
  type ICruiseOptions,
  type ICruiseResult,
  type IReporterOutput,
} from 'dependency-cruiser'
import extractDepcruiseOptions from 'dependency-cruiser/config-utl/extract-depcruise-options'

import {
  ARCHITECTURE_OUTPUT_DIR,
  CLIENT_SURFACE_IDS,
  FOCUSED_SERVER_AREA_IDS,
  dependencyCruiserOptions,
} from './architecture-refresh-config.js'
import { normalizeArchitectureGraph } from './architecture-refresh-normalize.js'
import {
  buildArchitectureOutputFiles,
  renderClientSurfaceDot,
  renderFocusedAreaDot,
} from './architecture-refresh-report.js'

export interface RunArchitectureRefreshDeps {
  readonly cruiseGraph?: () => Promise<ICruiseResult>
  readonly formatTopLevelGraph?: (kind: 'archi' | 'ddot', raw: ICruiseResult) => Promise<string>
  readonly renderDotToSvg?: (dot: string) => Promise<string>
  readonly formatGeneratedFiles?: (filePaths: readonly string[]) => Promise<void>
  readonly rmDir?: (dirPath: string) => Promise<void>
  readonly mkdirp?: (dirPath: string) => Promise<void>
  readonly writeTextFile?: (filePath: string, content: string) => Promise<void>
}

interface DotDiscoveryDeps {
  readonly env?: NodeJS.ProcessEnv
  readonly whichExecutable?: (command: string, options?: { PATH?: string }) => string | null
  readonly accessPath?: (filePath: string, mode?: number) => Promise<void>
}

type ArchitectureModel = ReturnType<typeof normalizeArchitectureGraph>

const DEPENDENCY_CRUISER_CONFIG_PATH = '.dependency-cruiser.mjs'
const FOCUSED_SERVER_AREA_ID_SET = new Set<string>(FOCUSED_SERVER_AREA_IDS)
const CLIENT_SURFACE_ID_SET = new Set<string>(CLIENT_SURFACE_IDS)
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

const reporterOutputToText = (output: IReporterOutput['output']): string => {
  if (typeof output !== 'string') {
    throw new Error('Expected dependency-cruiser formatted text output, received graph output')
  }

  return output
}

const defaultCruiseGraph = async (): Promise<ICruiseResult> => {
  const cruiseOptions = await extractDepcruiseOptions(path.join(process.cwd(), DEPENDENCY_CRUISER_CONFIG_PATH))
  const result = await cruise(['src', 'client'], {
    ...cruiseOptions,
    ...dependencyCruiserApiOptions,
  })
  return reporterOutputToCruiseResult(result.output)
}

const serverOnlyRawGraph = (raw: ICruiseResult): ICruiseResult => ({
  ...raw,
  modules: raw.modules.filter((module) => module.source.startsWith('src/')),
})

const defaultFormatTopLevelGraph = async (kind: 'archi' | 'ddot', raw: ICruiseResult): Promise<string> => {
  const result = await format(serverOnlyRawGraph(raw), { outputType: kind })
  return reporterOutputToText(result.output)
}

const escapeSvgText = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

const renderDotFallbackSvg = (dot: string): string => {
  const content = escapeSvgText(dot)

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">',
    '  <rect width="1200" height="800" fill="#ffffff" />',
    '  <text x="24" y="40" font-family="monospace" font-size="24" fill="#111827">Graphviz dot executable not available</text>',
    '  <text x="24" y="72" font-family="monospace" font-size="16" fill="#4b5563">DOT source preserved below for deterministic review output.</text>',
    `  <foreignObject x="24" y="104" width="1152" height="672"><pre xmlns="http://www.w3.org/1999/xhtml" style="margin:0;font:14px monospace;white-space:pre-wrap;color:#111827;">${content}</pre></foreignObject>`,
    '</svg>',
    '',
  ].join('\n')
}

const findExecutableCandidateInOrder = async (
  candidatePaths: readonly string[],
  accessPath: (filePath: string, mode?: number) => Promise<void>,
): Promise<string | null> => {
  const [candidate, ...remainingCandidates] = candidatePaths
  if (candidate === undefined) {
    return null
  }

  try {
    await accessPath(candidate, constants.X_OK)
    return candidate
  } catch {
    return findExecutableCandidateInOrder(remainingCandidates, accessPath)
  }
}

export const findDotExecutable = (deps: DotDiscoveryDeps = {}): Promise<string | null> => {
  const env = deps.env ?? process.env
  const whichExecutable =
    deps.whichExecutable ??
    ((command: string, options?: { PATH?: string }): string | null => Bun.which(command, options))
  const accessPath = deps.accessPath ?? access
  const pathResolvedDot = whichExecutable('dot', { PATH: env['PATH'] })

  if (pathResolvedDot !== null) {
    return Promise.resolve(pathResolvedDot)
  }

  const candidatePaths = [env['GRAPHVIZ_DOT'], '/opt/homebrew/bin/dot', '/usr/local/bin/dot'].filter(
    (candidate): candidate is string => candidate !== undefined,
  )

  return findExecutableCandidateInOrder(candidatePaths, accessPath)
}

export const renderDotToSvg = (dot: string, deps: DotDiscoveryDeps = {}): Promise<string> =>
  findDotExecutable(deps).then((dotExecutable) =>
    dotExecutable === null
      ? renderDotFallbackSvg(dot)
      : new Promise<string>((resolve, reject) => {
          const child = spawn(dotExecutable, ['-Tsvg'], { stdio: ['pipe', 'pipe', 'pipe'] })
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
          child.once('exit', (code) => {
            if (code === 0) {
              resolve(stdout)
              return
            }

            reject(new Error(stderr.trim() || `${dotExecutable} exited with code ${code ?? 1}`))
          })
          child.stdin.end(dot)
        }),
  )

const defaultRenderDotToSvg = (dot: string): Promise<string> => renderDotToSvg(dot)

const defaultRmDir = (dirPath: string): Promise<void> => rm(dirPath, { recursive: true, force: true })

const defaultMkdirp = async (dirPath: string): Promise<void> => {
  await mkdir(dirPath, { recursive: true })
}

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
    child.once('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(stderr.trim() || `oxfmt exited with code ${code ?? 1}`))
    })
  })

const committedServerAreas = (model: ArchitectureModel): ArchitectureModel['server']['areas'] =>
  model.server.areas.filter((area) => FOCUSED_SERVER_AREA_ID_SET.has(area.id))

const committedClientSurfaces = (model: ArchitectureModel): ArchitectureModel['client']['surfaces'] =>
  model.client.surfaces.filter((surface) => CLIENT_SURFACE_ID_SET.has(surface.id))

const writeCommittedDiagramFiles = async (
  model: ArchitectureModel,
  raw: ICruiseResult,
  formatTopLevelGraph: (kind: 'archi' | 'ddot', rawGraph: ICruiseResult) => Promise<string>,
  renderDotToSvgFile: (dot: string) => Promise<string>,
  writeManagedFile: (relativePath: string, content: string) => Promise<void>,
): Promise<void> => {
  const [serverArchiDot, serverDdotDot] = await Promise.all([
    formatTopLevelGraph('archi', raw),
    formatTopLevelGraph('ddot', raw),
  ])
  const [serverArchiSvg, serverDdotSvg] = await Promise.all([
    renderDotToSvgFile(serverArchiDot),
    renderDotToSvgFile(serverDdotDot),
  ])

  await Promise.all([
    writeManagedFile('diagrams/server-archi.svg', serverArchiSvg),
    writeManagedFile('diagrams/server-ddot.svg', serverDdotSvg),
    ...committedServerAreas(model).map(async (area): Promise<void> => {
      const svg = await renderDotToSvgFile(renderFocusedAreaDot(area.id, model))
      await writeManagedFile(`server/${area.slug}.svg`, svg)
    }),
    ...committedClientSurfaces(model).map(async (surface): Promise<void> => {
      const svg = await renderDotToSvgFile(renderClientSurfaceDot(surface.id, model))
      await writeManagedFile(`client/${surface.slug}.svg`, svg)
    }),
  ])
}

export const runArchitectureRefresh = async (
  _argv: readonly string[],
  deps: RunArchitectureRefreshDeps = {},
): Promise<void> => {
  const cruiseGraph = deps.cruiseGraph ?? defaultCruiseGraph
  const formatTopLevelGraph = deps.formatTopLevelGraph ?? defaultFormatTopLevelGraph
  const renderDotToSvgFile = deps.renderDotToSvg ?? defaultRenderDotToSvg
  const formatGeneratedFiles = deps.formatGeneratedFiles ?? defaultFormatGeneratedFiles
  const rmDir = deps.rmDir ?? defaultRmDir
  const mkdirp = deps.mkdirp ?? defaultMkdirp
  const writeTextFile = deps.writeTextFile ?? defaultWriteTextFile

  const raw = await cruiseGraph()
  const model = normalizeArchitectureGraph(raw)
  const outputRoot = path.join(process.cwd(), ARCHITECTURE_OUTPUT_DIR)
  const outputFiles = buildArchitectureOutputFiles(model)

  await rmDir(outputRoot)

  const writeManagedFile = async (relativePath: string, content: string): Promise<void> => {
    const absolutePath = path.join(outputRoot, relativePath)
    await mkdirp(path.dirname(absolutePath))
    await writeTextFile(absolutePath, content)
  }

  await writeManagedFile('raw/dependency-cruiser.json', `${JSON.stringify(raw, null, 2)}\n`)

  await Promise.all(outputFiles.map((file) => writeManagedFile(file.relativePath, file.content)))
  await formatGeneratedFiles([
    path.join(outputRoot, 'raw/dependency-cruiser.json'),
    ...outputFiles.map((file) => path.join(outputRoot, file.relativePath)),
  ])
  await writeCommittedDiagramFiles(model, raw, formatTopLevelGraph, renderDotToSvgFile, writeManagedFile)
}

if (import.meta.main) {
  await runArchitectureRefresh(process.argv.slice(2))
}
