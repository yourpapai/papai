// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { lstatSync, realpathSync } from 'node:fs'
import path from 'node:path'

import { STORY_JUNIT_REPORT_PATH, STORY_REPORT_DIRECTORY } from './story-reports.js'
import { parseBunInteger } from './story-runner-integers.js'

export const STORY_SEED = 41021
const VALUE_FLAGS = new Set([
  '--seed',
  '--rerun-each',
  '--test-name-pattern',
  '--reporter',
  '--reporter-outfile',
  '--coverage-reporter',
])
const BOOLEAN_FLAGS = new Set(['--randomize'])

export type ParsedStoryRunnerArguments = Readonly<{
  forwarded: readonly string[]
  fixture?: string
  compat: boolean
  contracts: boolean
  baselineRef?: string
  manifestOnly: boolean
  seed: number
}>

type ArgumentState = {
  forwarded: string[]
  fixture: string | undefined
  baselineRef: string | undefined
  compat: boolean
  contracts: boolean
  manifestOnly: boolean
  seed: number | undefined
  hasReporter: boolean
  hasReporterOutfile: boolean
}

function parseValue(
  args: readonly string[],
  index: number,
  flag: string,
): Readonly<{ value: string; consumed: number }> {
  const argument = args[index]
  if (argument !== undefined && argument.includes('=')) {
    const value = argument.slice(argument.indexOf('=') + 1)
    if (value.trim() === '') throw new Error(`${flag} requires a non-empty value`)
    return { value, consumed: 0 }
  }
  const value = args[index + 1]
  if (value === undefined || value.startsWith('-')) throw new Error(`${flag} requires a value`)
  if (value.trim() === '') throw new Error(`${flag} requires a non-empty value`)
  return { value, consumed: 1 }
}

function parseSeed(token: string): number {
  return parseBunInteger(token, {
    flag: '--seed',
    minimum: 0,
    maximum: 4_294_967_295,
    expectation: 'an integer between 0 and 4294967295',
  })
}

function applyForwardedValue(
  state: ArgumentState,
  flag: string,
  argument: string,
  parsed: Readonly<{ value: string; consumed: number }>,
): void {
  if (flag === '--rerun-each') {
    parseBunInteger(parsed.value, {
      flag,
      minimum: 1,
      maximum: 4_294_967_295,
      expectation: 'an integer between 1 and 4294967295',
    })
  }
  state.forwarded.push(argument)
  if (parsed.consumed === 1) state.forwarded.push(parsed.value)
  if (flag === '--seed') state.seed = parseSeed(parsed.value)
  if (flag === '--reporter') state.hasReporter = true
  if (flag === '--reporter-outfile') state.hasReporterOutfile = true
}

function finalizeArguments(state: ArgumentState): ParsedStoryRunnerArguments {
  const effectiveSeed = state.seed ?? STORY_SEED
  if (state.seed === undefined) state.forwarded.push('--seed', String(effectiveSeed))
  if (!state.manifestOnly && !state.hasReporter) state.forwarded.push('--reporter', 'junit')
  if (!state.manifestOnly && !state.hasReporter && !state.hasReporterOutfile) {
    state.forwarded.push('--reporter-outfile', STORY_JUNIT_REPORT_PATH)
  }
  return {
    forwarded: state.forwarded,
    fixture: state.fixture,
    baselineRef: state.baselineRef,
    compat: state.compat || state.baselineRef !== undefined,
    contracts: state.contracts,
    manifestOnly: state.manifestOnly,
    seed: effectiveSeed,
  }
}

export function parseStoryRunnerArguments(args: readonly string[]): ParsedStoryRunnerArguments {
  const state: ArgumentState = {
    forwarded: [],
    fixture: undefined,
    baselineRef: undefined,
    compat: false,
    contracts: false,
    manifestOnly: false,
    seed: undefined,
    hasReporter: false,
    hasReporterOutfile: false,
  }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === undefined) continue
    const [flag] = argument.split('=', 1)
    if (flag === '--fixture' || flag === '--baseline-ref') {
      const parsed = parseValue(args, index, flag)
      if (flag === '--fixture') state.fixture = parsed.value
      else state.baselineRef = parsed.value
      index += parsed.consumed
      continue
    }
    if (argument === '--compat' || argument === '--manifest-only' || argument === '--contracts') {
      if (argument === '--compat') state.compat = true
      else if (argument === '--manifest-only') state.manifestOnly = true
      else state.contracts = true
      continue
    }
    if (flag !== undefined && VALUE_FLAGS.has(flag)) {
      const parsed = parseValue(args, index, flag)
      applyForwardedValue(state, flag, argument, parsed)
      index += parsed.consumed
      continue
    }
    if (BOOLEAN_FLAGS.has(argument)) {
      state.forwarded.push(argument)
      continue
    }
    throw new Error(`Unsupported story runner argument: ${argument}`)
  }
  return finalizeArguments(state)
}

function isWithinDirectory(directory: string, target: string): boolean {
  const relative = path.relative(directory, target)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function existingPath(target: string): ReturnType<typeof lstatSync> | undefined {
  return lstatSync(target, { throwIfNoEntry: false })
}

function pathComponents(root: string, target: string): readonly string[] {
  const parent = path.dirname(target)
  const relative = path.relative(root, parent)
  if (relative === '') return [root, target]
  const components = [root]
  let current = root
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment)
    components.push(current)
  }
  components.push(target)
  return components
}

function assertSafeReporterOutfile(liveRoot: string, output: string): void {
  const rootEntry = existingPath(liveRoot)
  const realLiveRoot = rootEntry === undefined ? undefined : realpathSync(liveRoot)
  for (const component of pathComponents(liveRoot, output)) {
    const entry = existingPath(component)
    if (entry === undefined) continue
    if (entry.isSymbolicLink()) throw new Error('Story reporter outfile must not traverse symbolic links')
    if (realLiveRoot !== undefined && !isWithinDirectory(realLiveRoot, realpathSync(component))) {
      throw new Error(`Story reporter outfile must stay within ${liveRoot}`)
    }
  }
}

function resolveReporterOutfile(value: string, liveRoot: string, reportRoot: string): string {
  const output = path.resolve(liveRoot, value)
  const relative = path.relative(reportRoot, output)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Story reporter outfile must stay within ${reportRoot}`)
  }
  assertSafeReporterOutfile(liveRoot, output)
  return output
}

export function resolveReporterOutfiles(forwarded: readonly string[], liveRoot: string): readonly string[] {
  const reportRoot = path.resolve(liveRoot, STORY_REPORT_DIRECTORY)
  const argumentsForChild: string[] = []
  let reporterOutfile = false
  for (const argument of forwarded) {
    if (reporterOutfile) {
      argumentsForChild.push(resolveReporterOutfile(argument, liveRoot, reportRoot))
      reporterOutfile = false
      continue
    }
    if (argument.startsWith('--reporter-outfile=')) {
      argumentsForChild.push(
        `--reporter-outfile=${resolveReporterOutfile(argument.slice('--reporter-outfile='.length), liveRoot, reportRoot)}`,
      )
      continue
    }
    argumentsForChild.push(argument)
    reporterOutfile = argument === '--reporter-outfile'
  }
  return argumentsForChild
}
