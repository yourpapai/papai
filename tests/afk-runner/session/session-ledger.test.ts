// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  findInFlightSession,
  findKilledSession,
  nextSessionAttempt,
  readSessionLedger,
  recordDeadSpawn,
  recordSessionId,
  SessionLedgerLineSchema,
  sessionLedgerPath,
  transcriptPathFor,
  updateSessionStatus,
} from '../../../afk-runner/src/session-ledger.js'

const tmpDirs: string[] = []

function makeRunDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-session-ledger-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

const spawnInput = { label: 'reviewer', role: 'reviewer', round: 1, model: 'glm' }

describe('SessionLedgerLineSchema', () => {
  it('accepts a complete line and rejects lines missing required fields', () => {
    const line = {
      label: 'reviewer',
      role: 'reviewer',
      round: 1,
      attempt: 1,
      model: 'glm',
      opencodeSessionId: 'ses_abc',
      status: 'spawned',
      ts: '2026-08-19T00:00:00.000Z',
    }
    expect(SessionLedgerLineSchema.safeParse(line).success).toBe(true)
    expect(SessionLedgerLineSchema.safeParse({ ...line, status: 'wat' }).success).toBe(false)
    expect(SessionLedgerLineSchema.safeParse({ ...line, attempt: 0 }).success).toBe(false)
    expect(SessionLedgerLineSchema.safeParse({ ...line, round: -1 }).success).toBe(false)
    expect(SessionLedgerLineSchema.safeParse({ ...line, opencodeSessionId: 7 }).success).toBe(false)
  })

  it('accepts a null session id (spawn died before its first session-bearing line)', () => {
    const line = {
      label: 'reviewer',
      role: 'reviewer',
      round: 1,
      attempt: 1,
      model: 'glm',
      opencodeSessionId: null,
      status: 'killed',
      ts: '2026-08-19T00:00:00.000Z',
    }
    expect(SessionLedgerLineSchema.safeParse(line).success).toBe(true)
  })
})

describe('session ledger appender', () => {
  it('records the session id on disk the moment it is reported, as a spawned line', () => {
    const runDir = makeRunDir()
    const attempt = recordSessionId(runDir, spawnInput, 'ses_abc')
    expect(attempt).toBe(1)
    const raw = fs.readFileSync(sessionLedgerPath(runDir), 'utf8')
    const lines = raw.trimEnd().split('\n')
    expect(lines).toHaveLength(1)
    const parsed = SessionLedgerLineSchema.parse(JSON.parse(lines[0]!))
    expect(parsed).toMatchObject({
      label: 'reviewer',
      role: 'reviewer',
      round: 1,
      attempt: 1,
      model: 'glm',
      opencodeSessionId: 'ses_abc',
      status: 'spawned',
    })
  })

  it('allocates sequential attempts per (label, round) key and keeps other keys independent', () => {
    const runDir = makeRunDir()
    expect(nextSessionAttempt(runDir, 'reviewer', 1)).toBe(1)
    expect(recordSessionId(runDir, spawnInput, 'ses_a')).toBe(1)
    expect(nextSessionAttempt(runDir, 'reviewer', 1)).toBe(2)
    expect(nextSessionAttempt(runDir, 'reviewer', 2)).toBe(1)
    expect(nextSessionAttempt(runDir, 'resolver', 1)).toBe(1)
    expect(recordSessionId(runDir, spawnInput, 'ses_b')).toBe(2)
    expect(readSessionLedger(runDir).map((line) => line.opencodeSessionId)).toEqual(['ses_a', 'ses_b'])
  })

  it('allocates the next free attempt when the preferred attempt is already recorded', () => {
    const runDir = makeRunDir()
    expect(recordSessionId(runDir, spawnInput, 'ses_a', 1)).toBe(1)
    // a stall retry under the same runAgent call reuses preferred attempt 1
    expect(recordSessionId(runDir, spawnInput, 'ses_b', 1)).toBe(2)
  })

  it('transitions the latest line of a key to done or killed, leaving other keys untouched', () => {
    const runDir = makeRunDir()
    recordSessionId(runDir, spawnInput, 'ses_a')
    recordSessionId(runDir, { ...spawnInput, label: 'resolver', role: 'resolver' }, 'ses_r')
    updateSessionStatus(runDir, 'reviewer', 1, 'done')
    expect(
      readSessionLedger(runDir)
        .filter((line) => line.label === 'reviewer')
        .map((line) => line.status),
    ).toEqual(['done'])
    expect(
      readSessionLedger(runDir)
        .filter((line) => line.label === 'resolver')
        .map((line) => line.status),
    ).toEqual(['spawned'])
    updateSessionStatus(runDir, 'resolver', 1, 'killed')
    expect(
      readSessionLedger(runDir)
        .filter((line) => line.label === 'resolver')
        .map((line) => line.status),
    ).toEqual(['killed'])
  })

  it('records a killed spawn without a session id when the process died before any session-bearing line', () => {
    const runDir = makeRunDir()
    recordDeadSpawn(runDir, spawnInput, 1)
    const [line] = readSessionLedger(runDir)
    expect(line).toMatchObject({ attempt: 1, opencodeSessionId: null, status: 'killed' })
    expect(nextSessionAttempt(runDir, 'reviewer', 1)).toBe(2)
  })
})

describe('session ledger reading', () => {
  it('returns an empty list when no ledger exists', () => {
    const runDir = makeRunDir()
    expect(readSessionLedger(runDir)).toEqual([])
    expect(findInFlightSession(runDir, 'reviewer', 1)).toBeNull()
  })

  it('skips torn or corrupt lines instead of failing the read', () => {
    const runDir = makeRunDir()
    recordSessionId(runDir, spawnInput, 'ses_a')
    fs.appendFileSync(sessionLedgerPath(runDir), '{"label":"torn')
    const lines = readSessionLedger(runDir)
    expect(lines).toHaveLength(1)
    expect(lines[0]?.opencodeSessionId).toBe('ses_a')
  })

  it('finds the latest in-flight (spawned or killed, id-bearing) line for a key', () => {
    const runDir = makeRunDir()
    recordSessionId(runDir, spawnInput, 'ses_a')
    updateSessionStatus(runDir, 'reviewer', 1, 'done')
    expect(findInFlightSession(runDir, 'reviewer', 1)).toBeNull()
    recordSessionId(runDir, spawnInput, 'ses_b')
    updateSessionStatus(runDir, 'reviewer', 1, 'killed')
    const inFlight = findInFlightSession(runDir, 'reviewer', 1)
    expect(inFlight?.opencodeSessionId).toBe('ses_b')
    expect(inFlight?.status).toBe('killed')
  })
})

describe('findKilledSession — the continuation seam lookup (escalation-retry-session-continuation D6)', () => {
  it('returns the latest id-bearing killed line for a (label, round)', () => {
    const runDir = makeRunDir()
    recordSessionId(runDir, spawnInput, 'ses_a')
    updateSessionStatus(runDir, 'reviewer', 1, 'killed')
    recordSessionId(runDir, spawnInput, 'ses_b')
    updateSessionStatus(runDir, 'reviewer', 1, 'killed')
    const killed = findKilledSession(runDir, 'reviewer', 1)
    expect(killed?.opencodeSessionId).toBe('ses_b')
    expect(killed?.status).toBe('killed')
  })

  it('excludes a dangling spawned entry and a settled done entry — null either way', () => {
    const runDir = makeRunDir()
    recordSessionId(runDir, spawnInput, 'ses_spawned')
    expect(findKilledSession(runDir, 'reviewer', 1)).toBeNull()
    updateSessionStatus(runDir, 'reviewer', 1, 'done')
    expect(findKilledSession(runDir, 'reviewer', 1)).toBeNull()
  })

  it('excludes a killed line with no id and other (label, round) keys — no match is null', () => {
    const runDir = makeRunDir()
    recordDeadSpawn(runDir, spawnInput, 1)
    recordSessionId(runDir, { ...spawnInput, label: 'resolver', role: 'resolver' }, 'ses_r')
    updateSessionStatus(runDir, 'resolver', 1, 'killed')
    expect(findKilledSession(runDir, 'reviewer', 1)).toBeNull()
    expect(findKilledSession(runDir, 'reviewer', 2)).toBeNull()
  })
})

describe('transcriptPathFor', () => {
  it('names per-attempt transcripts under the run transcripts dir, correlating with the ledger key', () => {
    const runDir = makeRunDir()
    expect(transcriptPathFor(runDir, 'reviewer', 2, 3)).toBe(path.join(runDir, 'transcripts', 'reviewer-r2-a3.jsonl'))
  })
})
