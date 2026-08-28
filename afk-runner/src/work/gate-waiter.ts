// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { AutonomyConfig } from '../config.js'
import { flattenPosition } from '../drive/loop.js'
import type { EventInput } from '../events.js'
import { readEvents } from '../events.js'
import { foldLogOrInitial } from '../kernel/fold.js'
import type { KernelMachine } from '../kernel/machine.js'
import type { GateAnswers } from './gate-answers.js'
import { claimGateSettle } from './gate-claims.js'
import { evaluateLadder, renderAutoApproveAnswers } from './gate-prelude.js'
import {
  expectedContentFor,
  readReviewResultFromSidecars,
  settleGateFile,
  settleGateWithAnswers,
} from './gate-settle.js'
import type { SettleInput, SettleOutcome } from './gate-settle.js'
import { consumeSteerFile } from './steer.js'

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

export interface SteerLanding {
  readonly kind: 'abort' | 'veto' | 'extend'
  readonly id?: string
  readonly redirect?: string
}

export function peekSteer(runDir: string): SteerLanding | null {
  const steerPath = path.join(runDir, 'steer.md')
  if (!existsSync(steerPath)) return null
  const first = readFileSync(steerPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  if (first === undefined) return null
  if (first === 'abort') return { kind: 'abort' }
  if (first === 'extend') return { kind: 'extend' }
  const veto = first.match(/^veto\s+(\S+)=(.*)$/u)
  if (veto !== null) {
    return { kind: 'veto', id: veto[1], redirect: veto[2] }
  }
  return null
}

/** Steer taxonomy (deadline-waiter copy): extend-at-final is invalid and skipped with a warning. */
export function translateSteer(
  directive: SteerLanding,
  gateMode: 'early' | 'final',
): { readonly outcome: SteerLanding; readonly warn: string | null } {
  if (directive.kind === 'extend' && gateMode === 'final') {
    return { outcome: directive, warn: 'steer: extend is not valid at a final gate — skipped' }
  }
  return { outcome: directive, warn: null }
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

function narrowGateMode(mode: 'early' | 'final' | 'plan'): 'early' | 'final' {
  return mode === 'early' ? 'early' : 'final'
}

function readGateMd(runDir: string, version: number): Promise<string | null> {
  return readFile(path.join(runDir, `gate-${version}.md`), 'utf8').catch((): string | null => null)
}

function steerAnswers(steer: SteerLanding): GateAnswers {
  if (steer.kind === 'abort') return { items: [], blockerAnswers: [], acks: [], decision: 'abort' }
  if (steer.kind === 'extend') return { items: [], blockerAnswers: [], acks: [], decision: 'extend' }
  return {
    items: [
      {
        kind: 'assumption',
        id: steer.id ?? '',
        text: '',
        accepted: false,
        ...(steer.redirect === undefined ? {} : { redirect: steer.redirect }),
      },
    ],
    blockerAnswers: [],
    // The trajectory ack rides along checked — the parser accepts T-ids
    // unconditionally and a cap-hit gate requires it (desugarFlags parity).
    acks: [{ id: 'T1', text: 'I reviewed the trajectory and the open findings above' }],
    decision: 'veto',
  }
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
  let digests: string[] = []

  async function attemptSettle(
    context: {
      readonly version: number
      readonly gateMode: 'early' | 'final'
      readonly round: { readonly current: number; readonly cap: number } | null
    },
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
    }
    const result = await via(input)
    return { kind: 'settled', outcome: result.outcome }
  }

  async function step(): Promise<GateWaiterResult> {
    await ports.tick()
    const snapshot = foldLogOrInitial(ports.machine, ports.logPath).snapshot
    if (flattenPosition(snapshot.value) !== 'gate.awaiting') return { kind: 'external' }
    const gate = snapshot.context.gate
    if (gate === null) return { kind: 'external' }
    const gateMode = narrowGateMode(gate.mode)

    const expiry = await processExpiry(
      ports,
      gate.version,
      gateMode,
      snapshot.context.round,
      snapshot.context.gateDeadlineAt,
      snapshot.context.gateDeadlineReArmed,
    )
    if (expiry !== null) return expiry

    const steer = peekSteer(ports.runDir)
    if (steer !== null) {
      const translated = translateSteer(steer, gateMode)
      consumeSteerFile(ports.runDir)
      if (translated.warn !== null) {
        ports.stdout?.(translated.warn)
        return step()
      }
      return attemptSettle({ version: gate.version, gateMode, round: snapshot.context.round }, (input) =>
        settleGateWithAnswers(input, steerAnswers(steer)),
      )
    }

    const md = await readGateMd(ports.runDir, gate.version)
    if (md === null || !looksAnswered(md)) {
      digests = []
      return step()
    }
    digests = [...digests, digestOf(md)]
    if (isStableEdit(digests)) {
      return attemptSettle({ version: gate.version, gateMode, round: snapshot.context.round }, (input) =>
        settleGateFile(input),
      )
    }
    return step()
  }

  return step()
}

/** Exclusive-create claim for the deadline expiry path (legacy artifact name, D4). */
function claimGateExpiry(runDir: string, version: number): boolean {
  try {
    writeFileSync(path.join(runDir, `gate-${version}.expiry-claim`), `${new Date().toISOString()}\n`, { flag: 'wx' })
    return true
  } catch {
    return false
  }
}

/**
 * Deadline expiry (design D4): claim the gate exclusively under the legacy
 * `expiry-claim` name, re-run the ladder with expiry semantics (conservative
 * branches only — approve/extend, never abort), settle through the seam when
 * one applies, re-arm at most once via one additive `gate rearmed` event,
 * and otherwise leave the gate pending indefinitely. Returns null to keep
 * waiting.
 */
async function processExpiry(
  ports: GateWaiterPorts,
  version: number,
  gateMode: 'early' | 'final',
  round: { readonly current: number; readonly cap: number } | null,
  deadlineAt: string | null,
  reArmed: boolean,
): Promise<GateWaiterResult | null> {
  if (deadlineAt === null || ports.now === undefined || ports.repoRoot === undefined || ports.autonomy === undefined) {
    return null
  }
  if (ports.now().getTime() < new Date(deadlineAt).getTime()) return null
  if (!claimGateExpiry(ports.runDir, version)) {
    ports.stdout?.(`gate ${version} expiry already claimed by another process`)
    return { kind: 'external' }
  }
  const events = readEvents(ports.logPath)
  const currentRound = round?.current ?? 1
  const reviewResult = await readReviewResultFromSidecars(
    ports.sidecarDir,
    currentRound,
    gateMode === 'early' ? 'cap-hit' : 'converged',
  )
  const context = foldLogOrInitial(ports.machine, ports.logPath).snapshot.context
  const assumptions = (await expectedContentFor(ports.sidecarDir, currentRound, gateMode)).assumptions
  const decision = evaluateLadder(
    {
      version,
      mode: gateMode,
      reviewResult,
      context,
      events,
      sidecarDir: ports.sidecarDir,
      changeDir: ports.changeDir,
      runDir: ports.runDir,
      repoRoot: ports.repoRoot,
      emit: ports.emit,
      autonomy: ports.autonomy,
    },
    assumptions,
    true,
  )
  if (decision.action === 'approve' || decision.action === 'extend') {
    const result = await settleGateWithAnswers(
      {
        gate: {
          emit: ports.emit,
          runDir: ports.runDir,
          changeDir: ports.changeDir,
          driftCheck: () => Promise.resolve(),
        },
        version,
        gateMode,
        expected: await expectedContentFor(ports.sidecarDir, currentRound, gateMode),
        round,
      },
      decision.action === 'approve'
        ? renderAutoApproveAnswers(decision, assumptions)
        : { items: [], blockerAnswers: [], acks: [], decision: 'extend' },
    )
    return { kind: 'settled', outcome: result.outcome }
  }
  if (reArmed) {
    ports.stdout?.('auto-deadline: no safe policy branch — gate stays pending')
    return null
  }
  const reArmMinutes = ports.autonomy.deadlineMinutes ?? 10
  const nextDeadline = new Date(ports.now().getTime() + reArmMinutes * 60_000).toISOString()
  ports.emit({
    altitude: 'L2',
    type: 'gate',
    action: 'rearmed',
    mode: gateMode,
    version,
    deadlineAt: nextDeadline,
  })
  ports.stdout?.(`auto-deadline: no safe policy branch — re-armed once at ${nextDeadline}`)
  return null
}

/** The production tick: one second between polls. */
export function oneSecondTick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 1_000)
  })
}
