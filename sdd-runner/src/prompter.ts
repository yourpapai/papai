// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import * as readline from 'node:readline/promises'

export interface Prompter {
  readonly say: (line: string) => void
  readonly ask: (prompt: string) => Promise<string | null>
}

/**
 * Test/scripting prompter: `ask` pulls the next pre-scripted answer (or `null`
 * when the script is exhausted, standing in for EOF); every exchange is
 * recorded into `transcript` so tests can assert on the walkthrough.
 */
export function scriptedPrompter(answers: readonly string[]): { prompter: Prompter; transcript: string[] } {
  const transcript: string[] = []
  const queue = [...answers]
  const prompter: Prompter = {
    say: (line) => {
      transcript.push(line)
    },
    ask: (prompt) => {
      transcript.push(`? ${prompt}`)
      const next = queue.shift()
      if (next === undefined) return Promise.resolve(null)
      transcript.push(`> ${next}`)
      return Promise.resolve(next)
    },
  }
  return { prompter, transcript }
}

export interface ReadlineStreams {
  readonly input: NodeJS.ReadableStream
  readonly output: NodeJS.WritableStream
}

/**
 * Thin `node:readline` adapter (no new deps). Behavior lives in the session
 * and is covered via `scriptedPrompter`; this only wires the terminal I/O.
 */
export function readlinePrompter(streams: ReadlineStreams): Prompter {
  let terminal: readline.Interface | null = null
  const openTerminal = (): readline.Interface => {
    terminal ??= readline.createInterface({ input: streams.input, output: streams.output })
    return terminal
  }
  return {
    say: (line) => {
      streams.output.write(`${line}\n`)
    },
    ask: (prompt) => openTerminal().question(`${prompt} `),
  }
}

/** Interactive mode is entered only when stdin is a TTY (flags always win). */
export function stdinIsInteractive(input: NodeJS.ReadStream | { readonly isTTY?: boolean } = process.stdin): boolean {
  return input.isTTY ?? false
}
