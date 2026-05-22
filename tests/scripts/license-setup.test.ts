// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const REPO_ROOT = path.resolve(import.meta.dir, '../..')

const readRepoFile = (relativePath: string): string => readFileSync(path.join(REPO_ROOT, relativePath), 'utf8')

const HEADER = '// SPDX-License-Identifier: BUSL-1.1'

const runCommand = (
  cwd: string,
  cmd: readonly string[],
  env: Readonly<Record<string, string>> = {},
): Readonly<{ exitCode: number | null; stdout: string; stderr: string }> => {
  const result = Bun.spawnSync({
    cmd: [...cmd],
    cwd,
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  return {
    exitCode: result.exitCode,
    stdout: result.stdout === undefined ? '' : Buffer.from(result.stdout).toString(),
    stderr: result.stderr === undefined ? '' : Buffer.from(result.stderr).toString(),
  }
}

const createHeaderScriptRepo = (): string => {
  const repoDir = mkdtempSync(path.join(tmpdir(), 'license-headers-'))
  const scriptPath = path.join(repoDir, 'scripts/add-license-headers.ts')
  mkdirSync(path.dirname(scriptPath), { recursive: true })
  writeFileSync(scriptPath, readRepoFile('scripts/add-license-headers.ts'))
  return repoDir
}

const writeRepoFile = (repoDir: string, relativePath: string, content: string): string => {
  const filePath = path.join(repoDir, relativePath)
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content)
  return filePath
}

describe('license setup', () => {
  test('copies LICENSE into the final Docker image', () => {
    const dockerfile = readRepoFile('Dockerfile')

    expect(dockerfile).toMatch(/FROM base AS final[\s\S]*COPY LICENSE \.\/LICENSE/u)
  })

  test('keeps the BSL text separate from the standalone patent grant', () => {
    const license = readRepoFile('LICENSE')

    expect(license).not.toContain('# Patent Grant')
    expect(license).toContain('Additional Use Grant: Non-commercial production use is permitted')
    expect(license).toContain('Commercial production use requires a separate commercial license')
    expect(readRepoFile('PATENTS')).toContain('Licensor grants each user of the Licensed Work')
  })

  test('adds headers to every maintained TypeScript and JavaScript code root', () => {
    const repoDir = createHeaderScriptRepo()
    const files = [
      'src/runtime.ts',
      'client/debug/app.ts',
      'scripts/tool.ts',
      'review-loop/src/runner.ts',
      'tests/runtime.test.ts',
      'drizzle.config.ts',
    ] as const

    try {
      files.forEach((file) => {
        writeRepoFile(repoDir, file, 'export const value = true\n')
      })

      const result = runCommand(repoDir, ['bun', 'scripts/add-license-headers.ts'])

      expect(result.exitCode).toBe(0)
      files.forEach((file) => expect(readFileSync(path.join(repoDir, file), 'utf8')).toStartWith(HEADER))
    } finally {
      rmSync(repoDir, { recursive: true, force: true })
    }
  })

  test('preserves executable shebangs as the first line', () => {
    const repoDir = createHeaderScriptRepo()
    const script = 'scripts/cli.ts'

    try {
      writeRepoFile(repoDir, script, '#!/usr/bin/env bun\nconsole.log("ok")\n')

      const result = runCommand(repoDir, ['bun', 'scripts/add-license-headers.ts'])
      const stamped = readFileSync(path.join(repoDir, script), 'utf8')

      expect(result.exitCode).toBe(0)
      expect(stamped).toStartWith('#!/usr/bin/env bun\n')
      expect(stamped.split('\n').slice(1, 6)).toContain(HEADER)
    } finally {
      rmSync(repoDir, { recursive: true, force: true })
    }
  })

  test('uses the current header year for new files and expands old years to a range', () => {
    const repoDir = createHeaderScriptRepo()
    const freshFile = 'src/fresh.ts'
    const existingFile = 'src/existing.ts'

    try {
      writeRepoFile(repoDir, freshFile, 'export const fresh = true\n')
      writeRepoFile(
        repoDir,
        existingFile,
        [
          '// SPDX-License-Identifier: BUSL-1.1',
          '// Copyright (c) 2026 Dmitriy Lazarev',
          '// Use of this software is governed by the Business Source License 1.1.',
          '// See LICENSE in the project root for details.',
          '',
          'export const existing = true',
        ].join('\n'),
      )

      const result = runCommand(repoDir, ['bun', 'scripts/add-license-headers.ts'], { LICENSE_HEADER_YEAR: '2027' })

      expect(result.exitCode).toBe(0)
      expect(readFileSync(path.join(repoDir, freshFile), 'utf8')).toContain('// Copyright (c) 2027 Dmitriy Lazarev')
      expect(readFileSync(path.join(repoDir, existingFile), 'utf8')).toContain(
        '// Copyright (c) 2026-2027 Dmitriy Lazarev',
      )
    } finally {
      rmSync(repoDir, { recursive: true, force: true })
    }
  })
})
