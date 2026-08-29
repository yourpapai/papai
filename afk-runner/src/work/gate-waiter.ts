// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { AutonomyConfig } from '../config.js'
import { escalationStageOf } from '../drive/failure-budget.js'
import { flattenPosition } from '../drive/loop.js'
import type { EventInput, StageId } from '../events.js'
import { foldLogOrInitial } from '../kernel/fold.js'
import type { KernelMachine } from '../kernel/machine.js'
import { claimGateSettle } from './gate-claims.js'
import { processExpiry } from './gate-expiry.js'
import { settleGateWithAnswers } from './gate-settle.js'
import { expectedContentFor, settleGateFile } from './gate-settle.js'
import type { SettleInput, SettleOutcome } from './gate-settle.js'
import { consumeSteerFile } from './steer.js'
import { peekSteer, steerAnswers, translateSteer } from './waiter-steer.js'
export type { SteerLanding } from './waiter-steer.js'
export { peekSteer, translateSteer } from './waiter-steer.js'

export function digestOf(md: string): string {
  return createHash('sha256').update(md).digest('hex')
}

/**
 * Hand-edit stability guard (deadline-waiter copy): a gate file settles
 * through the waiter only when its content hash is unchanged for 3
 * consecutive ticks, guarding against non-atomic editor writes and
 * two-step edits being settled mid-edit.
 */
export function isStableEdit(digests: readonly string[]): boolean {
  if (digests.length < 3) return false
  const last = digests.slice(-3)
  return last.every((digest) => digest === last[0])
}

/** Whether a polled gate file parses as human-answered: a checked box or an answer section. */
export function looksAnswered(md: string): boolean {
  return /-\s\[x\]\s*[AFT]\d+/u.test(md) || md.includes('## Gate response')
}

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
 * guard; a steer directive is translated to its answer equivalent
 * (extend-at-final skipped with a warning); external settlement — another
 * process answered — exits cleanly; a lost settle claim exits as external.
 * Calm-stop against a parked gate is a no-op: the waiter never consults the
 * stop marker. Ctrl-C is the operator's exit.
 */
export function awaitGateSettle(ports: GateWaiterPorts): Promise<GateWaiterResult> {
  const digests: string[] = []
  const attemptSettle: AttemptSettleFn = (context, via) => attemptSettleOf(ports, context, via)
  return step(ports, digests, attemptSettle)
}

interface WaiterContext {
  readonly version: number
  readonly gateMode: 'early' | 'final' | 'escalation'
  readonly round: { readonly current: number; readonly cap: number } | null
  readonly failedStage?: StageId
}

type AttemptSettleFn = (
  context: WaiterContext,
  via: (input: SettleInput) => Promise<{ outcome: SettleOutcome }>,
) => Promise<GateWaiterResult>

/** Claim-then-settle: first-writer-wins arbitration, then the seam. A lost claim exits as external. */
async function attemptSettleOf(
  ports: GateWaiterPorts,
  context: WaiterContext,
  via: (input: SettleInput) => Promise<{ outcome: SettleOutcome }>,
): Promise<GateWaiterResult> {
  const claim = claimGateSettle(ports.runDir, context.version, `waiter-${process.pid}`)
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
    expected: await expectedContentFor(ports.sidecarDir, context.round?.current ?? 1, context.gateMode),
    round: context.round,
    ...(context.failedStage === undefined ? {} : { failedStage: context.failedStage }),
  }
  const result = await via(input)
  return { kind: 'settled', outcome: result.outcome }
}

/** The steer branch of one waiter tick: consume the directive, settle through the seam when valid, recurse otherwise. */
function steerTick(
  ports: GateWaiterPorts,
  context: WaiterContext,
  digests: string[],
  attemptSettle: AttemptSettleFn,
): Promise<GateWaiterResult> {
  const steer = peekSteer(ports.runDir)
  if (steer === null) return step(ports, digests, attemptSettle)
  const translated = translateSteer(steer, context.gateMode)
  consumeSteerFile(ports.runDir)
  if (translated.warn !== null) {
    ports.stdout?.(translated.warn)
    return step(ports, digests, attemptSettle)
  }
  return attemptSettle(context, (input) => settleGateWithAnswers(input, steerAnswers(steer)))
}

/** One waiter tick: expiry, steer, then the gate file's stable hand-edit. */
async function step(
  ports: GateWaiterPorts,
  digests: string[],
  attemptSettle: AttemptSettleFn,
): Promise<GateWaiterResult> {
  await ports.tick()
  const snapshot = foldLogOrInitial(ports.machine, ports.logPath).snapshot
  if (flattenPosition(snapshot.value) !== 'gate.awaiting') return { kind: 'external' }
  const gate = snapshot.context.gate
  if (gate === null) return { kind: 'external' }
  const gateMode = narrowGateMode(gate.mode)
  // The escalation retry mover targets the still-active failed stage (C6 D4)
  const escalationStage = gateMode === 'escalation' ? escalationStageOf(snapshot.context) : null
  const context: WaiterContext = {
    version: gate.version,
    gateMode,
    round: snapshot.context.round,
    ...(escalationStage === null ? {} : { failedStage: escalationStage }),
  }

  const expiry = await processExpiry(
    ports,
    gate.version,
    gateMode,
    snapshot.context.round,
    snapshot.context.gateDeadlineAt,
    snapshot.context.gateDeadlineReArmed,
    escalationStage,
  )
  if (expiry !== null) return expiry

  if (peekSteer(ports.runDir) !== null) return steerTick(ports, context, digests, attemptSettle)

  const md = await readGateMd(ports.runDir, gate.version)
  if (md === null || !looksAnswered(md)) {
    digests.length = 0
    return step(ports, digests, attemptSettle)
  }
  digests.push(digestOf(md))
  if (isStableEdit(digests)) return attemptSettle(context, (input) => settleGateFile(input))
  return step(ports, digests, attemptSettle)
}

/** The production tick: one second between polls. */
export function oneSecondTick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 1_000)
  })
}
