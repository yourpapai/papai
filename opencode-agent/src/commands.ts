// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { canTransition } from './state-manager.js'
import type { Phase, TransitionSignal } from './types.js'

/** Slash commands a maintainer can issue from an issue comment. */
export const SLASH_COMMANDS = ['/approve', '/changes', '/ask', '/retry', '/cancel'] as const

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
export const COMMAND_SIGNALS: Record<string, TransitionSignal> = {
  '/approve': 'APPROVED',
  '/changes': 'CHANGES_REQUESTED',
  '/retry': 'RETRY',
  '/cancel': 'CANCELLED',
}

/**
 * The commands `phase` would actually accept, straight from the transition
 * table, so a list shown to a maintainer cannot drift from what the machine will
 * take. `/ask` is appended unconditionally: answering asks nothing of the state
 * machine, so there is no phase in which it is refused.
 */
export const acceptedCommands = (phase: Phase): readonly string[] => [
  ...Object.entries(COMMAND_SIGNALS)
    .filter(([, signal]) => canTransition(phase, signal))
    .map(([command]) => command),
  '/ask',
]
