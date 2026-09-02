// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { z } from 'zod'

export const SessionLedgerStatusSchema = z.enum(['spawned', 'done', 'killed'])
export type SessionLedgerStatus = z.infer<typeof SessionLedgerStatusSchema>

export const SessionLedgerLineSchema = z.object({
  label: z.string().min(1),
  role: z.string().min(1),
  round: z.number().int().nonnegative(),
  attempt: z.number().int().positive(),
  model: z.string().min(1),
  opencodeSessionId: z.string().min(1).nullable(),
  status: SessionLedgerStatusSchema,
  ts: z.string().min(1),
})
export type SessionLedgerLine = z.infer<typeof SessionLedgerLineSchema>

export interface SessionSpawnInput {
  readonly label: string
  readonly role: string
  readonly round: number
  readonly model: string
}

export function sessionLedgerPath(runDir: string): string {
  return path.join(runDir, 'sessions.jsonl')
}

export function transcriptPathFor(runDir: string, label: string, round: number, attempt: number): string {
  return path.join(runDir, 'transcripts', `${label}-r${round}-a${attempt}.jsonl`)
}

/**
 * Parse the ledger, skipping torn or corrupt lines: a crash mid-append must
 * not make the whole ledger unreadable — resume only needs the intact lines.
 */
export function readSessionLedger(runDir: string): readonly SessionLedgerLine[] {
  const ledgerPath = sessionLedgerPath(runDir)
  if (!existsSync(ledgerPath)) return []
  const parsed: SessionLedgerLine[] = []
  for (const line of readFileSync(ledgerPath, 'utf8').split('\n')) {
    if (line.trim().length === 0) continue
    try {
      parsed.push(SessionLedgerLineSchema.parse(JSON.parse(line)))
    } catch {
      // torn line — skip
    }
  }
  return parsed
}

function isKey(line: SessionLedgerLine, label: string, round: number): boolean {
  return line.label === label && line.round === round
}

function freeAttempt(lines: readonly SessionLedgerLine[], label: string, round: number, preferred: number): number {
  const used = new Set(lines.filter((line) => isKey(line, label, round)).map((line) => line.attempt))
  let attempt = preferred
  while (used.has(attempt)) attempt += 1
  return attempt
}

export function nextSessionAttempt(runDir: string, label: string, round: number): number {
  const attempts = readSessionLedger(runDir)
    .filter((line) => isKey(line, label, round))
    .map((line) => line.attempt)
  return attempts.length === 0 ? 1 : Math.max(...attempts) + 1
}

function appendLine(runDir: string, line: SessionLedgerLine): void {
  appendFileSync(sessionLedgerPath(runDir), `${JSON.stringify(line)}\n`)
}

/**
 * Append the `spawned` line carrying the opencode session id. Synchronous on
 * purpose: this runs the moment the first session-bearing event line arrives,
 * so a crash mid-agent still leaves the id on disk (D1).
 */
export function recordSessionId(
  runDir: string,
  input: SessionSpawnInput,
  opencodeSessionId: string,
  preferredAttempt: number = 1,
): number {
  const attempt = freeAttempt(readSessionLedger(runDir), input.label, input.round, preferredAttempt)
  appendLine(runDir, { ...input, attempt, opencodeSessionId, status: 'spawned', ts: new Date().toISOString() })
  return attempt
}

/** A spawn that died before emitting any session-bearing line: killed, no id. */
export function recordDeadSpawn(runDir: string, input: SessionSpawnInput, preferredAttempt: number): number {
  const attempt = freeAttempt(readSessionLedger(runDir), input.label, input.round, preferredAttempt)
  appendLine(runDir, { ...input, attempt, opencodeSessionId: null, status: 'killed', ts: new Date().toISOString() })
  return attempt
}

/** Transition the latest line of one (label, round) key to a terminal status. */
export function updateSessionStatus(runDir: string, label: string, round: number, status: SessionLedgerStatus): void {
  const lines = [...readSessionLedger(runDir)]
  let index = -1
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (isKey(lines[i]!, label, round)) {
      index = i
      break
    }
  }
  if (index === -1) return
  lines[index] = { ...lines[index]!, status }
  writeFileSync(sessionLedgerPath(runDir), `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`)
}

/**
 * Settle one spawn attempt: every ledger line this runAgent call opened
 * (attempt >= the allocated attempt — a stall retry bumps past collisions) is
 * transitioned; a spawn that died before any session-bearing line gets one
 * killed line with a null id.
 */
export function settleSessionAttempt(
  runDir: string,
  input: SessionSpawnInput,
  attempt: number,
  status: SessionLedgerStatus,
): void {
  const lines = [...readSessionLedger(runDir)]
  const mine = allOfKey(lines, input.label, input.round).filter((index) => lines[index]!.attempt >= attempt)
  if (mine.length === 0) {
    appendLine(runDir, { ...input, attempt, opencodeSessionId: null, status, ts: new Date().toISOString() })
    return
  }
  for (const index of mine) {
    lines[index] = { ...lines[index]!, status }
  }
  writeFileSync(sessionLedgerPath(runDir), `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`)
}

function allOfKey(lines: readonly SessionLedgerLine[], label: string, round: number): number[] {
  const indices: number[] = []
  for (let i = 0; i < lines.length; i += 1) {
    if (isKey(lines[i]!, label, round)) indices.push(i)
  }
  return indices
}

/** Latest id-bearing line of a key in one of the given statuses, or null. */
function latestIdBearing(
  runDir: string,
  label: string,
  round: number,
  statuses: readonly SessionLedgerStatus[],
): SessionLedgerLine | null {
  const matches = readSessionLedger(runDir).filter(
    (line) => isKey(line, label, round) && line.opencodeSessionId !== null && statuses.includes(line.status),
  )
  return matches.length === 0 ? null : matches[matches.length - 1]!
}

/** Latest in-flight (spawned or killed, id-bearing) line for a key, or null. */
export function findInFlightSession(runDir: string, label: string, round: number): SessionLedgerLine | null {
  return latestIdBearing(runDir, label, round, ['spawned', 'killed'])
}

/**
 * Latest id-bearing `killed` line for a key, or null — the stage re-entry
 * continuation boundary (escalation-retry-session-continuation D2): in-process
 * failures settle `killed` (continue); a true crash dangles `spawned` and a
 * settled spawn reads `done`, both fresh.
 */
export function findKilledSession(runDir: string, label: string, round: number): SessionLedgerLine | null {
  return latestIdBearing(runDir, label, round, ['killed'])
}
