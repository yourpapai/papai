// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { commandArgOf, handleBindCommand, parseBindPath } from './bind-command.js'
import type { AdminConfigReader, HttpFetch } from './client.js'
import { cancelCodingTaskTool, followupCodingTaskTool } from './event-tools.js'
import { codingTaskStatusTool, createCodingTaskTool, listCodingTasksTool } from './tools.js'
import type { Tool } from './tools.js'

type RegisterTool = (tool: Tool) => void
type RegisterFragment = (f: { name: string; content: string }) => void
type RegisterCommand = (c: {
  name: string
  description: string
  execute: (message: unknown, reply: { text(s: string): Promise<void> | void }, auth: unknown) => Promise<void> | void
}) => void
type LogInfo = (meta: Record<string, unknown>, msg: string) => void

type ActivationContext = {
  registerTool: RegisterTool
  registerFragment: RegisterFragment
  registerCommand: RegisterCommand
  logInfo: LogInfo
  httpFetch: HttpFetch | undefined
  adminConfig: AdminConfigReader
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (isRecord(value)) return value
  throw new Error(message)
}

function isRegisterTool(value: unknown): value is RegisterTool {
  return typeof value === 'function'
}

function isRegisterFragment(value: unknown): value is RegisterFragment {
  return typeof value === 'function'
}

function isRegisterCommand(value: unknown): value is RegisterCommand {
  return typeof value === 'function'
}

function isLogInfo(value: unknown): value is LogInfo {
  return typeof value === 'function'
}

function isHttpFetch(value: unknown): value is HttpFetch {
  return typeof value === 'function'
}

function isAdminConfig(value: unknown): value is AdminConfigReader {
  return isRecord(value) && typeof value['get'] === 'function'
}

function extractActivationContext(ctx: unknown): ActivationContext {
  const context = requireRecord(ctx, 'nerv: plugin context must be an object')
  const log = requireRecord(context['log'], 'nerv: plugin context log must be an object')
  const registration = requireRecord(context['registration'], 'nerv: plugin context registration must be an object')
  const providerRuntime = context['providerRuntime']

  if (!isLogInfo(log['info'])) throw new Error('nerv: logger.info must be a function')
  if (!isRegisterTool(registration['registerTool'])) throw new Error('nerv: registerTool must be a function')
  if (!isRegisterFragment(registration['registerPromptFragment']))
    throw new Error('nerv: registerPromptFragment must be a function')
  if (!isRegisterCommand(registration['registerCommand'])) throw new Error('nerv: registerCommand must be a function')
  if (!isAdminConfig(context['adminConfig'])) throw new Error('nerv: adminConfig must be an object with get()')

  const logInfo = log['info']
  const registerTool = registration['registerTool']
  const registerFragment = registration['registerPromptFragment']
  const registerCommand = registration['registerCommand']
  const adminConfig = context['adminConfig']

  let httpFetch: HttpFetch | undefined
  if (isRecord(providerRuntime) && isHttpFetch(providerRuntime['httpFetch'])) {
    httpFetch = providerRuntime['httpFetch']
  }

  return { registerTool, registerFragment, registerCommand, logInfo, httpFetch, adminConfig }
}

const NERV_PROMPT_FRAGMENT =
  'Supervised coding tasks: for long-running work — open/update a GitLab merge request and watch it until CI is ' +
  'green, iterate on review comments, or work across multiple repos — use create_coding_task(project, prompt). ' +
  'It runs until done and notifies the user; use followup_coding_task to queue guidance for the next checkpoint, ' +
  'cancel_coding_task to stop it, and coding_task_status/list_coding_tasks to check progress. Only one task runs ' +
  'per thread. For a single one-shot change that opens a PR immediately, use start_session (the acp plugin) instead.'

const NERV_COMMAND_TEXT =
  'nerv supervised coding tasks are available. Ask me in natural language, e.g. "supervise an MR on demo to add ' +
  'retries and keep it green", "what’s the status of my coding task?", or "tell the task to address the review ' +
  'comments".'

const factory = (): { activate(ctx: unknown): void } => ({
  activate(rawCtx: unknown): void {
    const ctx = extractActivationContext(rawCtx)
    ctx.registerTool(createCodingTaskTool(ctx.httpFetch))
    ctx.registerTool(codingTaskStatusTool(ctx.httpFetch))
    ctx.registerTool(listCodingTasksTool(ctx.httpFetch))
    ctx.registerTool(followupCodingTaskTool(ctx.httpFetch))
    ctx.registerTool(cancelCodingTaskTool(ctx.httpFetch))
    ctx.registerFragment({ name: 'nerv-hint', content: NERV_PROMPT_FRAGMENT })
    ctx.registerCommand({
      name: 'nerv',
      description: 'About nerv supervised coding tasks',
      execute: async (
        message: unknown,
        reply: { text(s: string): Promise<void> | void },
        auth: unknown,
      ): Promise<void> => {
        const bindPath = parseBindPath(commandArgOf(message))
        if (bindPath !== null) {
          await handleBindCommand(reply, auth, ctx.adminConfig, ctx.httpFetch, bindPath)
          return
        }
        await reply.text(NERV_COMMAND_TEXT)
      },
    })
    ctx.logInfo({}, 'nerv plugin activated')
  },
})

export default factory
