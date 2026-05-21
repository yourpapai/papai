// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

import { PUBLIC_DIR } from '../../scripts/build-client.js'

describe('build-client', () => {
  beforeAll(() => {
    // Clean output dir
    if (fs.existsSync(PUBLIC_DIR)) {
      fs.rmSync(PUBLIC_DIR, { recursive: true })
    }

    // Run the build script
    const proc = Bun.spawnSync(['bun', 'scripts/build-client.ts'], {
      cwd: path.resolve(import.meta.dir, '../..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    if (proc.exitCode !== 0) {
      throw new Error(`Build failed: ${proc.stderr.toString()}`)
    }
  })

  afterAll(() => {
    // Clean up
    if (fs.existsSync(PUBLIC_DIR)) {
      fs.rmSync(PUBLIC_DIR, { recursive: true })
    }
  })

  test('creates public/ directory', () => {
    expect(fs.existsSync(PUBLIC_DIR)).toBe(true)
  })

  test.each([['debug.js'], ['admin.js']])('outputs %s as IIFE', (jsName) => {
    const jsPath = path.join(PUBLIC_DIR, jsName)
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
    const htmlPath = path.join(PUBLIC_DIR, htmlName)
    expect(fs.existsSync(htmlPath)).toBe(true)
    const content = fs.readFileSync(htmlPath, 'utf8')
    expect(content).toContain('<!doctype html>')
    expect(content).toContain(jsName)
    // Single script reference (not dashboard-ui.js + dashboard-state.js)
    expect(content).not.toContain('dashboard-ui.js')
    expect(content).not.toContain('dashboard-state.js')
  })

  test.each([['debug.css'], ['admin.css']])('copies %s', (cssName) => {
    const cssPath = path.join(PUBLIC_DIR, cssName)
    expect(fs.existsSync(cssPath)).toBe(true)
    const content = fs.readFileSync(cssPath, 'utf8')
    expect(content).toContain('{')
  })
})
