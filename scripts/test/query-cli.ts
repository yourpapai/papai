// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * The command-line face of the query surface.
 *
 * Split from `query.ts` so the renderers stay a pure text layer with no notion of argv,
 * exit codes, or the filesystem. Everything here is wiring; everything there is answers.
 */

import fs from 'node:fs'
import path from 'node:path'

import { computeFingerprint, defaultFingerprintDeps } from './fingerprint.js'
import { LAST_RUN_JSON, LAST_RUN_LOG } from './paths.js'
import { renderFailures, renderLog, renderShow, renderSlowest, renderStatus } from './query.js'
import type { QueryContext } from './query.js'
import { readReport } from './report.js'

export interface QueryDeps {
  /** Reads a repo-relative path; `null` when missing or unreadable. */
  readFile: (path: string) => string | null
  fingerprint: () => string
  write: (text: string) => void
}

const COMMANDS = new Set(['status', 'failures', 'show', 'log', 'slowest'])
const VALUE_FLAGS = new Set(['-C', '--context', '--max'])
const NEEDS_ARGUMENT = new Set(['show', 'log'])

const USAGE = [
  'usage: bun scripts/test/query.ts <command>',
  '  status | failures [--files] | slowest [n]',
  '  show <#id | file:line | file | name substring>',
  '  log <pattern> [-C n] [--max n]',
].join('\n')

/** Positional arguments, with the values of `-C`/`--context`/`--max` consumed. */
const positionalArgs = (args: readonly string[]): string[] => {
  const positional: string[] = []
  let expectsValue = false
  for (const arg of args) {
    if (expectsValue) expectsValue = false
    else if (arg.startsWith('-')) expectsValue = VALUE_FLAGS.has(arg)
    else positional.push(arg)
  }
  return positional
}

const toNumber = (raw: string | undefined, fallback: number): number =>
  raw === undefined || raw === '' || !Number.isFinite(Number(raw)) ? fallback : Number(raw)

/** First finite `--name value` or `--name=value`; else `fallback`. */
const numberFlag = (args: readonly string[], names: readonly string[], fallback: number): number => {
  for (const [index, arg] of args.entries()) {
    const inline = names.find((name) => arg.startsWith(`${name}=`))
    const named = names.includes(arg) ? args[index + 1] : undefined
    const raw = inline === undefined ? named : arg.slice(inline.length + 1)
    if (raw !== undefined && Number.isFinite(Number(raw))) return Number(raw)
  }
  return fallback
}

const renderFor = (
  command: string,
  ctx: QueryContext,
  args: readonly string[],
  positional: readonly string[],
): string => {
  if (command === 'failures') return renderFailures(ctx, { filesOnly: args.includes('--files') })
  if (command === 'show') return renderShow(ctx, positional[0] ?? '')
  if (command === 'slowest') return renderSlowest(ctx, toNumber(positional[0], 10))
  if (command === 'log') {
    const context = numberFlag(args, ['-C', '--context'], 3)
    return renderLog(ctx, positional[0] ?? '', { context, max: numberFlag(args, ['--max'], 200) })
  }
  return renderStatus(ctx)
}

const loadContext = (deps: QueryDeps): QueryContext => ({
  report: readReport(LAST_RUN_JSON, { read: deps.readFile }),
  log: deps.readFile(LAST_RUN_LOG),
  currentFingerprint: deps.fingerprint(),
})

/**
 * Dispatch one query: `0` on any answer, `2` on a usage error, `3` when no usable report
 * exists. The run's own failures are never this command's exit code.
 */
export function runQuery(argv: readonly string[], deps: QueryDeps): number {
  const command = argv[0] ?? ''
  const args = argv.slice(1)
  const positional = positionalArgs(args)
  if (!COMMANDS.has(command) || (NEEDS_ARGUMENT.has(command) && positional[0] === undefined)) {
    deps.write(USAGE)
    return 2
  }

  const ctx = loadContext(deps)
  deps.write(renderFor(command, ctx, args, positional))
  return ctx.report === null ? 3 : 0
}

const readTextFile = (absolute: string): string | null => {
  try {
    return fs.readFileSync(absolute, 'utf8')
  } catch {
    return null
  }
}

function main(): void {
  const cwd = path.resolve(import.meta.dir, '../..')
  process.exitCode = runQuery(process.argv.slice(2), {
    readFile: (relPath: string): string | null => readTextFile(path.resolve(cwd, relPath)),
    fingerprint: (): string => computeFingerprint(defaultFingerprintDeps(cwd)),
    write: (text: string): void => {
      console.log(text)
    },
  })
}

if (import.meta.main) main()
