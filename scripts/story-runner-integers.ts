// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

const BUN_INTEGER_TOKEN = /^\+?\d+$/u

type BunIntegerOptions = Readonly<{
  flag: string
  minimum: number
  maximum?: number
  expectation?: string
}>

export function parseBunInteger(token: string, options: BunIntegerOptions): number {
  const error = (): Error => new Error(`${options.flag} requires ${options.expectation ?? 'an integer'}`)
  if (!BUN_INTEGER_TOKEN.test(token)) throw error()
  const value = Number(token)
  if (!Number.isSafeInteger(value) || value < options.minimum) throw error()
  if (options.maximum !== undefined && value > options.maximum) throw error()
  return value
}
