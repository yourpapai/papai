// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { defaultRunStryker } from '../../../scripts/mutation/paired-run.js'
import { resolveNodeModulesBin } from '../../../scripts/mutation/stryker-bin.js'

const makeRoot = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'stryker-bin-'))

const placeBin = (dir: string, binName: string): string => {
  const binPath = path.join(dir, 'node_modules', '.bin', binName)
  fs.mkdirSync(path.dirname(binPath), { recursive: true })
  fs.writeFileSync(binPath, '#!/usr/bin/env node\n')
  return binPath
}

describe('resolveNodeModulesBin', () => {
  test('returns the projectRoot-local bin when it exists', () => {
    const root = makeRoot()
    const expected = placeBin(root, 'stryker')

    expect(resolveNodeModulesBin(root, 'stryker')).toBe(expected)
  })

  test('walks up to an ancestor node_modules when projectRoot has none', () => {
    const root = makeRoot()
    const expected = placeBin(root, 'stryker')
    const nested = path.join(root, '.mutation-improve', 'worktrees', 'run-iter1')
    fs.mkdirSync(nested, { recursive: true })

    expect(resolveNodeModulesBin(nested, 'stryker')).toBe(expected)
  })

  test('prefers the nearest node_modules when several ancestors provide the bin', () => {
    const root = makeRoot()
    placeBin(root, 'stryker')
    const mid = path.join(root, 'packages', 'app')
    const expected = placeBin(mid, 'stryker')
    const nested = path.join(mid, 'worktrees', 'iter1')
    fs.mkdirSync(nested, { recursive: true })

    expect(resolveNodeModulesBin(nested, 'stryker')).toBe(expected)
  })

  test('falls back to the projectRoot-anchored path when no ancestor provides the bin', () => {
    const root = makeRoot()

    expect(resolveNodeModulesBin(root, 'stryker')).toBe(path.join(root, 'node_modules', '.bin', 'stryker'))
  })
})

describe('defaultRunStryker', () => {
  const placeExecutableBin = (dir: string, binName: string): void => {
    const binPath = path.join(dir, 'node_modules', '.bin', binName)
    fs.mkdirSync(path.dirname(binPath), { recursive: true })
    fs.writeFileSync(binPath, '#!/bin/bash\nexit 0\n')
    fs.chmodSync(binPath, 0o755)
  }

  test('spawns the bin from an ancestor node_modules when projectRoot has none', () => {
    const root = makeRoot()
    placeExecutableBin(root, 'stryker')
    const nested = path.join(root, '.mutation-improve', 'worktrees', 'run-iter1')
    fs.mkdirSync(nested, { recursive: true })

    expect(() => defaultRunStryker(path.join(nested, 'stryker.config.json'), nested, { verbose: false })).not.toThrow()
  })

  test('throws when no ancestor node_modules provides the bin', () => {
    const root = makeRoot()

    expect(() => defaultRunStryker(path.join(root, 'stryker.config.json'), root, { verbose: false })).toThrow(
      /stryker/u,
    )
  })
})
