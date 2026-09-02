// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { AutonomyConfig } from '../config.js'
import { escalationStageOf } from '../drive/failure-budget.js'
import { flattenPosition } from '../drive/loop.js'
import type { EventInput, StageId } from '../events.js'
import { foldLogOrInitial } from '../kernel/fold.js'
import type { KernelContext, KernelMachine } from '../kernel/machine.js'
import type { DigestRecord } from '../legacy-fold.js'
import { claimGateSettle, releaseGateSettle } from './gate-claims.js'
import { processExpiry } from './gate-expiry.js'
import { settleGateWithAnswers } from './gate-settle.js'
import { expectedContentFor, settleGateFile } from './gate-settle.js'
import type { SettleInput, SettleOutcome } from './gate-settle.js'
import { clearResponseError, readFailedDigest, writeResponseError, writeSteerResponseError } from './response-error.js'
import { consumeSteerFile } from './steer.js'
import { digestOf, isStableEdit, looksAnswered } from './waiter-probe.js'
import { peekSteer, steerAnswers, steerLineOf, translateSteer } from './waiter-steer.js'
import type { SteerLanding } from './waiter-steer.js'
export type { SteerLanding } from './waiter-steer.js'
export { peekSteer, translateSteer } from './waiter-steer.js'
// The probe grammar (digests, stability, answered-look, the production tick) lives in
// waiter-probe.ts; re-exported so the waiter's importers are unchanged.
export { digestOf, isStableEdit, looksAnswered, oneSecondTick } from './waiter-probe.js'

export interface GateWaiterPorts {
  readonly runDir: string
  readonly logPath: string
  readonly sidecarDir: string
  readonly changeDir: string
  readonly machine: KernelMachine
  /** Validated append into the run log — the settle seam's only write path. */
  readonly emit: (event: EventInput) => void
  /** One poll period; injected in tests, the 1s default in production. */
  readonly tick: () => Promise<void>
  readonly stdout?: (line: string) => void
  /** Expiry face (D4): ladder inputs, clock, and re-arm window. */
  readonly repoRoot?: string
  readonly autonomy?: AutonomyConfig
  readonly now?: () => Date
}

export type GateWaiterResult =
  | { readonly kind: 'settled'; readonly outcome: SettleOutcome }
  | { readonly kind: 'external' }

/** A contained settle rejection (D3): data for the feedback loop, not a waiter death. */
type WaiterRejection = { readonly kind: 'rejected'; readonly reason: string }

type AttemptOutcome = GateWaiterResult | WaiterRejection

/** Escalation stays first-class (C6 D4); only the dormant plan mode collapses to final. */
function narrowGateMode(mode: 'early' | 'final' | 'plan' | 'escalation'): 'early' | 'final' | 'escalation' {
  return mode === 'plan' ? 'final' : mode
}

function readGateMd(runDir: string, version: number): Promise<string | null> {
  return readFile(path.join(runDir, `gate-${version}.md`), 'utf8').catch((): string | null => null)
}

/**
 * The foreground gate waiter (design D3): a run-level post-park continuation
 * polling the gate file, the steer file, and the log once per tick. A
 * hand-edited gate file settles through the seam after the 3-tick stability
 * guard; a rejected settle becomes feedback — the sibling response-error
 * artifact plus a stdout line — and the waiter keeps waiting, re-attempting
 * only after the gate file's digest changes (D3). A steer directive is
 * translated to its answer equivalent (extend-at-final skipped with a
 * warning); external settlement — another process answered — exits cleanly;
 * a lost settle claim exits as external. Calm-stop against a parked gate is
 * a no-op: the waiter never consults the stop marker. Ctrl-C is the
 * operator's exit.
 */
export function awaitGateSettle(ports: GateWaiterPorts): Promise<GateWaiterResult> {
  const attemptSettle: AttemptSettleFn = (context, via) => attemptSettleOf(ports, context, via)
  return step(ports, emptyWaiterState(), attemptSettle)
}

/** Threading state across ticks: the stability window and the digest guard (D3). */
interface WaiterState {
  readonly digests: string[]
  /** The digest of the last rejected gate file — an unchanged digest never re-attempts. */
  failedDigest: string | null
  /** The gate version the failedDigest was seeded for (resume reads the error artifact once per version). */
  seededFor: number | null
}

function emptyWaiterState(): WaiterState {
  return { digests: [], failedDigest: null, seededFor: null }
}

interface WaiterContext {
  readonly version: number
  readonly gateMode: 'early' | 'final' | 'escalation'
  readonly round: { readonly current: number; readonly cap: number } | null
  /** The fold's digest records — the F-C2 guard's input for settle-time expected content (D3 site 3). */
  readonly perRound: readonly DigestRecord[]
  readonly failedStage?: StageId
}

type AttemptSettleFn = (
  context: WaiterContext,
  via: (input: SettleInput) => Promise<{ outcome: SettleOutcome } | WaiterRejection>,
) => Promise<AttemptOutcome>

/** Claim-then-settle (D4 attempt scoping): first-writer-wins arbitration, the seam, then release on the attempt's outcome — settled or rejected. A lost claim exits as external. */
async function attemptSettleOf(
  ports: GateWaiterPorts,
  context: WaiterContext,
  via: (input: SettleInput) => Promise<{ outcome: SettleOutcome } | WaiterRejection>,
): Promise<AttemptOutcome> {
  const claimant = `waiter-${process.pid}`
  const claim = claimGateSettle(ports.runDir, context.version, claimant)
  if (!claim.claimed) {
    ports.stdout?.(`gate ${context.version} settle already claimed by ${claim.winner ?? 'another process'}`)
    return { kind: 'external' }
  }
  const input: SettleInput = {
    gate: {
      emit: ports.emit,
      runDir: ports.runDir,
      changeDir: ports.changeDir,
      driftCheck: () => Promise.resolve(),
    },
    version: context.version,
    gateMode: context.gateMode,
    // D3 site 3: settle-time expected content declares the substituted
    // POLICY-INTEGRITY blocker the rendered gate carries — the row is
    // acknowledgeable through the standard response grammar, never a
    // render-only trap that rejects every answer as unknown.
    expected: await expectedContentFor(
      ports.sidecarDir,
      context.round?.current ?? 1,
      context.gateMode,
      context.perRound,
    ),
    round: context.round,
    ...(context.failedStage === undefined ? {} : { failedStage: context.failedStage }),
  }
  try {
    const result = await via(input)
    if ('kind' in result) return result
    return { kind: 'settled', outcome: result.outcome }
  } finally {
    releaseGateSettle(ports.runDir, context.version, claimant)
  }
}

/** The steer branch of one waiter tick: consume the directive, settle through the seam when valid, recurse otherwise. */
async function steerTick(
  ports: GateWaiterPorts,
  context: WaiterContext,
  state: WaiterState,
  attemptSettle: AttemptSettleFn,
): Promise<GateWaiterResult> {
  const steer = peekSteer(ports.runDir)
  if (steer === null) return step(ports, state, attemptSettle)
  const translated = translateSteer(steer, context.gateMode)
  consumeSteerFile(ports.runDir)
  if (translated.warn !== null) {
    ports.stdout?.(translated.warn)
    return step(ports, state, attemptSettle)
  }
  const result = await attemptSettle(context, (input) => settleGateWithAnswers(input, steerAnswers(steer)))
  if (result.kind === 'rejected')
    return steerFeedbackAndKeepWaiting(ports, context, state, attemptSettle, steer, result.reason)
  clearResponseError(ports.runDir, context.version)
  state.failedDigest = null
  return result
}

/**
 * Record a steer rejection as contained feedback (D2): the artifact is
 * written unconditionally — a steer often lands before any stable gate-file
 * read — its heading marked (steer), its reason embedding the consumed
 * directive, and its digest the sha256 of the directive line, which no
 * gate-file content digest can equal — the resume-seeded file-path guard
 * stays inert, so no hand edit is ever blocked by a steer rejection.
 */
function steerFeedbackAndKeepWaiting(
  ports: GateWaiterPorts,
  context: WaiterContext,
  state: WaiterState,
  attemptSettle: AttemptSettleFn,
  steer: SteerLanding,
  reason: string,
): Promise<GateWaiterResult> {
  const directive = steerLineOf(steer)
  const marked = `steer "${directive}" rejected: ${reason}`
  writeSteerResponseError(ports.runDir, context.version, marked, digestOf(directive))
  ports.stdout?.(`gate ${context.version} settle rejected — see gate-${context.version}.response-error.md: ${marked}`)
  return step(ports, state, attemptSettle)
}

/** Record a rejection as operator feedback (D3): sibling artifact + stdout line, then keep waiting. */
function feedbackAndKeepWaiting(
  ports: GateWaiterPorts,
  context: WaiterContext,
  state: WaiterState,
  attemptSettle: AttemptSettleFn,
  reason: string,
): Promise<GateWaiterResult> {
  const digest = state.digests.at(-1)
  if (digest !== undefined) {
    state.failedDigest = digest
    writeResponseError(ports.runDir, context.version, reason, digest)
  }
  ports.stdout?.(`gate ${context.version} settle rejected — see gate-${context.version}.response-error.md: ${reason}`)
  return step(ports, state, attemptSettle)
}

/** One waiter tick: expiry, steer, then the gate file's stable hand-edit. */
async function step(
  ports: GateWaiterPorts,
  state: WaiterState,
  attemptSettle: AttemptSettleFn,
): Promise<GateWaiterResult> {
  await ports.tick()
  const snapshot = foldLogOrInitial(ports.machine, ports.logPath).snapshot
  if (flattenPosition(snapshot.value) !== 'gate.awaiting') return { kind: 'external' }
  const gate = snapshot.context.gate
  if (gate === null) return { kind: 'external' }
  // Already-answered guard (D5): an explicitly-outcome'd record at awaiting
  // is another producer's settle (resume's owed movers heal the rest) —
  // never re-settle it. A historical answered-no-outcome record still heals
  // forward: the next settle appends the explicit outcome.
  if (gate.answered && snapshot.context.gateOutcome !== null) return { kind: 'external' }
  // Resume seeding (D3): an unchanged poisoned file must not re-attempt —
  // the error artifact's failed digest initializes the guard once per version.
  if (state.seededFor !== gate.version) {
    state.seededFor = gate.version
    state.failedDigest = readFailedDigest(ports.runDir, gate.version)
  }
  const gateMode = narrowGateMode(gate.mode)
  // The escalation retry mover targets the still-active failed stage (C6 D4)
  const escalationStage = gateMode === 'escalation' ? escalationStageOf(snapshot.context) : null
  const context: WaiterContext = {
    version: gate.version,
    gateMode,
    round: snapshot.context.round,
    perRound: snapshot.context.perRound,
    ...(escalationStage === null ? {} : { failedStage: escalationStage }),
  }

  const expiry = await expiryTick(ports, snapshot.context, gate.version, gateMode, escalationStage)
  if (expiry !== null) return expiry

  if (peekSteer(ports.runDir) !== null) return steerTick(ports, context, state, attemptSettle)

  const md = await readGateMd(ports.runDir, gate.version)
  if (md === null || !looksAnswered(md)) {
    state.digests.length = 0
    return step(ports, state, attemptSettle)
  }
  state.digests.push(digestOf(md))
  if (!isStableEdit(state.digests)) return step(ports, state, attemptSettle)
  return settleStableFile(ports, context, state, attemptSettle)
}

/** The deadline face of one tick: null keeps waiting. */
function expiryTick(
  ports: GateWaiterPorts,
  context: KernelContext,
  version: number,
  gateMode: 'early' | 'final' | 'escalation',
  escalationStage: StageId | null,
): Promise<GateWaiterResult | null> {
  return processExpiry(
    ports,
    version,
    gateMode,
    context.round,
    context.gateDeadlineAt,
    context.gateDeadlineReArmed,
    escalationStage,
  )
}

/** The stable hand-edit's settle attempt, behind the digest guard (D3). */
async function settleStableFile(
  ports: GateWaiterPorts,
  context: WaiterContext,
  state: WaiterState,
  attemptSettle: AttemptSettleFn,
): Promise<GateWaiterResult> {
  const digest = state.digests.at(-1)!
  if (state.failedDigest === digest) return step(ports, state, attemptSettle)
  const result = await attemptSettle(context, (input) => settleGateFile(input))
  if (result.kind === 'rejected') return feedbackAndKeepWaiting(ports, context, state, attemptSettle, result.reason)
  clearResponseError(ports.runDir, context.version)
  state.failedDigest = null
  return result
}
