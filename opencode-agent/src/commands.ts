// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { canTransition } from './transitions.js'
import type { AgentState, TransitionSignal } from './types.js'

/**
 * Slash commands a maintainer can issue from an issue comment.
 *
 * `/continue` is deliberately not a second spelling of `/retry`. That one means
 * "the thing that broke, again" and is accepted in `FAILED`; this one means "you
 * were not finished" and is accepted only in `INCOMPLETE`, where a wall-clock
 * stop parks. One command for both would need the state to say which kind of park
 * it is carrying, and every reader of the phase would have to ask.
 */
export const SLASH_COMMANDS = [
  '/approve',
  '/changes',
  '/ask',
  '/retry',
  '/cancel',
  '/review',
  '/continue',
  '/sync',
  '/fix',
] as const

export type SlashCommand = (typeof SLASH_COMMANDS)[number]

/** A parsed command plus whatever the maintainer wrote after it. */
export interface ParsedCommand {
  command: SlashCommand
  /** Text following the command, including subsequent lines. Often the point. */
  argument: string
}

const FENCE_PATTERN = /^\s*```/u

/** Drops ``` fenced regions; an unterminated fence swallows the rest of the body. */
const stripFencedBlocks = (body: string): string => {
  const kept: string[] = []
  let inside = false

  for (const line of body.split('\n')) {
    if (FENCE_PATTERN.test(line)) {
      inside = !inside
      continue
    }
    if (!inside) kept.push(line)
  }

  return kept.join('\n')
}

const matchCommand = (line: string): SlashCommand | null => {
  const lowered = line.trim().toLowerCase()
  return SLASH_COMMANDS.find((command) => lowered === command || lowered.startsWith(`${command} `)) ?? null
}

/**
 * Extracts the first slash command from a comment body, with its argument.
 *
 * Only a line that *starts* with the command counts, so quoting the agent's own
 * instructions ("reply with /approve to continue") does not fire it, and fenced
 * code blocks are ignored for the same reason. Everything from the rest of that
 * line onwards is the argument — `/changes` and `/ask` are only useful with one.
 */
export const parseSlashCommand = (body: string | null): ParsedCommand | null => {
  if (body === null) return null

  const lines = stripFencedBlocks(body).split('\n')

  for (const [index, line] of lines.entries()) {
    const command = matchCommand(line)
    if (command === null) continue

    const sameLine = line.trim().slice(command.length).trim()
    const rest = lines
      .slice(index + 1)
      .join('\n')
      .trim()
    return { command, argument: [sameLine, rest].filter((part) => part.length > 0).join('\n\n') }
  }

  return null
}

/**
 * What a maintainer comment with no slash command means.
 *
 * `question` is the safe default and the fallback for anything ambiguous:
 * answering a comment that was really a change request costs one reply, while
 * re-planning a comment that was really a question throws away an approved
 * artefact.
 */
export const COMMENT_INTENTS = ['question', 'changes', 'approve', 'none'] as const

export type CommentIntent = (typeof COMMENT_INTENTS)[number]

/**
 * Slash commands, mapped to the signal they inject before handlers run.
 *
 * Here rather than in `triggers.ts`, which applies them, because two callers now
 * need to ask what a phase accepts: the refusal comment, and the waiting comment
 * in `run-report.ts`. `triggers.ts` imports `run-report.ts`, so the derivation
 * cannot live in either of them without a cycle — the reason `moveOrSkip` moved
 * to `trigger-outcome.ts`. It belongs beside {@link SLASH_COMMANDS} anyway: this
 * module is the command vocabulary, and what each command *means* to the machine
 * is part of it.
 */
export const COMMAND_SIGNALS: Partial<Record<SlashCommand, TransitionSignal>> = {
  '/approve': 'APPROVED',
  '/changes': 'CHANGES_REQUESTED',
  '/retry': 'RETRY',
  '/cancel': 'CANCELLED',
  '/review': 'REVIEW_REQUESTED',
  '/continue': 'CONTINUE',
  // The `/review` shape, not the `/sync` one: `/fix` moves the machine, through
  // the same `CI_FAILED` transition the red-run door applies — one signal, one
  // `ciAttempts` increment site, one budget shared by both doors.
  '/fix': 'CI_FAILED',
}

/**
 * Commands whose availability the transition table cannot decide alone.
 *
 * There are three. `/sync` is the `/ask` shape — no signal, so the table is never
 * asked — and applies wherever the **agent branch exists**: `changeName !== null`
 * is that fact by the workspace's own doctrine (a `changeName === null` state
 * has no folder to read and no branch to switch to), with `prNumber` named
 * beside it because a delivered state is the other spelling of the same fact.
 * The one branch-less state that still names a change is a **cancelled** one —
 * `/cancel` deletes the branch (D9) and parks in `COMPLETE` with no pull
 * request, the same split `presentationKey` makes — and `/sync` must refuse it
 * or `ensureBranch` would resurrect the branch the cleanup deleted. It used to
 * key on `prNumber` alone, which issue #323 broke: the drift refusal parked the
 * issue `FAILED` with no pull request, named `/sync` as the remedy, and the
 * gate refused it — a remedy the state it was prescribed for could not take,
 * with the hand merge as the only way out. `COMPLETE` is the phase where
 * a table cannot decide for `/review` at all: that is where a **delivered**
 * issue and a **cancelled** one both live, and the phase alone cannot tell them
 * apart: `presentationKey` already splits them on the pull request, because a
 * delivered issue and an abandoned one are not the same outcome. `/review`
 * needs the same split — on a cancelled issue it would name a branch nobody
 * asked for and report against a pull request that does not exist. `/fix`
 * keeps the `prNumber` predicate: its round repairs the checks of a pull
 * request, and a state naming none has nothing for it to read.
 *
 * One predicate table with two readers rather than two spellings of one rule:
 * {@link acceptedCommands} shows a maintainer the list, `triggers.ts` enforces
 * it before applying the signal, and the offer and the gate cannot drift apart.
 */
const COMMAND_APPLIES: Partial<Record<SlashCommand, (state: AgentState) => boolean>> = {
  '/review': (state) => state.prNumber !== null,
  '/sync': (state) =>
    state.prNumber !== null || (state.changeName !== null && !(state.phase === 'COMPLETE' && state.prUrl === null)),
  '/fix': (state) => state.prNumber !== null,
}

/** Whether `command` applies to this state, over and above what the phase takes. */
export const commandApplies = (command: SlashCommand, state: AgentState): boolean => {
  const applies = COMMAND_APPLIES[command]
  return applies === undefined ? true : applies(state)
}

const accepts = (state: AgentState, command: SlashCommand): boolean => {
  const signal = COMMAND_SIGNALS[command]
  // `/ask` and `/sync` are the commands with no signal, and neither needs the
  // transition table: answering and syncing ask nothing of the state machine,
  // so there is no phase to refuse them. `/sync` still asks the predicate above
  // — before capture there is no branch to merge base into — while `/ask` has
  // no row there and is accepted everywhere, exactly as before.
  if (signal === undefined) return commandApplies(command, state)
  return canTransition(state.phase, signal) && commandApplies(command, state)
}

/**
 * The commands this **state** would actually accept, straight from the
 * transition table and the predicate above, so a list shown to a maintainer
 * cannot drift from what the machine will take.
 *
 * It takes a state rather than a phase because `/review` needs one — see
 * {@link COMMAND_APPLIES} — and both call sites already hold one.
 */
export const acceptedCommands = (state: AgentState): readonly string[] =>
  SLASH_COMMANDS.filter((command) => accepts(state, command))
