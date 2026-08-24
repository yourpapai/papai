// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { AUTONOMY_DEFAULTS } from './config.js'
import type { OrchestratorDeps } from './gate-digest.js'

type ResumeGate = (deps: OrchestratorDeps, runId: string, options: GateResumeOptions) => Promise<RunGateResumeResult>
import type { GateResumeOptions, RunGateResumeResult } from './extend-round.js'
import { nowOf } from './gate-digest.js'
import { runPolicyLadder } from './gate-prelude.js'
import { consumeSteerFile } from './review-loop.js'
import { loadRunState, narrowGateMode, saveRunState } from './run-state.js'
import type { RunState } from './run-state.js'

/**
 * Whether a flagless `gate resume` should enter the deadline waiter (D11):
 * the default only on a non-TTY against a deadline-pending gate. A TTY keeps
 * the interactive session; `--no-wait` forces the immediate answer path;
 * decision flags and absent deadlines never wait.
 */
export function shouldEnterWaiter(input: {
  readonly isTty: boolean
  readonly deadlineAt: string | null
  readonly hasDecisionFlags: boolean
  readonly noWait: boolean
}): boolean {
  if (input.noWait || input.hasDecisionFlags || input.deadlineAt === null) return false
  return !input.isTty
}

export function isExternallySettled(state: RunState): boolean {
  return state.gate === null
}

export function digestOf(md: string): string {
  return createHash('sha256').update(md).digest('hex')
}

/**
 * Hand-edit stability guard (D11 / A11): a gate file settles through the
 * waiter only when its content hash is unchanged for 3 consecutive 1s ticks,
 * guarding against non-atomic editor writes and two-step edits being settled
 * mid-edit.
 */
export function isStableEdit(digests: readonly string[]): boolean {
  if (digests.length < 3) return false
  const last = digests.slice(-3)
  return last.every((digest) => digest === last[0])
}

/**
 * Whether a polled gate file parses as human-answered: at least one box
 * checked or an answer section present.
 */
export function looksAnswered(md: string): boolean {
  return /-\s\[x\]\s*[AFT]\d+/u.test(md) || md.includes('## Gate response')
}

export interface SteerLanding {
  readonly kind: 'abort' | 'veto' | 'extend'
  readonly id?: string
  readonly redirect?: string
}

export function translateSteer(
  directive: SteerLanding,
  gateMode: 'early' | 'final',
): { readonly outcome: SteerLanding; readonly warn: string | null } {
  if (directive.kind === 'extend' && gateMode === 'final') {
    return { outcome: directive, warn: 'steer: extend is not valid at a final gate — skipped' }
  }
  return { outcome: directive, warn: null }
}

/**
 * Deadline expiry handling (D11 / 12.3): reload state immediately before any
 * write, claim the gate via exclusive-create `gate-<n>.expiry-claim` (loser
 * exits), and re-arm at most once (`gateDeadlineReArmed` persisted before the
 * re-armed deadline is written). Never auto-aborts: with no conservative
 * branch available the gate stays pending; after one re-arm it stays pending
 * indefinitely. The claim file remains as an append-only audit artifact.
 */
export async function processExpiry(
  workDir: string,
  runId: string,
  reArmMinutes: number,
  trySettle: (state: RunState) => Promise<boolean>,
): Promise<'claimed-and-settled' | 'claimed-rearmed' | 'claimed-stay-pending' | 'lost-claim'> {
  const state = await loadRunState(workDir, runId)
  const version = state.gate?.version
  if (state.gate === null || version === undefined || state.gateDeadlineAt === null) {
    return 'lost-claim'
  }
  const claimPath = path.join(state.runDir, `gate-${version}.expiry-claim`)
  try {
    writeFileSync(claimPath, `${new Date().toISOString()}\n`, { flag: 'wx' })
  } catch {
    return 'lost-claim'
  }
  const settled = await trySettle(state)
  if (settled) return 'claimed-and-settled'
  if (state.gateDeadlineReArmed) return 'claimed-stay-pending'
  state.gateDeadlineReArmed = true
  state.gateDeadlineAt = new Date(Date.now() + reArmMinutes * 60_000).toISOString()
  await saveRunState(state)
  return 'claimed-rearmed'
}

/** Poll one gate file for a hand-edit answer (used by the 1s waiter loop). */
export async function readGateMd(runDir: string, version: number): Promise<string | null> {
  const gatePath = path.join(runDir, `gate-${version}.md`)
  const md = await readFile(gatePath, 'utf8').catch(() => null)
  return md
}

/** Peek steer.md for a landing directive without consuming it. */
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

/**
 * Deadline field lifecycle (D11): every gate presentation overwrites
 * `gateDeadlineAt` when `deadlineMinutes` is configured and clears both
 * deadline fields when it is not, so a stale deadline from an earlier gate
 * never leaks into a later presentation. Returns the bell/notification line
 * to print at presentation time (null when no deadline is configured).
 */
export function deadlineStampFor(deps: OrchestratorDeps): { gateDeadlineAt: string | null; notify: string | null } {
  const minutes = (deps.autonomy ?? AUTONOMY_DEFAULTS).deadlineMinutes
  if (minutes === undefined) {
    return { gateDeadlineAt: null, notify: null }
  }
  const at = new Date(nowOf(deps).getTime() + minutes * 60_000)
  return {
    gateDeadlineAt: at.toISOString(),
    notify: `\x07auto-deadline: unvetoed gate auto-proceeds at ${at.toISOString()}`,
  }
}

/**
 * Foreground deadline waiter (D11): 1s polling reloads `state.json` and the
 * gate file from disk every tick (no cached state). An externally settled
 * gate exits cleanly; a hand-edited file settles through the normal
 * `runGateResume` path once stable (3 consecutive ticks, same content); a
 * landing steer directive is translated to its flag equivalent; expiry
 * claims the gate exclusively and re-runs the ladder conservatively.
 */
export function awaitGateDeadline(
  deps: OrchestratorDeps,
  runId: string,
  resume: ResumeGate,
): Promise<RunGateResumeResult> {
  const reArmMinutes = deps.autonomy?.deadlineMinutes ?? 10

  async function step(digests: readonly string[]): Promise<RunGateResumeResult> {
    await tickDelay()
    const state = await loadRunState(deps.config.workDir, runId)
    const resumed = await maybeResume(deps, state, runId, digests, resume)
    if (resumed !== null) return resumed
    if (expiryDue(state)) {
      const handled = await handleExpiry(deps, state, runId, reArmMinutes)
      if (handled !== null) return handled
    }
    const next = await nextDigestsOf(state, digests)
    return step(next)
  }

  return step([])
}

function expiryDue(state: RunState): boolean {
  return state.gate !== null && state.gateDeadlineAt !== null && new Date(state.gateDeadlineAt).getTime() <= Date.now()
}

async function maybeResume(
  deps: OrchestratorDeps,
  state: RunState,
  runId: string,
  digests: readonly string[],
  resume: ResumeGate,
): Promise<RunGateResumeResult | null> {
  if (state.gate === null) return { runId, outcome: 'approved', version: 0 }
  const steer = peekSteer(state.runDir)
  if (steer !== null) return resume(deps, runId, steerOptionsFor(steer, state, deps))
  const gateMd = await readGateMd(state.runDir, state.gate.version)
  if (gateMd === null || !looksAnswered(gateMd)) return null
  const digest = digestOf(gateMd)
  if (isStableEdit([...digests, digest])) return resume(deps, runId, { noWait: true })
  return null
}

async function handleExpiry(
  deps: OrchestratorDeps,
  state: RunState,
  runId: string,
  reArmMinutes: number,
): Promise<RunGateResumeResult | null> {
  const outcome = await processExpiry(deps.config.workDir, runId, reArmMinutes, (claimed) =>
    conservativeBranchApplies(deps, claimed),
  )
  if (outcome === 'claimed-and-settled' || outcome === 'lost-claim') {
    return { runId, outcome: 'approved', version: state.gate?.version ?? 0 }
  }
  deps.stdout?.('\x07auto-deadline: no safe policy branch — gate stays pending')
  return null
}

async function nextDigestsOf(state: RunState, digests: readonly string[]): Promise<string[]> {
  if (state.gate === null) return []
  const gateMd = await readGateMd(state.runDir, state.gate.version)
  if (gateMd === null || !looksAnswered(gateMd)) return []
  return [...digests, digestOf(gateMd)]
}

function tickDelay(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 1_000)
  })
}

function steerOptionsFor(steer: SteerLanding, state: RunState, deps: OrchestratorDeps): GateResumeOptions {
  const translated = translateSteer(steer, narrowGateMode(state.gate?.mode ?? 'final'))
  if (translated.warn !== null) deps.stdout?.(translated.warn)
  const consume = consumeSteerFile(state.runDir)
  for (const warning of consume.warnings) deps.stdout?.(`steer: ${warning}`)
  if (steer.kind === 'abort') return { abort: true }
  if (steer.kind === 'veto') {
    return {
      confirmAll: true,
      vetoes: [{ id: steer.id ?? '', ...(steer.redirect === undefined ? {} : { redirect: steer.redirect }) }],
    }
  }
  return { extend: true }
}

/**
 * Expiry re-runs the ladder with `deadlineExpired` semantics permitting only
 * conservative branches (R1 approve, else R2 extend, else stay pending).
 */
function conservativeBranchApplies(deps: OrchestratorDeps, claimed: RunState): Promise<boolean> {
  const decision = runPolicyLadder(
    { ...deps, autonomy: { ...(deps.autonomy ?? AUTONOMY_DEFAULTS) } },
    claimed,
    {
      cwd: deps.config.repoRoot,
      changeDir: path.join(deps.config.repoRoot, 'openspec', 'changes', claimed.changeName),
      sidecarDir: path.join(claimed.runDir, 'sidecars'),
      emit: (): void => undefined,
    },
    { outcome: 'converged', rounds: claimed.round, openBlockers: [], openMaterial: [], openNitpicks: [] },
    {
      mode: narrowGateMode(claimed.gate?.mode ?? 'final'),
      version: claimed.gate?.version ?? 1,
      events: [],
      costUsd: 0,
      costKnown: false,
      assumptions: [],
      trajectory: [],
    },
  )
  return Promise.resolve(decision.decision.action === 'approve' || decision.decision.action === 'extend')
}
