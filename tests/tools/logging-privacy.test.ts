// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const { logMultistream, logger } = await import('../../src/logger.js')
const { NO_ANALYTICS_SCOPE } = await import('../../src/analytics/provider-request-scope.js')
const { convertMcpToolsToToolSet } = await import('../../src/mcp/tool-adapter.js')
const { makeTools } = await import('../../src/tools/index.js')
const { buildToolsContextRecord, finalizeProviderScopedTools } = await import('../../src/tools/wrap-tool-execution.js')
const { getToolExecutor, restoreFetch, setMockFetch, setupTestDb } = await import('../utils/test-helpers.js')
const { fetchAndExtract } = await import('../../src/web/fetch-extract.js')
const { createMockProvider } = await import('./mock-provider.js')

const CANARIES = [
  'CANARY-TITLE-9f3e2a',
  'CANARY-PROJECT-ID-71c',
  'CANARY-NATIVE-TASK-55d',
  'CANARY-QUERY-8b21',
  'CANARY-PROVIDER-PAYLOAD-4d9',
  'CANARY-LOGIN-3fa',
  'CANARY-WEB-HOST-77e',
  'CANARY-ATTACHMENT-ID-2c6',
  'CANARY-SERVER-1ab',
  'CANARY-TOOL-9zz',
  'CANARY-MCP-TEXT-55q',
] as const

const [TITLE, PROJECT, NATIVE_TASK, QUERY, PAYLOAD, LOGIN, WEB_HOST, ATTACH, MCP_SERVER, MCP_TOOL, MCP_TEXT] = CANARIES

const logLines: string[] = []
logMultistream.add({
  level: 'debug',
  stream: {
    write(chunk: string): void {
      logLines.push(chunk)
    },
  },
})

const serializedLogLines = (): string => logLines.join('')

const expectNoCanaryInLogs = (): void => {
  const serialized = serializedLogLines()
  for (const canary of CANARIES) {
    expect(serialized, `log output must not contain ${canary}`).not.toContain(canary)
  }
}

describe('logging privacy runtime closure', () => {
  afterEach(() => {
    restoreFetch()
  })

  test('all-capability core and MCP tools never log canary content on success, failure, or blocked paths', async () => {
    await setupTestDb()
    logLines.length = 0
    // tests/setup silences the shared logger; re-enable it for this capture window.
    logger.level = 'debug'
    try {
      const provider = createMockProvider({
        createTask: () =>
          Promise.resolve({
            id: NATIVE_TASK,
            title: TITLE,
            status: 'todo',
            url: `https://canary-task-host.example/t/${NATIVE_TASK}`,
          }),
        searchTasks: () => Promise.reject(new Error(PAYLOAD)),
        deleteAttachment: () => Promise.reject(new Error(PAYLOAD)),
        identityResolver: {
          searchUsers: () => Promise.resolve([{ id: 'canary-user-id-0e4', login: LOGIN }]),
        },
      })
      const descriptors = await makeTools(provider, {
        storageContextId: 'pi-1:chat-1',
        chatUserId: 'user-1',
        mode: 'normal',
        contextType: 'dm',
      })
      const toolSet = finalizeProviderScopedTools(descriptors)
      const context = buildToolsContextRecord(toolSet, NO_ANALYTICS_SCOPE)
      const executeNamed = (name: string, input: unknown): Promise<unknown> =>
        getToolExecutor(toolSet[name])(input, { context: context[name], toolCallId: `call-${name}` })

      expect(toolSet['create_task']).toBeDefined()
      await executeNamed('create_task', { projectId: PROJECT, title: TITLE })
      await executeNamed('search_tasks', { query: QUERY })
      await executeNamed('find_user', { query: QUERY })
      await executeNamed('remove_attachment', { taskId: NATIVE_TASK, attachmentId: ATTACH, confidence: 0.99 })

      setMockFetch(() => Promise.reject(new Error(PAYLOAD)))
      await executeNamed('web_fetch', { url: `https://${WEB_HOST}.example/secret?q=${QUERY}` })

      const mcpTools = convertMcpToolsToToolSet(
        MCP_SERVER,
        [{ name: MCP_TOOL, inputSchema: { type: 'object', properties: {} } }],
        { callTool: () => Promise.resolve({ content: [{ type: 'text', text: MCP_TEXT }], isError: true }) },
      )
      const finalizedMcp = finalizeProviderScopedTools(mcpTools)
      const mcpName = Object.keys(finalizedMcp)[0]!
      await getToolExecutor(finalizedMcp[mcpName])({}, { context: NO_ANALYTICS_SCOPE, toolCallId: 'call-mcp' })
      // Missing scope fails closed through the wrapper; the dynamic server/tool names must not be logged.
      await getToolExecutor(finalizedMcp[mcpName])({}, { toolCallId: 'call-mcp-unscoped' })
    } finally {
      logger.level = 'silent'
    }

    expect(logLines.length, 'expected tool execution to emit logs').toBeGreaterThan(0)
    expectNoCanaryInLogs()
    expect(serializedLogLines(), 'failure logs must not carry raw error messages').not.toContain(PAYLOAD)
    expect(serializedLogLines(), 'expected at least one failure log').toContain('"level":50')
  })

  test('web URL normalization failure logs a bounded error class, never the raw URL', async () => {
    await setupTestDb()
    logLines.length = 0
    logger.level = 'debug'
    const CANARY_RAW_URL = 'CANARY-RAW-URL-4q7'
    try {
      await fetchAndExtract({
        storageContextId: 'pi-1:chat-1',
        url: `http://${CANARY_RAW_URL}.example bad url`,
      }).catch(() => undefined)
    } finally {
      logger.level = 'silent'
    }
    const serialized = serializedLogLines()
    expect(serialized).not.toContain(CANARY_RAW_URL)
    expect(serialized).not.toContain('Invalid URL')
    expect(serialized).toContain('errorClass')
  })
})

/**
 * Log-metadata keys that are never reviewed: raw user content, provider/native
 * IDs, URLs, filenames, logins, and uncontrolled error text. A registered
 * factory that logs one of these fails this closure statically.
 */
const BANNED_LOG_KEYS: ReadonlySet<string> = new Set([
  'error',
  'message',
  'missing',
  'taskId',
  'projectId',
  'commentId',
  'reactionId',
  'attachmentId',
  'fileId',
  'labelId',
  'sprintId',
  'agileId',
  'statusId',
  'workItemId',
  'memoryId',
  'memoId',
  'memo_id',
  'templateId',
  'recurringTaskId',
  'queryId',
  'stagedId',
  'id',
  'title',
  'name',
  'query',
  'queries',
  'filename',
  'url',
  'reaction',
  'tag',
  'tags',
  'claim',
  'params',
  'prefs',
  'result',
  'filters',
  'thread',
  'userId',
  'chatUserId',
  'actorUserId',
  'requesterUserId',
  'resolvedUserId',
  'resolvedAssigneeId',
  'assigneeId',
  'login',
  'claimedLogin',
  'username',
  'email',
  'groupId',
  'createdTaskId',
  'schedule',
  'beforeDate',
  'newStatus',
])

const LOG_CALL_PATTERN = /log\.(?:debug|info|warn|error)\(\s*\{([\s\S]*?)\}\s*,/gu
const MULTILINE_KEY_PATTERN = /^\s{2,}([A-Za-z_$][\w$]*)\s*[:,]/gmu
const SINGLELINE_KEY_PATTERN = /([A-Za-z_$][\w$]*)\s*(?::|,|\s*$)/gu

const metadataKeysOf = (body: string): string[] => {
  if (body.includes('\n')) {
    return [...body.matchAll(MULTILINE_KEY_PATTERN)].map((match) => match[1]!)
  }
  return [...body.matchAll(SINGLELINE_KEY_PATTERN)].map((match) => match[1]!)
}

const listToolSourceFiles = (dir: string): string[] => {
  const entries = readdirSync(dir)
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      files.push(...listToolSourceFiles(full))
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      files.push(full)
    }
  }
  return files
}

describe('logging privacy static closure', () => {
  const toolsDir = fileURLToPath(new URL('../../src/tools', import.meta.url))

  test('no registered tool factory logs an unreviewed dynamic field', () => {
    const violations = listToolSourceFiles(toolsDir).flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      return [...source.matchAll(LOG_CALL_PATTERN)].flatMap((call) =>
        metadataKeysOf(call[1]!)
          .filter((key) => BANNED_LOG_KEYS.has(key))
          .map((key) => `${file}: banned log metadata key "${key}"`),
      )
    })
    expect(violations).toEqual([])
  })

  test('tool failure logs use the controlled error class helper', () => {
    const violations = listToolSourceFiles(toolsDir)
      .filter((file) =>
        readFileSync(file, 'utf8').includes('error: error instanceof Error ? error.message : String(error)'),
      )
      .map((file) => `${file}: uncontrolled error.message in a log metadata field`)
    expect(violations).toEqual([])
  })
})
