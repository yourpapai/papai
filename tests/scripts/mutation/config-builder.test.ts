// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildPairedConfig } from '../../../scripts/mutation/config-builder.js'

const BASE = {
  testRunner: 'bun',
  appendPlugins: ['@hughescr/stryker-bun-runner', '@stryker-mutator/typescript-checker'],
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.json',
  bun: { timeout: 120_000 },
  mutate: ['src/providers/**/*.ts'],
  coverageAnalysis: 'perTest',
  ignoreStatic: true,
  incremental: true,
  incrementalFile: 'reports/stryker-incremental.json',
  concurrency: 8,
  timeoutMS: 60_000,
  timeoutFactor: 2,
  thresholds: { high: 80, low: 60, break: 40 },
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation.html' },
  jsonReporter: { fileName: 'reports/mutation.json' },
  ignorePatterns: ['node_modules', '.stryker-tmp'],
  cleanTempDir: true,
}

describe('buildPairedConfig', () => {
  test('mutates exactly the given source file', () => {
    const cfg = buildPairedConfig({
      base: BASE,
      srcFile: 'src/providers/kaneo/label-resource.ts',
      testFiles: ['tests/providers/kaneo/label-resource.test.ts'],
      reportPath: 'reports/paired/label-resource.json',
    })
    expect(cfg.mutate).toEqual(['src/providers/kaneo/label-resource.ts'])
  })

  test('forces ignoreStatic:false regardless of base', () => {
    const cfg = buildPairedConfig({
      base: BASE,
      srcFile: 'src/foo.ts',
      testFiles: ['tests/foo.test.ts'],
      reportPath: 'reports/paired/foo.json',
    })
    expect(cfg.ignoreStatic).toBe(false)
  })

  test('passes testFiles through bun.testFiles', () => {
    const cfg = buildPairedConfig({
      base: BASE,
      srcFile: 'src/foo.ts',
      testFiles: ['tests/foo.test.ts', 'tests/integration/foo-flow.test.ts'],
      reportPath: 'reports/paired/foo.json',
    })
    expect(cfg.bun.testFiles).toEqual(['./tests/foo.test.ts', './tests/integration/foo-flow.test.ts'])
  })

  test('prefixes relative testFiles with ./ so Bun treats them as paths not patterns', () => {
    // Without ./prefix, Bun uses testFiles as pattern filters and applies pathIgnorePatterns,
    // which blocks tests/client/** from being discovered in the Stryker sandbox.
    const cfg = buildPairedConfig({
      base: BASE,
      srcFile: 'client/admin/feature-flags-fetcher-schemas.ts',
      testFiles: ['tests/client/admin/feature-flags-fetcher-schemas.test.ts'],
      reportPath: 'reports/paired/feature-flags.json',
    })
    expect(cfg.bun.testFiles).toEqual(['./tests/client/admin/feature-flags-fetcher-schemas.test.ts'])
  })

  test('does not double-prefix testFiles that already start with ./', () => {
    const cfg = buildPairedConfig({
      base: BASE,
      srcFile: 'src/foo.ts',
      testFiles: ['./tests/foo.test.ts'],
      reportPath: 'reports/paired/foo.json',
    })
    expect(cfg.bun.testFiles).toEqual(['./tests/foo.test.ts'])
  })

  test('does not add ./ prefix to absolute testFile paths', () => {
    const cfg = buildPairedConfig({
      base: BASE,
      srcFile: 'src/foo.ts',
      testFiles: ['/absolute/path/foo.test.ts'],
      reportPath: 'reports/paired/foo.json',
    })
    expect(cfg.bun.testFiles).toEqual(['/absolute/path/foo.test.ts'])
  })

  test('preserves base bun options (timeout)', () => {
    const cfg = buildPairedConfig({
      base: BASE,
      srcFile: 'src/foo.ts',
      testFiles: ['tests/foo.test.ts'],
      reportPath: 'reports/paired/foo.json',
    })
    expect(cfg.bun.timeout).toBe(120_000)
  })

  test('disables incremental and html, routes json to the per-file report path, and breaks at 0', () => {
    const cfg = buildPairedConfig({
      base: BASE,
      srcFile: 'src/foo.ts',
      testFiles: ['tests/foo.test.ts'],
      reportPath: 'reports/paired/foo.json',
    })
    expect(cfg.incremental).toBe(false)
    expect(cfg.reporters).toEqual(['json'])
    expect(cfg.jsonReporter.fileName).toBe('reports/paired/foo.json')
    expect(cfg.thresholds.break).toBe(0)
    expect(cfg.htmlReporter).toBeUndefined()
    expect(cfg['incrementalFile']).toBeUndefined()
  })

  test('preserves base threshold bands while breaking at 0', () => {
    const cfg = buildPairedConfig({
      base: { ...BASE, thresholds: { high: 95, low: 75, break: 50 } },
      srcFile: 'src/foo.ts',
      testFiles: ['tests/foo.test.ts'],
      reportPath: 'reports/paired/foo.json',
    })
    expect(cfg.thresholds).toEqual({ high: 95, low: 75, break: 0 })
  })

  test('preserves checkers, tsconfig, plugins, and ignorePatterns', () => {
    const cfg = buildPairedConfig({
      base: BASE,
      srcFile: 'src/foo.ts',
      testFiles: ['tests/foo.test.ts'],
      reportPath: 'reports/paired/foo.json',
    })
    expect(cfg.checkers).toEqual(['typescript'])
    expect(cfg.tsconfigFile).toBe('tsconfig.json')
    expect(cfg.appendPlugins).toEqual(['@hughescr/stryker-bun-runner', '@stryker-mutator/typescript-checker'])
    expect(cfg.ignorePatterns).toEqual(['node_modules', '.stryker-tmp'])
  })

  test('rejects an empty testFiles list', () => {
    expect(() =>
      buildPairedConfig({
        base: BASE,
        srcFile: 'src/foo.ts',
        testFiles: [],
        reportPath: 'reports/paired/foo.json',
      }),
    ).toThrow(/testFiles/u)
  })

  test('adds --path-ignore-patterns "" bunArg when any testFile is under tests/client/', () => {
    // bunfig.toml pathIgnorePatterns blocks tests/client/** during discovery in the
    // Stryker sandbox. The stryker-bun-runner sanitizer copies pathIgnorePatterns to
    // the sandbox bunfig; --path-ignore-patterns '' on the CLI overrides it.
    const cfg = buildPairedConfig({
      base: BASE,
      srcFile: 'client/admin/feature-flags-fetcher-schemas.ts',
      testFiles: ['tests/client/admin/feature-flags-fetcher-schemas.test.ts'],
      reportPath: 'reports/paired/feature-flags.json',
    })
    expect(cfg.bun.bunArgs).toContain('--path-ignore-patterns')
    expect(cfg.bun.bunArgs).toContain('')
  })

  test('does not add bunArg for server-side tests not under tests/client/', () => {
    const cfg = buildPairedConfig({
      base: BASE,
      srcFile: 'src/tools/feature-flags.ts',
      testFiles: ['tests/tools/feature-flags.test.ts'],
      reportPath: 'reports/paired/feature-flags.json',
    })
    expect(cfg.bun.bunArgs).toBeUndefined()
  })

  test('preserves existing base bunArgs when adding path-ignore-patterns', () => {
    const cfg = buildPairedConfig({
      base: { ...BASE, bun: { ...BASE.bun, bunArgs: ['--watch'] } },
      srcFile: 'client/foo.ts',
      testFiles: ['tests/client/foo.test.ts'],
      reportPath: 'reports/paired/foo.json',
    })
    expect(cfg.bun.bunArgs).toContain('--watch')
    expect(cfg.bun.bunArgs).toContain('--path-ignore-patterns')
  })
})
