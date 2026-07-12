// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

const VALUE_FLAGS = new Set([
  '--seed',
  '--rerun-each',
  '--test-name-pattern',
  '--reporter',
  '--reporter-outfile',
  '--coverage-reporter',
])
const BOOLEAN_FLAGS = new Set(['--randomize'])

type ParsedArguments = Readonly<{ forwarded: readonly string[]; fixture?: string }>

function parseArguments(args: readonly string[]): ParsedArguments {
  const forwarded: string[] = []
  let fixture: string | undefined
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === undefined) continue
    if (argument === '--fixture') {
      const value = args[index + 1]
      if (value === undefined || value.startsWith('-')) throw new Error('--fixture requires a path')
      fixture = value
      index += 1
      continue
    }
    const [flag] = argument.split('=', 1)
    if (flag !== undefined && VALUE_FLAGS.has(flag)) {
      forwarded.push(argument)
      if (!argument.includes('=')) {
        const value = args[index + 1]
        if (value === undefined || value.startsWith('-')) throw new Error(`${flag} requires a value`)
        forwarded.push(value)
        index += 1
      }
      continue
    }
    if (BOOLEAN_FLAGS.has(argument)) {
      forwarded.push(argument)
      continue
    }
    throw new Error(`Unsupported story runner argument: ${argument}`)
  }
  return { forwarded, ...(fixture === undefined ? {} : { fixture }) }
}

function sanitizedEnvironment(): Record<string, string> {
  const allowed = ['PATH', 'HOME', 'TMPDIR', 'CI'] as const
  const env = Object.fromEntries(
    allowed.flatMap((key) => (process.env[key] === undefined ? [] : [[key, process.env[key]] as const])),
  )
  env['TZ'] = 'UTC'
  env['PAPAI_STORY_RUNNER'] = '1'
  return env
}

async function discoverStories(): Promise<readonly string[]> {
  const files: string[] = []
  const glob = new Bun.Glob('tests/stories/**/*.story.test.ts')
  for await (const file of glob.scan({ cwd: process.cwd(), onlyFiles: true })) files.push(file)
  return files.sort()
}

async function main(): Promise<number> {
  let parsed: ParsedArguments
  try {
    parsed = parseArguments(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 2
  }
  const files =
    parsed.fixture === undefined
      ? await discoverStories()
      : [`./${path.relative(process.cwd(), path.resolve(parsed.fixture))}`]
  if (files.length === 0) {
    console.error('No story tests found')
    return 2
  }
  const child = Bun.spawn(
    [
      'bun',
      '--no-env-file',
      'test',
      '--preload',
      './tests/stories/preload.ts',
      '--path-ignore-patterns',
      '',
      ...parsed.forwarded,
      ...files,
    ],
    { cwd: process.cwd(), env: sanitizedEnvironment(), stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' },
  )
  const exitCode = await child.exited
  return exitCode
}

process.exitCode = await main()
