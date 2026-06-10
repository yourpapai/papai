// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { PUBLIC_DIR } from '../../scripts/build-client.js'

describe('build-client', () => {
  // Build into a temp dir (via CLIENT_BUILD_OUTDIR) instead of the real
  // public/: other test files serve the repo's public/ bundles in parallel
  // workers, so wiping or rebuilding it here would race with them.
  let outDir: string

  beforeAll(() => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-client-test-'))

    // Run the build script
    const proc = Bun.spawnSync(['bun', 'scripts/build-client.ts'], {
      cwd: path.resolve(import.meta.dir, '../..'),
      env: { ...process.env, CLIENT_BUILD_OUTDIR: outDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    if (proc.exitCode !== 0) {
      throw new Error(`Build failed: ${proc.stderr.toString()}`)
    }
  })

  afterAll(() => {
    fs.rmSync(outDir, { recursive: true, force: true })
  })

  test('PUBLIC_DIR defaults to the repo public/ dir when no override is set', () => {
    // This test process has no CLIENT_BUILD_OUTDIR, so the imported constant
    // must point at the real public/ output dir used in production builds.
    expect(PUBLIC_DIR).toBe(path.resolve(import.meta.dir, '../../public'))
  })

  test('creates the output directory', () => {
    expect(fs.existsSync(outDir)).toBe(true)
  })

  test.each([['debug.js'], ['admin.js']])('outputs %s as IIFE', (jsName) => {
    const jsPath = path.join(outDir, jsName)
    expect(fs.existsSync(jsPath)).toBe(true)
    const content = fs.readFileSync(jsPath, 'utf8')
    expect(content.length).toBeGreaterThan(0)
    // IIFE format: starts with ( or !
    expect(content).toMatch(/^[(!]/u)
    // No ES module syntax
    expect(content).not.toContain('export *')
    expect(content).not.toContain('export {')
    expect(content).not.toMatch(/^import /mu)
  })

  test.each([
    ['debug.html', 'debug.js'],
    ['admin.html', 'admin.js'],
  ])('copies %s', (htmlName, jsName) => {
    const htmlPath = path.join(outDir, htmlName)
    expect(fs.existsSync(htmlPath)).toBe(true)
    const content = fs.readFileSync(htmlPath, 'utf8')
    expect(content).toContain('<!doctype html>')
    expect(content).toContain(jsName)
    // Single script reference (not dashboard-ui.js + dashboard-state.js)
    expect(content).not.toContain('dashboard-ui.js')
    expect(content).not.toContain('dashboard-state.js')
  })

  test.each([['debug.css'], ['admin.css']])('copies %s', (cssName) => {
    const cssPath = path.join(outDir, cssName)
    expect(fs.existsSync(cssPath)).toBe(true)
    const content = fs.readFileSync(cssPath, 'utf8')
    expect(content).toContain('{')
  })
})
