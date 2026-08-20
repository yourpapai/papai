// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * The command-line face of the wrapper: the only place real collaborators are wired.
 *
 * Split from `run.ts` so the run logic stays assertable with everything injected, and
 * so the one place that touches the filesystem, the clock and the process is small
 * enough to read in a sitting.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { PUBLIC_DIR } from '../build-client.js'
import { ensureClientBuilt, missingBundles, REQUIRED_BUNDLES } from '../ensure-client-built.js'
import { computeFingerprint, defaultFingerprintDeps } from './fingerprint.js'
import { parseWrapperArgs } from './mode.js'
import { LAST_RUN_JUNIT, LAST_RUN_LOG, REPORT_DIR } from './paths.js'
import { writeReport } from './report.js'
import { runWrapper } from './run.js'
import type { RunDeps, SpawnResult } from './run.js'

const absolute = (cwd: string, relPath: string): string => path.resolve(cwd, relPath)

/** Build the client bundles when they are missing, reusing the existing guard verbatim. */
const realEnsureClientBuilt = (cwd: string): void => {
  ensureClientBuilt({
    publicDir: PUBLIC_DIR,
    required: REQUIRED_BUNDLES,
    missing: missingBundles,
    build: (): void => {
      const proc = Bun.spawnSync(['bun', 'scripts/build-client.ts'], {
        cwd,
        stdio: ['ignore', 'inherit', 'inherit'],
      })
      if (proc.exitCode !== 0) throw new Error(`bun build:client failed with exit code ${String(proc.exitCode)}`)
    },
    log: (message: string): void => {
      console.error(message)
    },
  })
}

/**
 * The environment the suite runs under, with git pinned to the repo's own config.
 *
 * This has to be set here, on the child's *startup* environment, and not in
 * `tests/setup.ts`. Bun does not propagate later `process.env` mutations to
 * subprocesses the way Node does — measured on 1.3.11, a var assigned at runtime is
 * invisible to both `node:child_process.spawnSync` and `Bun.spawnSync` unless it is
 * passed explicitly. A preload therefore cannot reach the ~20 suites that shell out to
 * `git init`, and those emit a 10-line advice block each: about 100 lines, a fifth of
 * everything a near-green full run prints.
 *
 * `master` is git's historical default, so suites that name the initial branch still pass.
 */
const childEnv = (cwd: string): Record<string, string | undefined> => ({
  ...process.env,
  GIT_CONFIG_GLOBAL: path.join(cwd, 'tests/fixtures/gitconfig'),
  GIT_CONFIG_SYSTEM: '/dev/null',
})

/**
 * stdout and stderr share one file descriptor, so the captured log is byte-complete and
 * correctly interleaved. Piping them apart reorders `console.log` against `(fail)`.
 */
const captureChild = (argv: readonly string[], cwd: string, stream: boolean): SpawnResult => {
  const logPath = absolute(cwd, LAST_RUN_LOG)
  fs.mkdirSync(absolute(cwd, REPORT_DIR), { recursive: true })
  const fd = fs.openSync(logPath, 'w')
  const startedAt = Date.now()
  try {
    const proc = Bun.spawnSync([...argv], {
      cwd,
      env: childEnv(cwd),
      stdio: ['inherit', fd, fd],
    })
    const output = fs.readFileSync(logPath, 'utf8')
    if (stream) process.stderr.write(output)
    return { exitCode: proc.exitCode, output, wallMs: Date.now() - startedAt }
  } finally {
    fs.closeSync(fd)
  }
}

/** Bypass runs keep the terminal: nothing is captured because nothing is persisted. */
const inheritChild = (argv: readonly string[], cwd: string): SpawnResult => {
  const startedAt = Date.now()
  const proc = Bun.spawnSync([...argv], {
    cwd,
    env: childEnv(cwd),
    stdio: ['inherit', 'inherit', 'inherit'],
  })
  return {
    exitCode: proc.exitCode,
    output: '',
    wallMs: Date.now() - startedAt,
  }
}

const readFileOrNull = (filePath: string): string | null => {
  try {
    return fs.readFileSync(filePath, 'utf8')
  } catch {
    return null
  }
}

const realGitSha = (cwd: string): string | null => {
  try {
    const proc = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    if (proc.exitCode !== 0) return null
    const sha = proc.stdout.toString().trim()
    return sha === '' ? null : sha
  } catch {
    return null
  }
}

const realDeps = (cwd: string, bypass: boolean, stream: boolean): RunDeps => ({
  cwd,
  env: process.env,
  cores: os.availableParallelism(),
  load1: os.loadavg()[0] ?? 0,
  ensureClientBuilt: (): void => {
    realEnsureClientBuilt(cwd)
  },
  clearArtifacts: (): void => {
    fs.mkdirSync(absolute(cwd, REPORT_DIR), { recursive: true })
    fs.rmSync(absolute(cwd, LAST_RUN_LOG), { force: true })
    fs.rmSync(absolute(cwd, LAST_RUN_JUNIT), { force: true })
  },
  spawn: (argv): SpawnResult => (bypass ? inheritChild(argv, cwd) : captureChild(argv, cwd, stream)),
  fingerprint: (): string => computeFingerprint(defaultFingerprintDeps(cwd)),
  gitSha: (): string | null => realGitSha(cwd),
  readJUnit: (): string | null => readFileOrNull(absolute(cwd, LAST_RUN_JUNIT)),
  writeArtifacts: (log, junitXml, report): void => {
    fs.writeFileSync(absolute(cwd, LAST_RUN_LOG), log)
    if (junitXml !== null) fs.writeFileSync(absolute(cwd, LAST_RUN_JUNIT), junitXml)
    writeReport(report, {
      read: (relPath) => readFileOrNull(absolute(cwd, relPath)),
      write: (relPath, contents) => {
        fs.writeFileSync(absolute(cwd, relPath), contents)
      },
    })
  },
  print: (line: string): void => {
    process.stdout.write(`${line}\n`)
  },
  now: (): string => new Date().toISOString(),
})

function main(): void {
  const argv = process.argv.slice(2)
  const parsed = parseWrapperArgs(argv)
  process.exit(runWrapper(argv, realDeps(path.resolve(import.meta.dir, '..', '..'), parsed.bypass, parsed.stream)))
}

if (import.meta.main) {
  main()
}
