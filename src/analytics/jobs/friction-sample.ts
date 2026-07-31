// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, rmSync, writeFileSync } from 'node:fs'

import { eq } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { analyticsEvents, analyticsSessionEvents, analyticsSessions, analyticsTurnFriction } from '../../db/schema.js'
import { logger } from '../../logger.js'
import { DAY_MS } from '../retention/expiry-guard.js'

const log = logger.child({ scope: 'analytics:jobs:friction-sample' })

export type FrictionSampleDeps = Readonly<{
  getDrizzleDb: typeof defaultGetDrizzleDb
}>

export type SignatureBand = '0_1' | '2_3' | '4_7'

export type FrictionTimelineEvent = Readonly<{
  eventName: string
  offsetMs: number
  outcome?: string
}>

export type FrictionSampleCase = Readonly<{
  caseToken: string
  turnCountDecile: number
  platform: string
  contextType: string
  appVersion: string
  signatureBand: SignatureBand
  signatureCount: number
  timeline: readonly FrictionTimelineEvent[]
}>

export type FrictionSampleResult = Readonly<{
  cases: readonly FrictionSampleCase[]
  tokenMap: Readonly<Record<string, string>>
}>

const FRICTION_BIT_FIELDS = [
  'rephrase',
  'clarificationAbandoned',
  'permissionIssue',
  'stop',
  'longTurn',
  'disclosureFallback',
  'failureChain',
] as const

const TYPED_OUTCOME_PROPS = ['execution_outcome', 'decision', 'outcome', 'stage'] as const

const bandFor = (signatureCount: number): SignatureBand => {
  if (signatureCount <= 1) return '0_1'
  if (signatureCount <= 3) return '2_3'
  return '4_7'
}

const typedOutcome = (propsJson: string): string | undefined => {
  try {
    const parsed: unknown = JSON.parse(propsJson)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const record: Record<string, unknown> = Object.fromEntries(Object.entries(parsed))
    for (const key of TYPED_OUTCOME_PROPS) {
      const value = record[key]
      if (typeof value === 'string' && value.length > 0) return value
    }
    return undefined
  } catch {
    return undefined
  }
}

type Candidate = Readonly<{
  sessionKey: string
  turnCount: number
  platform: string
  contextType: string
  appVersion: string
  signatureCount: number
}>

const loadCandidates = (deps: FrictionSampleDeps, nowMs: number): readonly Candidate[] => {
  const db = deps.getDrizzleDb()
  const sessions = db.select().from(analyticsSessions).all()
  const frictionRows = db.select().from(analyticsTurnFriction).all()
  const anchorSessions = new Map<string, string>()
  for (const event of db
    .select({ eventId: analyticsEvents.eventId, sessionKey: analyticsEvents.sessionKey })
    .from(analyticsEvents)
    .all()) {
    if (event.sessionKey !== null) anchorSessions.set(event.eventId, event.sessionKey)
  }
  const bitsBySession = new Map<string, Set<string>>()
  for (const row of frictionRows) {
    const sessionKey = anchorSessions.get(row.anchorEventId)
    if (sessionKey === undefined) continue
    const bits = bitsBySession.get(sessionKey) ?? new Set<string>()
    for (const field of FRICTION_BIT_FIELDS) {
      if (row[field]) bits.add(field)
    }
    bitsBySession.set(sessionKey, bits)
  }
  const firstEvents = new Map(
    db
      .select({
        eventId: analyticsEvents.eventId,
        platform: analyticsEvents.platform,
        contextType: analyticsEvents.contextType,
        appVersion: analyticsEvents.appVersion,
      })
      .from(analyticsEvents)
      .all()
      .map((row) => [row.eventId, row]),
  )
  const candidates: Candidate[] = []
  for (const session of sessions) {
    if (session.endMs + DAY_MS > nowMs) continue
    const first = firstEvents.get(session.firstEventId)
    if (first === undefined) continue
    candidates.push({
      sessionKey: session.sessionKey,
      turnCount: session.turnCount,
      platform: first.platform,
      contextType: first.contextType,
      appVersion: first.appVersion,
      signatureCount: bitsBySession.get(session.sessionKey)?.size ?? 0,
    })
  }
  return candidates.sort((left, right) => left.sessionKey.localeCompare(right.sessionKey))
}

/**
 * Value-based turn-count decile: sessions with equal turn counts always land
 * in the same decile, so strata stay sampleable; decile d means the session's
 * turn count exceeds d/9 of the population's spread.
 */
const assignDeciles = (candidates: readonly Candidate[]): ReadonlyMap<string, number> => {
  const belowCount = new Map<number, number>()
  const turnCounts = [...new Set(candidates.map((candidate) => candidate.turnCount))].sort((a, b) => a - b)
  let below = 0
  for (const turnCount of turnCounts) {
    belowCount.set(turnCount, below)
    below += candidates.filter((candidate) => candidate.turnCount === turnCount).length
  }
  const denominator = Math.max(1, candidates.length - 1)
  const deciles = new Map<string, number>()
  for (const candidate of candidates) {
    deciles.set(candidate.sessionKey, Math.floor((9 * (belowCount.get(candidate.turnCount) ?? 0)) / denominator))
  }
  return deciles
}

const stratumKey = (candidate: Candidate, decile: number): string =>
  [decile, candidate.platform, candidate.contextType, candidate.appVersion, bandFor(candidate.signatureCount)].join('|')

const timelineFor = (
  deps: FrictionSampleDeps,
  sessionKey: string,
  startMs: number,
): readonly FrictionTimelineEvent[] => {
  const db = deps.getDrizzleDb()
  const links = db
    .select({ eventId: analyticsSessionEvents.eventId })
    .from(analyticsSessionEvents)
    .where(eq(analyticsSessionEvents.sessionKey, sessionKey))
    .all()
  const eventsById = new Map(
    db
      .select({
        eventId: analyticsEvents.eventId,
        eventName: analyticsEvents.eventName,
        occurredAtMs: analyticsEvents.occurredAtMs,
        propsJson: analyticsEvents.propsJson,
      })
      .from(analyticsEvents)
      .all()
      .map((row) => [row.eventId, row]),
  )
  return links
    .map((link) => eventsById.get(link.eventId))
    .filter((row): row is NonNullable<typeof row> => row !== undefined)
    .sort((left, right) => left.occurredAtMs - right.occurredAtMs || left.eventId.localeCompare(right.eventId))
    .map((row) => {
      const outcome = typedOutcome(row.propsJson)
      return outcome === undefined
        ? { eventName: row.eventName, offsetMs: row.occurredAtMs - startMs }
        : { eventName: row.eventName, offsetMs: row.occurredAtMs - startMs, outcome }
    })
}

/**
 * Stratified friction sampler: partitions mature complete sessions by
 * turn-count decile, platform, context type, app version, and signature band,
 * then deterministically samples up to `perStratum` sessions per stratum for
 * the seed. Output carries typed timelines and random case tokens only; the
 * engineer-only token map is the sole link back to session keys.
 */
export const sampleFrictionSessions = (
  input: Readonly<{ nowMs: number; perStratum: number; seed: string }>,
  deps: FrictionSampleDeps = { getDrizzleDb: defaultGetDrizzleDb },
): FrictionSampleResult => {
  const candidates = loadCandidates(deps, input.nowMs)
  const deciles = assignDeciles(candidates)
  const strata = new Map<string, Candidate[]>()
  for (const candidate of candidates) {
    const key = stratumKey(candidate, deciles.get(candidate.sessionKey) ?? 0)
    const bucket = strata.get(key) ?? []
    bucket.push(candidate)
    strata.set(key, bucket)
  }
  const sessionStart = new Map(
    deps
      .getDrizzleDb()
      .select({ sessionKey: analyticsSessions.sessionKey, startMs: analyticsSessions.startMs })
      .from(analyticsSessions)
      .all()
      .map((row) => [row.sessionKey, row.startMs]),
  )
  const cases: FrictionSampleCase[] = []
  const tokenMap: Record<string, string> = {}
  for (const key of [...strata.keys()].sort()) {
    const bucket = strata.get(key) ?? []
    const ranked = [...bucket].sort((left, right) => {
      const leftHash = createHash('sha256').update(`${input.seed}${left.sessionKey}`).digest('hex')
      const rightHash = createHash('sha256').update(`${input.seed}${right.sessionKey}`).digest('hex')
      return leftHash.localeCompare(rightHash) || left.sessionKey.localeCompare(right.sessionKey)
    })
    for (const candidate of ranked.slice(0, Math.max(0, input.perStratum))) {
      const caseToken = `case-${randomUUID().slice(0, 8)}`
      tokenMap[caseToken] = candidate.sessionKey
      cases.push({
        caseToken,
        turnCountDecile: deciles.get(candidate.sessionKey) ?? 0,
        platform: candidate.platform,
        contextType: candidate.contextType,
        appVersion: candidate.appVersion,
        signatureBand: bandFor(candidate.signatureCount),
        signatureCount: candidate.signatureCount,
        timeline: timelineFor(deps, candidate.sessionKey, sessionStart.get(candidate.sessionKey) ?? 0),
      })
    }
  }
  log.info({ strata: strata.size, sampled: cases.length }, 'friction sample drawn')
  return { cases, tokenMap }
}

/** Product/UX output carries timelines and tokens only; the engineer-only token map is mode-0600. */
export const writeFrictionSampleOutputs = (
  result: FrictionSampleResult,
  paths: Readonly<{ outputPath: string; tokenMapPath: string }>,
): void => {
  writeFileSync(paths.outputPath, `${JSON.stringify({ cases: result.cases }, null, 2)}\n`, { mode: 0o644 })
  writeFileSync(paths.tokenMapPath, `${JSON.stringify(result.tokenMap, null, 2)}\n`, { mode: 0o600 })
  chmodSync(paths.tokenMapPath, 0o600)
  log.info('friction sample outputs written; token map is permission-restricted')
}

/** Destroys the engineer-only token map at meeting end. */
export const destroyTokenMap = (tokenMapPath: string): void => {
  rmSync(tokenMapPath, { force: true })
  log.info('friction token map destroyed')
}
