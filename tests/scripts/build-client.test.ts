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

  test('outputs dashboard.js as IIFE', () => {
    const jsPath = path.join(PUBLIC_DIR, 'dashboard.js')
    expect(fs.existsSync(jsPath)).toBe(true)
    const content = fs.readFileSync(jsPath, 'utf8')
    expect(content.length).toBeGreaterThan(0)
    // IIFE format: starts with ( or !
    expect(content).toMatch(/^[(!]/)
    // No ES module syntax
    expect(content).not.toContain('export *')
    expect(content).not.toContain('export {')
    expect(content).not.toMatch(/^import /m)
  })

  test('copies dashboard.html', () => {
    const htmlPath = path.join(PUBLIC_DIR, 'dashboard.html')
    expect(fs.existsSync(htmlPath)).toBe(true)
    const content = fs.readFileSync(htmlPath, 'utf8')
    expect(content).toContain('<!doctype html>')
    expect(content).toContain('dashboard.js')
    // Single script reference (not dashboard-ui.js + dashboard-state.js)
    expect(content).not.toContain('dashboard-ui.js')
    expect(content).not.toContain('dashboard-state.js')
  })

  test('copies dashboard.css', () => {
    const cssPath = path.join(PUBLIC_DIR, 'dashboard.css')
    expect(fs.existsSync(cssPath)).toBe(true)
    const content = fs.readFileSync(cssPath, 'utf8')
    expect(content).toContain('{')
  })
})
