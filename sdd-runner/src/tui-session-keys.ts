// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { KeyFlags } from './gate-session-state.js'
import type { KeyFeed } from './tui-gate-session.js'

/**
 * A key script as a resumable token stream: the session screen's loop mounts
 * a fresh Ink surface per iteration, but scripted keys flow through one
 * shared cursor so a single script drives many iterations.
 */

export interface ScriptKey {
  readonly input: string
  readonly key: KeyFlags
}

export interface ScriptKeys {
  next(): ScriptKey | undefined
}

const UP = '\u001b[A'
const DOWN = '\u001b[B'
const CR = '\r'
const DEL = '\x7f'

function tokensOf(script: string): string[] {
  const tokens: string[] = []
  let rest = script
  while (rest.length > 0) {
    const token = rest.startsWith(UP) || rest.startsWith(DOWN) ? rest.slice(0, 3) : rest.slice(0, 1)
    tokens.push(token)
    rest = rest.slice(token.length)
  }
  return tokens
}

function keyOf(token: string): KeyFlags {
  return {
    upArrow: token === UP,
    downArrow: token === DOWN,
    return: token === CR,
    escape: false,
    backspace: token === DEL,
    delete: false,
  }
}

export function createScriptKeys(script: string): ScriptKeys {
  const tokens = tokensOf(script)
  let index = 0
  return {
    next: (): ScriptKey | undefined => {
      const token = tokens[index]
      if (token === undefined) return undefined
      index += 1
      return { input: token, key: keyOf(token) }
    },
  }
}

/** Emits script keys into a feed until the consumer settles or tokens run out. */
export async function pumpScript(feed: KeyFeed, script: ScriptKeys, settled: () => boolean): Promise<void> {
  await feed.whenSubscribed
  while (!settled()) {
    const next = script.next()
    if (next === undefined) return
    feed.emit(next.input, next.key)
  }
}
