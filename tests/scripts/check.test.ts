// Integration tests for ../../scripts/check.js (check.sh — no TS module; shell script under test)
import { describe, expect, test } from 'bun:test'
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

const createTempRepo = (): Readonly<{ repoDir: string; binDir: string; logFile: string }> => {
  const repoDir = mkdtempSync(path.join(tmpdir(), 'check-script-'))
  const scriptsDir = path.join(repoDir, 'scripts')
  const binDir = path.join(repoDir, 'bin')
  const logFile = path.join(repoDir, 'calls.log')

  mkdirSync(scriptsDir, { recursive: true })
  mkdirSync(binDir, { recursive: true })

  writeExecutable(path.join(scriptsDir, 'check.sh'), readFileSync(CHECK_SCRIPT_PATH, 'utf8'))
  writeExecutable(
    path.join(binDir, 'bun'),
    ['#!/bin/bash', 'set -euo pipefail', 'printf "bun %s\\n" "$*" >> "$CHECK_LOG_FILE"', 'exit 0', ''].join('\n'),
  )
  writeExecutable(
    path.join(binDir, 'bunx'),
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
      'exit 0',
      '',
    ].join('\n'),
  )

  expectSuccess(runCommand(repoDir, ['git', 'init']))

  return { repoDir, binDir, logFile }
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
})
