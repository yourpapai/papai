// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { loadRegistry, planPayloads } from './figma-connect-lib.js'

export interface ConnectArgs {
  command: 'validate' | 'plan'
}

const fail = (message: string): never => {
  console.error(`status=error reason=${message}`)
  process.exit(1)
}

export const parseConnectArgs = (argv: readonly string[]): ConnectArgs => {
  const [command, ...flags] = argv
  if (command === undefined) throw new Error('missing_command')
  if (command !== 'validate' && command !== 'plan') throw new Error(`unknown_command:${command}`)
  for (const flag of flags) throw new Error(`unknown_flag:${flag}`)
  return { command }
}

const runValidate = (): void => {
  const registry = loadRegistry()
  console.info(
    `status=ok components=${registry.components.length} screens=${registry.screens.length} sections=${registry.sections.length}`,
  )
}

const runPlan = (): void => {
  const payloads = planPayloads(loadRegistry())
  console.info(JSON.stringify({ descriptions: payloads }, null, 2))
}

const parseOrFail = (argv: readonly string[]): ConnectArgs => {
  try {
    return parseConnectArgs(argv)
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }
}

export const main = (): void => {
  const args = parseOrFail(process.argv.slice(2))
  if (args.command === 'validate') runValidate()
  else runPlan()
}

if (import.meta.main) main()
