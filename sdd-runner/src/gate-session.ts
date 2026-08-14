// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { renderGateAnswers, responseFromAnswers } from './gate-answers.js'
import type { GateAck, GateAnswerItem, GateAnswers, GateBlockerAnswer } from './gate-answers.js'
import { parseGateResponse } from './gate-model.js'
import type { ExpectedGateContent, GateResponse } from './gate-model.js'
import { decisionConsequences } from './gate-render.js'
import type { Prompter } from './prompter.js'

export type { Prompter } from './prompter.js'
export { readlinePrompter, scriptedPrompter, stdinIsInteractive } from './prompter.js'

export interface GateSessionItem {
  readonly kind: 'assumption' | 'finding'
  readonly id: string
  readonly text: string
  readonly evidence: string
  readonly blastRadius: string
}

export interface GateSessionBlocker {
  readonly id: string
  readonly gap: string
  readonly evidence: string
}

export interface GateSessionView {
  readonly gateMode: 'early' | 'final'
  readonly items: readonly GateSessionItem[]
  readonly blockers: readonly GateSessionBlocker[]
  readonly requiredAck: { readonly id: string; readonly text: string } | null
}

export interface GateSessionDeps {
  readonly prompter: Prompter
  readonly view: GateSessionView
  readonly writeGateMd: (md: string) => Promise<void>
}

export type GateSessionResult =
  | { readonly status: 'answered'; readonly decision: GateAnswers['decision']; readonly gateMd: string }
  | { readonly status: 'abandoned' }

async function ask(prompter: Prompter, prompt: string): Promise<string | null> {
  const raw = await prompter.ask(prompt)
  if (raw === null) return null
  const trimmed = raw.trim()
  if (trimmed === 'q' || trimmed === 'quit') return null
  return trimmed
}

async function promptItem(prompter: Prompter, item: GateSessionItem): Promise<GateAnswerItem | null> {
  const choice = await ask(prompter, `${item.id} ${item.text} — (a)ccept / (v)eto / (i)nspect / (q)uit`)
  if (choice === null) return null
  if (choice === 'i') {
    prompter.say(`  evidence: ${item.evidence === '' ? '(none)' : item.evidence}`)
    prompter.say(`  blast radius: ${item.blastRadius === '' ? '(none)' : item.blastRadius}`)
    return promptItem(prompter, item)
  }
  if (choice === 'a') return { kind: item.kind, id: item.id, text: item.text, accepted: true }
  if (choice === 'v') return promptVeto(prompter, item)
  prompter.say('choose (a)ccept, (v)eto, (i)nspect, or (q)uit')
  return promptItem(prompter, item)
}

async function promptVeto(prompter: Prompter, item: GateSessionItem): Promise<GateAnswerItem | null> {
  const redirect = await ask(prompter, `redirect for ${item.id} (empty for none)`)
  if (redirect === null) return null
  return { kind: item.kind, id: item.id, text: item.text, accepted: false, ...(redirect === '' ? {} : { redirect }) }
}

type BlockerAnswer = GateBlockerAnswer | { readonly deferred: true; readonly id: string; readonly gap: string }

async function promptBlocker(prompter: Prompter, blocker: GateSessionBlocker): Promise<BlockerAnswer | null> {
  const raw = await ask(prompter, `${blocker.id} ${blocker.gap} — answer, OVERRIDE, or skip`)
  if (raw === null) return null
  if (raw === '' || raw === 'skip') return { deferred: true, id: blocker.id, gap: blocker.gap }
  return { id: blocker.id, gap: blocker.gap, answer: raw }
}

async function promptAck(prompter: Prompter, ack: { id: string; text: string }): Promise<boolean | null> {
  const choice = await ask(prompter, `${ack.id} ${ack.text} — (y)es / (n)o`)
  if (choice === null) return null
  if (choice === 'y' || choice === 'yes') return true
  if (choice === 'n' || choice === 'no') return false
  prompter.say('choose (y)es or (n)o')
  return promptAck(prompter, ack)
}

/**
 * The decision-menu consequence lines, rendered from the same
 * mode-conditional phrases the gate file's `### Decisions` block uses — one
 * copy source, two front-ends (Decision 6).
 */
export function consequenceLines(view: GateSessionView): string[] {
  const c = decisionConsequences(view.gateMode)
  const lines = ['Decision:', `  approve — ${c.approve}`]
  if (c.extend !== null) lines.push(`  extend — ${c.extend}`)
  lines.push(`  abort — ${c.abort}`)
  return lines
}

function expectedContent(view: GateSessionView): ExpectedGateContent {
  return {
    assumptions: view.items
      .filter((item) => item.kind === 'assumption')
      .map((item) => ({ id: item.id, text: item.text, blast_radius: item.blastRadius })),
    blockers: view.blockers.map((blocker) => ({ id: blocker.id, gap: blocker.gap, evidence: blocker.evidence })),
    findings: view.items
      .filter((item) => item.kind === 'finding')
      .map((item) => ({ id: item.id, gap: item.text, evidence: item.evidence })),
    ...(view.requiredAck === null ? {} : { requiredAck: view.requiredAck.id }),
    gateMode: view.gateMode,
  }
}

function sameResponse(a: GateResponse, b: GateResponse): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

interface Collected {
  readonly items: readonly GateAnswerItem[]
  readonly blockerAnswers: readonly GateBlockerAnswer[]
  readonly acks: readonly GateAck[]
  readonly decision: GateAnswers['decision']
}

/**
 * Walk the unresolved blockers, the trajectory ack, and the decision menu.
 * Recursion replaces loops: each retry cycle re-enters with the accumulated
 * state, matching the repo's sequential-await style.
 */
async function collectDecision(
  prompter: Prompter,
  view: GateSessionView,
  items: readonly GateAnswerItem[],
  answered: Map<string, GateBlockerAnswer>,
  ackAffirmed: boolean,
): Promise<Collected | null> {
  const nextBlocker = view.blockers.find((blocker) => !answered.has(blocker.id))
  if (nextBlocker !== undefined) {
    const answer = await promptBlocker(prompter, nextBlocker)
    if (answer === null) return null
    if (!('deferred' in answer)) answered.set(answer.id, answer)
    return collectDecision(prompter, view, items, answered, ackAffirmed)
  }
  if (!ackAffirmed && view.requiredAck !== null) {
    const affirmed = await promptAck(prompter, view.requiredAck)
    if (affirmed === null) return null
    return collectDecision(prompter, view, items, answered, affirmed)
  }
  for (const line of consequenceLines(view)) prompter.say(line)
  const choice = await ask(prompter, 'decision (approve / extend / abort / q)')
  if (choice === null) return null
  if (choice === 'abort') return { items: [], blockerAnswers: [], acks: [], decision: 'abort' }
  if (choice === 'extend') {
    if (view.gateMode !== 'early') {
      prompter.say('extend is available only at an early (cap-hit) gate')
      return collectDecision(prompter, view, items, answered, ackAffirmed)
    }
    return { items: [], blockerAnswers: [], acks: [], decision: 'extend' }
  }
  if (choice !== 'approve') {
    prompter.say('choose approve, extend, or abort (q to abandon)')
    return collectDecision(prompter, view, items, answered, ackAffirmed)
  }
  const unresolved = view.blockers.filter((blocker) => !answered.has(blocker.id))
  if (unresolved.length > 0 || !ackAffirmed) {
    const missing = [
      ...unresolved.map((blocker) => `blocker ${blocker.id} unanswered`),
      ...(ackAffirmed ? [] : [`${view.requiredAck?.id ?? 'ack'} not affirmed`]),
    ]
    prompter.say(`approve is unavailable: ${missing.join(', ')}`)
    return collectDecision(prompter, view, items, answered, ackAffirmed)
  }
  const acks: GateAck[] =
    view.requiredAck !== null && ackAffirmed ? [{ id: view.requiredAck.id, text: view.requiredAck.text }] : []
  return { items, blockerAnswers: [...answered.values()], acks, decision: 'approve' }
}

async function collectItems(
  prompter: Prompter,
  items: readonly GateSessionItem[],
  index: number,
  acc: readonly GateAnswerItem[],
): Promise<readonly GateAnswerItem[] | null> {
  const item = items[index]
  if (item === undefined) return acc
  const answer = await promptItem(prompter, item)
  if (answer === null) return null
  return collectItems(prompter, items, index + 1, [...acc, answer])
}

export interface FlagDecisionInput {
  readonly confirmAll?: boolean
  readonly abort?: boolean
  readonly extend?: boolean
  readonly vetoes?: readonly { readonly id: string; readonly redirect?: string }[]
}

/**
 * Desugar decision flags to the same answers the session collects (Decision
 * 5): `--confirm-all` accepts every item, answers every blocker with
 * OVERRIDE, and affirms the ack; each `--veto <id>=<redirect>` then
 * un-accepts its item with the redirect. Unknown veto ids fail before
 * anything is written. No flags at all is not a decision — the hand-edited
 * file path handles that case.
 */
export function desugarFlags(
  flags: FlagDecisionInput,
  view: GateSessionView,
  writeGateMd: (md: string) => Promise<void>,
): Promise<GateSessionResult> {
  if (flags.abort === true) {
    return settleAnswers({ items: [], blockerAnswers: [], acks: [], decision: 'abort' }, view, writeGateMd)
  }
  if (flags.extend === true) {
    return settleAnswers({ items: [], blockerAnswers: [], acks: [], decision: 'extend' }, view, writeGateMd)
  }
  if (flags.confirmAll !== true) {
    return Promise.reject(
      new Error('no decision flags given — pass --confirm-all/--veto/--abort/--extend, or hand-edit the gate file'),
    )
  }
  const known = new Set(view.items.map((item) => item.id))
  for (const veto of flags.vetoes ?? []) {
    if (!known.has(veto.id)) {
      return Promise.reject(new Error(`unknown veto id: ${veto.id} (not in this gate's item set)`))
    }
  }
  const items: GateAnswerItem[] = view.items.map((item) => {
    const veto = (flags.vetoes ?? []).find((candidate) => candidate.id === item.id)
    if (veto === undefined) return { kind: item.kind, id: item.id, text: item.text, accepted: true }
    return {
      kind: item.kind,
      id: item.id,
      text: item.text,
      accepted: false,
      ...(veto.redirect === undefined ? {} : { redirect: veto.redirect }),
    }
  })
  const blockerAnswers = view.blockers.map((blocker) => ({ id: blocker.id, gap: blocker.gap, answer: 'OVERRIDE' }))
  const ack = view.requiredAck
  const acks = ack === null ? [] : [{ id: ack.id, text: ack.text }]
  return settleAnswers({ items, blockerAnswers, acks, decision: 'approve' }, view, writeGateMd)
}

async function settleAnswers(
  answers: GateAnswers,
  view: GateSessionView,
  writeGateMd: (md: string) => Promise<void>,
): Promise<GateSessionResult> {
  const md = renderGateAnswers(answers)
  const parsed = parseGateResponse(md, expectedContent(view))
  if (!sameResponse(parsed, responseFromAnswers(answers))) {
    throw new Error('answer self-check failed: rendered answers parse back as a different outcome')
  }
  await writeGateMd(md)
  return { status: 'answered', decision: answers.decision, gateMd: md }
}

/**
 * Interactive gate session (Decisions 1-2): walk every finding/assumption
 * (accept / veto+redirect / inspect), answer cap-hit blockers, affirm the
 * trajectory ack, then offer the decision with consequence lines. The
 * collected answers render to gate-file grammar and pass a write-then-parse
 * self-check before anything is written; abandoning before the final decision
 * writes nothing.
 */
export async function runGateSession(deps: GateSessionDeps): Promise<GateSessionResult> {
  const { prompter, view } = deps
  const items = await collectItems(prompter, view.items, 0, [])
  if (items === null) return { status: 'abandoned' }
  const collected = await collectDecision(prompter, view, items, new Map(), view.requiredAck === null)
  if (collected === null) return { status: 'abandoned' }
  const answers: GateAnswers = {
    items: collected.items,
    blockerAnswers: collected.blockerAnswers,
    acks: collected.acks,
    decision: collected.decision,
  }
  return settleAnswers(answers, view, deps.writeGateMd)
}
