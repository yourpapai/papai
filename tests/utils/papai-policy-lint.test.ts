// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const REPO_ROOT = path.resolve(import.meta.dir, '../..')
const PLUGIN_PATH = path.join(REPO_ROOT, 'lint-plugins/papai-policy.js')

const eslintDirective = ['eslint', 'disable'].join('-')
const oxlintDirective = ['oxlint', 'disable'].join('-')
const tsIgnoreDirective = ['@ts', 'ignore'].join('-')
const tsNoCheckDirective = ['@ts', 'nocheck'].join('-')
const currentYear = new Date().getFullYear()
const previousYear = currentYear - 1

interface LintResult {
  exitCode: number
  output: string
}

function pluginSpecifier(tempDir: string): string {
  const relativePath = path.relative(tempDir, PLUGIN_PATH).split(path.sep).join('/')
  if (relativePath.startsWith('.')) {
    return relativePath
  }

  return `./${relativePath}`
}

function runRule(ruleName: string, source: string): LintResult {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'papai-policy-'))
  const configPath = path.join(tempDir, '.oxlintrc.json')
  const filePath = path.join(tempDir, 'input.ts')

  try {
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          jsPlugins: [pluginSpecifier(tempDir)],
          rules: {
            [ruleName]: 'error',
          },
        },
        null,
        2,
      ),
    )
    fs.writeFileSync(filePath, source)

    const proc = Bun.spawnSync([process.execPath, 'x', 'oxlint', '--config', configPath, filePath], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    return {
      exitCode: proc.exitCode,
      output: `${proc.stdout.toString()}${proc.stderr.toString()}`,
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

describe('papai policy oxlint plugin', () => {
  test('rejects files without a BUSL license header', () => {
    const result = runRule('papai-policy/require-license-header', 'export const value = 1\n')

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('papai-policy(require-license-header)')
  })

  test('allows files with a BUSL license header', () => {
    const result = runRule(
      'papai-policy/require-license-header',
      [
        '// SPDX-License-Identifier: BUSL-1.1',
        `// Copyright (c) ${currentYear} Dmitriy Lazarev`,
        '// Use of this software is governed by the Business Source License 1.1.',
        '// See LICENSE in the project root for details.',
        '',
        'export const value = 1',
      ].join('\n'),
    )

    expect(result.exitCode).toBe(0)
  })

  test('allows files with a BUSL license header year range ending in the current year', () => {
    const result = runRule(
      'papai-policy/require-license-header',
      [
        '// SPDX-License-Identifier: BUSL-1.1',
        `// Copyright (c) ${previousYear}-${currentYear} Dmitriy Lazarev`,
        '// Use of this software is governed by the Business Source License 1.1.',
        '// See LICENSE in the project root for details.',
        '',
        'export const value = 1',
      ].join('\n'),
    )

    expect(result.exitCode).toBe(0)
  })

  test('rejects incomplete or stale BUSL license headers', () => {
    const result = runRule(
      'papai-policy/require-license-header',
      [
        '// SPDX-License-Identifier: BUSL-1.1',
        '// Copyright (c) 2000 Dmitriy Lazarev',
        '// Use of this software is governed by the Business Source License 1.1.',
        '',
        'export const value = 1',
      ].join('\n'),
    )

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('papai-policy(require-license-header)')
  })

  test('allows executable shebangs before the BUSL license header', () => {
    const result = runRule(
      'papai-policy/require-license-header',
      [
        '#!/usr/bin/env bun',
        '// SPDX-License-Identifier: BUSL-1.1',
        `// Copyright (c) ${currentYear} Dmitriy Lazarev`,
        '// Use of this software is governed by the Business Source License 1.1.',
        '// See LICENSE in the project root for details.',
        '',
        'console.log("ok")',
      ].join('\n'),
    )

    expect(result.exitCode).toBe(0)
  })

  test('rejects inline suppression comments', () => {
    const result = runRule(
      'papai-policy/no-inline-suppression-comments',
      [
        `/* ${eslintDirective} no-console */`,
        `/* ${oxlintDirective} no-console */`,
        `// ${tsIgnoreDirective}`,
        `// ${tsNoCheckDirective}`,
        'export const value = 1',
      ].join('\n'),
    )

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('papai-policy(no-inline-suppression-comments)')
  })

  test('allows ordinary comments', () => {
    const result = runRule(
      'papai-policy/no-inline-suppression-comments',
      ['// regular comment', 'export const value = 1'].join('\n'),
    )

    expect(result.exitCode).toBe(0)
  })

  test('rejects optional property and parameter syntax', () => {
    const result = runRule(
      'papai-policy/no-optional-type-syntax',
      [
        'export type User = { name?: string }',
        'export function describeUser(name?: string): string {',
        '  return String(name)',
        '}',
      ].join('\n'),
    )

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('papai-policy(no-optional-type-syntax)')
  })

  test('rejects default-value syntax', () => {
    const result = runRule(
      'papai-policy/no-default-value-syntax',
      ["export function render(mode = 'safe'): string {", '  return mode', '}'].join('\n'),
    )

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('papai-policy(no-default-value-syntax)')
  })

  test('rejects fallback expressions in value positions', () => {
    const result = runRule(
      'papai-policy/no-fallback-expressions',
      [
        'export function normalize(value: string | undefined): string {',
        "  const preferred = value || 'fallback'",
        "  const stable = value ?? 'empty'",
        '  let next = value',
        "  next ??= 'later'",
        '  return preferred + stable + String(next)',
        '}',
      ].join('\n'),
    )

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('papai-policy(no-fallback-expressions)')
  })

  test('allows boolean control-flow conditions', () => {
    const result = runRule(
      'papai-policy/no-fallback-expressions',
      [
        'export function anyEnabled(left: boolean, right: boolean): boolean {',
        '  if (left || right) {',
        '    return true',
        '  }',
        '',
        '  return false',
        '}',
      ].join('\n'),
    )

    expect(result.exitCode).toBe(0)
  })
})
