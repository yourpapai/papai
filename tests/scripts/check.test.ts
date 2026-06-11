// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// Integration tests for ../../scripts/check.js (check.sh — no TS module; shell script under test)
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const REPO_ROOT = path.resolve(import.meta.dir, '../..')
const CHECK_SCRIPT_PATH = path.join(REPO_ROOT, 'scripts/check.sh')
type CommandResult = Readonly<{
  exitCode: number | null
  stdout: string
  stderr: string
}>

const baseEnv = Object.fromEntries(
  Object.entries(process.env).flatMap(
    (entry: readonly [string, string | undefined]): ReadonlyArray<readonly [string, string]> => {
      const [key, value] = entry
      return value === undefined ? [] : [[key, value]]
    },
  ),
)

const basePath = baseEnv['PATH'] ?? ''

const createEnv = (overrides: Readonly<Record<string, string>>): Record<string, string> => ({
  ...baseEnv,
  ...overrides,
})

const runCommand = (
  cwd: string,
  cmd: readonly string[],
  env: Readonly<Record<string, string>> = baseEnv,
): CommandResult => {
  const result = Bun.spawnSync({
    cmd: [...cmd],
    cwd,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  return {
    exitCode: result.exitCode,
    stdout: result.stdout === undefined ? '' : Buffer.from(result.stdout).toString(),
    stderr: result.stderr === undefined ? '' : Buffer.from(result.stderr).toString(),
  }
}

const expectSuccess = (result: CommandResult): void => {
  if (result.exitCode !== 0) {
    throw new Error(`Command failed with exit ${result.exitCode}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  }
}

const writeExecutable = (filePath: string, content: string): void => {
  writeFileSync(filePath, content)
  chmodSync(filePath, 0o755)
}

// The stub bun/bunx executables are written once and shared across tests:
// macOS scans every freshly written executable on its first exec
// (syspolicyd/XProtect, 200-600ms per new inode), so per-test stubs dominated
// this suite's runtime. The stubs are stateless — each test parameterizes them
// via its own CHECK_LOG_FILE env value.
let sharedBinDir = ''

beforeAll(() => {
  sharedBinDir = mkdtempSync(path.join(tmpdir(), 'check-script-bin-'))
  writeExecutable(
    path.join(sharedBinDir, 'bun'),
    ['#!/bin/bash', 'set -euo pipefail', 'printf "bun %s\\n" "$*" >> "$CHECK_LOG_FILE"', 'exit 0', ''].join('\n'),
  )
  writeExecutable(
    path.join(sharedBinDir, 'bunx'),
    [
      '#!/bin/bash',
      'set -euo pipefail',
      'printf "bunx %s\\n" "$*" >> "$CHECK_LOG_FILE"',
      'if [ "$#" -gt 0 ] && [ "$1" = "oxlint" ]; then',
      '  shift',
      '  has_lintable=false',
      '  for arg in "$@"; do',
      '    case "$arg" in',
      '      *.js|*.jsx|*.ts|*.tsx|*.mjs|*.cjs|*.mts|*.cts)',
      '        has_lintable=true',
      '        ;;',
      '    esac',
      '  done',
      '  if [ "$has_lintable" = false ]; then',
      '    printf "%s\\n" "No files found to lint. Please check your paths and ignore patterns."',
      '    printf "%s\\n" "Finished in 33ms on 0 files with 203 rules using 12 threads."',
      '    exit 1',
      '  fi',
      'fi',
      'if [ "$#" -gt 0 ] && [ "$1" = "oxfmt" ]; then',
      '  shift',
      '  has_formattable=false',
      '  while [ "$#" -gt 0 ]; do',
      '    case "$1" in',
      '      --check|--ignore-path=*)',
      '        ;;',
      '      .opencode/package.json|*.lock.json|*package-lock.json)',
      '        ;;',
      '      *)',
      '        has_formattable=true',
      '        ;;',
      '    esac',
      '    shift',
      '  done',
      '  if [ "$has_formattable" = false ]; then',
      '    printf "%s\n" "Expected at least one target file. All matched files may have been excluded by ignore rules."',
      '    exit 2',
      '  fi',
      'fi',
      'exit 0',
      '',
    ].join('\n'),
  )
})

afterAll(() => {
  rmSync(sharedBinDir, { recursive: true, force: true })
})

const createTempRepo = (): Readonly<{ repoDir: string; binDir: string; logFile: string }> => {
  const repoDir = mkdtempSync(path.join(tmpdir(), 'check-script-'))
  const scriptsDir = path.join(repoDir, 'scripts')
  const logFile = path.join(repoDir, 'calls.log')

  mkdirSync(scriptsDir, { recursive: true })
  writeExecutable(path.join(scriptsDir, 'check.sh'), readFileSync(CHECK_SCRIPT_PATH, 'utf8'))

  expectSuccess(runCommand(repoDir, ['git', 'init']))

  return { repoDir, binDir: sharedBinDir, logFile }
}

describe('check.sh --staged', () => {
  test('skips oxlint when only markdown files are staged', () => {
    const { repoDir, binDir, logFile } = createTempRepo()

    try {
      writeFileSync(path.join(repoDir, 'README.md'), '# Docs\n')
      expectSuccess(runCommand(repoDir, ['git', 'add', 'README.md']))

      const env = createEnv({
        PATH: `${binDir}:${basePath}`,
        CHECK_LOG_FILE: logFile,
      })
      const result = runCommand(repoDir, ['bash', 'scripts/check.sh', '--staged'], env)

      expect(result.exitCode).toBe(0)

      const calls = readFileSync(logFile, 'utf8')
      expect(calls).toContain('bun run typecheck')
      expect(calls).toContain('bunx oxfmt --check --ignore-path=.oxfmtignore README.md')
      expect(calls).not.toContain('bunx oxlint')
    } finally {
      rmSync(repoDir, { recursive: true, force: true })
    }
  })

  test('skips oxlint when staged files are hook-only TypeScript files outside lint scope', () => {
    const { repoDir, binDir, logFile } = createTempRepo()

    try {
      const hookFile = '.hooks/tests/tdd/checks/check-full.test.ts'
      const hookFilePath = path.join(repoDir, hookFile)
      mkdirSync(path.dirname(hookFilePath), { recursive: true })
      writeFileSync(hookFilePath, 'import { test } from "bun:test"\n\ntest("hook", () => {})\n')
      expectSuccess(runCommand(repoDir, ['git', 'add', hookFile]))

      const env = createEnv({
        PATH: `${binDir}:${basePath}`,
        CHECK_LOG_FILE: logFile,
      })
      const result = runCommand(repoDir, ['bash', 'scripts/check.sh', '--staged'], env)

      expect(result.exitCode).toBe(0)

      const calls = readFileSync(logFile, 'utf8')
      expect(calls).toContain('bun run typecheck')
      expect(calls).toContain(`bunx oxfmt --check --ignore-path=.oxfmtignore ${hookFile}`)
      expect(calls).not.toContain('bunx oxlint')
    } finally {
      rmSync(repoDir, { recursive: true, force: true })
    }
  })

  test('requires license headers for new code files outside src and client', () => {
    const { repoDir, binDir, logFile } = createTempRepo()

    try {
      const codeFiles = [
        'scripts/new-tool.ts',
        'review-loop/src/runner.ts',
        'tests/new-tool.test.ts',
        'drizzle.config.ts',
      ] as const
      codeFiles.forEach((file) => {
        const filePath = path.join(repoDir, file)
        mkdirSync(path.dirname(filePath), { recursive: true })
        writeFileSync(filePath, 'export const value = true\n')
      })
      expectSuccess(runCommand(repoDir, ['git', 'add', ...codeFiles]))

      const env = createEnv({
        PATH: `${binDir}:${basePath}`,
        CHECK_LOG_FILE: logFile,
      })
      const result = runCommand(repoDir, ['bash', 'scripts/check.sh', '--staged'], env)

      expect(result.exitCode).toBe(1)
      expect(result.stdout).toContain('Missing BUSL-1.1 license header')
      codeFiles.forEach((file) => expect(result.stdout).toContain(`  ${file}`))
    } finally {
      rmSync(repoDir, { recursive: true, force: true })
    }
  })

  test('skips format check when staged files are all ignored by oxfmt', () => {
    const { repoDir, binDir, logFile } = createTempRepo()

    try {
      const opencodeDir = path.join(repoDir, '.opencode')
      mkdirSync(opencodeDir, { recursive: true })
      writeFileSync(path.join(repoDir, '.oxfmtignore'), '.opencode/package.json\n')
      writeFileSync(path.join(opencodeDir, 'package.json'), '{"dependencies":{"@opencode-ai/plugin":"1.15.12"}}\n')
      writeFileSync(path.join(opencodeDir, 'package-lock.json'), '{"lockfileVersion":3}\n')
      expectSuccess(
        runCommand(repoDir, ['git', 'add', '.oxfmtignore', '.opencode/package.json', '.opencode/package-lock.json']),
      )

      const env = createEnv({
        PATH: `${binDir}:${basePath}`,
        CHECK_LOG_FILE: logFile,
      })
      const result = runCommand(repoDir, ['bash', 'scripts/check.sh', '--staged'], env)

      expect(result.exitCode).toBe(0)

      const calls = readFileSync(logFile, 'utf8')
      expect(calls).toContain('bun run typecheck')
      expect(calls).not.toContain('bunx oxfmt')
    } finally {
      rmSync(repoDir, { recursive: true, force: true })
    }
  })
})

describe('check.sh --skip-tests', () => {
  test('drops only test checks without corrupting colon-delimited script names', () => {
    const { repoDir, binDir, logFile } = createTempRepo()

    try {
      const env = createEnv({
        PATH: `${binDir}:${basePath}`,
        CHECK_LOG_FILE: logFile,
      })
      const result = runCommand(repoDir, ['bash', 'scripts/check.sh', '--skip-tests'], env)

      expect(result.exitCode).toBe(0)

      const calls = readFileSync(logFile, 'utf8')
        .trim()
        .split('\n')
        .filter((entry) => entry.length > 0)

      expect(calls).toContain('bun run lint')
      expect(calls).toContain('bun run review-loop:lint')
      expect(calls).not.toContain('bun run test')
      expect(calls).not.toContain('bun run test:client')
      expect(calls).not.toContain('bun run review-loop:test')
      expect(calls).not.toContain('bun run :client')
      expect(calls).not.toContain('bun run review-loop:')
    } finally {
      rmSync(repoDir, { recursive: true, force: true })
    }
  })
})

describe('check.sh full mode', () => {
  test('runs the server test suite serially when CI=true', () => {
    const { repoDir, binDir, logFile } = createTempRepo()

    try {
      const env = createEnv({
        PATH: `${binDir}:${basePath}`,
        CHECK_LOG_FILE: logFile,
        CI: 'true',
      })
      const result = runCommand(repoDir, ['bash', 'scripts/check.sh'], env)

      expect(result.exitCode).toBe(0)

      const calls = readFileSync(logFile, 'utf8')
      expect(calls).toContain('bun test')
      expect(calls).not.toContain('bun test --parallel')
    } finally {
      rmSync(repoDir, { recursive: true, force: true })
    }
  })

  test('runs the server test suite in parallel outside CI', () => {
    const { repoDir, binDir, logFile } = createTempRepo()

    try {
      const env = createEnv({
        PATH: `${binDir}:${basePath}`,
        CHECK_LOG_FILE: logFile,
        CI: '',
      })
      const result = runCommand(repoDir, ['bash', 'scripts/check.sh'], env)

      expect(result.exitCode).toBe(0)

      const calls = readFileSync(logFile, 'utf8')
      expect(calls).toContain('bun test --parallel')
    } finally {
      rmSync(repoDir, { recursive: true, force: true })
    }
  })

  test('invokes bun test directly without a concurrency override', () => {
    const { repoDir, binDir, logFile } = createTempRepo()

    try {
      const env = createEnv({
        PATH: `${binDir}:${basePath}`,
        CHECK_LOG_FILE: logFile,
      })
      const result = runCommand(repoDir, ['bash', 'scripts/check.sh'], env)

      expect(result.exitCode).toBe(0)

      const calls = readFileSync(logFile, 'utf8')
      expect(calls).toContain('bun test')
      expect(calls).toContain('bun --conditions=browser test --preload ./tests/client-setup.ts')
      expect(calls).toContain('bun test tests/review-loop')
      expect(calls).not.toContain('--max-concurrency')
      expect(calls).not.toContain('bun run test:client')
      expect(calls).not.toContain('bun run review-loop:test')
    } finally {
      rmSync(repoDir, { recursive: true, force: true })
    }
  })
})
