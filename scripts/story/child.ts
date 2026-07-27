// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import type { ParsedStoryRunnerArguments } from './cli.js'
import { buildStorySandboxCommand, type StorySandboxRequest } from './sandbox.js'
import type { StoryRunnerSession } from './session.js'

export type SpawnedStoryChild = Readonly<{
  exited: Promise<number>
  kill(signal: NodeJS.Signals): void
}>

export type StoryChildDependencies = Readonly<{
  env: Record<string, string | undefined>
  spawn(command: readonly string[], options: Parameters<typeof Bun.spawn>[1]): SpawnedStoryChild
  buildSandboxCommand?(request: StorySandboxRequest): readonly string[]
  platform?: NodeJS.Platform
  bunExecutable?: string
}>

const HOST_ENVIRONMENT_PASSTHROUGH = ['PATH', 'CI', 'HOME', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG'] as const

export function sanitizedStoryEnvironment(
  source: Record<string, string | undefined>,
  tempRoot: string,
): Record<string, string> {
  const env = Object.fromEntries(
    HOST_ENVIRONMENT_PASSTHROUGH.flatMap((key) => (source[key] === undefined ? [] : [[key, source[key]] as const])),
  )
  env['TMPDIR'] = tempRoot
  env['TZ'] = 'UTC'
  env['PAPAI_STORY_RUNNER'] = '1'
  return env
}

function childCommand(
  parsed: ParsedStoryRunnerArguments,
  session: StoryRunnerSession,
  bunExecutable: string,
  files: readonly string[],
): readonly string[] {
  return [
    bunExecutable,
    'test',
    `--config=${path.join(session.appRoot, 'scripts/snapshot-bunfig.toml')}`,
    '--path-ignore-patterns',
    '',
    '--preload',
    path.join(session.appRoot, 'tests/setup.ts'),
    '--preload',
    path.join(session.appRoot, 'tests/mock-reset.ts'),
    ...(parsed.contracts ? [] : ['--preload', path.join(session.appRoot, 'tests/stories/preload.ts')]),
    ...session.childReporterArguments,
    ...(parsed.coverage
      ? ['--coverage', '--coverage-reporter=lcov', `--coverage-dir=${path.join(session.tempRoot, 'coverage')}`]
      : []),
    ...files,
  ]
}

export function spawnStorySandboxedChild(
  parsed: ParsedStoryRunnerArguments,
  dependencies: StoryChildDependencies,
  files: readonly string[],
  session: StoryRunnerSession,
): SpawnedStoryChild {
  const bunExecutable = dependencies.bunExecutable ?? process.execPath
  const command = childCommand(parsed, session, bunExecutable, files)
  const buildSandbox = dependencies.buildSandboxCommand ?? buildStorySandboxCommand
  const sandboxCommand = buildSandbox({
    platform: dependencies.platform ?? process.platform,
    appRoot: session.appRoot,
    dependencyRoot: session.dependencyRoot,
    tempRoot: session.tempRoot,
    reportPaths: session.childReportPaths,
    bunExecutable,
    command,
  })
  return dependencies.spawn(sandboxCommand, {
    cwd: session.appRoot,
    env: {
      ...sanitizedStoryEnvironment(dependencies.env, session.tempRoot),
      PAPAI_STORY_EXECUTION_ROOT: session.appRoot,
    },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
}
