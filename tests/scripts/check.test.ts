// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// Integration tests for ../../scripts/check.js (check.sh — no TS module; shell script under test)
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
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
    [
      '#!/bin/bash',
      'set -euo pipefail',
      'printf "bun %s\\n" "$*" >> "$CHECK_LOG_FILE"',
      // CHECK_FAIL_MATCH lets a test make one specific bun invocation fail
      // (matched as a substring of the argv) while the rest still succeed.
      'if [ -n "${CHECK_FAIL_MATCH:-}" ]; then',
      '  case "$*" in',
      '    *"$CHECK_FAIL_MATCH"*)',
      '      exit 1',
      '      ;;',
      '  esac',
      'fi',
      'exit 0',
      '',
    ].join('\n'),
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

  // A commit made while `check:full` is running must not destroy that run's evidence. check.sh
  // cleared reports/checks/ as unconditional top-of-script setup, but ONLY full mode writes
  // there — staged mode keeps its per-check output in $TMPDIR. So the pre-commit hook's --staged
  // run deleted the logs of an in-flight full run, whose summary then pointed at files that no
  // longer existed. Observed 2026-08-31: seven leg logs written by 10:53, gone by 10:55.
  test('leaves an in-flight full run reports/checks logs intact', () => {
    const { repoDir, binDir, logFile } = createTempRepo()

    try {
      const checksDir = path.join(repoDir, 'reports', 'checks')
      mkdirSync(checksDir, { recursive: true })
      const inFlightLog = path.join(checksDir, 'test.log')
      writeFileSync(inFlightLog, 'output of a full run still in progress\n')

      writeFileSync(path.join(repoDir, 'README.md'), '# Docs\n')
      expectSuccess(runCommand(repoDir, ['git', 'add', 'README.md']))

      const env = createEnv({
        PATH: `${binDir}:${basePath}`,
        CHECK_LOG_FILE: logFile,
      })
      expect(runCommand(repoDir, ['bash', 'scripts/check.sh', '--staged'], env).exitCode).toBe(0)

      expect(existsSync(inFlightLog)).toBe(true)
      expect(readFileSync(inFlightLog, 'utf8')).toBe('output of a full run still in progress\n')
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
      // Full mode dropped the redundant typecheck leg (lint's tsgolint pass
      // reports every tsgo diagnostic class over a superset scope —
      // openspec/changes/dedupe-lint-typecheck); --skip-tests filters the
      // full-mode array and inherits that.
      expect(calls).not.toContain('bun run typecheck')
      expect(calls).not.toContain('bun run review-loop:lint')
      expect(calls).not.toContain('bun run test')
      expect(calls).not.toContain('bun run test:client')
      expect(calls).not.toContain('bun run review-loop:test')
      expect(calls).not.toContain('bun run :client')
      expect(calls).not.toContain('bun run review-loop:')
      // Aggregate gates enforce workspace code through the root checks only;
      // no per-workspace proxy script may appear in any mode.
      const workspaceProxyCalls = calls.filter((call) =>
        ['review-loop:', 'mutation-improve:', 'opencode-agent:'].some((prefix) => call.startsWith(`bun run ${prefix}`)),
      )
      expect(workspaceProxyCalls).toEqual([])
    } finally {
      rmSync(repoDir, { recursive: true, force: true })
    }
  })
})

describe('check.sh full mode', () => {
  // The mutation-improve build gate runs full mode in a worktree where the
  // agent's spec/plan/test files are NEW (untracked). Enumerating only
  // `git ls-files` (tracked) made them invisible until the pre-commit hook's
  // --staged mode rejected them at `git commit`, discarding passed iterations.
  test('flags headerless untracked docs files (the worktree new-file gap)', () => {
    const { repoDir, binDir, logFile } = createTempRepo()

    try {
      mkdirSync(path.join(repoDir, 'docs'), { recursive: true })
      writeFileSync(path.join(repoDir, 'docs', 'new-doc.md'), '# Doc without a license header\n')

      const env = createEnv({
        PATH: `${binDir}:${basePath}`,
        CHECK_LOG_FILE: logFile,
      })
      const result = runCommand(repoDir, ['bash', 'scripts/check.sh'], env)

      expect(result.exitCode).toBe(1)
      expect(result.stdout).toContain('Missing BUSL-1.1 license header')
      expect(result.stdout).toContain('docs/new-doc.md')
    } finally {
      rmSync(repoDir, { recursive: true, force: true })
    }
  })

  test('still flags headerless tracked docs files', () => {
    const { repoDir, binDir, logFile } = createTempRepo()

    try {
      mkdirSync(path.join(repoDir, 'docs'), { recursive: true })
      writeFileSync(path.join(repoDir, 'docs', 'tracked.md'), '# Doc without a license header\n')
      expectSuccess(runCommand(repoDir, ['git', 'add', 'docs/tracked.md']))

      const env = createEnv({
        PATH: `${binDir}:${basePath}`,
        CHECK_LOG_FILE: logFile,
      })
      const result = runCommand(repoDir, ['bash', 'scripts/check.sh'], env)

      expect(result.exitCode).toBe(1)
      expect(result.stdout).toContain('docs/tracked.md')
    } finally {
      rmSync(repoDir, { recursive: true, force: true })
    }
  })

  test('does not flag gitignored untracked files', () => {
    const { repoDir, binDir, logFile } = createTempRepo()

    try {
      writeFileSync(path.join(repoDir, '.gitignore'), 'docs/ignored.md\n')
      mkdirSync(path.join(repoDir, 'docs'), { recursive: true })
      writeFileSync(path.join(repoDir, 'docs', 'ignored.md'), '# Generated doc without a license header\n')

      const env = createEnv({
        PATH: `${binDir}:${basePath}`,
        CHECK_LOG_FILE: logFile,
      })
      const result = runCommand(repoDir, ['bash', 'scripts/check.sh'], env)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).not.toContain('docs/ignored.md')
    } finally {
      rmSync(repoDir, { recursive: true, force: true })
    }
  })

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

  test('gates on the coverage ratchet after a passing CI coverage run', () => {
    const { repoDir, binDir, logFile } = createTempRepo()

    try {
      const env = createEnv({
        PATH: `${binDir}:${basePath}`,
        CHECK_LOG_FILE: logFile,
        CI: 'true',
      })
      const result = runCommand(repoDir, ['bash', 'scripts/check.sh'], env)

      expect(result.exitCode).toBe(0)

      // bun's own coverageThreshold is a per-file rule and cannot express the
      // aggregate floor, so the ratchet — not `bun test --coverage` — is the gate.
      const calls = readFileSync(logFile, 'utf8')
      expect(calls).toContain('bun test --coverage')
      expect(calls).toContain('bun coverage:ratchet')
    } finally {
      rmSync(repoDir, { recursive: true, force: true })
    }
  })

  test('fails the check when the coverage ratchet fails', () => {
    const { repoDir, binDir, logFile } = createTempRepo()

    try {
      const env = createEnv({
        PATH: `${binDir}:${basePath}`,
        CHECK_LOG_FILE: logFile,
        CI: 'true',
        CHECK_FAIL_MATCH: 'coverage:ratchet',
      })
      const result = runCommand(repoDir, ['bash', 'scripts/check.sh'], env)

      // The ratchet's exit status must reach the job; a below-floor run cannot
      // be reported as a passing check.
      expect(result.exitCode).not.toBe(0)
    } finally {
      rmSync(repoDir, { recursive: true, force: true })
    }
  })

  test('skips the coverage ratchet when the CI test run itself fails', () => {
    const { repoDir, binDir, logFile } = createTempRepo()

    try {
      const env = createEnv({
        PATH: `${binDir}:${basePath}`,
        CHECK_LOG_FILE: logFile,
        CI: 'true',
        CHECK_FAIL_MATCH: 'test --coverage',
      })
      const result = runCommand(repoDir, ['bash', 'scripts/check.sh'], env)

      expect(result.exitCode).not.toBe(0)

      // A partial run's lcov would report a meaningless number, and the test
      // failure is its own diagnostic.
      const calls = readFileSync(logFile, 'utf8')
      expect(calls).not.toContain('bun coverage:ratchet')
    } finally {
      rmSync(repoDir, { recursive: true, force: true })
    }
  })

  test('delegates the server suite to the wrapper outside CI', () => {
    // The wrapper owns mode selection and writes reports/test/, so a check:full
    // run leaves the same queryable artifact a direct `bun run test` does.
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
      expect(calls).toContain('bun run test')
      expect(calls).not.toContain('bun test --parallel')
    } finally {
      rmSync(repoDir, { recursive: true, force: true })
    }
  })

  test('leaves every check its own log under reports/checks', () => {
    const { repoDir, binDir, logFile } = createTempRepo()

    try {
      const env = createEnv({
        PATH: `${binDir}:${basePath}`,
        CHECK_LOG_FILE: logFile,
      })
      const result = runCommand(repoDir, ['bash', 'scripts/check.sh'], env)

      expect(result.exitCode).toBe(0)
      const written = readdirSync(path.join(repoDir, 'reports', 'checks')).sort()
      expect(written).toContain('lint.log')
      expect(written).not.toContain('typecheck.log')
      // `:` is not a filename, and safe_name() has always mapped it to `_`.
      expect(written).toContain('format_check.log')
      expect(written).not.toContain('review-loop_lint.log')
    } finally {
      rmSync(repoDir, { recursive: true, force: true })
    }
  })

  test('a failing check leaves its output on disk and says where', () => {
    const { repoDir, binDir, logFile } = createTempRepo()

    try {
      const env = createEnv({
        PATH: `${binDir}:${basePath}`,
        CHECK_LOG_FILE: logFile,
        CHECK_FAIL_MATCH: 'run knip',
      })
      const result = runCommand(repoDir, ['bash', 'scripts/check.sh'], env)

      expect(result.exitCode).toBe(1)
      expect(result.stdout).toContain('✗ knip failed')
      expect(result.stdout).toContain('→ reports/checks/knip.log')
      expect(existsSync(path.join(repoDir, 'reports', 'checks', 'knip.log'))).toBe(true)
    } finally {
      rmSync(repoDir, { recursive: true, force: true })
    }
  })

  // The test lane runs a different command in each mode — the wrapper locally, the
  // coverage lane under CI — so the argv that makes it fail differs too. The pointer
  // is keyed on the check *name*, so it must not: asserting it in both modes is what
  // keeps it from being accidentally coupled to whichever command the lane happens to
  // run. Pinning CI explicitly also stops the ambient value deciding the outcome,
  // which is what made this pass locally and fail in CI.
  test.each([
    ['outside CI', '', 'run test'],
    ['under CI', 'true', 'test --coverage'],
  ])('a failing test check points at the query command %s, not a re-run', (_label, ci, failMatch) => {
    const { repoDir, binDir, logFile } = createTempRepo()

    try {
      const env = createEnv({
        PATH: `${binDir}:${basePath}`,
        CHECK_LOG_FILE: logFile,
        CI: ci,
        CHECK_FAIL_MATCH: failMatch,
      })
      const result = runCommand(repoDir, ['bash', 'scripts/check.sh'], env)

      expect(result.exitCode).toBe(1)
      expect(result.stdout).toContain('→ bun run test:failures')
      expect(result.stdout).toContain('do not re-run to look')
    } finally {
      rmSync(repoDir, { recursive: true, force: true })
    }
  })

  test('clears stale logs at the start so only this run is on disk', () => {
    const { repoDir, binDir, logFile } = createTempRepo()

    try {
      const checksDir = path.join(repoDir, 'reports', 'checks')
      mkdirSync(checksDir, { recursive: true })
      writeFileSync(path.join(checksDir, 'from-a-previous-run.log'), 'stale\n')

      const env = createEnv({
        PATH: `${binDir}:${basePath}`,
        CHECK_LOG_FILE: logFile,
      })
      expect(runCommand(repoDir, ['bash', 'scripts/check.sh'], env).exitCode).toBe(0)

      expect(existsSync(path.join(checksDir, 'from-a-previous-run.log'))).toBe(false)
      expect(existsSync(path.join(checksDir, 'lint.log'))).toBe(true)
    } finally {
      rmSync(repoDir, { recursive: true, force: true })
    }
  })

  test('invokes each lane without a concurrency override', () => {
    const { repoDir, binDir, logFile } = createTempRepo()

    try {
      // `CI: ''` because this asserts the wrapper lane, which only runs outside CI —
      // inheriting the ambient value made the assertion depend on where it ran.
      const env = createEnv({
        PATH: `${binDir}:${basePath}`,
        CHECK_LOG_FILE: logFile,
        CI: '',
      })
      const result = runCommand(repoDir, ['bash', 'scripts/check.sh'], env)

      expect(result.exitCode).toBe(0)

      const calls = readFileSync(logFile, 'utf8')
      expect(calls).toContain('bun run test')
      expect(calls).toContain('bun --conditions=browser test --preload ./tests/client-setup.ts')
      expect(calls).not.toContain('bun test tests/review-loop')
      expect(calls).not.toContain('--max-concurrency')
      expect(calls).not.toContain('bun run test:client')
      expect(calls).not.toContain('bun run review-loop:test')
      for (const prefix of ['review-loop:', 'mutation-improve:', 'opencode-agent:']) {
        expect(calls).not.toContain(`bun run ${prefix}`)
      }
    } finally {
      rmSync(repoDir, { recursive: true, force: true })
    }
  })
})

describe('check surface composition (check.sh vs check:verbose)', () => {
  // R1 (openspec/changes/dedupe-lint-typecheck): full mode and check:verbose
  // dropped the redundant typecheck leg — lint's tsgolint pass reports every
  // tsgo diagnostic class over a superset file scope. Staged mode keeps it:
  // oxlint runs on staged files only there, so the project-wide typecheck leg
  // is the only one that can catch an unstaged file broken by a staged edit.
  // The pairing must stay symmetric across the two full surfaces: re-adding
  // typecheck to one but not the other re-derives the dedup by accident.
  const readVerboseChecks = (): readonly string[] => {
    const packageJsonText = readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')
    const verboseMatch = packageJsonText.match(/"check:verbose": "([^"]*)"/u)
    if (verboseMatch === null) {
      throw new Error('check:verbose script not found in package.json')
    }
    const command = verboseMatch[1]
    if (command === undefined) {
      throw new Error('check:verbose script match captured no command')
    }
    return command
      .replace(/^bun run --parallel /u, '')
      .split(/\s+/u)
      .filter((name) => name.length > 0)
  }

  const parseChecksArray = (arrayBody: string): readonly string[] =>
    [...arrayBody.matchAll(/"([^"]+)"/gu)]
      .map((match) => match[1])
      .filter((name): name is string => typeof name === 'string')

  const readCheckShArrays = (): readonly (readonly string[])[] => {
    const checkSh = readFileSync(CHECK_SCRIPT_PATH, 'utf8')
    return [...checkSh.matchAll(/checks=\(([^)]*)\)/gu)].map((match) => parseChecksArray(match[1] ?? ''))
  }

  test('full mode and check:verbose agree on the lint/typecheck pairing', () => {
    const verboseChecks = readVerboseChecks()
    const checkArrays = readCheckShArrays()
    const fullMode = checkArrays.find((checks) => checks.includes('duplicates'))
    const staged = checkArrays.find((checks) => !checks.includes('duplicates'))
    expect(fullMode).toBeDefined()
    expect(staged).toBeDefined()

    expect(fullMode).toContain('lint')
    expect(fullMode).not.toContain('typecheck')
    expect(verboseChecks).toContain('lint')
    expect(verboseChecks).not.toContain('typecheck')

    // The staged array is the load-bearing exception and must keep typecheck.
    expect(staged).toContain('lint')
    expect(staged).toContain('typecheck')
  })
})
