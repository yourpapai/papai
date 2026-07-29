// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { REQUIRED_BUNDLES, ensureClientBuilt, missingBundles } from '../../scripts/ensure-client-built.js'
import type { EnsureDeps } from '../../scripts/ensure-client-built.js'

describe('missingBundles', () => {
  test('returns all required names when the dir does not exist', () => {
    const absent = path.join(os.tmpdir(), 'ensure-client-nope-does-not-exist')
    expect(missingBundles(absent, REQUIRED_BUNDLES)).toEqual([...REQUIRED_BUNDLES])
  })

  test('returns empty when every required file is present', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensure-client-all-'))
    try {
      for (const name of REQUIRED_BUNDLES) {
        fs.writeFileSync(path.join(dir, name), 'x')
      }
      expect(missingBundles(dir, REQUIRED_BUNDLES)).toEqual([])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('returns only the missing subset, in required order', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensure-client-some-'))
    try {
      // Present: debug.js and admin.css; everything else missing.
      fs.writeFileSync(path.join(dir, 'debug.js'), 'x')
      fs.writeFileSync(path.join(dir, 'admin.css'), 'x')
      const present = ['debug.js', 'admin.css']
      const expected = REQUIRED_BUNDLES.filter((name) => !present.includes(name))
      expect(missingBundles(dir, REQUIRED_BUNDLES)).toEqual(expected)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('ensureClientBuilt', () => {
  function makeDeps(missingResult: string[]): {
    deps: EnsureDeps
    buildCalls: number
    logs: string[]
  } {
    const logs: string[] = []
    let buildCalls = 0
    const deps: EnsureDeps = {
      publicDir: '/fake/public',
      required: REQUIRED_BUNDLES,
      missing: () => missingResult,
      build: () => {
        buildCalls += 1
      },
      log: (message: string) => {
        logs.push(message)
      },
    }
    return {
      deps,
      get buildCalls(): number {
        return buildCalls
      },
      logs,
    }
  }

  test('returns "present" and does not build when nothing is missing', () => {
    const harness = makeDeps([])
    const result = ensureClientBuilt(harness.deps)
    expect(result).toBe('present')
    expect(harness.buildCalls).toBe(0)
  })

  test('returns "built", builds once, and logs the missing names', () => {
    const harness = makeDeps(['debug.js', 'settings.html'])
    const result = ensureClientBuilt(harness.deps)
    expect(result).toBe('built')
    expect(harness.buildCalls).toBe(1)
    expect(harness.logs.join('\n')).toContain('debug.js')
    expect(harness.logs.join('\n')).toContain('settings.html')
  })
})
