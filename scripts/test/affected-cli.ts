// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * The command-line face of affected-test selection: the only place real collaborators
 * are wired. Split from `affected.ts` so the selection logic stays fully injectable.
 */

import { execFileSync } from 'node:child_process'
import path from 'node:path'

import { Glob } from 'bun'

import { createCandidateContext, listCandidateTests } from '../mutation/coverage-map.js'
import { classifyTestLane } from '../mutation/coverage-runner.js'
import {
  buildChangedFiles,
  formatBanner,
  parseAffectedArgs,
  planCommands,
  selectAffected,
  TEST_SCAN_PATTERN,
  wrapperSupportsSelectedBy,
} from './affected.js'
import type { Selection } from './affected.js'
import { buildReverseGraph, defaultGraphDeps } from './import-graph.js'
import { parseWrapperArgs } from './mode.js'

interface MainDeps {
  readonly projectRoot: string
  readonly runGit: (args: readonly string[]) => string
  readonly spawn: (argv: readonly string[]) => number
  readonly print: (line: string) => void
}

const countServerTests = (projectRoot: string): number => {
  try {
    return [...new Glob(TEST_SCAN_PATTERN).scanSync({ cwd: projectRoot, onlyFiles: true })].filter(
      (file) => classifyTestLane(file) === 'server',
    ).length
  } catch {
    return 0
  }
}

const changedFilesOrNull = (deps: MainDeps, baseRef: string): string[] | null => {
  try {
    const diff = deps.runGit(['diff', '--name-only', '--diff-filter=ACMR', `${baseRef}...HEAD`])
    return buildChangedFiles(diff, deps.runGit(['status', '--porcelain']))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    deps.print(`test:affected — cannot diff against ${baseRef} (${message.split('\n')[0] ?? ''}); running everything`)
    return null
  }
}

const resolveSelection = (deps: MainDeps, args: { depth: number; baseRef: string }): Selection => {
  const changed = changedFilesOrNull(deps, args.baseRef)
  if (changed === null) return { kind: 'full', reason: `git diff against ${args.baseRef} failed` }
  const ctx = createCandidateContext(deps.projectRoot)
  return selectAffected({
    changed,
    graph: buildReverseGraph(defaultGraphDeps(deps.projectRoot)),
    candidates: (srcFile) => listCandidateTests(srcFile, deps.projectRoot, ctx),
    depth: args.depth,
  })
}

const announce = (deps: MainDeps, selection: Selection): void => {
  const lines =
    selection.kind === 'full'
      ? [`test:affected — full suite: ${selection.reason}`]
      : formatBanner({ selection, serverTotal: countServerTests(deps.projectRoot) })
  for (const line of lines) deps.print(line)
}

export function runAffected(argv: readonly string[], deps: MainDeps): number {
  const args = parseAffectedArgs(argv)
  if (args.kind === 'usageError') {
    deps.print(args.reason)
    deps.print('Usage: bun scripts/test/affected.ts [--depth=N] [--base=REF]')
    return 2
  }
  const selection = resolveSelection(deps, args)
  announce(deps, selection)
  let worst = 0
  for (const command of planCommands(selection, { selectedBySupported: wrapperSupportsSelectedBy(parseWrapperArgs) })) {
    const code = deps.spawn(command.argv)
    if (code !== 0) worst = code
  }
  return worst
}

const realDeps = (projectRoot: string): MainDeps => ({
  projectRoot,
  runGit: (args): string => execFileSync('git', [...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
  spawn: (argv): number =>
    Bun.spawnSync([...argv], { cwd: projectRoot, stdio: ['inherit', 'inherit', 'inherit'] }).exitCode,
  print: (line): void => {
    process.stdout.write(`${line}\n`)
  },
})

if (import.meta.main) {
  process.exit(runAffected(process.argv.slice(2), realDeps(path.resolve(import.meta.dir, '..', '..'))))
}
