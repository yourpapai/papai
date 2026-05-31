// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Hooks, Plugin } from '@opencode-ai/plugin'

import { blockGitCheckoutDiscard } from '../../.hooks/git/checks/block-git-checkout-discard.mjs'
import { blockGitStash } from '../../.hooks/git/checks/block-git-stash.mjs'
import { checkFull } from '../../.hooks/tdd/checks/check-full.mjs'
import { enforceTdd } from '../../.hooks/tdd/checks/enforce-tdd.mjs'
import { enforceWritePolicy } from '../../.hooks/tdd/checks/enforce-write-policy.mjs'
import { trackTestWrite } from '../../.hooks/tdd/checks/track-test-write.mjs'
import { verifyTestImport } from '../../.hooks/tdd/checks/verify-test-import.mjs'
import { getSessionsDir } from '../../.hooks/tdd/paths.mjs'
import { SessionState } from '../../.hooks/tdd/session-state.mjs'

const EDIT_TOOLS = new Set(['write', 'edit', 'multiedit'])

type ToolBeforeHook = NonNullable<Hooks['tool.execute.before']>
type ToolBeforeInput = Parameters<ToolBeforeHook>[0]
type ToolBeforeOutput = Parameters<ToolBeforeHook>[1]
type ToolAfterHook = NonNullable<Hooks['tool.execute.after']>
type ToolAfterInput = Parameters<ToolAfterHook>[0]
type EventHook = NonNullable<Hooks['event']>
type EventInput = Parameters<EventHook>[0]

type TddContext = {
  tool_name: string | undefined
  tool_input: Record<string, unknown>
  session_id: string
  cwd: string
}

type PostWriteContext = {
  tool_input: { file_path: string }
  session_id: string
  cwd: string
}

const getCommand = (args: unknown): string => {
  if (args === null || typeof args !== 'object') return ''
  const command: unknown = Reflect.get(args, 'command')
  if (typeof command !== 'string') return ''
  return command
}

const getFilePath = (args: unknown): string | undefined => {
  if (args === null || typeof args !== 'object') return undefined
  const filePath: unknown = Reflect.get(args, 'filePath')
  if (typeof filePath !== 'string' || filePath.length === 0) return undefined
  return filePath
}

const blockBashCommand = (command: string): void => {
  const gitStashResult = blockGitStash({ tool_name: 'bash', tool_input: { command } })
  if (gitStashResult) throw new Error(gitStashResult.reason)

  const gitCheckoutResult = blockGitCheckoutDiscard({
    tool_name: 'bash',
    tool_input: { command },
  })
  if (gitCheckoutResult) throw new Error(gitCheckoutResult.reason)
}

const createPreWriteContext = (
  input: ToolBeforeInput,
  args: Record<string, unknown>,
  filePath: string,
  directory: string,
): TddContext => {
  return {
    tool_name: input.tool,
    tool_input: { ...args, file_path: filePath },
    session_id: input.sessionID,
    cwd: directory,
  }
}

const createPostWriteContext = (filePath: string, sessionID: string, directory: string): PostWriteContext => {
  return {
    tool_input: { file_path: filePath },
    session_id: sessionID,
    cwd: directory,
  }
}

const toToolArgsRecord = (args: unknown): Record<string, unknown> | null => {
  if (args === null || typeof args !== 'object') return null

  const record: Record<string, unknown> = {}
  for (const key of Reflect.ownKeys(args)) {
    if (typeof key !== 'string') continue
    record[key] = Reflect.get(args, key)
  }

  return record
}

const handleToolExecuteBefore = (directory: string, input: ToolBeforeInput, output: ToolBeforeOutput): void => {
  if (input.tool === 'bash') {
    blockBashCommand(getCommand(output.args))
  }

  if (!EDIT_TOOLS.has(input.tool)) return

  const filePath = getFilePath(output.args)
  if (filePath === undefined) return

  const toolArgs = toToolArgsRecord(output.args)
  if (toolArgs === null) return

  const ctx = createPreWriteContext(input, toolArgs, filePath, directory)

  const writePolicyResult = enforceWritePolicy(ctx)
  if (writePolicyResult) {
    throw new Error(writePolicyResult.reason)
  }

  const tddResult = enforceTdd(ctx)
  if (tddResult) {
    throw new Error(tddResult.reason)
  }

  const state = new SessionState(input.sessionID, getSessionsDir(directory))
  state.setNeedsRecheck(true)
}

const notifySession = (client: Parameters<Plugin>[0]['client'], sessionID: string, text: string): void => {
  void client.session.promptAsync({
    path: { id: sessionID },
    body: {
      parts: [{ type: 'text', text }],
    },
  })
}

const handleToolExecuteAfter = (
  client: Parameters<Plugin>[0]['client'],
  directory: string,
  input: ToolAfterInput,
): void => {
  if (!EDIT_TOOLS.has(input.tool)) return

  const filePath = getFilePath(input.args)
  if (filePath === undefined) return

  const ctx = createPostWriteContext(filePath, input.sessionID, directory)

  trackTestWrite(ctx)

  const importResult = verifyTestImport(ctx)
  if (!importResult) return

  notifySession(client, input.sessionID, importResult.reason)
}

const handleSessionIdle = (
  client: Parameters<Plugin>[0]['client'],
  directory: string,
  input: EventInput,
  sessionID: string,
): void => {
  if (input.event.type !== 'session.idle') return
  if (sessionID.length === 0) return

  const state = new SessionState(sessionID, getSessionsDir(directory))
  if (state.getNeedsRecheck() === false) {
    state.setNeedsRecheck(true)
    return
  }

  const result = checkFull({ cwd: directory, session_id: sessionID })
  if (!result) {
    state.setNeedsRecheck(true)
    return
  }

  notifySession(client, sessionID, result.reason)
  state.setNeedsRecheck(false)
}

export const TddEnforcement: Plugin = ({ client, directory }) => {
  let currentSessionID = ''

  return Promise.resolve({
    'tool.execute.before': (input, output) => {
      currentSessionID = input.sessionID
      handleToolExecuteBefore(directory, input, output)
      return Promise.resolve()
    },

    'tool.execute.after': (input) => {
      currentSessionID = input.sessionID
      handleToolExecuteAfter(client, directory, input)
      return Promise.resolve()
    },

    event: (input) => {
      handleSessionIdle(client, directory, input, currentSessionID)
      return Promise.resolve()
    },
  })
}
