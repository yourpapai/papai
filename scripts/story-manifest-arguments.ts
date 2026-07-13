// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { parseBunInteger } from './story-runner-integers.js'

export function parseStoryManifestArguments(args: readonly string[]): Readonly<{ seed: number }> {
  let seed = 41021
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    let token: string
    if (argument !== undefined && argument.startsWith('--seed=')) token = argument.slice('--seed='.length)
    else if (argument === '--seed') {
      const value = args[index + 1]
      if (value === undefined) throw new Error('--seed requires a value')
      token = value
      index += 1
    } else throw new Error(`Unsupported story manifest argument: ${argument}`)
    if (token.trim() === '') throw new Error('--seed requires a non-empty value')
    seed = parseBunInteger(token, {
      flag: '--seed',
      minimum: 0,
      maximum: 4_294_967_295,
      expectation: 'an integer between 0 and 4294967295',
    })
  }
  return { seed }
}
