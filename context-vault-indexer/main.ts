// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { chmodSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { relative } from 'node:path'

import pino from 'pino'

import type { ConfigFs } from './config.js'
import type { DaemonFs, PushOutcome } from './daemon.js'
import { startIndexer, type EntryDeps } from './entry.js'
import { startIpcServer } from './ipc.js'
import type { LockDeps, LockFileSystem } from './lock.js'
import { runDaemon } from './loop.js'
import type { IdentityFs } from './repo-identity.js'

const logger = pino({ base: undefined, timestamp: pino.stdTimeFunctions.isoTime })

const STATE_DIR_MODE = 0o700

const readTextOrNull = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

const configFs: ConfigFs = {
  readFile: readTextOrNull,
  writeFile: (path: string, contents: string) => {
    writeFileSync(path, contents, { mode: 0o600 })
  },
  rename: renameSync,
}

const identityFs: IdentityFs = {
  statKind: (path: string) => {
    try {
      return statSync(path).isDirectory() ? 'dir' : 'file'
    } catch {
      return null
    }
  },
  readFile: readTextOrNull,
}

const lockFs: LockFileSystem = {
  readLock: readTextOrNull,
  createExclusive: (path: string, contents: string) => {
    try {
      writeFileSync(path, contents, { flag: 'wx', mode: 0o600 })
      return true
    } catch {
      return false
    }
  },
  write: (path: string, contents: string) => {
    writeFileSync(path, contents, { mode: 0o600 })
  },
  remove: (path: string) => {
    rmSync(path, { force: true })
  },
}

const lock: LockDeps = {
  fs: lockFs,
  isPidAlive: (pid: number) => {
    try {
      // Signal 0 performs the permission/existence check without delivering.
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  },
  now: Date.now,
}

/** Relative paths of every `*.md` under dir, sorted; missing dir yields none. */
const listMarkdownFiles = (dir: string): string[] => {
  let entries: string[]
  try {
    entries = readdirSync(dir, { recursive: true, encoding: 'utf8' })
  } catch {
    logger.warn({ dir }, 'context-vault indexer could not read a spec dir this scan')
    return []
  }
  return entries
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => relative('', entry))
    .toSorted()
}

const makeDaemonFs = (statePath: string): DaemonFs => ({
  listMarkdownFiles,
  readFile: readTextOrNull,
  statMtime: (path: string) => {
    try {
      return statSync(path).mtimeMs
    } catch {
      return 0
    }
  },
  readState: () => readTextOrNull(statePath),
  writeState: (contents: string) => {
    writeFileSync(statePath, contents, { mode: 0o600 })
  },
})

/**
 * Creates the state dir 0700, and tightens it when it already existed with
 * looser permissions: `mkdirSync` leaves an existing directory's mode alone,
 * and the socket is briefly world-readable between Bun binding it and our
 * chmod, so an accessible parent would open exactly the window the 0700 is
 * there to close.
 */
const ensureStateDirSecure = (dir: string): void => {
  mkdirSync(dir, { recursive: true, mode: STATE_DIR_MODE })
  const mode = statSync(dir).mode & 0o777
  if ((mode & 0o077) === 0) return
  chmodSync(dir, STATE_DIR_MODE)
  logger.warn(
    { dir, previousMode: mode.toString(8) },
    'context-vault indexer tightened its state dir to owner-only access',
  )
}

const push = async (url: string, bearer: string, body: string): Promise<PushOutcome> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body,
  })
  return { ok: response.ok, status: response.status }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

export const createNodeEntryDeps = (stateDir: string): EntryDeps => ({
  env: process.env,
  pid: process.pid,
  now: Date.now,
  configFs,
  identityFs,
  lock,
  dirExists: (path: string) => {
    try {
      return statSync(path).isDirectory()
    } catch {
      return false
    }
  },
  ensureStateDir: ensureStateDirSecure,
  makeDaemonFs: (stateKey: string) => makeDaemonFs(`${stateDir}/state-${stateKey}.json`),
  startServer: startIpcServer,
  runLoop: runDaemon,
  push,
  sleep,
  onSignal: (handler: () => void) => {
    process.once('SIGINT', handler)
    process.once('SIGTERM', handler)
  },
  log: (message: string) => {
    logger.info(message)
  },
})

/**
 * Process shell for the indexer daemon: `bun run main.ts <stateDir>`.
 *
 * This is the `daemonEntry` the coding-agent adapter spawns detached. All
 * orchestration lives in `entry.ts` behind injected seams; this file exists to
 * bind the real filesystem, `fetch`, environment, and signals to them.
 */
export async function main(argv: readonly string[]): Promise<number> {
  const stateDir = argv[2]
  if (stateDir === undefined || stateDir.trim() === '') {
    logger.error('usage: bun run context-vault-indexer/main.ts <stateDir>')
    return 1
  }
  const result = await startIndexer(stateDir, createNodeEntryDeps(stateDir))
  if (result.error !== undefined) logger.error({ stateDir }, result.error)
  return result.code
}

if (import.meta.main) {
  process.exit(await main(process.argv))
}
