// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { classifyTestLane } from '../mutation/coverage-runner.js'
import { reachableTests } from './import-graph.js'

/**
 * Files preloaded into (or governing) every test worker. A change to any of them can alter the
 * behaviour of a test that imports none of them, so "affected" degenerates to "everything".
 */
export const BLAST_RADIUS_INPUTS: readonly string[] = [
  'bunfig.toml',
  'package.json',
  'bun.lock',
  'tests/setup.ts',
  'tests/mock-reset.ts',
]

/** Directory prefixes with the same property as {@link BLAST_RADIUS_INPUTS}. */
export const BLAST_RADIUS_PREFIXES: readonly string[] = ['tests/utils/']

/**
 * Measured across all 937 `src/` files: depth 1 selects nothing for 6 % of them; depth 2 has a
 * p50 of 0.5 % of the suite, a p90 of 2.7 %, and is never empty; depth 3 reaches the hub cluster
 * and blows out to 47.9 % at p90. The full closure is meaningless (p50 49 %).
 */
export const DEFAULT_DEPTH = 2

const DEFAULT_BASE_REF = 'origin/master'

/** The scope tag written into the run report, so a later reader knows the run was a subset. */
const SELECTED_BY_FLAG = '--selected-by'

const TEST_FILE_PATTERN = /\.(?:test|spec)\.tsx?$/u
const CODE_FILE_PATTERN = /\.(?:[cm]?tsx?|[cm]?jsx?)$/u
const DEPTH_PATTERN = /^[1-9]\d*$/u
export const TEST_SCAN_PATTERN = 'tests/**/*.test.ts'

export interface SelectAffectedInput {
  readonly changed: readonly string[]
  /** `dependency -> importers`, from `buildReverseGraph`. */
  readonly graph: Map<string, Set<string>>
  /** `listCandidateTests`, bound to the project root. */
  readonly candidates: (srcFile: string) => readonly string[]
  readonly depth: number
}

export interface PathSelection {
  readonly kind: 'paths'
  readonly server: readonly string[]
  readonly client: readonly string[]
  /** Selected but unrunnable per-file: `tests/e2e/**` needs Docker, `tests/stories/**` a sandbox. */
  readonly skippedExternal: readonly string[]
  readonly depth: number
  readonly changed: readonly string[]
}

export type Selection = { readonly kind: 'full'; readonly reason: string } | PathSelection

const toPosix = (filePath: string): string => filePath.replaceAll('\\', '/')

const isTestPath = (filePath: string): boolean => TEST_FILE_PATTERN.test(filePath)

const isCodeFile = (filePath: string): boolean => CODE_FILE_PATTERN.test(filePath)

const isBlastRadius = (filePath: string): boolean =>
  BLAST_RADIUS_INPUTS.includes(filePath) || BLAST_RADIUS_PREFIXES.some((prefix) => filePath.startsWith(prefix))

/** (a) graph reachability ∪ (b) candidate tests of changed code ∪ (c) changed tests themselves. */
const collectSelected = (input: SelectAffectedInput): string[] => {
  const selected = new Set<string>(reachableTests(input.graph, input.changed, input.depth))
  for (const file of input.changed) {
    if (isTestPath(file)) selected.add(file)
    else if (isCodeFile(file)) for (const candidate of input.candidates(file)) selected.add(candidate)
  }
  return [...selected].toSorted()
}

const splitLanes = (selected: readonly string[]): Pick<PathSelection, 'server' | 'client' | 'skippedExternal'> => ({
  server: selected.filter((file) => classifyTestLane(file) === 'server'),
  client: selected.filter((file) => classifyTestLane(file) === 'client'),
  skippedExternal: selected.filter((file) => classifyTestLane(file) === 'external'),
})

const pluralize = (count: number, noun: string): string => `${String(count)} ${noun}${count === 1 ? '' : 's'}`

/**
 * Pure: the whole selection decision, with no filesystem, git, or clock access. Falls back to a
 * full run whenever narrowing cannot be justified — an empty or unjustified subset run that
 * reports green is the one outcome this command must never produce.
 */
export function selectAffected(input: SelectAffectedInput): Selection {
  const changed = input.changed.map(toPosix)
  const blast = changed.find(isBlastRadius)
  if (blast !== undefined) {
    return { kind: 'full', reason: `${blast} is in every test worker's preload — everything is affected` }
  }
  if (changed.length === 0) return { kind: 'full', reason: 'no changed files vs the base ref; nothing to narrow from' }
  const selected = collectSelected({ ...input, changed })
  if (selected.length === 0) {
    return {
      kind: 'full',
      reason: `no test file is statically reachable from the ${pluralize(changed.length, 'changed file')}; running the full suite rather than nothing`,
    }
  }
  return { kind: 'paths', ...splitLanes(selected), depth: input.depth, changed }
}

const skippedLanesLine = (skipped: readonly string[]): string => {
  const suffix = skipped.length === 0 ? '' : ` (${pluralize(skipped.length, 'selected test file')} not run)`
  return `  skipped lanes: e2e, stories${suffix}`
}

/**
 * The mandatory banner, printed BEFORE any result. Every line of the caveat is load-bearing:
 * the selection is a static-import heuristic, and an agent that reads "0 fail" without reading
 * this will conclude the suite is green when a few percent of it ran.
 */
export function formatBanner(input: { selection: PathSelection; serverTotal: number }): readonly string[] {
  const { selection, serverTotal } = input
  const head = `test:affected — ${String(selection.server.length)} of ${String(serverTotal)} server test files (depth ${String(selection.depth)}, ${pluralize(selection.changed.length, 'changed file')})`
  const client =
    selection.client.length === 0 ? [] : [`  plus ${pluralize(selection.client.length, 'client test file')}`]
  return [
    head,
    ...client,
    skippedLanesLine(selection.skippedExternal),
    '  This is a static-import heuristic: it cannot see mock.module() targets, computed',
    '  dynamic imports, or behaviour reached through DI seams. Green here is not green',
    '  for the suite.',
  ]
}

export type AffectedArgs =
  | { readonly kind: 'ok'; readonly depth: number; readonly baseRef: string }
  | { readonly kind: 'usageError'; readonly reason: string }

/** `--depth=<n>` overrides the measured default; `--base=<ref>` the diff base. */
export function parseAffectedArgs(argv: readonly string[]): AffectedArgs {
  let depth = DEFAULT_DEPTH
  let baseRef = DEFAULT_BASE_REF
  for (const arg of argv) {
    if (arg.startsWith('--depth=')) {
      const text = arg.slice('--depth='.length)
      if (!DEPTH_PATTERN.test(text)) return { kind: 'usageError', reason: 'depth must be a positive integer' }
      depth = Number(text)
    } else if (arg.startsWith('--base=')) {
      baseRef = arg.slice('--base='.length)
      if (baseRef === '') return { kind: 'usageError', reason: 'base must not be empty' }
    } else {
      return { kind: 'usageError', reason: `unknown argument ${arg}` }
    }
  }
  return { kind: 'ok', depth, baseRef }
}

const unquote = (text: string): string =>
  text.startsWith('"') && text.endsWith('"') && text.length > 1 ? text.slice(1, -1) : text

const parseStatusLine = (line: string): string | null => {
  if (line.length < 4) return null
  // Deletions are dropped: a file that no longer exists has no companion test to select, and
  // its former importers are picked up through the graph only if they still reference it.
  if (line.slice(0, 2).includes('D')) return null
  const rest = line.slice(3).trim()
  const arrow = rest.indexOf(' -> ')
  return unquote(arrow === -1 ? rest : rest.slice(arrow + ' -> '.length))
}

/** Repo-relative paths from `git status --porcelain`: staged, unstaged, renamed, untracked. */
export function parseStatusPorcelain(output: string): string[] {
  return output
    .split('\n')
    .map((line) => parseStatusLine(line.replace(/\r$/u, '')))
    .filter((file): file is string => file !== null && file !== '')
}

/**
 * Committed changes vs the base ∪ uncommitted work. The second half is not an optimization:
 * an agent runs this against a dirty tree far more often than against a clean one, and a
 * selection blind to the edit it was invoked for is worse than no selection at all.
 */
export function buildChangedFiles(diffOutput: string, statusOutput: string): string[] {
  const fromDiff = diffOutput
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  return [...new Set([...fromDiff, ...parseStatusPorcelain(statusOutput)])].map(toPosix).toSorted()
}

export interface PlannedCommand {
  readonly lane: 'full' | 'server' | 'client'
  readonly argv: readonly string[]
}

/** The `test:client` preset from package.json; without it bun's scanner drops tests/client/**. */
const CLIENT_PRESET: readonly string[] = [
  'bun',
  '--conditions=browser',
  'test',
  '--preload',
  './tests/client-setup.ts',
  '--path-ignore-patterns',
  '',
]

// The CLI entry of the wrapper (run-cli.ts owns the import.meta.main guard);
// spawning the library module run.ts would load it and run nothing.
const WRAPPER: readonly string[] = ['bun', 'scripts/test/run-cli.ts']

/**
 * Commands to run, in order. A lane with no selected paths yields no command at all — handing
 * the wrapper an empty path list would silently run the entire suite under an "affected" banner.
 */
export function planCommands(selection: Selection, options: { selectedBySupported: boolean }): PlannedCommand[] {
  if (selection.kind === 'full') return [{ lane: 'full', argv: WRAPPER }]
  const tag = options.selectedBySupported ? [SELECTED_BY_FLAG, `affected@${String(selection.depth)}`] : []
  const commands: PlannedCommand[] = []
  if (selection.server.length > 0) commands.push({ lane: 'server', argv: [...WRAPPER, ...tag, ...selection.server] })
  if (selection.client.length > 0) commands.push({ lane: 'client', argv: [...CLIENT_PRESET, ...selection.client] })
  return commands
}

/**
 * Whether `scripts/test/run.ts` consumes `--selected-by <tag>` itself. Until that seam exists the
 * wrapper forwards the flag to `bun test` and treats its value as a path filter, which would
 * narrow the run to nothing — so the tag is dropped rather than guessed at.
 */
export function wrapperSupportsSelectedBy(
  parse: (argv: readonly string[]) => { readonly passthrough: readonly string[]; readonly paths: readonly string[] },
): boolean {
  const probe = parse([SELECTED_BY_FLAG, 'affected@probe'])
  return !probe.passthrough.includes(SELECTED_BY_FLAG) && !probe.paths.includes('affected@probe')
}
