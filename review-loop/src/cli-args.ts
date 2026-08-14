// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

/**
 * The command line, as a value.
 *
 * Split from `cli.ts` so that file is about *running* a review — the config, the
 * worktree, the loop, the stop and the finalization — rather than about how its
 * invocation is spelled. The two change for entirely different reasons: a new
 * flag is a change here and nowhere else, while everything the flags feed is
 * plain data by the time `runCli` sees it.
 */

export interface CliArgs {
  configPath: string
  planPath: string
  repoRoot?: string
  resumeRunId?: string
  resetWorktree: boolean
  poolSize?: number
  noInspect: boolean
}

const DEFAULT_CONFIG_PATH = path.join(import.meta.dir, '..', 'config.json')

function readValueArg(argv: readonly string[], index: number, name: string): string {
  const value = argv[index + 1]
  if (value === undefined) {
    throw new Error(`Missing value for ${name}`)
  }
  return value
}

interface ParsedFlags {
  configPath: string
  planPath?: string
  repoRoot?: string
  resumeRunId?: string
  resetWorktree: boolean
  poolSize?: number
  noInspect: boolean
}

function parseFlag(argv: readonly string[], index: number, flags: ParsedFlags): number {
  const arg = argv[index]
  if (arg === undefined) return index
  switch (arg) {
    case '--config':
      flags.configPath = readValueArg(argv, index, '--config')
      return index + 1
    case '--plan':
      flags.planPath = readValueArg(argv, index, '--plan')
      return index + 1
    case '--repo':
      flags.repoRoot = readValueArg(argv, index, '--repo')
      return index + 1
    case '--resume-run':
      flags.resumeRunId = readValueArg(argv, index, '--resume-run')
      return index + 1
    case '--reset-worktree':
      flags.resetWorktree = true
      return index
    case '--pool-size': {
      const value = Number(readValueArg(argv, index, '--pool-size'))
      if (!Number.isInteger(value) || value < 1) {
        throw new Error('--pool-size must be a positive integer')
      }
      flags.poolSize = value
      return index + 1
    }
    case '--no-inspect':
      flags.noInspect = true
      return index
    default:
      return index
  }
}

export function parseCliArgs(argv: readonly string[]): CliArgs {
  const flags: ParsedFlags = {
    configPath: DEFAULT_CONFIG_PATH,
    resetWorktree: false,
    noInspect: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    index = parseFlag(argv, index, flags)
  }
  if (flags.planPath === undefined) {
    throw new Error('Missing required --plan')
  }
  return {
    configPath: flags.configPath,
    planPath: flags.planPath,
    repoRoot: flags.repoRoot,
    resumeRunId: flags.resumeRunId,
    resetWorktree: flags.resetWorktree,
    poolSize: flags.poolSize,
    noInspect: flags.noInspect,
  }
}
